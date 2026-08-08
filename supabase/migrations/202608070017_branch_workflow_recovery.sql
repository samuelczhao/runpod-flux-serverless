create function public.release_branch_workflow_run(
  p_version_id uuid,
  p_run_id text
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_run_id), '') is null then
    raise exception 'invalid_workflow_run' using errcode = '22023';
  end if;
  update public.scene_versions set workflow_run_id = null
  where id = p_version_id and workflow_run_id = p_run_id and status = 'PENDING';
end;
$$;

revoke all on function public.release_branch_workflow_run(uuid, text) from public;
grant execute on function public.release_branch_workflow_run(uuid, text) to service_role;
