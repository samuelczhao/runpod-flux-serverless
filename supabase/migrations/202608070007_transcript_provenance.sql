alter table public.dreams add column raw_transcript text
  check (char_length(raw_transcript) <= 12000);

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
    if v_dream.raw_transcript = v_transcript then return; end if;
    raise exception 'completion_conflict' using errcode = '40001';
  end if;
  if v_job.status not in ('QUEUED', 'RUNNING') or v_job.external_job_id is null
    or v_dream.status <> 'TRANSCRIBING' then
    raise exception 'job_state_conflict' using errcode = '40001';
  end if;
  update public.dreams set raw_transcript = v_transcript, transcript = v_transcript,
    status = 'PLANNING', workflow_run_id = null where id = v_dream.id;
  update public.generation_jobs set status = 'COMPLETED', delay_ms = p_delay_ms,
    execution_ms = p_execution_ms, cost_source = 'unavailable' where id = p_job_id;
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
  if nullif(v_transcript, '') is null or char_length(v_transcript) > 12000 then
    raise exception 'invalid_transcript' using errcode = '22023';
  end if;
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then return; end if;
  if v_dream.workflow_run_id = p_claim_token then return query select p_claim_token, true; return; end if;
  if v_dream.workflow_run_id is not null then return query select v_dream.workflow_run_id, false; return; end if;
  if v_dream.input_mode <> 'audio' or v_dream.status <> 'PLANNING'
    or v_dream.audio_uploaded_at is null or v_dream.raw_transcript is null then
    raise exception 'dream_not_ready' using errcode = '23514';
  end if;
  update public.dreams set transcript = v_transcript, workflow_run_id = p_claim_token
  where id = p_dream_id;
  return query select p_claim_token, true;
end;
$$;
