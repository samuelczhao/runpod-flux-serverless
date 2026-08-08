create or replace function public.complete_audio_upload(
  p_dream_id uuid,
  p_user_id uuid,
  p_storage_path text,
  p_mime_type text,
  p_size_bytes integer
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
declare v_extension text;
declare v_expected_path text;
begin
  v_extension := case p_mime_type
    when 'audio/webm' then 'webm' when 'audio/mp4' then 'mp4' when 'audio/ogg' then 'ogg'
    else null end;
  if v_extension is null or p_size_bytes not between 1 and 10485760 then
    raise exception 'invalid_audio_metadata' using errcode = '22023';
  end if;
  v_expected_path := p_user_id::text || '/' || p_dream_id::text || '/source.' || v_extension;
  if p_storage_path <> v_expected_path then raise exception 'invalid_audio_path' using errcode = '22023'; end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'dream-audio' and object.name = p_storage_path
      and coalesce((object.metadata->>'size')::bigint, 0) = p_size_bytes
      and object.metadata->>'mimetype' = p_mime_type
  ) then raise exception 'audio_object_not_found' using errcode = 'P0002'; end if;
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then raise exception 'dream_not_found' using errcode = 'P0002'; end if;
  if v_dream.audio_storage_path = p_storage_path and v_dream.audio_mime_type = p_mime_type
    and v_dream.audio_size_bytes = p_size_bytes and v_dream.status <> 'DRAFT' then return; end if;
  if v_dream.input_mode <> 'audio' or v_dream.status <> 'DRAFT'
    or v_dream.audio_storage_path is not null then
    raise exception 'audio_upload_conflict' using errcode = '40001';
  end if;
  update public.dreams set status = 'UPLOADED', audio_storage_path = p_storage_path,
    audio_mime_type = p_mime_type, audio_size_bytes = p_size_bytes, audio_uploaded_at = now()
  where id = p_dream_id;
end;
$$;

create or replace function public.complete_transcription_job(
  p_job_id uuid,
  p_transcript text,
  p_delay_ms integer default null,
  p_execution_ms integer default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_job public.generation_jobs%rowtype;
declare v_dream public.dreams%rowtype;
declare v_transcript text;
begin
  v_transcript := trim(p_transcript);
  if nullif(v_transcript, '') is null or char_length(v_transcript) > 12000 then
    raise exception 'invalid_transcript' using errcode = '22023';
  end if;
  select * into v_job from public.generation_jobs where id = p_job_id for update;
  if v_job.id is null then raise exception 'job_not_found' using errcode = 'P0002'; end if;
  select * into v_dream from public.dreams where id = v_job.dream_id for update;
  if v_job.stage <> 'transcription' or v_job.scene_version_id is not null
    or v_dream.input_mode <> 'audio' then
    raise exception 'invalid_transcription_job' using errcode = '23514';
  end if;
  if v_job.status = 'COMPLETED' then
    if v_dream.transcript = v_transcript then return; end if;
    raise exception 'completion_conflict' using errcode = '40001';
  end if;
  if v_job.status not in ('QUEUED', 'RUNNING') or v_job.external_job_id is null
    or v_dream.status <> 'TRANSCRIBING' then
    raise exception 'job_state_conflict' using errcode = '40001';
  end if;
  update public.dreams set transcript = v_transcript, status = 'PLANNING', workflow_run_id = null
  where id = v_dream.id;
  update public.generation_jobs set status = 'COMPLETED', delay_ms = p_delay_ms,
    execution_ms = p_execution_ms, cost_source = 'unavailable' where id = p_job_id;
end;
$$;

create function public.prepare_audio_deletion(p_dream_id uuid) returns text
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  select * into v_dream from public.dreams where id = p_dream_id for update;
  if v_dream.id is null then raise exception 'dream_not_found' using errcode = 'P0002'; end if;
  if v_dream.audio_storage_path is null then return null; end if;
  if v_dream.input_mode <> 'audio' or v_dream.retain_audio
    or v_dream.status in ('DRAFT', 'UPLOADED', 'TRANSCRIBING') then
    raise exception 'audio_deletion_not_allowed' using errcode = '23514';
  end if;
  return v_dream.audio_storage_path;
end;
$$;

create or replace function public.mark_audio_deleted(p_dream_id uuid, p_storage_path text) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  select * into v_dream from public.dreams where id = p_dream_id for update;
  if v_dream.id is null then raise exception 'dream_not_found' using errcode = 'P0002'; end if;
  if v_dream.audio_storage_path is null then return; end if;
  if v_dream.audio_storage_path <> p_storage_path or v_dream.retain_audio
    or v_dream.status in ('DRAFT', 'UPLOADED', 'TRANSCRIBING') then
    raise exception 'audio_deletion_conflict' using errcode = '40001';
  end if;
  update public.dreams set audio_storage_path = null, audio_mime_type = null, audio_size_bytes = null
  where id = p_dream_id;
end;
$$;

revoke all on function public.prepare_audio_deletion(uuid) from public;
grant execute on function public.prepare_audio_deletion(uuid) to service_role;
