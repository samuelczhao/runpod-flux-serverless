alter table public.scenes drop constraint scenes_ordinal_check;
alter table public.scenes add constraint scenes_ordinal_check check (ordinal between 1 and 6);

create or replace function public.apply_dream_plan(
  p_dream_id uuid,
  p_plan jsonb,
  p_plan_hash text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_dream public.dreams%rowtype;
  v_motif jsonb;
  v_motif_id uuid;
  v_label text;
  v_slug text;
  v_scene_count integer;
begin
  if p_plan_hash is null or p_plan_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_plan_hash' using errcode = '22023';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or jsonb_typeof(p_plan->'scenes') is distinct from 'array'
    or jsonb_typeof(p_plan->'motifs') is distinct from 'array'
    or jsonb_typeof(p_plan->'mood') is distinct from 'array' then
    raise exception 'invalid_plan_shape' using errcode = '22023';
  end if;
  v_scene_count := jsonb_array_length(p_plan->'scenes');
  if v_scene_count not between 1 and 6
    or jsonb_array_length(p_plan->'motifs') not between 1 and 8 then
    raise exception 'invalid_plan_shape' using errcode = '22023';
  end if;
  if nullif(trim(p_plan->>'title'), '') is null
    or nullif(trim(p_plan->>'summary'), '') is null
    or nullif(trim(p_plan->>'visual_bible'), '') is null then
    raise exception 'invalid_plan_content' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_plan->'scenes') item
    where jsonb_typeof(item) <> 'object'
      or nullif(trim(item->>'caption'), '') is null
      or nullif(trim(item->>'prompt'), '') is null
  ) then raise exception 'invalid_scene_content' using errcode = '22023'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_plan->'motifs') item
    where jsonb_typeof(item) <> 'object'
      or nullif(trim(item->>'label'), '') is null
      or item->>'kind' not in ('person', 'place', 'object', 'emotion', 'theme')
  ) then raise exception 'invalid_motif_content' using errcode = '22023'; end if;
  if jsonb_array_length(p_plan->'mood') not between 1 and 3
    or exists (
      select 1 from jsonb_array_elements(p_plan->'mood') item
      where jsonb_typeof(item) <> 'string' or nullif(trim(item #>> '{}'), '') is null
    ) then raise exception 'invalid_mood_content' using errcode = '22023'; end if;
  select * into v_dream from public.dreams where id = p_dream_id for update;
  if v_dream.id is null then raise exception 'dream_not_found' using errcode = 'P0002'; end if;
  if v_dream.status = 'GENERATING_ANCHOR' and v_dream.plan_hash = p_plan_hash
    and (select count(*) from public.scenes where dream_id = p_dream_id) = v_scene_count then
    return;
  end if;
  if v_dream.status <> 'PLANNING' then raise exception 'state_conflict' using errcode = '40001'; end if;
  update public.dreams set title = p_plan->>'title', summary = p_plan->>'summary',
    visual_bible = p_plan->>'visual_bible', plan_hash = p_plan_hash,
    mood = array(select jsonb_array_elements_text(p_plan->'mood'))
  where id = p_dream_id;
  insert into public.scenes (dream_id, ordinal, caption, prompt)
  select p_dream_id, item.ordinality::smallint, item.value->>'caption', item.value->>'prompt'
  from jsonb_array_elements(p_plan->'scenes') with ordinality as item(value, ordinality);
  for v_motif in select value from jsonb_array_elements(p_plan->'motifs') loop
    v_label := trim(v_motif->>'label');
    v_slug := trim(both '-' from regexp_replace(lower(v_label), '[^a-z0-9]+', '-', 'g'));
    if v_slug = '' then v_slug := 'motif-' || substr(md5(v_label), 1, 12); end if;
    insert into public.motifs (user_id, canonical_label, slug, kind)
    values (v_dream.user_id, v_label, v_slug, (v_motif->>'kind')::public.motif_kind)
    on conflict (user_id, slug) do update set canonical_label = excluded.canonical_label
    returning id into v_motif_id;
    insert into public.dream_motifs (dream_id, motif_id) values (p_dream_id, v_motif_id)
    on conflict do nothing;
  end loop;
  update public.dreams set status = 'GENERATING_ANCHOR' where id = p_dream_id;
end;
$$;

create or replace function public.claim_generation_job(
  p_user_id uuid,
  p_dream_id uuid,
  p_scene_version_id uuid,
  p_stage text,
  p_operation_key text,
  p_model text,
  p_endpoint_id text,
  p_request_hash text
) returns table(job_id uuid, job_status public.job_status, external_id text, claimed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
declare v_job public.generation_jobs%rowtype;
declare v_ordinal smallint;
declare v_parent_id uuid;
begin
  if p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$'
    or nullif(trim(p_operation_key), '') is null
    or nullif(trim(p_model), '') is null
    or nullif(trim(p_endpoint_id), '') is null then
    raise exception 'invalid_job_identity' using errcode = '22023';
  end if;
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then raise exception 'dream_owner_mismatch' using errcode = '23514'; end if;
  if p_scene_version_id is not null then
    select scene.ordinal, version.parent_version_id into v_ordinal, v_parent_id
    from public.scene_versions version join public.scenes scene on scene.id = version.scene_id
    where version.id = p_scene_version_id and scene.dream_id = p_dream_id;
    if v_ordinal is null then raise exception 'version_dream_mismatch' using errcode = '23514'; end if;
  end if;
  if (p_stage = 'transcription' and (p_scene_version_id is not null or v_dream.input_mode <> 'audio'
      or v_dream.status <> 'TRANSCRIBING' or v_dream.audio_storage_path is null))
    or (p_stage = 'plan' and (p_scene_version_id is not null or v_dream.status <> 'PLANNING'
      or nullif(trim(v_dream.transcript), '') is null))
    or (p_stage = 'anchor' and (p_scene_version_id is null
      or v_dream.status <> 'GENERATING_ANCHOR' or v_ordinal <> 1 or v_parent_id is not null))
    or (p_stage = 'scene' and (p_scene_version_id is null
      or v_dream.status <> 'GENERATING_SCENES'
      or v_ordinal not between 2 and 6 or v_parent_id is not null))
    or (p_stage = 'branch' and (v_dream.status <> 'READY' or v_ordinal is null or v_parent_id is null))
    or p_stage not in ('transcription', 'plan', 'anchor', 'scene', 'branch') then
    raise exception 'job_stage_mismatch' using errcode = '23514';
  end if;
  insert into public.generation_jobs (
    user_id, dream_id, scene_version_id, stage, operation_key, model,
    endpoint_id, request_hash, status
  ) values (
    p_user_id, p_dream_id, p_scene_version_id, p_stage, p_operation_key, p_model,
    p_endpoint_id, p_request_hash, 'SUBMITTING'
  ) on conflict (user_id, operation_key) do nothing;
  if found then
    select * into v_job from public.generation_jobs
    where user_id = p_user_id and operation_key = p_operation_key;
    return query select v_job.id, v_job.status, v_job.external_job_id, true;
    return;
  end if;
  select * into v_job from public.generation_jobs
  where user_id = p_user_id and operation_key = p_operation_key for update;
  if v_job.dream_id <> p_dream_id
    or v_job.scene_version_id is distinct from p_scene_version_id
    or v_job.stage <> p_stage or v_job.model <> p_model
    or v_job.endpoint_id is distinct from p_endpoint_id
    or v_job.request_hash is distinct from p_request_hash then
    raise exception 'idempotency_conflict' using errcode = '23505';
  end if;
  return query select v_job.id, v_job.status, v_job.external_job_id, false;
end;
$$;

create or replace function public.complete_generation_job(
  p_job_id uuid,
  p_storage_path text,
  p_cost_usd numeric,
  p_cost_source text,
  p_delay_ms integer default null,
  p_execution_ms integer default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_job public.generation_jobs%rowtype;
declare v_version public.scene_versions%rowtype;
declare v_scene_id uuid;
declare v_ordinal smallint;
declare v_expected_path text;
declare v_dream_status public.dream_status;
begin
  if (p_cost_usd is null and p_cost_source is distinct from 'unavailable')
    or (p_cost_usd is not null and p_cost_source not in ('provider', 'estimated')) then
    raise exception 'invalid_cost' using errcode = '22023';
  end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  select version.scene_id, scene.ordinal into v_scene_id, v_ordinal
  from public.scene_versions version join public.scenes scene on scene.id = version.scene_id
  where version.id = v_job.scene_version_id;
  if v_scene_id is null then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  perform 1 from public.scenes where id = v_scene_id for update;
  select * into v_version from public.scene_versions where id = v_job.scene_version_id for update;
  v_expected_path := v_job.user_id::text || '/' || v_job.dream_id::text || '/' || v_version.id::text || '.png';
  if p_storage_path <> v_expected_path or not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'dream-images' and object.name = p_storage_path
  ) then raise exception 'invalid_storage_artifact' using errcode = '23514'; end if;
  if v_job.status = 'COMPLETED' then
    if v_version.status = 'COMPLETED' and v_version.storage_path = p_storage_path
      and v_job.cost_usd is not distinct from p_cost_usd
      and v_job.cost_source is not distinct from p_cost_source then return; end if;
    raise exception 'completion_conflict' using errcode = '40001';
  end if;
  if v_job.status not in ('QUEUED', 'RUNNING') or v_version.status <> 'PENDING' then
    raise exception 'job_state_conflict' using errcode = '40001';
  end if;
  if (v_job.stage = 'anchor' and (v_ordinal <> 1 or v_version.parent_version_id is not null))
    or (v_job.stage = 'scene' and (v_ordinal not between 2 and 6 or v_version.parent_version_id is not null))
    or (v_job.stage = 'branch' and v_version.parent_version_id is null)
    or v_job.stage not in ('anchor', 'scene', 'branch') then
    raise exception 'stage_scene_mismatch' using errcode = '23514';
  end if;
  update public.scene_versions set storage_path = p_storage_path, status = 'COMPLETED'
  where id = v_version.id;
  if v_job.stage in ('anchor', 'scene') then
    update public.scene_versions set is_selected = false where scene_id = v_scene_id and is_selected;
    update public.scene_versions set is_selected = true where id = v_version.id;
  end if;
  update public.generation_jobs set status = 'COMPLETED', cost_usd = p_cost_usd,
    cost_source = p_cost_source, delay_ms = p_delay_ms, execution_ms = p_execution_ms
  where id = p_job_id;
  if v_job.stage = 'anchor' then
    select status into v_dream_status from public.dreams where id = v_job.dream_id for update;
    if v_dream_status = 'GENERATING_ANCHOR' then
      update public.dreams set status = 'GENERATING_SCENES' where id = v_job.dream_id;
    elsif v_dream_status <> 'GENERATING_SCENES' then
      raise exception 'state_conflict' using errcode = '40001';
    end if;
  end if;
end;
$$;

create or replace function public.finalize_dream(p_dream_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_status public.dream_status;
declare v_scene_count integer;
declare v_ready_count integer;
begin
  select status into v_status from public.dreams where id = p_dream_id for update;
  if v_status = 'READY' then return; end if;
  if v_status <> 'GENERATING_SCENES' then raise exception 'state_conflict' using errcode = '40001'; end if;
  select count(*) into v_scene_count from public.scenes where dream_id = p_dream_id;
  select count(*) into v_ready_count from public.scenes scene
  join public.scene_versions version on version.scene_id = scene.id
  where scene.dream_id = p_dream_id and version.is_selected
    and version.status = 'COMPLETED' and version.storage_path is not null;
  if v_scene_count not between 1 and 6 or v_ready_count <> v_scene_count then
    raise exception 'dream_not_ready' using errcode = '23514';
  end if;
  update public.dreams set status = 'READY' where id = p_dream_id;
end;
$$;

revoke all on function public.apply_dream_plan(uuid, jsonb, text) from public, anon, authenticated;
revoke all on function public.claim_generation_job(uuid, uuid, uuid, text, text, text, text, text)
  from public, anon, authenticated;
revoke all on function public.complete_generation_job(uuid, text, numeric, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.finalize_dream(uuid) from public, anon, authenticated;
grant execute on function public.apply_dream_plan(uuid, jsonb, text) to service_role;
grant execute on function public.claim_generation_job(uuid, uuid, uuid, text, text, text, text, text)
  to service_role;
grant execute on function public.complete_generation_job(uuid, text, numeric, text, integer, integer)
  to service_role;
grant execute on function public.finalize_dream(uuid) to service_role;
