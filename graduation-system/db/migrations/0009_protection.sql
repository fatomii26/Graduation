-- "Never lose data": orders, tickets, payments, scans, transfers and the audit log cannot be deleted by anyone.
-- Logs are append-only. Row level security is on for every table and no browser role can read or write.

-- Scans accept one kind of update: the Data Clean-Up tool removing holder names from a closed season.
create or replace function scans_guard() returns trigger
language plpgsql as $$
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('app.allow_cleanup', true), '') = 'on'
     and new.id = old.id and new.ticket_id is not distinct from old.ticket_id and new.result = old.result and new.at = old.at then
    return new;
  end if;
  raise exception 'Rows in scans cannot be deleted or rewritten' using errcode = 'P0001';
end $$;

do $$
declare t text;
begin
  -- no delete, no truncate
  foreach t in array array[
    'seasons', 'graduates', 'financial_holds', 'orders', 'order_guests', 'receipts', 'extra_ticket_requests', 'extra_ticket_codes',
    'tickets', 'transfers', 'name_change_requests', 'ticket_sends', 'package_collections', 'merch_orders', 'merch_order_lines',
    'reconciliation_uploads', 'reconciliation_lines', 'staff']
  loop
    execute format('create trigger %I before delete on %I for each row execute function forbid_change()', t || '_no_delete', t);
    execute format('create trigger %I before truncate on %I for each statement execute function forbid_change()', t || '_no_truncate', t);
  end loop;

  -- append-only: no update, no delete, no truncate
  foreach t in array array['audit_log', 'technical_change_log', 'payments', 'payment_events', 'login_attempts']
  loop
    execute format('create trigger %I before update or delete on %I for each row execute function forbid_change()', t || '_append_only', t);
    execute format('create trigger %I before truncate on %I for each statement execute function forbid_change()', t || '_no_truncate', t);
  end loop;
end $$;

create trigger scans_append_only before update or delete on scans for each row execute function scans_guard();
create trigger scans_no_truncate before truncate on scans for each statement execute function forbid_change();

-- Row level security on every table, with no policies: only the server's own database user (the owner) can
-- reach the data, and it does so only through these functions and the server code.
do $$
declare r record;
begin
  for r in select tablename from pg_tables where schemaname = current_schema() loop
    execute format('alter table %I enable row level security', r.tablename);
  end loop;
end $$;

-- Hosted Postgres often creates API roles (Supabase: anon, authenticated). Make sure they can do nothing here.
do $$
declare rl text;
begin
  execute 'revoke execute on all functions in schema ' || quote_ident(current_schema()) || ' from public';
  foreach rl in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = rl) then
      execute format('revoke all on all tables in schema %I from %I', current_schema(), rl);
      execute format('revoke all on all sequences in schema %I from %I', current_schema(), rl);
      execute format('revoke all on all functions in schema %I from %I', current_schema(), rl);
      execute format('alter default privileges in schema %I revoke all on tables from %I', current_schema(), rl);
      execute format('alter default privileges in schema %I revoke all on functions from %I', current_schema(), rl);
    end if;
  end loop;
  execute format('alter default privileges in schema %I revoke execute on functions from public', current_schema());
end $$;
