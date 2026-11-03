-- Seasons, hall layout and venue, ceremonies, staff and permissions, merchandise, data clean-up, scheduled jobs

-- ---------------------------------------------------------------------------
-- Seasons
-- ---------------------------------------------------------------------------
-- A new season copies the previous season's prices, hall layout (zones and venue), merchandise items,
-- ceremonies (without dates) and programme map; the guest limit starts at 4 and sales start closed.
create or replace function create_season(p_id text, p_name text, p_copy_from text, p_actor text) returns jsonb
language plpgsql as $$
declare sid text := upper(btrim(coalesce(p_id, ''))); i int;
begin
  if sid !~ '^[A-Z0-9-]{3,20}$' or length(btrim(coalesce(p_name, ''))) < 3 then return res_err('bad_request'); end if;
  if exists (select 1 from seasons where id = sid) then return res_err('season_exists'); end if;
  insert into seasons (id, name, status, sort) values (sid, btrim(p_name), 'open', coalesce((select max(sort) from seasons), 0) + 1);

  if p_copy_from is not null and exists (select 1 from seasons where id = p_copy_from) then
    insert into season_settings (season_id, graduate_price_aed, guest_price_aed, guest_limit, hold_minutes, extra_code_hours,
                                 sales_open, zone_selection_enabled, transfers_enabled, extra_requests_enabled, name_changes_enabled,
                                 merch_enabled, reminder_enabled, reminder_days_before, venue_name, venue_area, graduate_capacity)
    select sid, graduate_price_aed, guest_price_aed, 4, hold_minutes, extra_code_hours,
           false, zone_selection_enabled, transfers_enabled, extra_requests_enabled, name_changes_enabled,
           merch_enabled, reminder_enabled, reminder_days_before, venue_name, venue_area, graduate_capacity
      from season_settings where season_id = p_copy_from;
    insert into zones (season_id, code, name, door, color, capacity, wheelchair_capacity, sort, active)
    select sid, code, name, door, color, capacity, wheelchair_capacity, sort, active from zones where season_id = p_copy_from;
    insert into ceremonies (season_id, number, name, graduate_entrance)
    select sid, number, name, graduate_entrance from ceremonies where season_id = p_copy_from;
    insert into merch_items (season_id, name, description, price_aed, image, active, sort)
    select sid, name, description, price_aed, image, active, sort from merch_items where season_id = p_copy_from and not removed;
    insert into programme_ceremony_map (season_id, programme, ceremony_number)
    select sid, programme, ceremony_number from programme_ceremony_map where season_id = p_copy_from;
  else
    insert into season_settings (season_id) values (sid);
    for i in 1..4 loop
      insert into ceremonies (season_id, number, name) values (sid, i, 'Ceremony ' || i);
    end loop;
  end if;
  perform log_event(p_actor, 'season_created', 'seasons', sid, null, null, jsonb_build_object('name', p_name, 'copied_from', p_copy_from));
  return jsonb_build_object('ok', true, 'id', sid);
end $$;

create or replace function set_season_status(p_id text, p_status text, p_actor text) returns jsonb
language plpgsql as $$
declare s seasons;
begin
  if p_status not in ('open', 'closed') then return res_err('bad_request'); end if;
  select * into s from seasons where id = p_id for update;
  if not found then return res_err('no_such_season'); end if;
  if s.cleaned_at is not null and p_status = 'open' then return res_err('season_cleaned'); end if;
  update seasons set status = p_status where id = p_id;
  perform log_event(p_actor, case when p_status = 'open' then 'season_opened' else 'season_closed' end, 'seasons', p_id);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Hall layout: zones. A zone can never be made smaller than the places already sold or held.
