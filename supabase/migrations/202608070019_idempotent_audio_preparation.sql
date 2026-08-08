alter table public.dreams
  add column audio_operation_key uuid,
  add constraint audio_operation_shape check (
    audio_operation_key is null or input_mode = 'audio'
  );

create unique index dreams_audio_operation_idx
on public.dreams (user_id, audio_operation_key)
where audio_operation_key is not null;

create function public.prepare_audio_dream(
  p_user_id uuid,
  p_operation_key uuid
) returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare v_dream_id uuid;
begin
  insert into public.dreams (user_id, input_mode, transcript, audio_operation_key)
  values (p_user_id, 'audio', null, p_operation_key)
  on conflict (user_id, audio_operation_key) where audio_operation_key is not null do nothing
  returning id into v_dream_id;
  if v_dream_id is null then
    select id into v_dream_id from public.dreams
    where user_id = p_user_id and audio_operation_key = p_operation_key;
  end if;
  return v_dream_id;
end;
$$;

revoke all on function public.prepare_audio_dream(uuid, uuid) from public;
grant execute on function public.prepare_audio_dream(uuid, uuid) to service_role;
