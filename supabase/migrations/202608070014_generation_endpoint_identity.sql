alter table public.generation_jobs
  add column endpoint_id text,
  add constraint generation_jobs_endpoint_check check (
    endpoint_id is null or nullif(trim(endpoint_id), '') is not null
  );

alter table public.scene_versions drop constraint branch_identity_shape_check;
alter table public.scene_versions add constraint branch_identity_shape_check check (
  (parent_version_id is null and operation_key is null and request_hash is null)
  or (parent_version_id is not null and seed is not null
    and nullif(trim(operation_key), '') is not null
    and request_hash is not null and request_hash ~ '^[0-9a-f]{64}$')
);

drop function public.claim_generation_job(uuid, uuid, uuid, text, text, text, text);
create function public.claim_generation_job(
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
    or (p_stage = 'anchor' and (v_dream.status <> 'GENERATING_ANCHOR' or v_ordinal <> 1
      or v_parent_id is not null))
    or (p_stage = 'scene' and (v_dream.status <> 'GENERATING_SCENES' or v_ordinal not between 2 and 3
      or v_parent_id is not null))
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
    return query select v_job.id, v_job.status, v_job.external_job_id, true; return;
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

create or replace function public.create_scene_branch(
  p_user_id uuid,
  p_dream_id uuid,
  p_parent_version_id uuid,
  p_instruction text,
  p_model text,
  p_seed bigint,
  p_operation_key text,
  p_request_hash text
) returns table(version_id uuid, claimed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
declare v_parent public.scene_versions%rowtype;
declare v_existing public.scene_versions%rowtype;
declare v_scene_id uuid;
declare v_instruction text;
declare v_version_id uuid;
begin
  v_instruction := trim(p_instruction);
  if nullif(v_instruction, '') is null or char_length(v_instruction) > 1000
    or nullif(trim(p_model), '') is null or p_seed is null or p_seed < 0
    or nullif(trim(p_operation_key), '') is null
    or p_request_hash is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_branch_input' using errcode = '22023';
  end if;
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then raise exception 'dream_not_found' using errcode = 'P0002'; end if;
  if v_dream.status <> 'READY' then raise exception 'dream_not_ready' using errcode = '23514'; end if;
  select parent.scene_id into v_scene_id from public.scene_versions parent
  join public.scenes scene on scene.id = parent.scene_id
  where parent.id = p_parent_version_id and scene.dream_id = p_dream_id;
  if v_scene_id is null then raise exception 'parent_not_found' using errcode = 'P0002'; end if;
  perform 1 from public.scenes where id = v_scene_id for update;
  select * into v_parent from public.scene_versions where id = p_parent_version_id for update;
  if v_parent.status <> 'COMPLETED' or v_parent.storage_path is null then
    raise exception 'invalid_branch_parent' using errcode = '23514';
  end if;
  select * into v_existing from public.scene_versions
  where operation_key = p_operation_key for update;
  if v_existing.id is not null then
    if v_existing.scene_id = v_scene_id and v_existing.parent_version_id = p_parent_version_id
      and v_existing.edit_instruction = v_instruction and v_existing.model = p_model
      and v_existing.seed = p_seed and v_existing.request_hash = p_request_hash then
      return query select v_existing.id, false; return;
    end if;
    raise exception 'idempotency_conflict' using errcode = '23505';
  end if;
  insert into public.scene_versions (
    scene_id, parent_version_id, edit_instruction, model, seed, operation_key, request_hash
  ) values (
    v_scene_id, p_parent_version_id, v_instruction, p_model, p_seed, p_operation_key, p_request_hash
  ) returning id into v_version_id;
  return query select v_version_id, true;
end;
$$;

revoke all on function public.claim_generation_job(uuid, uuid, uuid, text, text, text, text, text) from public;
grant execute on function public.claim_generation_job(uuid, uuid, uuid, text, text, text, text, text) to service_role;
revoke all on function public.create_scene_branch(uuid, uuid, uuid, text, text, bigint, text, text) from public;
grant execute on function public.create_scene_branch(uuid, uuid, uuid, text, text, bigint, text, text) to service_role;