-- ---------------------------------------------------------------------------
create or replace function save_zone(
  p_season text, p_id bigint, p_code text, p_name text, p_door text, p_color text,
  p_capacity int, p_wheelchair int, p_sort int, p_active boolean, p_actor text
) returns jsonb
language plpgsql as $$
declare z zones; maxg int; maxw int; nid bigint; v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if v_code !~ '^[A-Z0-9]{1,4}$' or length(btrim(coalesce(p_name, ''))) < 1 or length(btrim(coalesce(p_door, ''))) < 1
     or coalesce(p_capacity, -1) < 0 or coalesce(p_wheelchair, -1) < 0 then
    return res_err('bad_request');
  end if;
  if p_id is null then
    begin
      insert into zones (season_id, code, name, door, color, capacity, wheelchair_capacity, sort, active)
      values (p_season, v_code, btrim(p_name), btrim(p_door), coalesce(nullif(p_color, ''), '#7A1128'), p_capacity, p_wheelchair,
              coalesce(p_sort, 0), coalesce(p_active, true))
      returning id into nid;
    exception when unique_violation then
      return res_err('zone_exists');
    end;
    perform log_event(p_actor, 'zone_added', 'hall_layout', p_season, null, null,
                      jsonb_build_object('zone', v_code, 'capacity', p_capacity, 'wheelchair', p_wheelchair, 'door', p_door));
    return jsonb_build_object('ok', true, 'id', nid);
  end if;

  select * into z from zones where id = p_id and season_id = p_season for update;
  if not found then return res_err('no_such_zone'); end if;
  select coalesce(max(u.guests), 0), coalesce(max(u.wheelchairs), 0) into maxg, maxw
    from ceremonies c cross join lateral zone_usage(c.id, z.id) u where c.season_id = p_season;
  if p_capacity < maxg then return res_err('below_usage', jsonb_build_object('in_use', maxg)); end if;
  if p_wheelchair < maxw then return res_err('below_wheelchair_usage', jsonb_build_object('in_use', maxw)); end if;
  if not coalesce(p_active, true) and maxg > 0 then return res_err('zone_in_use', jsonb_build_object('in_use', maxg)); end if;
  if lower(btrim(p_door)) <> lower(z.door) and exists (select 1 from tickets where zone_id = z.id and status = 'valid') then
    return res_err('door_in_use');
  end if;
  begin
    update zones set code = v_code, name = btrim(p_name), door = btrim(p_door), color = coalesce(nullif(p_color, ''), z.color),
           capacity = p_capacity, wheelchair_capacity = p_wheelchair, sort = coalesce(p_sort, z.sort), active = coalesce(p_active, true)
     where id = z.id;
  exception when unique_violation then
    return res_err('zone_exists');
  end;
  perform log_event(p_actor, 'zone_updated', 'hall_layout', p_season, null, null,
                    jsonb_build_object('zone', v_code,
                      'old', jsonb_build_object('name', z.name, 'door', z.door, 'capacity', z.capacity, 'wheelchair', z.wheelchair_capacity, 'active', z.active),
                      'new', jsonb_build_object('name', p_name, 'door', p_door, 'capacity', p_capacity, 'wheelchair', p_wheelchair, 'active', p_active)));
  return jsonb_build_object('ok', true, 'id', z.id);
end $$;

create or replace function save_ceremony(
  p_season text, p_number int, p_name text, p_starts timestamptz, p_doors timestamptz, p_entrance text, p_actor text
) returns jsonb
language plpgsql as $$
declare c ceremonies;
begin
  if coalesce(p_number, 0) not between 1 and 20 or length(btrim(coalesce(p_name, ''))) < 2 then return res_err('bad_request'); end if;
  select * into c from ceremonies where season_id = p_season and number = p_number for update;
  insert into ceremonies (season_id, number, name, starts_at, doors_open_at, graduate_entrance)
  values (p_season, p_number, btrim(p_name), p_starts, p_doors, coalesce(nullif(btrim(coalesce(p_entrance, '')), ''), 'Graduate entrance'))
  on conflict (season_id, number) do update set name = excluded.name, starts_at = excluded.starts_at,
    doors_open_at = excluded.doors_open_at, graduate_entrance = excluded.graduate_entrance;
  perform log_event(p_actor, 'ceremony_saved', 'seasons', p_season, null, null,
                    jsonb_build_object('number', p_number, 'name', p_name, 'starts_at', p_starts, 'doors_open_at', p_doors,
                                       'old', case when c.id is not null then jsonb_build_object('name', c.name, 'starts_at', c.starts_at) end));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Staff (Add User, status changes, individual permissions)
