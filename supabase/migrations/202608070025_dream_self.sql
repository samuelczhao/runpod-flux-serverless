create table public.identity_references (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  operation_key uuid not null,
  status text not null default 'PENDING' check (
    status in ('PENDING', 'READY', 'DELETING', 'DELETED', 'FAILED')
  ),
  source_mime_type text not null check (
    source_mime_type in ('image/jpeg', 'image/png', 'image/webp')
  ),
  upload_path text,
  storage_path text,
  size_bytes integer check (size_bytes between 1 and 8388608),
  width integer check (width between 256 and 2048),
  height integer check (height between 256 and 2048),
  content_sha256 text check (content_sha256 ~ '^[0-9a-f]{64}$'),
  is_active boolean not null default false,
  consent_confirmed_at timestamptz not null,
  consent_version text not null check (consent_version = 'dream-self-v1'),
  upload_expires_at timestamptz,
  retention_expires_at timestamptz,
  cleanup_due_at timestamptz,
  ready_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, operation_key),
  constraint identity_reference_state_shape check (
    (status = 'PENDING' and upload_path is not null and storage_path is null
      and size_bytes is null and width is null and height is null
      and content_sha256 is null and not is_active and upload_expires_at is not null)
    or (status = 'READY' and storage_path is not null
      and size_bytes is not null and width is not null and height is not null
      and content_sha256 is not null and ready_at is not null
      and retention_expires_at is not null and deleted_at is null)
    or (status = 'DELETING' and not is_active)
    or (status in ('DELETED', 'FAILED') and not is_active)
  )
);

create unique index identity_references_active_user_idx
on public.identity_references (user_id) where is_active;

create index identity_references_expiring_upload_idx
on public.identity_references (upload_expires_at)
where status = 'PENDING';

alter table public.identity_references enable row level security;

create policy identity_references_owner_select on public.identity_references
for select using (user_id = auth.uid());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'identity-references', 'identity-references', false, 8388608,
  array['image/jpeg', 'image/png', 'image/webp']
) on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy identity_storage_owner_select on storage.objects for select using (
  bucket_id = 'identity-references'
  and (storage.foldername(name))[1] = auth.uid()::text
);

alter table public.dreams
  add column identity_reference_id uuid references public.identity_references(id) on delete restrict,
  add column visual_style text not null default 'dream-cinema' check (
    visual_style in ('dream-cinema', 'watercolor-memory', 'graphic-surreal')
  );

drop policy dreams_owner_insert on public.dreams;
create policy dreams_owner_insert on public.dreams for insert with check (
  user_id = auth.uid() and status = 'DRAFT' and workflow_run_id is null
  and audio_storage_path is null and plan_hash is null
  and ((input_mode = 'text' and nullif(trim(transcript), '') is not null)
    or (input_mode = 'audio' and transcript is null))
  and (identity_reference_id is null or exists (
    select 1 from public.identity_references reference
    where reference.id = identity_reference_id and reference.user_id = auth.uid()
      and reference.status = 'READY' and reference.retention_expires_at > now()
  ))
);

create function public.prepare_identity_reference(
  p_user_id uuid,
  p_operation_key uuid,
  p_mime_type text,
  p_consent_confirmed boolean,
  p_consent_version text
) returns table(reference_id uuid, reference_status text, source_path text)
language plpgsql security definer
set search_path = ''
as $$
declare v_reference public.identity_references%rowtype;
declare v_reference_id uuid;
declare v_extension text;
begin
  v_extension := case p_mime_type
    when 'image/jpeg' then 'jpg'
    when 'image/png' then 'png'
    when 'image/webp' then 'webp'
    else null end;
  if p_user_id is null or p_operation_key is null or v_extension is null
    or p_consent_confirmed is distinct from true
    or p_consent_version is distinct from 'dream-self-v1' then
    raise exception 'invalid_identity_operation' using errcode = '22023';
  end if;
  perform 1 from auth.users where id = p_user_id for update;
  select * into v_reference from public.identity_references
  where user_id = p_user_id and operation_key = p_operation_key for update;
  if v_reference.id is not null then
    if v_reference.source_mime_type is distinct from p_mime_type
      or v_reference.status not in ('PENDING', 'READY') then
      raise exception 'identity_preparation_conflict' using errcode = '40001';
    end if;
    if v_reference.status = 'PENDING' then
      update public.identity_references set upload_expires_at = now() + interval '2 hours',
        updated_at = now() where id = v_reference.id;
    end if;
    return query select v_reference.id, v_reference.status, v_reference.upload_path;
    return;
  end if;
  if (select count(*) from public.identity_references reference
      where reference.user_id = p_user_id and reference.status = 'PENDING') >= 2 then
    raise exception 'identity_upload_quota_reached' using errcode = '54000';
  end if;
  v_reference_id := gen_random_uuid();
  insert into public.identity_references (
    id, user_id, operation_key, source_mime_type, upload_path, upload_expires_at,
    consent_confirmed_at, consent_version
  ) values (
    v_reference_id, p_user_id, p_operation_key, p_mime_type,
    p_user_id::text || '/identity/' || v_reference_id::text || '/source.' || v_extension,
    now() + interval '2 hours', now(), p_consent_version
  ) on conflict (user_id, operation_key) do nothing;
  select * into v_reference from public.identity_references
  where user_id = p_user_id and operation_key = p_operation_key for update;
  if v_reference.id is null then
    raise exception 'identity_preparation_not_found' using errcode = 'P0002';
  end if;
  if v_reference.source_mime_type is distinct from p_mime_type
    or v_reference.status not in ('PENDING', 'READY') then
    raise exception 'identity_preparation_conflict' using errcode = '40001';
  end if;
  if v_reference.status = 'PENDING' then
    update public.identity_references set upload_expires_at = now() + interval '2 hours',
      updated_at = now() where id = v_reference.id;
  end if;
  return query select v_reference.id, v_reference.status, v_reference.upload_path;
