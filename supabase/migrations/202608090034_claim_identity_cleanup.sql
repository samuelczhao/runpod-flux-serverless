create function public.begin_identity_cleanup(
  p_reference_id uuid,
  p_user_id uuid,
  p_cleanup_kind text
) returns table(source_path text, reference_path text)
language plpgsql security definer
set search_path = ''
as $$
declare v_reference public.identity_references%rowtype;
declare v_reference_path text;
declare v_in_use boolean;
begin
  if p_cleanup_kind not in ('source', 'reference', 'tombstone') then
    raise exception 'invalid_identity_cleanup_kind' using errcode = '22023';
  end if;
  perform 1 from auth.users where id = p_user_id for update;
  select * into v_reference from public.identity_references
  where id = p_reference_id and user_id = p_user_id for update;
  if v_reference.id is null then return; end if;

  v_reference_path := p_user_id::text || '/identity/'
    || p_reference_id::text || '/reference.png';
  if p_cleanup_kind = 'tombstone' then
    if v_reference.status = 'DELETED' and v_reference.cleanup_due_at <= now() then
      return query select null::text, v_reference_path;
    end if;
    return;
  end if;
  if p_cleanup_kind = 'source' then
    if v_reference.status = 'READY' and v_reference.is_active
      and v_reference.retention_expires_at > now()
      and v_reference.upload_path is not null then
      return query select v_reference.upload_path, null::text;
    end if;
    return;
  end if;

  if not (
    (v_reference.status = 'PENDING' and v_reference.upload_expires_at <= now()
      and (v_reference.normalization_claim_token is null
        or v_reference.normalization_claimed_at <= now() - interval '10 minutes'))
    or v_reference.status in ('DELETING', 'FAILED')
    or (v_reference.status = 'READY'
      and (not v_reference.is_active or v_reference.retention_expires_at <= now()))
  ) then return; end if;

  select exists (
    select 1 from public.dreams dream
    where dream.identity_reference_id = p_reference_id
      and dream.status in (
        'DRAFT', 'UPLOADED', 'TRANSCRIBING', 'PLANNING',
        'GENERATING_ANCHOR', 'GENERATING_SCENES'
      )
      and dream.updated_at > now() - interval '24 hours'
  ) into v_in_use;
  if v_reference.status <> 'DELETING' and v_in_use then return; end if;

  if v_reference.status <> 'DELETING' then
    update public.identity_references set status = 'DELETING', is_active = false,
      normalization_claim_token = null, normalization_claimed_at = null,
      updated_at = now() where id = p_reference_id;
  end if;
  return query select v_reference.upload_path,
    coalesce(v_reference.storage_path, v_reference_path);
end;
$$;

revoke all on function public.begin_identity_cleanup(uuid, uuid, text) from public;
grant execute on function public.begin_identity_cleanup(uuid, uuid, text) to service_role;

-- Migration 033 changed this ledger from stories to reserved Runpod job slots.
-- Close only the pre-change bucket so its mixed units can never admit excess work.
update public.dream_global_daily_usage usage
set used = limits.max_global_day
from public.dream_quota_limits limits
where limits.singleton and usage.bucket_date <= date '2026-08-08';
