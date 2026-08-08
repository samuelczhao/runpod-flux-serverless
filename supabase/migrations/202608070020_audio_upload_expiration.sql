alter table public.dreams
  add column audio_upload_expires_at timestamptz,
  add column audio_cleanup_run_id text,
  add column audio_cleanup_claim_token text,
  add column audio_cleanup_claimed_at timestamptz,
  add constraint audio_cleanup_claim_shape check (
    (audio_cleanup_claim_token is null) = (audio_cleanup_claimed_at is null)
  );

create unique index dreams_audio_cleanup_run_idx on public.dreams (audio_cleanup_run_id)
where audio_cleanup_run_id is not null;

create index dreams_audio_cleanup_due_idx on public.dreams (audio_upload_expires_at)
where input_mode = 'audio' and audio_upload_expires_at is not null;

alter table public.dreams drop constraint dream_audio_metadata_check;
alter table public.dreams add constraint dream_audio_metadata_check check (
  (audio_storage_path is null and audio_size_bytes is null
    and (audio_mime_type is null or (audio_uploaded_at is null and input_mode = 'audio'
      and status in ('DRAFT', 'DELETING')
      and audio_mime_type in ('audio/webm', 'audio/mp4', 'audio/ogg'))))
  or (input_mode = 'audio' and audio_storage_path is not null
    and audio_mime_type in ('audio/webm', 'audio/mp4', 'audio/ogg')
    and audio_size_bytes between 1 and 10485760 and audio_uploaded_at is not null)
);

drop function public.prepare_audio_dream(uuid, uuid);

