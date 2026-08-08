alter table public.dreams
  add column audio_mime_type text,
  add column audio_size_bytes integer,
  add column audio_uploaded_at timestamptz,
  add constraint dream_audio_metadata_check check (
    (audio_storage_path is null and audio_mime_type is null and audio_size_bytes is null)
    or (input_mode = 'audio' and audio_storage_path is not null
      and audio_mime_type in ('audio/webm', 'audio/mp4', 'audio/ogg')
      and audio_size_bytes between 1 and 10485760 and audio_uploaded_at is not null)
  ),
  add constraint text_dream_payload_check check (
    input_mode <> 'text' or nullif(trim(transcript), '') is not null
  ),
  add constraint audio_early_transcript_check check (
    input_mode <> 'audio' or status not in ('DRAFT', 'UPLOADED', 'TRANSCRIBING') or transcript is null
  ),
  add constraint audio_state_object_check check (
    status not in ('UPLOADED', 'TRANSCRIBING')
    or (input_mode = 'audio' and audio_storage_path is not null)
  ),
  add constraint planned_state_transcript_check check (
    status not in ('PLANNING', 'GENERATING_ANCHOR', 'GENERATING_SCENES', 'READY')
    or nullif(trim(transcript), '') is not null
  ),
  add constraint audio_path_shape_check check (
    audio_storage_path is null or audio_storage_path ~
      ('^' || user_id::text || '/' || id::text || '/source\.(webm|mp4|ogg)$')
  );

alter table public.generation_jobs
  add constraint generation_job_stage_check check (
    stage in ('transcription', 'plan', 'anchor', 'scene', 'branch')
  ),
  add constraint generation_job_version_shape_check check (
    (stage in ('transcription', 'plan') and scene_version_id is null)
    or (stage in ('anchor', 'scene', 'branch') and scene_version_id is not null)
  );

drop policy dream_storage_owner_insert on storage.objects;
drop policy dream_storage_owner_delete on storage.objects;

update storage.buckets set allowed_mime_types = array['audio/webm', 'audio/mp4', 'audio/ogg']
where id = 'dream-audio';
update storage.buckets set allowed_mime_types = array['image/png'] where id = 'dream-images';

drop policy dreams_owner_insert on public.dreams;
create policy dreams_owner_insert on public.dreams for insert with check (
  user_id = auth.uid() and status = 'DRAFT' and workflow_run_id is null
  and audio_storage_path is null and plan_hash is null
  and ((input_mode = 'text' and nullif(trim(transcript), '') is not null)
    or (input_mode = 'audio' and transcript is null))
);

create function public.complete_audio_upload(
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
  ) then raise exception 'audio_object_not_found' using errcode = 'P0002'; end if;
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then raise exception 'dream_not_found' using errcode = 'P0002'; end if;
  if v_dream.status = 'UPLOADED' and v_dream.audio_storage_path = p_storage_path
    and v_dream.audio_mime_type = p_mime_type and v_dream.audio_size_bytes = p_size_bytes then return; end if;
  if v_dream.input_mode <> 'audio' or v_dream.status <> 'DRAFT'
    or v_dream.audio_storage_path is not null then
    raise exception 'audio_upload_conflict' using errcode = '40001';
  end if;
  update public.dreams set status = 'UPLOADED', audio_storage_path = p_storage_path,
    audio_mime_type = p_mime_type, audio_size_bytes = p_size_bytes, audio_uploaded_at = now()
  where id = p_dream_id;
end;
$$;

create function public.complete_transcription_job(
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
begin
  if nullif(trim(p_transcript), '') is null or char_length(p_transcript) > 12000 then
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
    if v_dream.transcript = p_transcript then return; end if;
    raise exception 'completion_conflict' using errcode = '40001';
  end if;
  if v_job.status not in ('QUEUED', 'RUNNING') or v_dream.status <> 'TRANSCRIBING' then
    raise exception 'job_state_conflict' using errcode = '40001';
  end if;
  update public.dreams set transcript = trim(p_transcript), status = 'PLANNING', workflow_run_id = null
  where id = v_dream.id;
  update public.generation_jobs set status = 'COMPLETED', delay_ms = p_delay_ms,
    execution_ms = p_execution_ms, cost_source = 'unavailable' where id = p_job_id;
end;
$$;

create function public.claim_audio_plan_workflow(
  p_dream_id uuid,
  p_user_id uuid,
  p_transcript text,
  p_claim_token text
) returns table(workflow_id text, claimed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  if nullif(trim(p_transcript), '') is null or char_length(p_transcript) > 12000 then
    raise exception 'invalid_transcript' using errcode = '22023';
  end if;
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then return; end if;
  if v_dream.workflow_run_id = p_claim_token then return query select p_claim_token, true; return; end if;
  if v_dream.workflow_run_id is not null then return query select v_dream.workflow_run_id, false; return; end if;
  if v_dream.input_mode <> 'audio' or v_dream.status <> 'PLANNING'
    or v_dream.audio_uploaded_at is null then
    raise exception 'dream_not_ready' using errcode = '23514';
  end if;
  update public.dreams set transcript = trim(p_transcript), workflow_run_id = p_claim_token
  where id = p_dream_id;
  return query select p_claim_token, true;
end;
$$;

create function public.mark_audio_deleted(p_dream_id uuid, p_storage_path text) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.dreams set audio_storage_path = null, audio_mime_type = null, audio_size_bytes = null
  where id = p_dream_id and audio_storage_path = p_storage_path and not retain_audio
    and status not in ('DRAFT', 'UPLOADED', 'TRANSCRIBING');
end;
$$;

create or replace function public.release_dream_workflow_claim(
  p_dream_id uuid,
  p_claim_token text
) returns void
language sql security definer
set search_path = ''
as $$
  update public.dreams set workflow_run_id = null,
    status = case
      when input_mode = 'text' then 'DRAFT'::public.dream_status
      when status = 'TRANSCRIBING' then 'UPLOADED'::public.dream_status
      else status
    end
  where id = p_dream_id and workflow_run_id = p_claim_token
    and status in ('PLANNING', 'TRANSCRIBING');
$$;

revoke all on function public.complete_audio_upload(uuid, uuid, text, text, integer) from public;
revoke all on function public.complete_transcription_job(uuid, text, integer, integer) from public;
revoke all on function public.claim_audio_plan_workflow(uuid, uuid, text, text) from public;
revoke all on function public.mark_audio_deleted(uuid, text) from public;
grant execute on function public.complete_audio_upload(uuid, uuid, text, text, integer) to service_role;
grant execute on function public.complete_transcription_job(uuid, text, integer, integer) to service_role;
grant execute on function public.claim_audio_plan_workflow(uuid, uuid, text, text) to service_role;
grant execute on function public.mark_audio_deleted(uuid, text) to service_role;
