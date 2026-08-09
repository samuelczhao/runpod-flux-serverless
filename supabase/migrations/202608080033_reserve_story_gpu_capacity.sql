alter table public.dream_quota_limits
  add constraint dream_quota_global_story_capacity check (max_global_day >= 8);

create or replace function public.increment_dream_quota_usage(p_user_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_limits public.dream_quota_limits%rowtype;
declare v_bucket_start timestamptz;
declare v_bucket_date date;
declare v_used integer;
declare v_story_slots constant integer := 8;
begin
  select * into v_limits from public.dream_quota_limits where singleton for share;
  if v_limits.singleton is null then
    raise exception 'dream_quota_not_configured' using errcode = 'P0001';
  end if;

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
  values (v_bucket_date, v_story_slots)
  on conflict (bucket_date) do update
    set used = public.dream_global_daily_usage.used + v_story_slots
    where public.dream_global_daily_usage.used <= v_limits.max_global_day - v_story_slots
  returning used into v_used;
  if v_used is null then
    raise exception 'dream_daily_limit' using errcode = 'P4293';
  end if;
end;
$$;

create or replace function public.reserve_existing_dream_creation(
  p_dream_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
begin
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then
    raise exception 'dream_not_found' using errcode = 'P0002';
  end if;
  if v_dream.quota_reserved_at is not null then
    if v_dream.status in (
      'DRAFT', 'UPLOADED', 'TRANSCRIBING', 'PLANNING',
      'GENERATING_ANCHOR', 'GENERATING_SCENES'
    ) then
      perform public.assert_dream_active_capacity(p_user_id, p_dream_id);
    end if;
    return;
  end if;
  perform public.assert_dream_active_capacity(p_user_id, p_dream_id);
  perform public.increment_dream_quota_usage(p_user_id);
  update public.dreams set quota_reserved_at = now() where id = p_dream_id;
end;
$$;

do $$
declare v_definition text;
begin
  select pg_get_functiondef(
    'public.prepare_identity_reference(uuid,uuid,text,boolean,text)'::regprocedure
  ) into v_definition;
  v_definition := replace(v_definition, '''54000''', '''P4297''');
  if v_definition not like '%P4297%' then
    raise exception 'identity_pending_quota_code_not_replaced';
  end if;
  execute v_definition;
end;
$$;

comment on table public.dream_global_daily_usage is
  'Reserved Runpod job slots by UTC day. A story reserves eight slots; a scene edit reserves one.';
