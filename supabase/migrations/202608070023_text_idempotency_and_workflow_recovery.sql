alter table public.dreams
  add column text_operation_key uuid,
  add column workflow_claim_token text,
  add column workflow_claimed_at timestamptz,
  add constraint text_operation_shape check (
    text_operation_key is null or input_mode = 'text'
  ),
  add constraint dream_workflow_claim_shape check (
    (workflow_claim_token is null) = (workflow_claimed_at is null)
  );

create unique index dreams_text_operation_idx
on public.dreams (user_id, text_operation_key)
where text_operation_key is not null;

create function public.prepare_text_dream(
  p_user_id uuid,
  p_operation_key uuid,
  p_transcript text
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
declare v_transcript text;
begin
  v_transcript := trim(p_transcript);
  if p_user_id is null or p_operation_key is null or v_transcript is null
    or char_length(v_transcript) not between 10 and 12000 then
    raise exception 'invalid_text_operation' using errcode = '22023';
  end if;
  insert into public.dreams (
    user_id, input_mode, transcript, text_operation_key
  ) values (
    p_user_id, 'text', v_transcript, p_operation_key
  ) on conflict (user_id, text_operation_key)
    where text_operation_key is not null do nothing;
  select * into v_dream from public.dreams
  where user_id = p_user_id and text_operation_key = p_operation_key for update;
  if v_dream.id is null then
    raise exception 'text_preparation_not_found' using errcode = 'P0002';
  end if;
  if v_dream.input_mode <> 'text' or v_dream.transcript is distinct from v_transcript then
    raise exception 'idempotency_conflict' using errcode = '23505';
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
      update public.dreams set status = 'PLANNING' where id = p_dream_id;
    elsif v_dream.status not in ('PLANNING', 'GENERATING_ANCHOR', 'GENERATING_SCENES') then
      raise exception 'dream_not_ready' using errcode = '23514';
    end if;
  elsif v_dream.input_mode = 'audio' then
    if v_dream.status = 'UPLOADED'
      and v_dream.audio_storage_path like p_user_id::text || '/' || p_dream_id::text || '/%' then
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

create or replace function public.claim_audio_plan_workflow(
  p_dream_id uuid,
  p_user_id uuid,
  p_transcript text,
  p_claim_token text
) returns table(workflow_id text, claimed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
declare v_transcript text;
begin
  v_transcript := trim(p_transcript);
  if v_transcript is null or char_length(v_transcript) not between 10 and 12000
    or nullif(trim(p_claim_token), '') is null then
    raise exception 'invalid_transcript' using errcode = '22023';
  end if;
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then return; end if;
  if v_dream.input_mode <> 'audio' or v_dream.status not in (
    'PLANNING', 'GENERATING_ANCHOR', 'GENERATING_SCENES'
  ) or v_dream.audio_uploaded_at is null or v_dream.raw_transcript is null then
    raise exception 'dream_not_ready' using errcode = '23514';
  end if;
  if v_dream.status <> 'PLANNING' and v_dream.transcript is distinct from v_transcript then
    raise exception 'transcript_conflict' using errcode = '40001';
  end if;
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
  update public.dreams set transcript = v_transcript,
    workflow_claim_token = p_claim_token, workflow_claimed_at = now()
  where id = p_dream_id;
  return query select p_claim_token, true;
end;
$$;

create or replace function public.record_dream_workflow(
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
    raise exception 'invalid_workflow_run' using errcode = '22023';
  end if;
  select * into v_dream from public.dreams where id = p_dream_id for update;
  if v_dream.id is null then raise exception 'dream_not_found' using errcode = 'P0002'; end if;
  if v_dream.workflow_run_id = p_run_id then return; end if;
  if v_dream.workflow_claim_token is distinct from p_claim_token then
    raise exception 'workflow_claim_conflict' using errcode = '40001';
  end if;
  update public.dreams set workflow_run_id = p_run_id,
    workflow_claim_token = null, workflow_claimed_at = null where id = p_dream_id;
end;
$$;

create or replace function public.release_dream_workflow_claim(
  p_dream_id uuid,
  p_claim_token text
) returns void
language sql security definer
set search_path = ''
as $$
  update public.dreams set workflow_claim_token = null, workflow_claimed_at = null
  where id = p_dream_id and workflow_claim_token = p_claim_token
    and workflow_run_id is null;
$$;

create function public.release_dream_workflow_execution(
  p_dream_id uuid,
  p_claim_token text,
  p_run_id text
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if nullif(trim(p_claim_token), '') is null or nullif(trim(p_run_id), '') is null then
    raise exception 'invalid_workflow_identity' using errcode = '22023';
  end if;
  update public.dreams set workflow_run_id = null,
    workflow_claim_token = null, workflow_claimed_at = null
  where id = p_dream_id
    and status in ('TRANSCRIBING', 'PLANNING', 'GENERATING_ANCHOR', 'GENERATING_SCENES', 'FAILED')
    and (
      (workflow_run_id = p_run_id and workflow_claim_token is null)
      or (workflow_run_id is null and workflow_claim_token = p_claim_token)
    );
end;
$$;

revoke all on function public.prepare_text_dream(uuid, uuid, text) from public;
revoke all on function public.release_dream_workflow_execution(uuid, text, text) from public;
grant execute on function public.prepare_text_dream(uuid, uuid, text) to service_role;
grant execute on function public.release_dream_workflow_execution(uuid, text, text) to service_role;
