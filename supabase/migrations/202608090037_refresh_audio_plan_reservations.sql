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
    raise exception 'transcript_conflict' using errcode = 'P4090';
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
  perform public.reserve_existing_dream_creation(p_dream_id, p_user_id);
  update public.dreams set transcript = v_transcript,
    workflow_claim_token = p_claim_token, workflow_claimed_at = now()
  where id = p_dream_id;
  return query select p_claim_token, true;
end;
$$;

revoke all on function public.claim_audio_plan_workflow(uuid, uuid, text, text) from public;
grant execute on function public.claim_audio_plan_workflow(uuid, uuid, text, text) to service_role;
