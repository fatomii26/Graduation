-- Booking rules: eligibility, guest limits, zone capacity, orders, payments, ticket issue

-- null = eligible; otherwise a reason code.
-- p_ignore_sales: counter and Graduation Day payments, and receipt redemption, work while online sales are closed.
create or replace function eligibility(p_season text, p_misis text, p_ignore_sales boolean default false) returns text
language plpgsql stable as $$
declare s seasons; st season_settings; g graduates;
begin
  select * into s from seasons where id = p_season;
  if not found then return 'no_such_season'; end if;
  select * into g from graduates where season_id = p_season and misis = p_misis;
  if not found then return 'not_on_master_list'; end if;
  if not g.confirmed_graduate then return 'not_confirmed'; end if;
  if g.financial_hold then return 'financial_hold'; end if;
  if g.ceremony_id is null then return 'no_ceremony'; end if;
  if not p_ignore_sales then
    if s.status <> 'open' then return 'season_closed'; end if;
    select * into st from season_settings where season_id = p_season;
    if not st.sales_open then return 'sales_closed'; end if;
  end if;
  return null;
end $$;

-- Guest tickets a graduate may hold: the season limit (or a personal limit), raised only by approved extra ticket codes.
create or replace function guest_allowance(p_season text, p_misis text) returns int
language sql stable as $$
  select (coalesce(g.max_guests, st.guest_limit)
       + coalesce((select sum(c.extra_guests) from extra_ticket_codes c
                    where c.season_id = p_season and c.misis = p_misis
                      and (c.used_at is not null or c.expires_at > now())), 0))::int
    from graduates g join season_settings st on st.season_id = g.season_id
   where g.season_id = p_season and g.misis = p_misis
$$;

-- Guest places already taken or on the way: valid guest tickets + unpaid live orders + unused receipts.
create or replace function guests_committed(p_season text, p_misis text, p_exclude uuid default null) returns int
language sql stable as $$
  select (
      (select count(*) from tickets t
        where t.season_id = p_season and t.misis = p_misis and t.kind = 'guest' and t.status = 'valid')
    + coalesce((select sum(o.guest_count) from orders o
                 where o.season_id = p_season and o.misis = p_misis and o.status = 'pending_payment'
                   and o.expires_at > now() and o.id is distinct from p_exclude), 0)
    + coalesce((select sum(r.guest_count) from receipts r
                 where r.season_id = p_season and r.misis = p_misis and r.status = 'unused'), 0)
  )::int
$$;

-- Is the graduate's own ticket already issued, paid for, or on the way?
create or replace function graduate_ticket_arranged(p_season text, p_misis text) returns boolean
language sql stable as $$
  select exists (select 1 from tickets t where t.season_id = p_season and t.misis = p_misis and t.kind = 'graduate' and t.status = 'valid')
      or exists (select 1 from orders o where o.season_id = p_season and o.misis = p_misis and o.includes_graduate
                   and ((o.status = 'paid' and o.kind <> 'third_party') or (o.status = 'pending_payment' and o.expires_at > now())))
      or exists (select 1 from receipts r where r.season_id = p_season and r.misis = p_misis and r.includes_graduate and r.status = 'unused')
$$;

-- ---------------------------------------------------------------------------
-- Zones
-- ---------------------------------------------------------------------------
-- Places used in one zone for one ceremony: valid guest tickets + guests of unpaid orders whose hold has not expired.
create or replace function zone_usage(p_ceremony bigint, p_zone bigint, p_exclude uuid default null)
returns table (guests int, wheelchairs int)
language sql stable as $$
  select
    ((select count(*) from tickets t
       where t.ceremony_id = p_ceremony and t.zone_id = p_zone and t.kind = 'guest' and t.status = 'valid')
   + (select count(*) from order_guests og join orders o on o.id = og.order_id
       where o.ceremony_id = p_ceremony and og.zone_id = p_zone and o.status = 'pending_payment'
         and o.expires_at > now() and o.id is distinct from p_exclude))::int,
    ((select count(*) from tickets t
       where t.ceremony_id = p_ceremony and t.zone_id = p_zone and t.kind = 'guest' and t.status = 'valid' and t.access = 'wheelchair')
   + (select count(*) from order_guests og join orders o on o.id = og.order_id
       where o.ceremony_id = p_ceremony and og.zone_id = p_zone and og.access = 'wheelchair' and o.status = 'pending_payment'
         and o.expires_at > now() and o.id is distinct from p_exclude))::int
