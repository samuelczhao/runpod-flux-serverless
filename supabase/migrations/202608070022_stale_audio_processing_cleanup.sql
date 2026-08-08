create function public.expire_stale_audio_processing(
  p_dream_id uuid,
  p_user_id uuid
) returns text
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  if p_dream_id is null or p_user_id is null then
    raise exception 'invalid_audio_expiry' using errcode = '22023';
  end if;
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then return null; end if;
  if v_dream.input_mode <> 'audio' or v_dream.status not in ('UPLOADED', 'TRANSCRIBING')
    or v_dream.audio_upload_expires_at is null
    or now() < v_dream.audio_upload_expires_at + interval '6 hours' then
    return null;
  end if;
  update public.dreams set status = 'FAILED', failed_stage = 'transcription',
    error_code = 'audio_processing_expired', workflow_run_id = null
  where id = p_dream_id;
  return v_dream.workflow_run_id;
end;
$$;

revoke all on function public.expire_stale_audio_processing(uuid, uuid) from public;
grant execute on function public.expire_stale_audio_processing(uuid, uuid) to service_role;
