create table public.dream_quota_limits (
  singleton boolean primary key default true check (singleton),
  max_active_per_user integer not null check (max_active_per_user between 1 and 20),
  max_user_hour integer not null check (max_user_hour between 1 and 100),
  max_global_day integer not null check (max_global_day between 1 and 10000)
);

insert into public.dream_quota_limits (
  singleton, max_active_per_user, max_user_hour, max_global_day
) values (true, 2, 6, 100);

create table public.dream_user_hourly_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  bucket_start timestamptz not null,
  used integer not null check (used > 0),
  primary key (user_id, bucket_start)
);

create table public.dream_global_daily_usage (
  bucket_date date primary key,
  used integer not null check (used > 0)
);

alter table public.dream_quota_limits enable row level security;
alter table public.dream_user_hourly_usage enable row level security;
alter table public.dream_global_daily_usage enable row level security;

comment on table public.dream_quota_limits is
  'Adjustable admission ceilings for the public DreamTrace demo.';
comment on table public.dream_user_hourly_usage is
  'Durable per-user dream allocations; deletion does not refund a bucket.';
comment on table public.dream_global_daily_usage is
  'Durable global dream allocations that cap daily GPU exposure.';

create function public.assert_dream_active_capacity(
  p_user_id uuid,
  p_exclude_dream_id uuid
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_limit integer;
declare v_active integer;
begin
  select max_active_per_user into v_limit
  from public.dream_quota_limits where singleton;
  if v_limit is null then
    raise exception 'dream_quota_not_configured' using errcode = 'P0001';
  end if;

  select count(*) into v_active
  from public.dreams dream
  where dream.user_id = p_user_id
    and dream.id is distinct from p_exclude_dream_id
    and (
      dream.status in ('UPLOADED', 'TRANSCRIBING', 'PLANNING',
        'GENERATING_ANCHOR', 'GENERATING_SCENES')
      or (dream.status = 'DRAFT' and (
        (dream.input_mode = 'text' and dream.created_at > now() - interval '15 minutes')
        or (dream.input_mode = 'audio' and dream.audio_upload_expires_at > now())
      ))
    );
  if v_active >= v_limit then
    raise exception 'dream_active_limit' using errcode = 'P4291';
  end if;
end;
$$;

create function public.reserve_dream_creation(p_user_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_limits public.dream_quota_limits%rowtype;
declare v_bucket_start timestamptz;
declare v_bucket_date date;
declare v_used integer;
begin
  select * into v_limits from public.dream_quota_limits where singleton for share;
  if v_limits.singleton is null then
    raise exception 'dream_quota_not_configured' using errcode = 'P0001';
  end if;

  perform public.assert_dream_active_capacity(p_user_id, null);
  v_bucket_start := date_trunc('hour', now() at time zone 'UTC') at time zone 'UTC';
  v_bucket_date := (now() at time zone 'UTC')::date;

  insert into public.dream_user_hourly_usage (user_id, bucket_start, used)
  values (p_user_id, v_bucket_start, 1)
  on conflict (user_id, bucket_start) do update
    set used = public.dream_user_hourly_usage.used + 1
    where public.dream_user_hourly_usage.used < v_limits.max_user_hour
  returning used into v_used;
  if v_used is null then
    raise exception 'dream_hourly_limit' using errcode = 'P4292';
  end if;

  v_used := null;
  insert into public.dream_global_daily_usage (bucket_date, used)
  values (v_bucket_date, 1)
  on conflict (bucket_date) do update
    set used = public.dream_global_daily_usage.used + 1
    where public.dream_global_daily_usage.used < v_limits.max_global_day
  returning used into v_used;
  if v_used is null then
    raise exception 'dream_daily_limit' using errcode = 'P4293';
  end if;
end;
$$;

create or replace function public.prepare_text_dream(
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
  perform public.reserve_dream_creation(p_user_id);
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

create or replace function public.prepare_audio_dream(
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
  perform public.reserve_dream_creation(p_user_id);
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

create or replace function public.claim_dream_workflow(
  p_dream_id uuid,
  p_user_id uuid,
  p_claim_token text
) returns table(workflow_id text, claimed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  if nullif(trim(p_claim_token), '') is null then
    raise exception 'invalid_workflow_claim' using errcode = '22023';
  end if;
  perform 1 from auth.users where id = p_user_id for update;
  if not found then return; end if;
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then return; end if;
  if v_dream.workflow_run_id is not null then
    return query select v_dream.workflow_run_id, false; return;
  end if;
  if v_dream.workflow_claim_token = p_claim_token then
    return query select p_claim_token, true; return;
  end if;
  if v_dream.workflow_claim_token is not null
    and v_dream.workflow_claimed_at > now() - interval '15 minutes' then
    return query select null::text, false; return;
  end if;
  if v_dream.input_mode = 'text' then
    if v_dream.status = 'DRAFT' and nullif(trim(v_dream.transcript), '') is not null then
      perform public.assert_dream_active_capacity(p_user_id, p_dream_id);
      update public.dreams set status = 'PLANNING' where id = p_dream_id;
    elsif v_dream.status not in ('PLANNING', 'GENERATING_ANCHOR', 'GENERATING_SCENES') then
      raise exception 'dream_not_ready' using errcode = '23514';
    end if;
  elsif v_dream.input_mode = 'audio' then
    if v_dream.status = 'UPLOADED'
      and v_dream.audio_storage_path like p_user_id::text || '/' || p_dream_id::text || '/%' then
      perform public.assert_dream_active_capacity(p_user_id, p_dream_id);
      update public.dreams set status = 'TRANSCRIBING' where id = p_dream_id;
    elsif v_dream.status <> 'TRANSCRIBING' then
      raise exception 'dream_not_ready' using errcode = '23514';
    end if;
  else raise exception 'dream_not_ready' using errcode = '23514';
  end if;
  update public.dreams set workflow_claim_token = p_claim_token,
    workflow_claimed_at = now() where id = p_dream_id;
  return query select p_claim_token, true;
end;
$$;

revoke all on table public.dream_quota_limits from public, anon, authenticated;
revoke all on table public.dream_user_hourly_usage from public, anon, authenticated;
revoke all on table public.dream_global_daily_usage from public, anon, authenticated;
grant select, update on table public.dream_quota_limits to service_role;
grant select on table public.dream_user_hourly_usage to service_role;
grant select on table public.dream_global_daily_usage to service_role;

revoke all on function public.assert_dream_active_capacity(uuid, uuid) from public;
revoke all on function public.reserve_dream_creation(uuid) from public;
revoke all on function public.prepare_text_dream(uuid, uuid, text, uuid, text) from public;
revoke all on function public.prepare_audio_dream(uuid, uuid, text, uuid, text) from public;
revoke all on function public.claim_dream_workflow(uuid, uuid, text) from public;
grant execute on function public.prepare_text_dream(uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.prepare_audio_dream(uuid, uuid, text, uuid, text) to service_role;
grant execute on function public.claim_dream_workflow(uuid, uuid, text) to service_role;
