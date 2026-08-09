alter table public.identity_references
  add column normalization_claim_token uuid,
  add column normalization_claimed_at timestamptz,
  add constraint identity_reference_normalization_claim_shape check (
    (normalization_claim_token is null and normalization_claimed_at is null)
    or (
      normalization_claim_token is not null and normalization_claimed_at is not null
      and status = 'PENDING'
    )
  );

create table public.identity_quota_limits (
  singleton boolean primary key default true check (singleton),
  max_user_hour integer not null check (max_user_hour between 1 and 100),
  max_global_day integer not null check (max_global_day between 1 and 1000),
  updated_at timestamptz not null default now()
);

insert into public.identity_quota_limits (singleton, max_user_hour, max_global_day)
values (true, 6, 40);

create table public.identity_user_hourly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_start timestamptz not null,
  used integer not null check (used > 0),
  primary key (user_id, bucket_start)
);

create table public.identity_global_daily_usage (
  bucket_date date primary key,
  used integer not null check (used > 0)
);

alter table public.identity_quota_limits enable row level security;
alter table public.identity_user_hourly_usage enable row level security;
alter table public.identity_global_daily_usage enable row level security;

comment on table public.identity_quota_limits is
  'Admission limits for Dream Self uploads. Cleanup capacity must exceed twice max_global_day.';
comment on table public.identity_user_hourly_usage is
  'Durable per-user Dream Self upload allocations. Terminal replacements do not refund usage.';
comment on table public.identity_global_daily_usage is
  'Durable global Dream Self upload allocations by UTC day.';

