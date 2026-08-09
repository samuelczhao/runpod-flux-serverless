create or replace function public.reserve_existing_dream_creation(
  p_dream_id uuid,
  p_user_id uuid
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
declare v_current_bucket date;
declare v_reserved_bucket date;
begin
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then
    raise exception 'dream_not_found' using errcode = 'P0002';
  end if;
  if v_dream.status not in (
    'DRAFT', 'UPLOADED', 'TRANSCRIBING', 'PLANNING',
    'GENERATING_ANCHOR', 'GENERATING_SCENES'
  ) then return; end if;
  perform public.assert_dream_active_capacity(p_user_id, p_dream_id);
  if v_dream.workflow_run_id is not null then return; end if;
  if v_dream.workflow_claim_token is not null
    and v_dream.workflow_claimed_at > now() - interval '15 minutes' then return; end if;

  v_current_bucket := (now() at time zone 'UTC')::date;
  v_reserved_bucket := (v_dream.quota_reserved_at at time zone 'UTC')::date;
  if v_dream.quota_reserved_at is not null
    and v_reserved_bucket = v_current_bucket then return; end if;
  perform public.increment_dream_quota_usage(p_user_id);
  update public.dreams set quota_reserved_at = now() where id = p_dream_id;
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
  perform public.reserve_existing_dream_creation(p_dream_id, p_user_id);
  select * into v_dream from public.dreams where id = p_dream_id;
  if v_dream.quota_reserved_at is null then
    raise exception 'dream_quota_unreserved' using errcode = '23514';
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

revoke all on function public.reserve_existing_dream_creation(uuid, uuid) from public;
revoke all on function public.claim_dream_workflow(uuid, uuid, text) from public;
grant execute on function public.claim_dream_workflow(uuid, uuid, text) to service_role;
