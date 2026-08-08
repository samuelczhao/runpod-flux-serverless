create function public.is_valid_dream_transition(
  p_from public.dream_status,
  p_to public.dream_status
) returns boolean
language sql immutable
set search_path = ''
as $$
  select (p_from, p_to) in (
    ('DRAFT', 'UPLOADED'), ('DRAFT', 'PLANNING'), ('DRAFT', 'DELETING'),
    ('UPLOADED', 'TRANSCRIBING'), ('UPLOADED', 'DELETING'),
    ('TRANSCRIBING', 'PLANNING'), ('TRANSCRIBING', 'FAILED'), ('TRANSCRIBING', 'DELETING'),
    ('PLANNING', 'GENERATING_ANCHOR'), ('PLANNING', 'FAILED'), ('PLANNING', 'DELETING'),
    ('GENERATING_ANCHOR', 'GENERATING_SCENES'), ('GENERATING_ANCHOR', 'FAILED'),
    ('GENERATING_ANCHOR', 'DELETING'), ('GENERATING_SCENES', 'READY'),
    ('GENERATING_SCENES', 'FAILED'), ('GENERATING_SCENES', 'DELETING'),
    ('READY', 'DELETING'), ('FAILED', 'TRANSCRIBING'), ('FAILED', 'PLANNING'),
    ('FAILED', 'GENERATING_ANCHOR'), ('FAILED', 'GENERATING_SCENES'), ('FAILED', 'DELETING')
  );
$$;

create function public.transition_dream_state(
  p_dream_id uuid,
  p_expected public.dream_status,
  p_next public.dream_status,
  p_failed_stage text default null,
  p_error_code text default null
) returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  if not public.is_valid_dream_transition(p_expected, p_next) then
    raise exception 'invalid_state_transition' using errcode = '22023';
  end if;
  update public.dreams set status = p_next, failed_stage = p_failed_stage,
    error_code = p_error_code, updated_at = now()
  where id = p_dream_id and status = p_expected;
  if not found then
    raise exception 'state_conflict' using errcode = '40001';
  end if;
end;
$$;

create function public.apply_dream_plan(p_dream_id uuid, p_plan jsonb) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_motif jsonb;
  v_motif_id uuid;
  v_label text;
  v_slug text;
begin
  select user_id into v_user_id from public.dreams
  where id = p_dream_id and status = 'PLANNING' for update;
  if v_user_id is null then raise exception 'state_conflict' using errcode = '40001'; end if;
  if jsonb_array_length(p_plan->'scenes') <> 3 then
    raise exception 'invalid_scene_count' using errcode = '22023';
  end if;
  update public.dreams set title = p_plan->>'title', summary = p_plan->>'summary',
    visual_bible = to_jsonb(p_plan->>'visual_bible'), updated_at = now() where id = p_dream_id;
  insert into public.scenes (dream_id, ordinal, caption, prompt)
  select p_dream_id, scene.ordinality::smallint, scene.value->>'caption', scene.value->>'prompt'
  from jsonb_array_elements(p_plan->'scenes') with ordinality as scene(value, ordinality);
  for v_motif in select value from jsonb_array_elements(p_plan->'motifs') loop
    v_label := trim(v_motif->>'label');
    v_slug := trim(both '-' from regexp_replace(lower(v_label), '[^a-z0-9]+', '-', 'g'));
    if v_slug = '' then v_slug := 'motif-' || substr(md5(v_label), 1, 12); end if;
    insert into public.motifs (user_id, canonical_label, slug, kind)
    values (v_user_id, v_label, v_slug, (v_motif->>'kind')::public.motif_kind)
    on conflict (user_id, slug) do update set canonical_label = excluded.canonical_label
    returning id into v_motif_id;
    insert into public.dream_motifs (dream_id, motif_id) values (p_dream_id, v_motif_id)
    on conflict do nothing;
  end loop;
  update public.dreams set status = 'GENERATING_ANCHOR', updated_at = now() where id = p_dream_id;
end;
$$;

create function public.finalize_dream(p_dream_id uuid) returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ready_count integer;
begin
  select count(distinct s.id) into v_ready_count
  from public.scenes s join public.scene_versions v on v.scene_id = s.id
  where s.dream_id = p_dream_id and v.status = 'COMPLETED';
  if v_ready_count <> 3 then raise exception 'dream_not_ready' using errcode = '23514'; end if;
  perform public.transition_dream_state(p_dream_id, 'GENERATING_SCENES', 'READY');
end;
$$;

create function public.touch_updated_at() returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger dreams_touch_updated_at before update on public.dreams
for each row execute function public.touch_updated_at();
create trigger jobs_touch_updated_at before update on public.generation_jobs
for each row execute function public.touch_updated_at();

revoke all on function public.is_valid_dream_transition(public.dream_status, public.dream_status) from public;
revoke all on function public.transition_dream_state(uuid, public.dream_status, public.dream_status, text, text) from public;
revoke all on function public.apply_dream_plan(uuid, jsonb) from public;
revoke all on function public.finalize_dream(uuid) from public;
grant execute on function public.is_valid_dream_transition(public.dream_status, public.dream_status) to service_role;
grant execute on function public.transition_dream_state(uuid, public.dream_status, public.dream_status, text, text) to service_role;
grant execute on function public.apply_dream_plan(uuid, jsonb) to service_role;
grant execute on function public.finalize_dream(uuid) to service_role;