end;
$$;

create function public.complete_identity_reference(
  p_reference_id uuid,
  p_user_id uuid,
  p_storage_path text,
  p_size_bytes integer,
  p_width integer,
  p_height integer,
  p_content_sha256 text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_reference public.identity_references%rowtype;
declare v_expected_path text;
begin
  v_expected_path := p_user_id::text || '/identity/' || p_reference_id::text || '/reference.png';
  if p_storage_path is distinct from v_expected_path
    or p_size_bytes is null or p_size_bytes not between 1 and 8388608
    or p_width is null or p_width not between 256 and 2048
    or p_height is null or p_height not between 256 and 2048
    or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_identity_metadata' using errcode = '22023';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'identity-references' and object.name = p_storage_path
      and coalesce((object.metadata->>'size')::bigint, 0) = p_size_bytes
      and object.metadata->>'mimetype' = 'image/png'
  ) then
    raise exception 'identity_object_not_found' using errcode = 'P0002';
  end if;
  perform 1 from auth.users where id = p_user_id for update;
  select * into v_reference from public.identity_references
  where id = p_reference_id and user_id = p_user_id for update;
  if v_reference.id is null then
    raise exception 'identity_reference_not_found' using errcode = 'P0002';
  end if;
  if v_reference.status = 'READY' then
    if v_reference.storage_path = p_storage_path
      and v_reference.size_bytes = p_size_bytes
      and v_reference.width = p_width and v_reference.height = p_height
      and v_reference.content_sha256 = p_content_sha256 then return; end if;
    raise exception 'identity_completion_conflict' using errcode = '40001';
  end if;
  if v_reference.status <> 'PENDING' or v_reference.upload_expires_at <= now() then
    raise exception 'identity_reference_not_ready' using errcode = '23514';
  end if;
  update public.identity_references set is_active = false, updated_at = now()
  where user_id = p_user_id and is_active;
  update public.identity_references set status = 'READY', storage_path = p_storage_path,
    size_bytes = p_size_bytes, width = p_width, height = p_height,
    content_sha256 = p_content_sha256, is_active = true,
    upload_expires_at = null, retention_expires_at = now() + interval '30 days',
    ready_at = now(), updated_at = now()
  where id = p_reference_id;
end;
$$;

create function public.begin_identity_deletion(
  p_reference_id uuid,
  p_user_id uuid
) returns table(source_path text, reference_path text)
language plpgsql security definer
set search_path = ''
as $$
declare v_reference public.identity_references%rowtype;
begin
  select * into v_reference from public.identity_references
  where id = p_reference_id and user_id = p_user_id for update;
  if v_reference.id is null then return; end if;
  if exists (
    select 1 from public.dreams dream
    where dream.identity_reference_id = p_reference_id
      and dream.status in (
        'DRAFT', 'UPLOADED', 'TRANSCRIBING', 'PLANNING',
        'GENERATING_ANCHOR', 'GENERATING_SCENES'
      )
      and dream.updated_at > now() - interval '24 hours'
  ) then raise exception 'identity_reference_in_use' using errcode = '55006'; end if;
  if v_reference.status = 'DELETED' then
    return query select v_reference.upload_path, v_reference.storage_path;
    return;
  end if;
  if v_reference.status not in ('PENDING', 'READY', 'FAILED', 'DELETING') then
    raise exception 'identity_deletion_conflict' using errcode = '40001';
  end if;
  update public.identity_references set status = 'DELETING', is_active = false,
    updated_at = now() where id = p_reference_id;
  return query select v_reference.upload_path, v_reference.storage_path;
