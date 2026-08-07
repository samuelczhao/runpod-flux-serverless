alter table public.generation_jobs alter column request_hash set not null;

create function public.claim_generation_job(
  p_user_id uuid,
  p_dream_id uuid,
  p_scene_version_id uuid,
  p_stage text,
  p_operation_key text,
  p_model text,
  p_request_hash text
) returns table(job_id uuid, job_status public.job_status, external_id text, claimed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare v_job public.generation_jobs%rowtype;
begin
  if p_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid_request_hash' using errcode = '22023'; end if;
  if not exists (select 1 from public.dreams where id = p_dream_id and user_id = p_user_id) then
    raise exception 'dream_owner_mismatch' using errcode = '23514';
  end if;
  if p_scene_version_id is not null and not exists (
    select 1 from public.scene_versions version join public.scenes scene on scene.id = version.scene_id
    where version.id = p_scene_version_id and scene.dream_id = p_dream_id
  ) then raise exception 'version_dream_mismatch' using errcode = '23514'; end if;
  insert into public.generation_jobs (
    user_id, dream_id, scene_version_id, stage, operation_key, model, request_hash, status
  ) values (
    p_user_id, p_dream_id, p_scene_version_id, p_stage, p_operation_key, p_model, p_request_hash, 'SUBMITTING'
  ) on conflict (user_id, operation_key) do nothing;
  if found then
    select * into v_job from public.generation_jobs
    where user_id = p_user_id and operation_key = p_operation_key;
    return query select v_job.id, v_job.status, v_job.external_job_id, true;
    return;
  end if;
  select * into v_job from public.generation_jobs
  where user_id = p_user_id and operation_key = p_operation_key for update;
  if v_job.dream_id <> p_dream_id or v_job.scene_version_id is distinct from p_scene_version_id
    or v_job.stage <> p_stage or v_job.model <> p_model or v_job.request_hash <> p_request_hash
  then raise exception 'idempotency_conflict' using errcode = '23505'; end if;
  return query select v_job.id, v_job.status, v_job.external_job_id, false;
end;
$$;

create function public.record_generation_submission(p_job_id uuid, p_external_id text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_job public.generation_jobs%rowtype;
begin
  if nullif(trim(p_external_id), '') is null then raise exception 'invalid_external_id' using errcode = '22023'; end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  if v_job.external_job_id = p_external_id and v_job.status in ('QUEUED', 'RUNNING', 'COMPLETED') then return; end if;
  if v_job.status not in ('SUBMITTING', 'SUBMIT_UNKNOWN') then
    raise exception 'job_state_conflict' using errcode = '40001';
  end if;
  update public.generation_jobs set external_job_id = p_external_id, status = 'QUEUED' where id = p_job_id;
end;
$$;

create function public.update_generation_job(
  p_job_id uuid,
  p_expected public.job_status,
  p_next public.job_status,
  p_delay_ms integer default null,
  p_execution_ms integer default null,
  p_error_code text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_current public.job_status;
begin
  if (p_expected, p_next) not in (
    ('SUBMITTING', 'SUBMIT_UNKNOWN'), ('SUBMITTING', 'FAILED'),
    ('QUEUED', 'RUNNING'), ('QUEUED', 'FAILED'), ('QUEUED', 'CANCELLED'),
    ('RUNNING', 'RUNNING'), ('RUNNING', 'FAILED'), ('RUNNING', 'CANCELLED')
  ) then raise exception 'invalid_job_transition' using errcode = '22023'; end if;
  update public.generation_jobs set status = p_next, delay_ms = coalesce(p_delay_ms, delay_ms),
    execution_ms = coalesce(p_execution_ms, execution_ms), error_code = p_error_code
  where id = p_job_id and status = p_expected;
  if found then return; end if;
  select status into v_current from public.generation_jobs where id = p_job_id;
  if v_current = p_next then return; end if;
  raise exception 'job_state_conflict' using errcode = '40001';
end;
$$;

create function public.complete_dream_plan(
  p_job_id uuid,
  p_plan jsonb,
  p_plan_hash text,
  p_cost_usd numeric
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_job public.generation_jobs%rowtype;
declare v_plan_hash text;
begin
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  if v_job.stage <> 'plan' or v_job.scene_version_id is not null then
    raise exception 'invalid_planning_job' using errcode = '23514';
  end if;
  if v_job.status = 'COMPLETED' then
    select plan_hash into v_plan_hash from public.dreams where id = v_job.dream_id;
    if v_plan_hash = p_plan_hash and v_job.cost_usd = p_cost_usd then return; end if;
    raise exception 'completion_conflict' using errcode = '40001';
  end if;
  if v_job.status <> 'SUBMITTING' then raise exception 'job_state_conflict' using errcode = '40001'; end if;
  perform public.apply_dream_plan(v_job.dream_id, p_plan, p_plan_hash);
  update public.generation_jobs set status = 'COMPLETED', cost_usd = p_cost_usd,
    cost_source = 'estimated' where id = p_job_id;
end;
$$;

create function public.complete_generation_job(
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
declare
  v_job public.generation_jobs%rowtype;
  v_version public.scene_versions%rowtype;
  v_ordinal smallint;
  v_dream_status public.dream_status;
begin
  if nullif(trim(p_storage_path), '') is null then raise exception 'invalid_storage_path' using errcode = '22023'; end if;
  if (p_cost_usd is null and p_cost_source is distinct from 'unavailable')
    or (p_cost_usd is not null and (p_cost_source is null or p_cost_source not in ('provider', 'estimated')))
  then raise exception 'invalid_cost' using errcode = '22023'; end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  select * into v_version from public.scene_versions
  where id = v_job.scene_version_id for update;
  select ordinal into v_ordinal from public.scenes where id = v_version.scene_id;
  if v_version.id is null then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  if v_job.status = 'COMPLETED' then
    if v_version.storage_path = p_storage_path and v_job.cost_usd is not distinct from p_cost_usd
      and v_job.cost_source = p_cost_source and v_version.is_selected then return; end if;
    raise exception 'completion_conflict' using errcode = '40001';
  end if;
  if v_job.status not in ('QUEUED', 'RUNNING') or v_version.status <> 'PENDING' then
    raise exception 'job_state_conflict' using errcode = '40001';
  end if;
  if (v_job.stage = 'anchor' and v_ordinal <> 1)
    or (v_job.stage = 'scene' and v_ordinal not between 2 and 3)
  then raise exception 'stage_scene_mismatch' using errcode = '23514'; end if;
  update public.scene_versions set is_selected = false where scene_id = v_version.scene_id and is_selected;
  update public.scene_versions set storage_path = p_storage_path, status = 'COMPLETED', is_selected = true
  where id = v_version.id;
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
declare v_ready_count integer;
begin
  select status into v_status from public.dreams where id = p_dream_id for update;
  if v_status = 'READY' then return; end if;
  if v_status <> 'GENERATING_SCENES' then raise exception 'state_conflict' using errcode = '40001'; end if;
  select count(*) into v_ready_count from public.scenes scene
  join public.scene_versions version on version.scene_id = scene.id
  where scene.dream_id = p_dream_id and version.is_selected
    and version.status = 'COMPLETED' and version.storage_path is not null;
  if v_ready_count <> 3 then raise exception 'dream_not_ready' using errcode = '23514'; end if;
  update public.dreams set status = 'READY' where id = p_dream_id;
end;
$$;

revoke all on function public.claim_generation_job(uuid, uuid, uuid, text, text, text, text) from public;
revoke all on function public.record_generation_submission(uuid, text) from public;
revoke all on function public.update_generation_job(uuid, public.job_status, public.job_status, integer, integer, text) from public;
revoke all on function public.complete_dream_plan(uuid, jsonb, text, numeric) from public;
revoke all on function public.complete_generation_job(uuid, text, numeric, text, integer, integer) from public;
grant execute on function public.claim_generation_job(uuid, uuid, uuid, text, text, text, text) to service_role;
grant execute on function public.record_generation_submission(uuid, text) to service_role;
grant execute on function public.update_generation_job(uuid, public.job_status, public.job_status, integer, integer, text) to service_role;
grant execute on function public.complete_dream_plan(uuid, jsonb, text, numeric) to service_role;
grant execute on function public.complete_generation_job(uuid, text, numeric, text, integer, integer) to service_role;
