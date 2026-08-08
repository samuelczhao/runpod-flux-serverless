alter table public.dreams
  add column audio_storage_path text,
  add column plan_hash text,
  add column mood text[] not null default '{}';

alter table public.dreams alter column visual_bible type text
using visual_bible #>> '{}';

alter table public.scene_versions
  add column is_selected boolean not null default false,
  add constraint scene_version_shape_check check (
    (parent_version_id is null) = (edit_instruction is null)
  ),
  add constraint scene_version_parent_check check (parent_version_id is distinct from id),
  add constraint selected_version_ready_check check (
    not is_selected or (status = 'COMPLETED' and storage_path is not null)
  );

alter table public.generation_jobs drop constraint generation_jobs_cost_source_check;

alter table public.generation_jobs
  add column request_hash text,
  add constraint generation_jobs_cost_source_check check (
    (cost_usd is null and (cost_source is null or cost_source = 'unavailable')) or
    (cost_usd is not null and cost_source in ('provider', 'estimated'))
  );

create unique index dreams_workflow_run_idx on public.dreams (workflow_run_id)
where workflow_run_id is not null;
create unique index scene_versions_initial_idx on public.scene_versions (scene_id)
where parent_version_id is null;
create unique index scene_versions_selected_idx on public.scene_versions (scene_id)
where is_selected;
create unique index generation_jobs_version_idx on public.generation_jobs (scene_version_id)
where scene_version_id is not null;

drop policy dreams_owner_insert on public.dreams;
create policy dreams_owner_insert on public.dreams for insert with check (
  user_id = auth.uid() and status = 'DRAFT' and workflow_run_id is null
  and audio_storage_path is null and plan_hash is null
);

create function public.validate_scene_parent() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (
    new.scene_id is distinct from old.scene_id or
    new.parent_version_id is distinct from old.parent_version_id
  ) then raise exception 'scene_ancestry_immutable' using errcode = '23514'; end if;
  if new.parent_version_id is not null and not exists (
    select 1 from public.scene_versions parent
    where parent.id = new.parent_version_id and parent.scene_id = new.scene_id
      and parent.status = 'COMPLETED' and parent.storage_path is not null
  ) then raise exception 'invalid_scene_parent' using errcode = '23514'; end if;
  return new;
end;
$$;

create trigger scene_versions_validate_parent before insert or update on public.scene_versions
for each row execute function public.validate_scene_parent();

create or replace function public.is_valid_dream_transition(
  p_from public.dream_status,
  p_to public.dream_status
) returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('DRAFT', 'UPLOADED'), ('DRAFT', 'PLANNING'), ('DRAFT', 'DELETING'),
    ('UPLOADED', 'TRANSCRIBING'), ('UPLOADED', 'DELETING'),
    ('TRANSCRIBING', 'PLANNING'), ('TRANSCRIBING', 'FAILED'), ('TRANSCRIBING', 'DELETING'),
    ('PLANNING', 'GENERATING_ANCHOR'), ('PLANNING', 'FAILED'), ('PLANNING', 'DELETING'),
    ('GENERATING_ANCHOR', 'GENERATING_SCENES'), ('GENERATING_ANCHOR', 'FAILED'),
    ('GENERATING_ANCHOR', 'DELETING'), ('GENERATING_SCENES', 'READY'),
    ('GENERATING_SCENES', 'FAILED'), ('GENERATING_SCENES', 'DELETING'),
    ('READY', 'DELETING'), ('FAILED', 'DELETING')
  );
$$;