$$;

-- Places left in each zone (students see these counts)
create or replace function zone_availability(p_ceremony bigint) returns jsonb
language sql stable as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', z.id, 'code', z.code, 'name', z.name, 'door', z.door, 'color', z.color,
           'capacity', z.capacity, 'taken', u.guests, 'left', greatest(z.capacity - u.guests, 0),
           'wheelchair_capacity', z.wheelchair_capacity, 'wheelchair_left', greatest(z.wheelchair_capacity - u.wheelchairs, 0)
         ) order by z.sort, z.code), '[]'::jsonb)
    from ceremonies c
    join zones z on z.season_id = c.season_id and z.active
    cross join lateral zone_usage(c.id, z.id) u
   where c.id = p_ceremony
$$;

-- Validates a group of guests and locks the zones involved.
-- p_guests: [{"name": "...", "zone_id": 12, "access": "none|wheelchair|companion", "assist": false}, ...]
-- Rules: names 2–120 characters; every guest in an active zone of the season; zone capacity and wheelchair
-- spaces; a companion only next to a wheelchair space in the same zone; the group stays in one zone unless
-- that zone cannot take them all (then it may be split, after the student has been warned).
-- When zone selection is switched off, the whole group is placed in the zone with the most room.
create or replace function check_group(p_season text, p_ceremony bigint, p_guests jsonb, p_exclude uuid default null) returns jsonb
language plpgsql as $$
declare
  st season_settings; cnt int; wc int; zid bigint; z zones; u record; r record; first_zone bigint; nz int;
