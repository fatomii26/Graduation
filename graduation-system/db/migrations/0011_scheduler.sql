-- Every-minute release of expired holds via pg_cron, where the extension is available
-- (Supabase: enable "pg_cron" under Database -> Extensions first; Azure Flexible Server: add it to
-- azure.extensions and shared_preload_libraries). Without pg_cron, the app's /api/cron/tick endpoint
-- runs the same job. Correctness never depends on it: expired holds stop counting the moment they expire.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    begin
      execute 'create extension if not exists pg_cron';
      perform cron.schedule('release-expired-holds', '* * * * *', 'select public.run_release_holds_job()');
    exception when others then
      raise notice 'pg_cron not scheduled (%). Use the /api/cron/tick endpoint instead.', sqlerrm;
    end;
  end if;
end $$;

-- Keep row level security on for every table, including any added after 0009
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', r.tablename);
  end loop;
end $$;