drop function public.apply_dream_plan(uuid, jsonb);
create function public.apply_dream_plan(
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
begin
  if p_plan_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_plan_hash' using errcode = '22023'; end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or jsonb_typeof(p_plan->'scenes') is distinct from 'array'
    or jsonb_array_length(p_plan->'scenes') <> 3
    or jsonb_typeof(p_plan->'motifs') is distinct from 'array'
    or jsonb_array_length(p_plan->'motifs') not between 1 and 8
    or jsonb_typeof(p_plan->'mood') is distinct from 'array'
  then raise exception 'invalid_plan_shape' using errcode = '22023'; end if;
  if nullif(trim(p_plan->>'title'), '') is null
    or nullif(trim(p_plan->>'summary'), '') is null
    or nullif(trim(p_plan->>'visual_bible'), '') is null
  then raise exception 'invalid_plan_content' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_plan->'scenes') item
    where jsonb_typeof(item) <> 'object' or nullif(trim(item->>'caption'), '') is null
      or nullif(trim(item->>'prompt'), '') is null)
  then raise exception 'invalid_scene_content' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_plan->'motifs') item
    where jsonb_typeof(item) <> 'object' or nullif(trim(item->>'label'), '') is null
      or item->>'kind' not in ('person', 'place', 'object', 'emotion', 'theme'))
  then raise exception 'invalid_motif_content' using errcode = '22023'; end if;
  if jsonb_array_length(p_plan->'mood') not between 1 and 6
    or exists (select 1 from jsonb_array_elements(p_plan->'mood') item
      where jsonb_typeof(item) <> 'string' or nullif(trim(item #>> '{}'), '') is null)
  then raise exception 'invalid_mood_content' using errcode = '22023'; end if;
  select * into v_dream from public.dreams where id = p_dream_id for update;
  if v_dream.id is null then raise exception 'dream_not_found' using errcode = 'P0002'; end if;
  if v_dream.status = 'GENERATING_ANCHOR' and v_dream.plan_hash = p_plan_hash
    and (select count(*) from public.scenes where dream_id = p_dream_id) = 3 then return; end if;
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

create function public.claim_dream_workflow(
  p_dream_id uuid,
  p_user_id uuid,
  p_claim_token text
) returns table(workflow_id text, claimed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  select * into v_dream from public.dreams where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then return; end if;
  if v_dream.workflow_run_id = p_claim_token then return query select p_claim_token, true; return; end if;
  if v_dream.workflow_run_id is not null then return query select v_dream.workflow_run_id, false; return; end if;
  if v_dream.input_mode = 'text' and v_dream.status = 'DRAFT'
    and nullif(trim(v_dream.transcript), '') is not null then
    update public.dreams set workflow_run_id = p_claim_token, status = 'PLANNING' where id = p_dream_id;
  elsif v_dream.input_mode = 'audio' and v_dream.status = 'UPLOADED'
    and v_dream.audio_storage_path like p_user_id::text || '/' || p_dream_id::text || '/%' then
    update public.dreams set workflow_run_id = p_claim_token, status = 'TRANSCRIBING' where id = p_dream_id;
  else raise exception 'dream_not_ready' using errcode = '23514'; end if;
  return query select p_claim_token, true;
end;
$$;

create function public.record_dream_workflow(
  p_dream_id uuid,
  p_claim_token text,
  p_run_id text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_current text;
begin
  select workflow_run_id into v_current from public.dreams where id = p_dream_id for update;
  if v_current = p_run_id then return; end if;
  if v_current <> p_claim_token then raise exception 'workflow_claim_conflict' using errcode = '40001'; end if;
  update public.dreams set workflow_run_id = p_run_id where id = p_dream_id;
end;
$$;

create function public.release_dream_workflow_claim(p_dream_id uuid, p_claim_token text) returns void
language sql security definer
set search_path = ''
as $$
  update public.dreams set workflow_run_id = null,
    status = case input_mode when 'text' then 'DRAFT'::public.dream_status else 'UPLOADED'::public.dream_status end
  where id = p_dream_id and workflow_run_id = p_claim_token
    and status in ('PLANNING', 'TRANSCRIBING');
$$;

revoke all on function public.validate_scene_parent() from public;
revoke all on function public.apply_dream_plan(uuid, jsonb, text) from public;
revoke all on function public.claim_dream_workflow(uuid, uuid, text) from public;
revoke all on function public.record_dream_workflow(uuid, text, text) from public;
revoke all on function public.release_dream_workflow_claim(uuid, text) from public;
grant execute on function public.apply_dream_plan(uuid, jsonb, text) to service_role;
grant execute on function public.claim_dream_workflow(uuid, uuid, text) to service_role;
grant execute on function public.record_dream_workflow(uuid, text, text) to service_role;
grant execute on function public.release_dream_workflow_claim(uuid, text) to service_role;