begin
  select * into st from season_settings where season_id = p_season;
  if p_guests is null or jsonb_typeof(p_guests) <> 'array' then p_guests := '[]'::jsonb; end if;
  cnt := jsonb_array_length(p_guests);
  if cnt = 0 then return jsonb_build_object('ok', true, 'guests', '[]'::jsonb); end if;
  if cnt > 20 then return res_err('limit_reached'); end if;

  if exists (select 1 from jsonb_array_elements(p_guests) x
              where jsonb_typeof(x) <> 'object' or length(btrim(coalesce(x->>'name', ''))) not between 2 and 120) then
    return res_err('name_required');
  end if;
  if exists (select 1 from jsonb_array_elements(p_guests) x where coalesce(x->>'access', 'none') not in ('none', 'wheelchair', 'companion')) then
    return res_err('bad_request');
  end if;
  select count(*) into wc from jsonb_array_elements(p_guests) x where x->>'access' = 'wheelchair';

  if not st.zone_selection_enabled then
    select z2.id into zid
      from zones z2 cross join lateral zone_usage(p_ceremony, z2.id, p_exclude) u2
     where z2.season_id = p_season and z2.active
       and z2.capacity - u2.guests >= cnt and z2.wheelchair_capacity - u2.wheelchairs >= wc
     order by z2.capacity - u2.guests desc, z2.sort
     limit 1;
    if zid is null then return res_err('no_space'); end if;
    select jsonb_agg(x || jsonb_build_object('zone_id', zid) order by n) into p_guests
      from jsonb_array_elements(p_guests) with ordinality e(x, n);
  end if;

  if exists (select 1 from jsonb_array_elements(p_guests) x
               left join zones z3 on z3.id = case when x->>'zone_id' ~ '^[0-9]{1,18}$' then (x->>'zone_id')::bigint end
                                  and z3.season_id = p_season and z3.active
              where z3.id is null) then
    return res_err('no_such_zone');
  end if;

  -- lock the zone rows in a fixed order: bookings for the same zone queue up, so capacity can never be overshot
  perform 1 from zones
   where id in (select (x->>'zone_id')::bigint from jsonb_array_elements(p_guests) x)
   order by id for update;

  for r in
    select (x->>'zone_id')::bigint as zone_id, count(*)::int as n,
           (count(*) filter (where x->>'access' = 'wheelchair'))::int as w,
           (count(*) filter (where x->>'access' = 'companion'))::int as c
      from jsonb_array_elements(p_guests) x group by 1 order by 1
  loop
    select * into z from zones where id = r.zone_id;
    select * into u from zone_usage(p_ceremony, r.zone_id, p_exclude);
    if r.c > r.w then
      return res_err('companion_needs_wheelchair', jsonb_build_object('zone', z.code));
    end if;
    if u.guests + r.n > z.capacity then
      return res_err('zone_full', jsonb_build_object('zone', z.code, 'zone_name', z.name, 'left', greatest(z.capacity - u.guests, 0)));
    end if;
    if r.w > 0 and u.wheelchairs + r.w > z.wheelchair_capacity then
      return res_err('no_wheelchair_space', jsonb_build_object('zone', z.code, 'zone_name', z.name, 'left', greatest(z.wheelchair_capacity - u.wheelchairs, 0)));
    end if;
  end loop;

  select count(distinct x->>'zone_id') into nz from jsonb_array_elements(p_guests) x;
  if nz > 1 then
    first_zone := (p_guests->0->>'zone_id')::bigint;
    select * into z from zones where id = first_zone;
    select * into u from zone_usage(p_ceremony, first_zone, p_exclude);
    if z.capacity - u.guests >= cnt and z.wheelchair_capacity - u.wheelchairs >= wc then
      return res_err('keep_together', jsonb_build_object('zone', z.code, 'zone_name', z.name));
    end if;
  end if;

  return jsonb_build_object('ok', true, 'guests', p_guests);
end $$;

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create or replace function new_order_ref(p_prefix text) returns text
language plpgsql volatile as $$
declare r text;
begin
  loop
    r := new_code(p_prefix, 6);
    exit when not exists (select 1 from orders where ref = r) and not exists (select 1 from merch_orders where ref = r);
  end loop;
  return r;
end $$;

create or replace function new_receipt_number() returns text
language plpgsql volatile as $$
declare r text;
begin
  loop
    r := new_code('RC', 8);
    exit when not exists (select 1 from receipts where receipt_number = r);
  end loop;
  return r;
end $$;

-- Online booking by the student. p_kind 'main' (graduate ticket + guests) or 'extra' (with an extra ticket code).
-- Creates an unpaid order that holds the places for season_settings.hold_minutes.
create or replace function book_order(p_season text, p_misis text, p_kind text, p_guests jsonb, p_extra_code text, p_actor text)
returns jsonb
language plpgsql as $$
declare
  g graduates; st season_settings; why text; cnt int; amt numeric; oid uuid; r text; chk jsonb; inc boolean;
  c extra_ticket_codes; item jsonb; pos int := 0; exp timestamptz; lim int; used int;
