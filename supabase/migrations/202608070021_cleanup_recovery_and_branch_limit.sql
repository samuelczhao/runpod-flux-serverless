create unique index scene_versions_single_branch_idx
on public.scene_versions (scene_id)
where parent_version_id is not null;

create function public.complete_audio_cleanup_workflow(
  p_dream_id uuid,
  p_run_id text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  if nullif(trim(p_run_id), '') is null then
    raise exception 'invalid_cleanup_run' using errcode = '22023';
  end if;
  select * into v_dream from public.dreams where id = p_dream_id for update;
  if v_dream.id is null then return; end if;
  if v_dream.audio_upload_expires_at is null
    and v_dream.audio_cleanup_run_id is null then return; end if;
  if v_dream.audio_cleanup_run_id is distinct from p_run_id
    or v_dream.status in ('DRAFT', 'UPLOADED', 'TRANSCRIBING', 'DELETING')
    or (not v_dream.retain_audio and v_dream.audio_storage_path is not null) then
    raise exception 'audio_cleanup_completion_conflict' using errcode = '40001';
  end if;
  update public.dreams set audio_upload_expires_at = null,
    audio_cleanup_run_id = null, audio_cleanup_claim_token = null,
    audio_cleanup_claimed_at = null where id = p_dream_id;
end;
$$;

revoke all on function public.complete_audio_cleanup_workflow(uuid, text) from public;
grant execute on function public.complete_audio_cleanup_workflow(uuid, text) to service_role;
