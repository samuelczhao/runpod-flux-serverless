create or replace function public.record_generation_submission(
  p_job_id uuid,
  p_external_id text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_job public.generation_jobs%rowtype;
begin
  if nullif(trim(p_external_id), '') is null then
    raise exception 'invalid_external_id' using errcode = '22023';
  end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  if v_job.external_job_id = p_external_id and v_job.status in ('QUEUED', 'RUNNING', 'COMPLETED') then
    if v_job.stage = 'branch' then
      update public.scene_versions set status = 'PENDING'
      where id = v_job.scene_version_id and status in ('PENDING', 'SUBMIT_UNKNOWN');
    end if;
    return;
  end if;
  if v_job.status not in ('SUBMITTING', 'SUBMIT_UNKNOWN') then
    raise exception 'job_state_conflict' using errcode = '40001';
  end if;
  if v_job.stage = 'branch' then
    update public.scene_versions set status = 'PENDING'
    where id = v_job.scene_version_id and status in ('PENDING', 'SUBMIT_UNKNOWN');
    if not found then raise exception 'branch_version_state_conflict' using errcode = '40001'; end if;
  end if;
  update public.generation_jobs set external_job_id = p_external_id, status = 'QUEUED'
  where id = p_job_id;
end;
$$;

revoke all on function public.record_generation_submission(uuid, text) from public;
grant execute on function public.record_generation_submission(uuid, text) to service_role;