begin
  if p_kind not in ('main', 'extra') then return res_err('bad_request'); end if;
  why := eligibility(p_season, p_misis);
  if why is not null then return res_err(why); end if;

  select * into g from graduates where season_id = p_season and misis = p_misis for update;
  select * into st from season_settings where season_id = p_season;
  update orders set status = 'expired'
   where season_id = p_season and misis = p_misis and status = 'pending_payment' and expires_at <= now();

  if p_guests is null or jsonb_typeof(p_guests) <> 'array' then p_guests := '[]'::jsonb; end if;
  cnt := jsonb_array_length(p_guests);

  if p_kind = 'main' then
    if exists (select 1 from orders where season_id = p_season and misis = p_misis and kind = 'main' and status in ('pending_payment', 'paid')) then
      return res_err('order_exists');
    end if;
    inc := not graduate_ticket_arranged(p_season, p_misis);
    if not inc and cnt = 0 then return res_err('nothing_to_buy'); end if;
  else
    inc := false;
    if not exists (select 1 from tickets where season_id = p_season and misis = p_misis and kind = 'graduate' and status = 'valid') then
      return res_err('main_order_required');
    end if;
    if exists (select 1 from orders where season_id = p_season and misis = p_misis and kind = 'extra' and status = 'pending_payment') then
      return res_err('order_exists');
    end if;
    select * into c from extra_ticket_codes
     where code = upper(btrim(coalesce(p_extra_code, ''))) and season_id = p_season and misis = p_misis for update;
    if not found then return res_err('code_invalid'); end if;
    if c.used_at is not null then return res_err('code_used'); end if;
    if c.expires_at <= now() then return res_err('code_expired'); end if;
    if cnt < 1 then return res_err('nothing_to_buy'); end if;
    if cnt > c.extra_guests then return res_err('limit_reached', jsonb_build_object('limit', c.extra_guests)); end if;
  end if;

  lim := guest_allowance(p_season, p_misis);
  used := guests_committed(p_season, p_misis);
  if used + cnt > lim then
    return res_err('limit_reached', jsonb_build_object('limit', lim, 'committed', used));
  end if;

  chk := check_group(p_season, g.ceremony_id, p_guests, null);
  if not (chk->>'ok')::boolean then return chk; end if;
  p_guests := chk->'guests';

  amt := case when inc then st.graduate_price_aed else 0 end + cnt * st.guest_price_aed;
  r := new_order_ref('GR');
  exp := now() + make_interval(mins => st.hold_minutes);
  insert into orders (ref, season_id, misis, kind, status, channel, ceremony_id, zone_id, includes_graduate,
                      guest_count, amount_aed, extra_code, expires_at, created_by)
  values (r, p_season, p_misis, p_kind, 'pending_payment', case when amt = 0 then 'free' else 'online' end, g.ceremony_id,
          case when cnt > 0 then (p_guests->0->>'zone_id')::bigint end, inc, cnt, amt,
          case when p_kind = 'extra' then c.code end, exp, p_actor)
  returning id into oid;

  for item in select value from jsonb_array_elements(p_guests) loop
    pos := pos + 1;
    insert into order_guests (order_id, position, guest_name, zone_id, access, needs_assistance)
    values (oid, pos, regexp_replace(btrim(item->>'name'), '\s+', ' ', 'g'), (item->>'zone_id')::bigint,
            coalesce(item->>'access', 'none'), coalesce(item->>'assist', 'false') in ('true', '1', 'yes'));
  end loop;

  perform log_event(p_actor, 'order_created', 'tickets', p_season, p_misis, oid,
                    jsonb_build_object('ref', r, 'kind', p_kind, 'amount', amt, 'guests', cnt, 'graduate_ticket', inc));
  if amt = 0 then
    perform mark_order_paid(oid, 'free', null, p_actor);
  end if;
  return jsonb_build_object('ok', true, 'order_id', oid, 'ref', r, 'amount', amt, 'expires_at', exp, 'paid', amt = 0);
end $$;

-- The student (p_misis) or staff (p_misis null) cancels an unpaid order.
create or replace function cancel_order(p_order uuid, p_misis text, p_actor text) returns jsonb
language plpgsql as $$
declare o orders;
begin
  select * into o from orders where id = p_order for update;
  if not found or (p_misis is not null and o.misis <> p_misis) then return res_err('no_such_order'); end if;
  if o.status not in ('pending_payment', 'expired') then return res_err('cannot_cancel'); end if;
  update orders set status = 'cancelled' where id = o.id;
  perform log_event(p_actor, 'order_cancelled', 'tickets', o.season_id, o.misis, o.id, jsonb_build_object('ref', o.ref));
  return jsonb_build_object('ok', true);
