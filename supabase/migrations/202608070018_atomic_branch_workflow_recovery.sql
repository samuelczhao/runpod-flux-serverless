create function public.release_branch_workflow_execution(
  p_version_id uuid,
  p_claim_token text,
  p_run_id text
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_claim_token), '') is null or nullif(trim(p_run_id), '') is null then
    raise exception 'invalid_workflow_identity' using errcode = '22023';
  end if;
  update public.scene_versions set workflow_run_id = null,
    workflow_claim_token = null, workflow_claimed_at = null
  where id = p_version_id and parent_version_id is not null and status = 'PENDING'
    and (
      (workflow_run_id = p_run_id and workflow_claim_token is null)
      or (workflow_run_id is null and workflow_claim_token = p_claim_token)
    );
end;
$$;

revoke all on function public.release_branch_workflow_execution(uuid, text, text) from public;
grant execute on function public.release_branch_workflow_execution(uuid, text, text) to service_role;