end;
$$;

create function public.complete_identity_deletion(
  p_reference_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.identity_references set status = 'DELETED', upload_path = null,
    storage_path = null, size_bytes = null, width = null, height = null,
    content_sha256 = null, is_active = false, upload_expires_at = null,
    retention_expires_at = null, cleanup_due_at = now() + interval '15 minutes',
    deleted_at = coalesce(deleted_at, now()), updated_at = now()
  where id = p_reference_id and user_id = p_user_id and status = 'DELETING';
end;
$$;

create function public.complete_identity_tombstone_cleanup(
  p_reference_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.identity_references set cleanup_due_at = null, updated_at = now()
  where id = p_reference_id and user_id = p_user_id and status = 'DELETED'
    and cleanup_due_at <= now();
end;
$$;

create function public.mark_identity_source_deleted(
  p_reference_id uuid,
  p_user_id uuid,
  p_source_path text
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.identity_references set upload_path = null, updated_at = now()
  where id = p_reference_id and user_id = p_user_id and status = 'READY'
    and upload_path = p_source_path;
end;
$$;

create function public.get_identity_cleanup_candidates(
  p_limit integer
) returns table(reference_id uuid, user_id uuid, cleanup_kind text)
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_limit not between 1 and 100 then
    raise exception 'invalid_cleanup_limit' using errcode = '22023';
  end if;
  return query
  select reference.id, reference.user_id,
    case
      when reference.status = 'DELETED' then 'tombstone'
      when reference.status = 'READY' and reference.is_active
        and reference.retention_expires_at > now() and reference.upload_path is not null
      then 'source'
      else 'reference'
    end
  from public.identity_references reference
  where (reference.status = 'PENDING' and reference.upload_expires_at <= now())
    or reference.status in ('DELETING', 'FAILED')
    or (reference.status = 'DELETED' and reference.cleanup_due_at <= now())
    or (reference.status = 'READY' and (
      not reference.is_active or reference.retention_expires_at <= now()
      or reference.upload_path is not null
    ))
  order by reference.created_at
  limit p_limit;
end;
$$;

create function public.prepare_text_dream(
  p_user_id uuid,
  p_operation_key uuid,
  p_transcript text,
  p_identity_reference_id uuid,
  p_visual_style text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
declare v_transcript text;
begin
  v_transcript := trim(p_transcript);
  if p_user_id is null or p_operation_key is null or v_transcript is null
    or char_length(v_transcript) not between 10 and 12000
    or p_visual_style not in ('dream-cinema', 'watercolor-memory', 'graphic-surreal') then
    raise exception 'invalid_text_operation' using errcode = '22023';
  end if;
  perform 1 from auth.users where id = p_user_id for update;
  select * into v_dream from public.dreams
  where user_id = p_user_id and text_operation_key = p_operation_key for update;
  if v_dream.id is not null then
    if v_dream.input_mode <> 'text' or v_dream.transcript is distinct from v_transcript
      or v_dream.identity_reference_id is distinct from p_identity_reference_id
      or v_dream.visual_style is distinct from p_visual_style then
      raise exception 'idempotency_conflict' using errcode = '23505';
    end if;
    return v_dream.id;
  end if;
  if p_identity_reference_id is not null then
    perform 1 from public.identity_references reference
    where reference.id = p_identity_reference_id and reference.user_id = p_user_id
      and reference.status = 'READY' and reference.retention_expires_at > now() for key share;
    if not found then
      raise exception 'identity_reference_not_ready' using errcode = '23514';
    end if;
  end if;
  insert into public.dreams (
    user_id, input_mode, transcript, text_operation_key,
    identity_reference_id, visual_style
  ) values (
    p_user_id, 'text', v_transcript, p_operation_key,
    p_identity_reference_id, p_visual_style
  ) on conflict (user_id, text_operation_key)
    where text_operation_key is not null do nothing;
  select * into v_dream from public.dreams
  where user_id = p_user_id and text_operation_key = p_operation_key for update;
  if v_dream.id is null then
    raise exception 'text_preparation_not_found' using errcode = 'P0002';
  end if;
  if v_dream.input_mode <> 'text' or v_dream.transcript is distinct from v_transcript
    or v_dream.identity_reference_id is distinct from p_identity_reference_id
    or v_dream.visual_style is distinct from p_visual_style then
    raise exception 'idempotency_conflict' using errcode = '23505';
  end if;
  return v_dream.id;
end;
$$;

create function public.prepare_audio_dream(
  p_user_id uuid,
  p_operation_key uuid,
  p_mime_type text,
  p_identity_reference_id uuid,
  p_visual_style text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  if p_user_id is null or p_operation_key is null
    or p_mime_type not in ('audio/webm', 'audio/mp4', 'audio/ogg')
    or p_visual_style not in ('dream-cinema', 'watercolor-memory', 'graphic-surreal') then
    raise exception 'invalid_audio_operation' using errcode = '22023';
  end if;
  perform 1 from auth.users where id = p_user_id for update;
  select * into v_dream from public.dreams
  where user_id = p_user_id and audio_operation_key = p_operation_key for update;
  if v_dream.id is not null then
    if v_dream.input_mode <> 'audio' or v_dream.audio_mime_type is distinct from p_mime_type
      or v_dream.identity_reference_id is distinct from p_identity_reference_id
      or v_dream.visual_style is distinct from p_visual_style then
      raise exception 'audio_preparation_conflict' using errcode = '40001';
    end if;
    if v_dream.status = 'DRAFT' and v_dream.audio_storage_path is null then
      update public.dreams set audio_upload_expires_at = now() + interval '2 hours'
      where id = v_dream.id;
    end if;
    return v_dream.id;
  end if;
  if p_identity_reference_id is not null then
    perform 1 from public.identity_references reference
    where reference.id = p_identity_reference_id and reference.user_id = p_user_id
      and reference.status = 'READY' and reference.retention_expires_at > now() for key share;
    if not found then
      raise exception 'identity_reference_not_ready' using errcode = '23514';
    end if;
  end if;
  insert into public.dreams (
    user_id, input_mode, transcript, audio_operation_key, audio_mime_type,
    audio_upload_expires_at, identity_reference_id, visual_style
  ) values (
    p_user_id, 'audio', null, p_operation_key, p_mime_type,
    now() + interval '2 hours', p_identity_reference_id, p_visual_style
  ) on conflict (user_id, audio_operation_key)
    where audio_operation_key is not null do nothing;
  select * into v_dream from public.dreams
  where user_id = p_user_id and audio_operation_key = p_operation_key for update;
  if v_dream.id is null then
    raise exception 'audio_preparation_not_found' using errcode = 'P0002';
  end if;
  if v_dream.audio_mime_type is distinct from p_mime_type
    or v_dream.identity_reference_id is distinct from p_identity_reference_id
    or v_dream.visual_style is distinct from p_visual_style then
    raise exception 'audio_preparation_conflict' using errcode = '40001';
  end if;
  if v_dream.status = 'DRAFT' and v_dream.audio_storage_path is null then
    update public.dreams set audio_upload_expires_at = now() + interval '2 hours'
    where id = v_dream.id;
  end if;
  return v_dream.id;
end;
$$;

revoke all on table public.identity_references from public;
grant select on table public.identity_references to authenticated;

revoke all on function public.prepare_identity_reference(uuid, uuid, text, boolean, text) from public;
revoke all on function public.complete_identity_reference(uuid, uuid, text, integer, integer, integer, text) from public;
revoke all on function public.begin_identity_deletion(uuid, uuid) from public;
revoke all on function public.complete_identity_deletion(uuid, uuid) from public;
revoke all on function public.complete_identity_tombstone_cleanup(uuid, uuid) from public;
revoke all on function public.mark_identity_source_deleted(uuid, uuid, text) from public;
revoke all on function public.get_identity_cleanup_candidates(integer) from public;
revoke all on function public.prepare_text_dream(uuid, uuid, text, uuid, text) from public;
revoke all on function public.prepare_audio_dream(uuid, uuid, text, uuid, text) from public;

grant execute on function public.prepare_identity_reference(uuid, uuid, text, boolean, text) to service_role;
grant execute on function public.complete_identity_reference(uuid, uuid, text, integer, integer, integer, text) to service_role;
grant execute on function public.begin_identity_deletion(uuid, uuid) to service_role;
grant execute on function public.complete_identity_deletion(uuid, uuid) to service_role;
grant execute on function public.complete_identity_tombstone_cleanup(uuid, uuid) to service_role;
grant execute on function public.mark_identity_source_deleted(uuid, uuid, text) to service_role;
grant execute on function public.get_identity_cleanup_candidates(integer) to service_role;
grant execute on function public.prepare_text_dream(uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.prepare_audio_dream(uuid, uuid, text, uuid, text) to service_role;