end $$;

-- Scheduled every minute. Correctness never depends on it (holds count only while expires_at > now()).
create or replace function release_expired_holds() returns int
language plpgsql as $$
declare n int; m int;
begin
  update orders set status = 'expired' where status = 'pending_payment' and expires_at <= now();
  get diagnostics n = row_count;
  update merch_orders set status = 'expired' where status = 'pending_payment' and expires_at <= now();
  get diagnostics m = row_count;
  return n + m;
end $$;

-- Issues tickets for a confirmed payment. Idempotent: a second call never creates a second set of tickets.
-- A payment that arrives after the hold expired is accepted when the zone still has room; otherwise the
-- order goes to Needs Attention (graduate ticket issued, guest tickets wait for Finance).
create or replace function mark_order_paid(p_order uuid, p_method text, p_ref text, p_actor text) returns jsonb
language plpgsql as $$
declare o orders; g graduates; c ceremonies; v_over text; r record; z zones; u record; rc text;
begin
  select * into o from orders where id = p_order for update;
  if not found then return res_err('no_such_order'); end if;

  if o.status = 'paid' then
    if p_ref is not null and o.payment_ref is not null and p_ref <> o.payment_ref and p_method not in ('receipt', 'free') then
      update orders set needs_attention = format('A second payment (ref %s) was received for an order already paid (ref %s). Refund it in the payment gateway.', p_ref, o.payment_ref)
       where id = o.id;
      perform log_event(p_actor, 'second_payment', 'payments', o.season_id, o.misis, o.id, jsonb_build_object('ref', p_ref));
      return jsonb_build_object('ok', true, 'already_paid', true, 'attention', true);
    end if;
    return jsonb_build_object('ok', true, 'already_paid', true);
  end if;

  if o.status = 'cancelled' then
    update orders set needs_attention = format('Payment received (ref %s) for a cancelled order. Refund it, or convert it to a receipt.', coalesce(p_ref, '?'))
     where id = o.id;
    perform log_event(p_actor, 'payment_on_cancelled_order', 'payments', o.season_id, o.misis, o.id, jsonb_build_object('ref', p_ref));
    return res_err('order_cancelled');
  end if;

  if o.kind = 'main' and o.status = 'expired'
     and exists (select 1 from orders x where x.season_id = o.season_id and x.misis = o.misis and x.kind = 'main'
                   and x.status in ('pending_payment', 'paid') and x.id <> o.id) then
    update orders set needs_attention = format('Paid (ref %s) after the hold expired, and the graduate has since made another booking. Refund it, or convert it to a receipt.', coalesce(p_ref, '?')),
           payment_method = p_method, payment_ref = coalesce(p_ref, payment_ref)
     where id = o.id;
    perform log_event(p_actor, 'payment_on_superseded_order', 'payments', o.season_id, o.misis, o.id, jsonb_build_object('ref', p_ref));
    return res_err('order_superseded');
  end if;

  select * into g from graduates where season_id = o.season_id and misis = o.misis;

  if o.kind = 'third_party' then
    rc := new_receipt_number();
    insert into receipts (receipt_number, season_id, misis, source, includes_graduate, guest_count, amount_aed, method,
                          payer_name, payer_email, payer_relation, source_order_id, entered_by)
    values (rc, o.season_id, o.misis, 'third_party', o.includes_graduate, o.guest_count, o.amount_aed, coalesce(p_method, 'online'),
            o.payer_name, o.payer_email, o.payer_relation, o.id, p_actor);
    update orders set status = 'paid', paid_at = now(), payment_method = p_method, payment_ref = coalesce(p_ref, payment_ref),
           receipt_number = rc
     where id = o.id;
    perform log_event(p_actor, 'third_party_paid', 'payments', o.season_id, o.misis, o.id,
                      jsonb_build_object('ref', p_ref, 'receipt', rc, 'payer', o.payer_name, 'amount', o.amount_aed));
    return jsonb_build_object('ok', true, 'third_party', true, 'receipt_number', rc);
  end if;

  select * into c from ceremonies where id = o.ceremony_id;

  if o.status = 'expired' and o.guest_count > 0 then
    for r in
      select og.zone_id, count(*)::int as n, (count(*) filter (where og.access = 'wheelchair'))::int as w
        from order_guests og where og.order_id = o.id group by og.zone_id order by og.zone_id
    loop
      select * into z from zones where id = r.zone_id for update;
      select * into u from zone_usage(o.ceremony_id, r.zone_id, o.id);
      if u.guests + r.n > z.capacity or u.wheelchairs + r.w > z.wheelchair_capacity then
        v_over := coalesce(v_over || ', ', '') || z.name;
      end if;
    end loop;
  end if;

  update orders set status = 'paid', paid_at = now(), payment_method = p_method, payment_ref = coalesce(p_ref, payment_ref),
         needs_attention = case when v_over is not null
           then format('Paid after the hold expired and %s is now full. Convert it to a receipt so the student can choose another zone, or refund.', v_over)
           else needs_attention end
   where id = o.id;

  if o.includes_graduate
     and not exists (select 1 from tickets where season_id = o.season_id and misis = o.misis and kind = 'graduate' and status = 'valid') then
    insert into tickets (season_id, order_id, misis, kind, holder_name, ceremony_id, zone_id, door, token)
    values (o.season_id, o.id, o.misis, 'graduate', g.full_name, o.ceremony_id, null, c.graduate_entrance, new_token());
  end if;

  if v_over is null then
    insert into tickets (season_id, order_id, misis, kind, holder_name, ceremony_id, zone_id, door, access, needs_assistance, token)
    select o.season_id, o.id, o.misis, 'guest', og.guest_name, o.ceremony_id, og.zone_id, zz.door, og.access, og.needs_assistance, new_token()
      from order_guests og join zones zz on zz.id = og.zone_id
     where og.order_id = o.id
     order by og.position;
  end if;

  if o.extra_code is not null then
    update extra_ticket_codes set used_at = coalesce(used_at, now()), used_order_id = o.id where code = o.extra_code;
  end if;

  perform log_event(p_actor, 'order_paid', 'payments', o.season_id, o.misis, o.id,
                    jsonb_build_object('ref', o.ref, 'method', p_method, 'payment_ref', p_ref, 'amount', o.amount_aed, 'over_capacity', v_over));
  return jsonb_build_object('ok', true, 'attention', v_over is not null);
