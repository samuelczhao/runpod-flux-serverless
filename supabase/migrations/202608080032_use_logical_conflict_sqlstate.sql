do $$
declare v_function record;
begin
  for v_function in
    select pg_get_functiondef(routine.oid) as definition
    from pg_proc routine
    join pg_namespace namespace on namespace.oid = routine.pronamespace
    where namespace.nspname = 'public'
      and routine.prokind = 'f'
      and routine.prosrc like '%40001%'
  loop
    execute replace(v_function.definition, '40001', 'P4090');
  end loop;
end;
$$;

comment on schema public is
  'Application conflicts use P4090; SQLSTATE 40001 is reserved for retryable serialization failures.';