-- ---------------------------------------------------------------------------
create or replace function add_staff(
  p_email text, p_name text, p_title text, p_department text, p_role text, p_all_seasons boolean, p_seasons text[], p_actor text
) returns jsonb
language plpgsql as $$
declare e text := lower(btrim(coalesce(p_email, '')));
begin
  if e !~ '^[a-z0-9._%+-]+@mdx\.ac\.ae$' then return res_err('bad_email'); end if;
  if not exists (select 1 from roles where name = p_role) then return res_err('bad_role'); end if;
  if exists (select 1 from staff where email = e) then return res_err('staff_exists'); end if;
  begin
    insert into staff (email, full_name, job_title, department, role, status, all_seasons, seasons)
    values (e, btrim(p_name), btrim(coalesce(p_title, '')), p_department, p_role, 'invited', coalesce(p_all_seasons, true), coalesce(p_seasons, '{}'));
  exception when check_violation then
    return res_err('bad_request');
  end;
  perform log_event(p_actor, 'staff_added', 'access', null, null, null,
                    jsonb_build_object('email', e, 'role', p_role, 'department', p_department));
  return jsonb_build_object('ok', true, 'email', e);
end $$;

create or replace function update_staff(
  p_email text, p_name text, p_title text, p_department text, p_role text, p_all_seasons boolean, p_seasons text[], p_actor text
) returns jsonb
language plpgsql as $$
declare s staff;
begin
  select * into s from staff where email = lower(p_email) for update;
  if not found then return res_err('no_such_staff'); end if;
  if not exists (select 1 from roles where name = p_role) then return res_err('bad_role'); end if;
  begin
    update staff set full_name = btrim(p_name), job_title = btrim(coalesce(p_title, '')), department = p_department, role = p_role,
           all_seasons = coalesce(p_all_seasons, true), seasons = coalesce(p_seasons, '{}')
     where email = s.email;
  exception when check_violation then
    return res_err('bad_request');
  end;
  perform log_event(p_actor, 'staff_updated', 'access', null, null, null,
                    jsonb_build_object('email', s.email, 'old_role', s.role, 'new_role', p_role, 'department', p_department,
                                       'all_seasons', p_all_seasons, 'seasons', to_jsonb(p_seasons)));
  return jsonb_build_object('ok', true);
end $$;

-- Remove is a status change, never a deletion. Pausing or removing someone signs them out everywhere.
create or replace function set_staff_status(p_email text, p_status text, p_actor text) returns jsonb
language plpgsql as $$
declare s staff;
begin
  if p_status not in ('invited', 'active', 'paused', 'removed') then return res_err('bad_request'); end if;
  select * into s from staff where email = lower(p_email) for update;
  if not found then return res_err('no_such_staff'); end if;
  if s.email = lower(p_actor) and p_status in ('paused', 'removed') then return res_err('cannot_change_self'); end if;
  update staff set status = p_status where email = s.email;
  if p_status in ('paused', 'removed') then
    update sessions set revoked_at = now(), revoked_by = p_actor where kind = 'staff' and subject = s.email and revoked_at is null;
  end if;
  perform log_event(p_actor, 'staff_status_changed', 'access', null, null, null,
                    jsonb_build_object('email', s.email, 'old', s.status, 'new', p_status));
  return jsonb_build_object('ok', true);
end $$;