end $$;

-- Merchandise: idempotent payment confirmation
create or replace function merch_order_paid(p_order uuid, p_method text, p_ref text, p_actor text) returns jsonb
language plpgsql as $$
declare m merch_orders;
begin
  select * into m from merch_orders where id = p_order for update;
  if not found then return res_err('no_such_order'); end if;
  if m.status = 'paid' then return jsonb_build_object('ok', true, 'already_paid', true); end if;
  update merch_orders set status = 'paid', paid_at = now(), payment_method = p_method, payment_ref = coalesce(p_ref, payment_ref),
         needs_attention = case when m.status <> 'pending_payment'
           then format('Payment received while the order was %s.', m.status) else needs_attention end
   where id = m.id;
  perform log_event(p_actor, 'merch_order_paid', 'merchandise', m.season_id, m.misis, null,
                    jsonb_build_object('order', m.id, 'ref', m.ref, 'method', p_method, 'payment_ref', p_ref, 'amount', m.amount_aed));
  return jsonb_build_object('ok', true);
end $$;

-- Gateway notification. Safe to receive twice (event key), the amount is checked against the order,
-- and a mismatch goes to Needs Attention without issuing tickets. Every payment is written to the ledger.
create or replace function record_payment(
  p_event_key text, p_gateway text, p_target text, p_target_id text, p_status text,
  p_amount numeric, p_gateway_ref text, p_payload jsonb, p_actor text
) returns jsonb
language plpgsql as $$
declare o orders; m merch_orders; n int; res jsonb;
begin
  if p_target not in ('ticket', 'merch') or coalesce(p_target_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return res_err('no_such_order');
  end if;

  insert into payment_events (event_key, gateway, target, target_id, gateway_ref, status, amount, payload)
  values (p_event_key, p_gateway, p_target, p_target_id, p_gateway_ref, p_status, p_amount, coalesce(p_payload, '{}'::jsonb))
  on conflict (event_key) do nothing;
  get diagnostics n = row_count;
  if n = 0 then return jsonb_build_object('ok', true, 'duplicate', true); end if;

  if p_target = 'ticket' then
    select * into o from orders where id = p_target_id::uuid for update;
    if not found then return res_err('no_such_order'); end if;
    if p_status <> 'paid' then
      perform log_event(p_actor, 'payment_failed', 'payments', o.season_id, o.misis, o.id, jsonb_build_object('ref', p_gateway_ref, 'status', p_status));
      return jsonb_build_object('ok', true, 'paid', false, 'order_id', o.id);
    end if;
    if not exists (select 1 from payments where order_id = o.id and reference = p_gateway_ref) then
      insert into payments (season_id, misis, order_id, channel, method, amount_aed, reference, recorded_by)
      values (o.season_id, o.misis, o.id, case when o.kind = 'third_party' then 'third_party' else 'online' end,
              p_gateway, coalesce(p_amount, 0), p_gateway_ref, p_actor);
    end if;
    if p_amount is null or round(p_amount * 100) <> round(o.amount_aed * 100) then
      update orders set needs_attention = format('Amount mismatch: the gateway reported AED %s but the order is AED %s (ref %s). Tickets were not issued.',
                                                 coalesce(p_amount::text, '?'), o.amount_aed, coalesce(p_gateway_ref, '?'))
       where id = o.id;
      perform log_event(p_actor, 'payment_amount_mismatch', 'payments', o.season_id, o.misis, o.id,
                        jsonb_build_object('ref', p_gateway_ref, 'amount', p_amount, 'expected', o.amount_aed));
      return res_err('amount_mismatch', jsonb_build_object('order_id', o.id));
    end if;
    res := mark_order_paid(o.id, 'online', p_gateway_ref, p_actor);
    return res || jsonb_build_object('order_id', o.id);
  end if;

  select * into m from merch_orders where id = p_target_id::uuid for update;
  if not found then return res_err('no_such_order'); end if;
  if p_status <> 'paid' then
    perform log_event(p_actor, 'merch_payment_failed', 'merchandise', m.season_id, m.misis, null, jsonb_build_object('order', m.id, 'status', p_status));
    return jsonb_build_object('ok', true, 'paid', false, 'order_id', m.id);
  end if;
  if not exists (select 1 from payments where merch_order_id = m.id and reference = p_gateway_ref) then
    insert into payments (season_id, misis, merch_order_id, channel, method, amount_aed, reference, recorded_by)
    values (m.season_id, m.misis, m.id, 'merch_online', p_gateway, coalesce(p_amount, 0), p_gateway_ref, p_actor);
  end if;
  if p_amount is null or round(p_amount * 100) <> round(m.amount_aed * 100) then
    update merch_orders set needs_attention = format('Amount mismatch: the gateway reported AED %s but the order is AED %s.', coalesce(p_amount::text, '?'), m.amount_aed)
     where id = m.id;
    return res_err('amount_mismatch', jsonb_build_object('order_id', m.id));
  end if;
  res := merch_order_paid(m.id, 'online', p_gateway_ref, p_actor);
  return res || jsonb_build_object('order_id', m.id);
end $$;
