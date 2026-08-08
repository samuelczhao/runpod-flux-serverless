alter table public.scene_versions
  add column operation_key text,
  add column request_hash text,
  add constraint branch_identity_shape_check check (
    (parent_version_id is null and operation_key is null and request_hash is null)
    or (parent_version_id is not null and nullif(trim(operation_key), '') is not null
      and request_hash ~ '^[0-9a-f]{64}$')
  );

create unique index scene_versions_operation_idx on public.scene_versions (operation_key)
where operation_key is not null;

create function public.create_scene_branch(
  p_user_id uuid,
  p_dream_id uuid,
  p_parent_version_id uuid,
  p_instruction text,
  p_model text,
  p_seed bigint,
  p_operation_key text,
  p_request_hash text
) returns table(version_id uuid, claimed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
declare v_parent public.scene_versions%rowtype;
declare v_existing public.scene_versions%rowtype;
declare v_scene_id uuid;
declare v_instruction text;
declare v_version_id uuid;
begin
  v_instruction := trim(p_instruction);
  if nullif(v_instruction, '') is null or char_length(v_instruction) > 1000
    or nullif(trim(p_model), '') is null or p_seed < 0
    or nullif(trim(p_operation_key), '') is null or p_request_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_branch_input' using errcode = '22023';
  end if;
  select * into v_dream from public.dreams
  where id = p_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then raise exception 'dream_not_found' using errcode = 'P0002'; end if;
  if v_dream.status <> 'READY' then raise exception 'dream_not_ready' using errcode = '23514'; end if;
  select parent.scene_id into v_scene_id from public.scene_versions parent
  join public.scenes scene on scene.id = parent.scene_id
  where parent.id = p_parent_version_id and scene.dream_id = p_dream_id;
  if v_scene_id is null then raise exception 'parent_not_found' using errcode = 'P0002'; end if;
  perform 1 from public.scenes where id = v_scene_id for update;
  select * into v_parent from public.scene_versions where id = p_parent_version_id for update;
  if v_parent.status <> 'COMPLETED' or v_parent.storage_path is null then
    raise exception 'invalid_branch_parent' using errcode = '23514';
  end if;
  select * into v_existing from public.scene_versions
  where operation_key = p_operation_key for update;
  if v_existing.id is not null then
    if v_existing.scene_id = v_scene_id and v_existing.parent_version_id = p_parent_version_id
      and v_existing.edit_instruction = v_instruction and v_existing.model = p_model
      and v_existing.seed = p_seed and v_existing.request_hash = p_request_hash then
      return query select v_existing.id, false; return;
    end if;
    raise exception 'idempotency_conflict' using errcode = '23505';
  end if;
  insert into public.scene_versions (
    scene_id, parent_version_id, edit_instruction, model, seed, operation_key, request_hash
  ) values (
    v_scene_id, p_parent_version_id, v_instruction, p_model, p_seed, p_operation_key, p_request_hash
  ) returning id into v_version_id;
  return query select v_version_id, true;
end;
$$;

create function public.select_scene_version(
  p_user_id uuid,
  p_scene_id uuid,
  p_expected_version_id uuid,
  p_next_version_id uuid
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_dream public.dreams%rowtype;
declare v_dream_id uuid;
declare v_current_id uuid;
declare v_next public.scene_versions%rowtype;
begin
  select dream_id into v_dream_id from public.scenes where id = p_scene_id;
  select * into v_dream from public.dreams
  where id = v_dream_id and user_id = p_user_id for update;
  if v_dream.id is null then raise exception 'scene_not_found' using errcode = 'P0002'; end if;
  if v_dream.status <> 'READY' then raise exception 'dream_not_ready' using errcode = '23514'; end if;
  perform 1 from public.scenes where id = p_scene_id for update;
  select id into v_current_id from public.scene_versions
  where scene_id = p_scene_id and is_selected for update;
  if v_current_id = p_next_version_id then return; end if;
  if v_current_id is distinct from p_expected_version_id then
    raise exception 'selection_conflict' using errcode = '40001';
  end if;
  select * into v_next from public.scene_versions
  where id = p_next_version_id and scene_id = p_scene_id for update;
  if v_next.id is null or v_next.status <> 'COMPLETED' or v_next.storage_path is null
    or not exists (select 1 from storage.objects object
      where object.bucket_id = 'dream-images' and object.name = v_next.storage_path) then
    raise exception 'version_not_selectable' using errcode = '23514';
  end if;
  update public.scene_versions set is_selected = false where id = v_current_id;
  update public.scene_versions set is_selected = true where id = v_next.id;
end;
$$;

revoke all on function public.create_scene_branch(uuid, uuid, uuid, text, text, bigint, text, text) from public;
revoke all on function public.select_scene_version(uuid, uuid, uuid, uuid) from public;
grant execute on function public.create_scene_branch(uuid, uuid, uuid, text, text, bigint, text, text) to service_role;
grant execute on function public.select_scene_version(uuid, uuid, uuid, uuid) to service_role;