-- p_allowed: true adds the permission, false removes it, null returns to the role preset
create or replace function set_staff_permission(p_email text, p_permission text, p_allowed boolean, p_actor text) returns jsonb
language plpgsql as $$
begin
  if not exists (select 1 from staff where email = lower(p_email)) then return res_err('no_such_staff'); end if;
  if not exists (select 1 from permissions where key = p_permission) then return res_err('bad_permission'); end if;
  if p_allowed is null then
    delete from staff_permissions where email = lower(p_email) and permission = p_permission;
  else
    insert into staff_permissions (email, permission, allowed) values (lower(p_email), p_permission, p_allowed)
    on conflict (email, permission) do update set allowed = excluded.allowed;
  end if;
  perform log_event(p_actor, 'permission_changed', 'access', null, null, null,
                    jsonb_build_object('email', lower(p_email), 'permission', p_permission, 'allowed', p_allowed));
  return jsonb_build_object('ok', true);
end $$;

-- Called after a successful sign-in check (Microsoft, one-time link password, or test-mode shortcut)
create or replace function staff_signed_in(p_email text, p_method text, p_ip text) returns jsonb
language plpgsql as $$
declare s staff;
begin
  select * into s from staff where email = lower(p_email) for update;
  if not found or s.status not in ('invited', 'active') then
    insert into login_attempts (kind, subject, ok, method, reason, ip)
    values ('staff', lower(coalesce(p_email, '?')), false, p_method, case when found then 'status_' || s.status else 'not_staff' end, p_ip);
    return res_err(case when found then 'account_' || s.status else 'not_staff' end);
  end if;
  update staff set status = 'active', last_login_at = now() where email = s.email;
  insert into login_attempts (kind, subject, ok, method, ip) values ('staff', s.email, true, p_method, p_ip);
  return jsonb_build_object('ok', true, 'email', s.email);
end $$;

-- ---------------------------------------------------------------------------
-- Merchandise
-- ---------------------------------------------------------------------------
create or replace function save_merch_item(
  p_season text, p_id bigint, p_name text, p_description text, p_price numeric, p_image text, p_active boolean, p_sort int, p_actor text
) returns jsonb
language plpgsql as $$
declare it merch_items; nid bigint;
begin
  if length(btrim(coalesce(p_name, ''))) < 2 or coalesce(p_price, -1) < 0 then return res_err('bad_request'); end if;
  if length(coalesce(p_image, '')) > 400000 then return res_err('image_too_large'); end if;
  if p_id is null then
    insert into merch_items (season_id, name, description, price_aed, image, active, sort)
    values (p_season, btrim(p_name), coalesce(p_description, ''), p_price, coalesce(p_image, ''), coalesce(p_active, true), coalesce(p_sort, 0))
    returning id into nid;
    perform log_event(p_actor, 'merch_item_added', 'merchandise', p_season, null, null, jsonb_build_object('item', nid, 'name', p_name, 'price', p_price));
    return jsonb_build_object('ok', true, 'id', nid);
  end if;
  select * into it from merch_items where id = p_id and season_id = p_season for update;
  if not found or it.removed then return res_err('no_such_item'); end if;
  update merch_items set name = btrim(p_name), description = coalesce(p_description, ''), price_aed = p_price,
         image = coalesce(p_image, it.image), active = coalesce(p_active, true), sort = coalesce(p_sort, it.sort)
   where id = it.id;
  perform log_event(p_actor, 'merch_item_updated', 'merchandise', p_season, null, null,
                    jsonb_build_object('item', it.id, 'old_price', it.price_aed, 'new_price', p_price, 'active', p_active));
  return jsonb_build_object('ok', true, 'id', it.id);
end $$;

create or replace function remove_merch_item(p_id bigint, p_actor text) returns jsonb
language plpgsql as $$
declare it merch_items;
begin
  select * into it from merch_items where id = p_id for update;
  if not found then return res_err('no_such_item'); end if;
  update merch_items set removed = true, active = false where id = it.id;
  perform log_event(p_actor, 'merch_item_removed', 'merchandise', it.season_id, null, null, jsonb_build_object('item', it.id, 'name', it.name));
  return jsonb_build_object('ok', true);
end $$;

