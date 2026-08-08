drop function public.complete_dream_plan(uuid, jsonb, text, numeric);

create function public.complete_dream_plan(
  p_job_id uuid,
  p_plan jsonb,
  p_plan_hash text,
  p_cost_usd numeric,
  p_cost_source text,
  p_delay_ms integer default null,
  p_execution_ms integer default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_job public.generation_jobs%rowtype;
declare v_plan_hash text;
begin
  if (p_cost_usd is null and p_cost_source is distinct from 'unavailable')
    or (p_cost_usd is not null and (p_cost_usd < 0 or p_cost_source not in ('provider', 'estimated')))
    or coalesce(p_delay_ms, 0) < 0 or coalesce(p_execution_ms, 0) < 0 then
    raise exception 'invalid_planning_metrics' using errcode = '22023';
  end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  if v_job.stage <> 'plan' or v_job.scene_version_id is not null or v_job.external_job_id is null then
    raise exception 'invalid_planning_job' using errcode = '23514';
  end if;
  if v_job.status = 'COMPLETED' then
    select plan_hash into v_plan_hash from public.dreams where id = v_job.dream_id;
    if v_plan_hash = p_plan_hash and v_job.cost_usd is not distinct from p_cost_usd
      and v_job.cost_source is not distinct from p_cost_source then return; end if;
    raise exception 'completion_conflict' using errcode = '40001';
  end if;
  if v_job.status not in ('QUEUED', 'RUNNING') then
    raise exception 'job_state_conflict' using errcode = '40001';
  end if;
  perform public.apply_dream_plan(v_job.dream_id, p_plan, p_plan_hash);
  update public.generation_jobs set status = 'COMPLETED', cost_usd = p_cost_usd,
    cost_source = p_cost_source, delay_ms = p_delay_ms, execution_ms = p_execution_ms
  where id = p_job_id;
end;
$$;

revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on all functions in schema public to service_role;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
alter default privileges in schema public grant execute on functions to service_role;