create function public.increment_identity_quota_usage(p_user_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_limits public.identity_quota_limits%rowtype;
declare v_bucket_start timestamptz;
declare v_bucket_date date;
declare v_used integer;
begin
  select * into v_limits from public.identity_quota_limits where singleton for share;
  if v_limits.singleton is null then
    raise exception 'identity_quota_not_configured' using errcode = 'P0001';
  end if;

  v_bucket_start := date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC';
  v_bucket_date := (now() at time zone 'UTC')::date;
  insert into public.identity_user_hourly_usage (user_id, bucket_start, used)
  values (p_user_id, v_bucket_start, 1)
  on conflict (user_id, bucket_start) do update
    set used = public.identity_user_hourly_usage.used + 1
    where public.identity_user_hourly_usage.used < v_limits.max_user_hour
  returning used into v_used;
  if v_used is null then
    raise exception 'identity_hourly_limit' using errcode = 'P4295';
  end if;

  v_used := null;
  insert into public.identity_global_daily_usage (bucket_date, used)
  values (v_bucket_date, 1)
  on conflict (bucket_date) do update
    set used = public.identity_global_daily_usage.used + 1
    where public.identity_global_daily_usage.used < v_limits.max_global_day
  returning used into v_used;
  if v_used is null then
    raise exception 'identity_daily_limit' using errcode = 'P4296';
  end if;
end;
$$;

create or replace function public.prepare_identity_reference(
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
  if not found then
    raise exception 'identity_user_not_found' using errcode = 'P0002';
  end if;
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
      where reference.user_id = p_user_id and reference.status = 'PENDING'
        and reference.upload_expires_at > now()) >= 2 then
    raise exception 'identity_upload_quota_reached' using errcode = '54000';
  end if;
  perform public.increment_identity_quota_usage(p_user_id);
  v_reference_id := gen_random_uuid();
  insert into public.identity_references (
    id, user_id, operation_key, source_mime_type, upload_path, upload_expires_at,
    consent_confirmed_at, consent_version
  ) values (
    v_reference_id, p_user_id, p_operation_key, p_mime_type,
    p_user_id::text || '/identity/' || v_reference_id::text || '/source.' || v_extension,
    now() + interval '2 hours', now(), p_consent_version
  );
  return query select v_reference_id, 'PENDING'::text,
    p_user_id::text || '/identity/' || v_reference_id::text || '/source.' || v_extension;
end;
$$;

create function public.claim_identity_normalization(
  p_reference_id uuid,
  p_user_id uuid,
  p_claim_token uuid
) returns boolean
language plpgsql security definer
set search_path = ''
as $$
declare v_reference public.identity_references%rowtype;
begin
  if p_claim_token is null then
    raise exception 'invalid_identity_claim' using errcode = '22023';
  end if;
  select * into v_reference from public.identity_references
  where id = p_reference_id and user_id = p_user_id for update;
  if v_reference.id is null or v_reference.status <> 'PENDING'
    or v_reference.upload_expires_at <= now() then
    return false;
  end if;
  if v_reference.normalization_claim_token = p_claim_token then
    update public.identity_references set normalization_claimed_at = now(), updated_at = now()
    where id = p_reference_id;
    return true;
  end if;
  if v_reference.normalization_claim_token is not null
    and v_reference.normalization_claimed_at > now() - interval '10 minutes' then
    return false;
  end if;
  update public.identity_references set normalization_claim_token = p_claim_token,
    normalization_claimed_at = now(), updated_at = now()
  where id = p_reference_id;
  return true;
end;
$$;

create function public.release_identity_normalization(
  p_reference_id uuid,
  p_user_id uuid,
  p_claim_token uuid
) returns void
language sql security definer
set search_path = ''
as $$
  update public.identity_references set normalization_claim_token = null,
    normalization_claimed_at = null, updated_at = now()
  where id = p_reference_id and user_id = p_user_id and status = 'PENDING'
    and normalization_claim_token = p_claim_token;
$$;

drop function public.complete_identity_reference(uuid, uuid, text, integer, integer, integer, text);

create function public.complete_identity_reference(
  p_reference_id uuid,
  p_user_id uuid,
  p_claim_token uuid,
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
  if p_claim_token is null or p_storage_path is distinct from v_expected_path
    or p_size_bytes is null or p_size_bytes not between 1 and 8388608
    or p_width is null or p_width not between 256 and 2048
    or p_height is null or p_height not between 256 and 2048
    or p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_identity_metadata' using errcode = '22023';
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
  if v_reference.status <> 'PENDING' or v_reference.upload_expires_at <= now()
    or v_reference.normalization_claim_token is distinct from p_claim_token
    or v_reference.normalization_claimed_at <= now() - interval '10 minutes' then
    raise exception 'identity_reference_not_ready' using errcode = '23514';
  end if;
  if not exists (
    select 1 from storage.objects object
    where object.bucket_id = 'identity-references' and object.name = p_storage_path
      and coalesce((object.metadata->>'size')::bigint, 0) = p_size_bytes
      and object.metadata->>'mimetype' = 'image/png'
  ) then
    raise exception 'identity_object_not_found' using errcode = 'P0002';
  end if;
  update public.identity_references set is_active = false, updated_at = now()
  where user_id = p_user_id and is_active;
  update public.identity_references set status = 'READY', storage_path = p_storage_path,
    size_bytes = p_size_bytes, width = p_width, height = p_height,
    content_sha256 = p_content_sha256, is_active = true,
    upload_expires_at = null, retention_expires_at = now() + interval '30 days',
    ready_at = now(), normalization_claim_token = null,
    normalization_claimed_at = null, updated_at = now()
  where id = p_reference_id;
end;
$$;

create or replace function public.begin_identity_deletion(
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
    normalization_claim_token = null, normalization_claimed_at = null,
    updated_at = now() where id = p_reference_id;
  return query select v_reference.upload_path, v_reference.storage_path;
end;
$$;

create or replace function public.complete_identity_deletion(
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
    normalization_claim_token = null, normalization_claimed_at = null,
    deleted_at = coalesce(deleted_at, now()), updated_at = now()
  where id = p_reference_id and user_id = p_user_id and status = 'DELETING';
end;
$$;

create or replace function public.get_identity_cleanup_candidates(
  p_limit integer
) returns table(reference_id uuid, user_id uuid, cleanup_kind text)
language plpgsql security definer
set search_path = ''
as $$
begin
  if p_limit not between 1 and 250 then
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

create function public.get_identity_cleanup_health()
returns table(due_count bigint, oldest_due_at timestamptz)
language sql security definer
set search_path = ''
as $$
  select count(*), min(case
    when reference.status = 'PENDING' then reference.upload_expires_at
    when reference.status = 'DELETED' then reference.cleanup_due_at
    when reference.status = 'READY' and reference.upload_path is not null
      then coalesce(reference.ready_at, reference.updated_at)
    when reference.status = 'READY' then reference.retention_expires_at
    else reference.updated_at
  end)
  from public.identity_references reference
  where (reference.status = 'PENDING' and reference.upload_expires_at <= now())
    or reference.status in ('DELETING', 'FAILED')
    or (reference.status = 'DELETED' and reference.cleanup_due_at <= now())
    or (reference.status = 'READY' and (
      not reference.is_active or reference.retention_expires_at <= now()
      or reference.upload_path is not null
    ));
$$;

revoke all on table public.identity_quota_limits from public, anon, authenticated;
revoke all on table public.identity_user_hourly_usage from public, anon, authenticated;
revoke all on table public.identity_global_daily_usage from public, anon, authenticated;
grant select on table public.identity_quota_limits to service_role;
grant select on table public.identity_user_hourly_usage to service_role;
grant select on table public.identity_global_daily_usage to service_role;

revoke all on function public.increment_identity_quota_usage(uuid) from public;
revoke all on function public.claim_identity_normalization(uuid, uuid, uuid) from public;
revoke all on function public.release_identity_normalization(uuid, uuid, uuid) from public;
revoke all on function public.complete_identity_reference(
  uuid, uuid, uuid, text, integer, integer, integer, text
) from public;
revoke all on function public.get_identity_cleanup_health() from public;

grant execute on function public.claim_identity_normalization(uuid, uuid, uuid) to service_role;
grant execute on function public.release_identity_normalization(uuid, uuid, uuid) to service_role;
grant execute on function public.complete_identity_reference(
  uuid, uuid, uuid, text, integer, integer, integer, text
) to service_role;
grant execute on function public.get_identity_cleanup_health() to service_role;
