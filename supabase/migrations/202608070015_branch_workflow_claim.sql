alter table public.scene_versions
  add column workflow_run_id text,
  add column workflow_claim_token text,
  add column workflow_claimed_at timestamptz,
  add constraint branch_workflow_claim_shape check (
    (workflow_claim_token is null) = (workflow_claimed_at is null)
  );

create unique index scene_versions_workflow_run_idx on public.scene_versions (workflow_run_id)
where workflow_run_id is not null;

create function public.claim_branch_workflow(
  p_user_id uuid,
  p_version_id uuid,
  p_claim_token text
) returns table(workflow_id text, claimed boolean)
language plpgsql security definer
set search_path = ''
as $$
declare v_version public.scene_versions%rowtype;
begin
  if nullif(trim(p_claim_token), '') is null then
    raise exception 'invalid_workflow_claim' using errcode = '22023';
  end if;
  select version.* into v_version from public.scene_versions version
  join public.scenes scene on scene.id = version.scene_id
  join public.dreams dream on dream.id = scene.dream_id
  where version.id = p_version_id and dream.user_id = p_user_id for update of version;
  if v_version.id is null then return; end if;
  if v_version.parent_version_id is null or v_version.status <> 'PENDING' then
    raise exception 'branch_not_ready' using errcode = '23514';
  end if;
  if v_version.workflow_run_id is not null then
    return query select v_version.workflow_run_id, false; return;
  end if;
  if v_version.workflow_claim_token = p_claim_token then
    return query select null::text, true; return;
  end if;
  if v_version.workflow_claim_token is not null
    and v_version.workflow_claimed_at > now() - interval '15 minutes' then
    return query select null::text, false; return;
  end if;
  update public.scene_versions set workflow_claim_token = p_claim_token, workflow_claimed_at = now()
  where id = p_version_id;
  return query select null::text, true;
end;
$$;

create function public.record_branch_workflow(
  p_version_id uuid,
  p_claim_token text,
  p_run_id text
) returns void
language plpgsql security definer
set search_path = ''
as $$
declare v_version public.scene_versions%rowtype;
begin
  if nullif(trim(p_run_id), '') is null then
    raise exception 'invalid_workflow_run' using errcode = '22023';
  end if;
  select * into v_version from public.scene_versions where id = p_version_id for update;
  if v_version.id is null then raise exception 'version_not_found' using errcode = 'P0002'; end if;
  if v_version.workflow_run_id = p_run_id then return; end if;
  if v_version.workflow_claim_token is distinct from p_claim_token then
    raise exception 'workflow_claim_conflict' using errcode = '40001';
  end if;
  update public.scene_versions set workflow_run_id = p_run_id,
    workflow_claim_token = null, workflow_claimed_at = null where id = p_version_id;
end;
$$;

create function public.release_branch_workflow_claim(
  p_version_id uuid,
  p_claim_token text
) returns void
language sql security definer
set search_path = ''
as $$
  update public.scene_versions set workflow_claim_token = null, workflow_claimed_at = null
  where id = p_version_id and workflow_claim_token = p_claim_token and workflow_run_id is null;
$$;

revoke all on function public.claim_branch_workflow(uuid, uuid, text) from public;
revoke all on function public.record_branch_workflow(uuid, text, text) from public;
revoke all on function public.release_branch_workflow_claim(uuid, text) from public;
grant execute on function public.claim_branch_workflow(uuid, uuid, text) to service_role;
grant execute on function public.record_branch_workflow(uuid, text, text) to service_role;
grant execute on function public.release_branch_workflow_claim(uuid, text) to service_role;