-- p_lines: [{"item_id": 3, "qty": 2}, ...]. Online orders wait for the gateway; counter orders are paid at once.
create or replace function create_merch_order(
  p_season text, p_misis text, p_buyer_name text, p_buyer_email text, p_lines jsonb, p_channel text, p_method text, p_actor text
) returns jsonb
language plpgsql as $$
declare
  st season_settings; s seasons; m text := norm_misis(p_misis); amt numeric := 0; oid uuid; r text; ln record; it merch_items; res jsonb;
begin
  if m !~ '^[A-Z0-9]{4,20}$' then return res_err('bad_misis'); end if;
  if length(btrim(coalesce(p_buyer_name, ''))) < 2 then return res_err('name_required'); end if;
  if p_channel not in ('online', 'counter') then return res_err('bad_request'); end if;
  if p_channel = 'online' and position('@' in coalesce(p_buyer_email, '')) < 2 then return res_err('email_required'); end if;
  if p_channel = 'counter' and coalesce(btrim(p_method), '') = '' then return res_err('bad_request'); end if;
  select * into s from seasons where id = p_season;
  select * into st from season_settings where season_id = p_season;
  if not found then return res_err('no_such_season'); end if;
  if p_channel = 'online' and (s.status <> 'open' or not st.merch_enabled
       or (st.shop_close_date is not null and (now() at time zone 'Asia/Dubai')::date > st.shop_close_date)) then
    return res_err('shop_closed');
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then return res_err('nothing_to_buy'); end if;
  if exists (select 1 from jsonb_array_elements(p_lines) x
              where coalesce(x->>'item_id', '') !~ '^[0-9]{1,18}$' or coalesce(x->>'qty', '') !~ '^[0-9]{1,2}$') then
    return res_err('bad_request');
  end if;

  r := new_order_ref('MD');
  insert into merch_orders (ref, season_id, misis, buyer_name, buyer_email, channel, status, amount_aed, expires_at, created_by)
  values (r, p_season, m, btrim(p_buyer_name), nullif(lower(btrim(coalesce(p_buyer_email, ''))), ''), p_channel, 'pending_payment', 0,
          now() + interval '30 minutes', p_actor)
  returning id into oid;
  for ln in
    select (x->>'item_id')::bigint as item_id, sum((x->>'qty')::int)::int as qty
      from jsonb_array_elements(p_lines) x group by 1 having sum((x->>'qty')::int) > 0
  loop
    select * into it from merch_items where id = ln.item_id and season_id = p_season and active and not removed;
    if not found then raise exception 'merch_item_unavailable' using errcode = 'P0001'; end if;
    if ln.qty > 50 then raise exception 'merch_qty' using errcode = 'P0001'; end if;
    insert into merch_order_lines (order_id, item_id, item_name, quantity, unit_price) values (oid, it.id, it.name, ln.qty, it.price_aed);
    amt := amt + ln.qty * it.price_aed;
  end loop;
  if amt <= 0 then raise exception 'merch_nothing' using errcode = 'P0001'; end if;
  update merch_orders set amount_aed = amt where id = oid;
  perform log_event(p_actor, 'merch_order_created', 'merchandise', p_season, m, null,
                    jsonb_build_object('order', oid, 'ref', r, 'amount', amt, 'channel', p_channel));
  if p_channel = 'counter' then
    insert into payments (season_id, misis, merch_order_id, channel, method, amount_aed, reference, recorded_by)
    values (p_season, m, oid, 'merch_counter', p_method, amt, r, p_actor);
    res := merch_order_paid(oid, p_method, r, p_actor);
  end if;
  return jsonb_build_object('ok', true, 'order_id', oid, 'ref', r, 'amount', amt);
exception
  when raise_exception then
    return res_err(case sqlerrm when 'merch_item_unavailable' then 'item_unavailable' when 'merch_qty' then 'bad_request' else 'nothing_to_buy' end);
end $$;

