create or replace function public.begin_identity_deletion(
  p_reference_id uuid,
  p_user_id uuid
) returns table(source_path text, reference_path text)
language plpgsql security definer
set search_path = ''
as $$
declare v_reference public.identity_references%rowtype;
begin
  perform 1 from auth.users where id = p_user_id for update;
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
  where (reference.status = 'PENDING' and reference.upload_expires_at <= now()
      and (reference.normalization_claim_token is null
        or reference.normalization_claimed_at <= now() - interval '10 minutes'))
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

create or replace function public.get_identity_cleanup_health()
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
  where (reference.status = 'PENDING' and reference.upload_expires_at <= now()
      and (reference.normalization_claim_token is null
        or reference.normalization_claimed_at <= now() - interval '10 minutes'))
    or reference.status in ('DELETING', 'FAILED')
    or (reference.status = 'DELETED' and reference.cleanup_due_at <= now())
    or (reference.status = 'READY' and (
      not reference.is_active or reference.retention_expires_at <= now()
      or reference.upload_path is not null
    ));
$$;