create function public.prepare_audio_dream(
  p_user_id uuid,
  p_operation_key uuid,
  p_mime_type text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  if p_user_id is null or p_operation_key is null or p_mime_type is null
    or p_mime_type not in ('audio/webm', 'audio/mp4', 'audio/ogg') then
    raise exception 'invalid_audio_operation' using errcode = '22023';
  end if;
  insert into public.dreams (
    user_id, input_mode, transcript, audio_operation_key,
    audio_mime_type, audio_upload_expires_at
  ) values (
    p_user_id, 'audio', null, p_operation_key,
    p_mime_type, now() + interval '2 hours'
  ) on conflict (user_id, audio_operation_key)
    where audio_operation_key is not null do nothing;
  select * into v_dream from public.dreams
  where user_id = p_user_id and audio_operation_key = p_operation_key for update;
  if v_dream.id is null then
    raise exception 'audio_preparation_not_found' using errcode = 'P0002';
  end if;
  if v_dream.status <> 'DRAFT' or v_dream.audio_storage_path is not null
    or v_dream.audio_mime_type is distinct from p_mime_type then
    raise exception 'audio_preparation_conflict' using errcode = '40001';
  end if;
  update public.dreams set audio_upload_expires_at = now() + interval '2 hours'
  where id = v_dream.id;
  return v_dream.id;
end;
$$;

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
  if p_storage_path <> v_expected_path then
    raise exception 'invalid_audio_path' using errcode = '22023';
  end if;
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
    or v_dream.audio_storage_path is not null
    or v_dream.audio_mime_type is distinct from p_mime_type
    or v_dream.audio_upload_expires_at is null then
    raise exception 'audio_upload_conflict' using errcode = '40001';
  end if;
  update public.dreams set status = 'UPLOADED', audio_storage_path = p_storage_path,
    audio_size_bytes = p_size_bytes, audio_uploaded_at = now()
  where id = p_dream_id;
end;
$$;

create function public.claim_audio_cleanup_workflow(
  p_user_id uuid,
  p_dream_id uuid,
  p_claim_token text
) returns table(workflow_id text, claimed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  if nullif(trim(p_claim_token), '') is null then
    raise exception 'invalid_cleanup_claim' using errcode = '22023';
  end if;
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then return; end if;
  if v_dream.input_mode <> 'audio' or v_dream.audio_upload_expires_at is null then
    raise exception 'audio_cleanup_not_ready' using errcode = '23514';
  end if;
  if v_dream.audio_cleanup_run_id is not null then
    return query select v_dream.audio_cleanup_run_id, false; return;
  end if;
  if v_dream.audio_cleanup_claim_token = p_claim_token then
    return query select null::text, true; return;
  end if;
  if v_dream.audio_cleanup_claim_token is not null
    and v_dream.audio_cleanup_claimed_at > now() - interval '15 minutes' then
    return query select null::text, false; return;
  end if;
  update public.dreams set audio_cleanup_claim_token = p_claim_token,
    audio_cleanup_claimed_at = now() where id = p_dream_id;
  return query select null::text, true;
end;
$$;

create function public.record_audio_cleanup_workflow(
  p_dream_id uuid,
  p_claim_token text,
  p_run_id text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  if nullif(trim(p_claim_token), '') is null or nullif(trim(p_run_id), '') is null then
    raise exception 'invalid_cleanup_run' using errcode = '22023';
  end if;
  select * into v_dream from public.dreams where id = p_dream_id for update;
  if v_dream.id is null then return; end if;
  if v_dream.audio_cleanup_run_id = p_run_id then return; end if;
  if v_dream.audio_cleanup_claim_token is distinct from p_claim_token then
    raise exception 'cleanup_claim_conflict' using errcode = '40001';
  end if;
  update public.dreams set audio_cleanup_run_id = p_run_id,
    audio_cleanup_claim_token = null, audio_cleanup_claimed_at = null
  where id = p_dream_id;
end;
$$;

create function public.release_audio_cleanup_execution(
  p_dream_id uuid,
  p_claim_token text,
  p_run_id text
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_claim_token), '') is null or nullif(trim(p_run_id), '') is null then
    raise exception 'invalid_cleanup_identity' using errcode = '22023';
  end if;
  update public.dreams set audio_cleanup_run_id = null,
    audio_cleanup_claim_token = null, audio_cleanup_claimed_at = null
  where id = p_dream_id and (
    (audio_cleanup_run_id = p_run_id and audio_cleanup_claim_token is null)
    or (audio_cleanup_run_id is null and audio_cleanup_claim_token = p_claim_token)
  );
end;
$$;

create function public.prepare_expired_audio_draft_cleanup(
  p_dream_id uuid,
  p_user_id uuid
) returns text
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
declare v_extension text;
begin
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then return null; end if;
  if v_dream.audio_upload_expires_at is null or now() < v_dream.audio_upload_expires_at then
    return null;
  end if;
  if v_dream.status not in ('DRAFT', 'DELETING') or v_dream.audio_storage_path is not null then
    return null;
  end if;
  v_extension := case v_dream.audio_mime_type
    when 'audio/webm' then 'webm' when 'audio/mp4' then 'mp4' when 'audio/ogg' then 'ogg'
    else null end;
  if v_extension is null then
    raise exception 'invalid_audio_cleanup' using errcode = '23514';
  end if;
  if v_dream.status = 'DRAFT' then
    update public.dreams set status = 'DELETING' where id = p_dream_id;
  end if;
  return p_user_id::text || '/' || p_dream_id::text || '/source.' || v_extension;
end;
$$;

create function public.complete_expired_audio_draft_cleanup(
  p_dream_id uuid,
  p_user_id uuid,
  p_storage_path text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
declare v_extension text;
declare v_expected_path text;
begin
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then return; end if;
  v_extension := case v_dream.audio_mime_type
    when 'audio/webm' then 'webm' when 'audio/mp4' then 'mp4' when 'audio/ogg' then 'ogg'
    else null end;
  v_expected_path := p_user_id::text || '/' || p_dream_id::text || '/source.' || v_extension;
  if v_dream.status <> 'DELETING' or v_dream.audio_storage_path is not null
    or v_extension is null or p_storage_path is distinct from v_expected_path then
    raise exception 'audio_cleanup_conflict' using errcode = '40001';
  end if;
  delete from public.dreams where id = p_dream_id;
end;
$$;

revoke all on function public.prepare_audio_dream(uuid, uuid, text) from public;
revoke all on function public.claim_audio_cleanup_workflow(uuid, uuid, text) from public;
revoke all on function public.record_audio_cleanup_workflow(uuid, text, text) from public;
revoke all on function public.release_audio_cleanup_execution(uuid, text, text) from public;
revoke all on function public.prepare_expired_audio_draft_cleanup(uuid, uuid) from public;
revoke all on function public.complete_expired_audio_draft_cleanup(uuid, uuid, text) from public;
grant execute on function public.prepare_audio_dream(uuid, uuid, text) to service_role;
grant execute on function public.claim_audio_cleanup_workflow(uuid, uuid, text) to service_role;
grant execute on function public.record_audio_cleanup_workflow(uuid, text, text) to service_role;
grant execute on function public.release_audio_cleanup_execution(uuid, text, text) to service_role;
grant execute on function public.prepare_expired_audio_draft_cleanup(uuid, uuid) to service_role;
grant execute on function public.complete_expired_audio_draft_cleanup(uuid, uuid, text) to service_role;