-- Mark as Collected is allowed only after a successful payment
create or replace function mark_collected(p_order uuid, p_actor text) returns jsonb
language plpgsql as $$
declare m merch_orders;
begin
  select * into m from merch_orders where id = p_order for update;
  if not found then return res_err('no_such_order'); end if;
  if m.status <> 'paid' then return res_err('not_paid'); end if;
  if m.collected then return jsonb_build_object('ok', true, 'already', true); end if;
  update merch_orders set collected = true, collected_by = p_actor, collected_at = now() where id = m.id;
  perform log_event(p_actor, 'merch_collected', 'merchandise', m.season_id, m.misis, null, jsonb_build_object('order', m.id, 'ref', m.ref));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Data Clean-Up: remove names, emails and mobile numbers from a closed season. MISIS and payments stay.
-- ---------------------------------------------------------------------------
create or replace function clean_up_season(p_season text, p_actor text) returns jsonb
language plpgsql as $$
declare s seasons; n int;
begin
  select * into s from seasons where id = p_season for update;
  if not found then return res_err('no_such_season'); end if;
  if s.status <> 'closed' then return res_err('season_open'); end if;
  if s.cleaned_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  perform set_config('app.allow_cleanup', 'on', true);

  delete from email_outbox where to_address in (
    select email from graduates where season_id = p_season
    union select private_email from graduates where season_id = p_season and private_email is not null);
  update graduates set full_name = 'Removed', email = lower(misis) || '@removed.invalid', private_email = null, mobile = null,
         grad_seat_label = null
   where season_id = p_season;
  get diagnostics n = row_count;
  update tickets set holder_name = 'Removed' where season_id = p_season;
  update order_guests set guest_name = 'Removed' where order_id in (select id from orders where season_id = p_season);
  update orders set payer_name = null, payer_email = null where season_id = p_season;
  update receipts set payer_name = null, payer_email = null where season_id = p_season;
  update merch_orders set buyer_name = 'Removed', buyer_email = null where season_id = p_season;
  update name_change_requests set old_name = 'Removed', new_name = 'Removed' where season_id = p_season;
  update ticket_sends set address = 'removed' where ticket_id in (select id from tickets where season_id = p_season);
  update scans set holder_name = null where season_id = p_season;
  delete from otp_codes where season_id = p_season;
  update seasons set cleaned_at = now() where id = p_season;
  perform log_event(p_actor, 'season_cleaned', 'technical', p_season, null, null, jsonb_build_object('graduates', n));
  return jsonb_build_object('ok', true, 'graduates', n);
end $$;

-- ---------------------------------------------------------------------------
-- Scheduled jobs (run, pause and restart from Technical Settings)
-- ---------------------------------------------------------------------------
create or replace function job_start(p_job text) returns bigint
language plpgsql as $$
declare j scheduled_jobs; rid bigint;
begin
  select * into j from scheduled_jobs where name = p_job;
  if not found then return null; end if;
  if j.paused then
    update scheduled_jobs set last_status = 'skipped', last_message = 'Paused' where name = p_job;
    return null;
  end if;
  insert into scheduled_job_runs (job) values (p_job) returning id into rid;
  return rid;
end $$;

create or replace function job_finish(p_run bigint, p_status text, p_message text) returns void
language plpgsql as $$
declare j text;
begin
  update scheduled_job_runs set finished_at = now(), status = p_status, message = left(p_message, 1000) where id = p_run returning job into j;
  update scheduled_jobs set last_run_at = now(), last_status = p_status, last_message = left(p_message, 1000) where name = j;
  delete from scheduled_job_runs where started_at < now() - interval '14 days';
end $$;

-- The every-minute job, callable from pg_cron or from the app's scheduler endpoint
create or replace function run_release_holds_job() returns int
language plpgsql as $$
declare rid bigint; n int;
begin
  rid := job_start('release_holds');
  if rid is null then return 0; end if;
  n := release_expired_holds();
  perform job_finish(rid, 'ok', n || ' expired');
  return n;
end $$;
