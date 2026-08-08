create or replace function public.update_generation_job(
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
declare v_job public.generation_jobs%rowtype;
begin
  if (p_expected, p_next) not in (
    ('SUBMITTING', 'SUBMIT_UNKNOWN'), ('SUBMITTING', 'FAILED'),
    ('QUEUED', 'RUNNING'), ('QUEUED', 'FAILED'), ('QUEUED', 'CANCELLED'),
    ('RUNNING', 'RUNNING'), ('RUNNING', 'FAILED'), ('RUNNING', 'CANCELLED')
  ) then raise exception 'invalid_job_transition' using errcode = '22023'; end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  if v_job.status = p_next then return; end if;
  if v_job.status <> p_expected then raise exception 'job_state_conflict' using errcode = '40001'; end if;
  update public.generation_jobs set status = p_next, delay_ms = coalesce(p_delay_ms, delay_ms),
    execution_ms = coalesce(p_execution_ms, execution_ms), error_code = p_error_code
  where id = p_job_id;
  if v_job.stage = 'branch' and p_next in ('FAILED', 'CANCELLED') then
    update public.scene_versions set status = p_next where id = v_job.scene_version_id and status = 'PENDING';
  end if;
end;
$$;
