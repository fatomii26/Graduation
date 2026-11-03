-- Finance (counter receipts, third party, Needs Attention, holds) and DAR (confirmation, allocation, Master List)

create or replace function parse_yes_no(p text) returns boolean
language sql immutable as $$
  select case
    when lower(btrim(coalesce(p, ''))) in ('yes', 'y', 'true', '1', 'x') then true
    when lower(btrim(coalesce(p, ''))) in ('no', 'n', 'false', '0') then false
  end
$$;

create or replace function norm_misis(p text) returns text
language sql immutable as $$
  select upper(regexp_replace(coalesce(p, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

create or replace function student_email_ok(p_email text) returns boolean
language sql stable as $$
  select position('@' in coalesce(p_email, '')) > 1
     and split_part(lower(p_email), '@', 2) = any (string_to_array(replace(lower(a.student_email_domains), ' ', ''), ','))
    from app_settings a
$$;

-- ---------------------------------------------------------------------------
-- Counter payments (Finance Office) and Graduation Day payments -> receipt number
-- ---------------------------------------------------------------------------
create or replace function record_counter_payment(
  p_season text, p_misis text, p_includes_graduate boolean, p_guests int, p_amount numeric,
  p_method text, p_source text, p_payer_name text, p_actor text
) returns jsonb
language plpgsql as $$
declare g graduates; st season_settings; why text; expected numeric; rc text; lim int; used int; m text := norm_misis(p_misis);
begin
  if p_source not in ('counter', 'graduation_day') or coalesce(p_guests, -1) < 0 or coalesce(btrim(p_method), '') = '' then
    return res_err('bad_request');
  end if;
  why := eligibility(p_season, m, true);
  if why is not null then return res_err(why); end if;
  select * into g from graduates where season_id = p_season and misis = m for update;
  select * into st from season_settings where season_id = p_season;

  if p_includes_graduate and graduate_ticket_arranged(p_season, m) then return res_err('graduate_ticket_exists'); end if;
  if not p_includes_graduate and not graduate_ticket_arranged(p_season, m) then return res_err('graduate_ticket_required'); end if;
  if not p_includes_graduate and p_guests = 0 then return res_err('nothing_to_buy'); end if;

  lim := guest_allowance(p_season, m);
  used := guests_committed(p_season, m);
  if used + p_guests > lim then
    return res_err('limit_reached', jsonb_build_object('limit', lim, 'committed', used));
  end if;

  expected := case when p_includes_graduate then st.graduate_price_aed else 0 end + p_guests * st.guest_price_aed;
  if p_amount is not null and round(p_amount * 100) <> round(expected * 100) then
    return res_err('amount_mismatch', jsonb_build_object('expected', expected));
  end if;

  rc := new_receipt_number();
  insert into receipts (receipt_number, season_id, misis, source, includes_graduate, guest_count, amount_aed, method, payer_name, entered_by)
  values (rc, p_season, m, p_source, p_includes_graduate, p_guests, expected, p_method, nullif(btrim(coalesce(p_payer_name, '')), ''), p_actor);
  insert into payments (season_id, misis, receipt_number, channel, method, amount_aed, reference, recorded_by)
  values (p_season, m, rc, p_source, p_method, expected, rc, p_actor);
  perform log_event(p_actor, 'counter_payment', 'finance', p_season, m, null,
                    jsonb_build_object('receipt', rc, 'source', p_source, 'graduate_ticket', p_includes_graduate,
                                       'guests', p_guests, 'amount', expected, 'method', p_method));
  return jsonb_build_object('ok', true, 'receipt_number', rc, 'amount', expected, 'email', g.email, 'name', g.full_name);
end $$;

-- The student redeems a receipt once: chooses the zone and guest names, and the tickets are issued at once.
create or replace function redeem_receipt(p_season text, p_misis text, p_receipt text, p_guests jsonb, p_actor text) returns jsonb
language plpgsql as $$
declare
  rc receipts; g graduates; why text; chk jsonb; oid uuid; r text; item jsonb; pos int := 0; cnt int; k text; res jsonb;
begin
  select * into rc from receipts where receipt_number = upper(btrim(coalesce(p_receipt, ''))) for update;
  if not found or rc.season_id <> p_season or rc.misis <> p_misis or rc.status = 'void' then return res_err('receipt_invalid'); end if;
  if rc.status = 'used' then return res_err('receipt_used'); end if;
  why := eligibility(p_season, p_misis, true);
  if why is not null then return res_err(why); end if;

  select * into g from graduates where season_id = p_season and misis = p_misis for update;
  update orders set status = 'expired'
   where season_id = p_season and misis = p_misis and status = 'pending_payment' and expires_at <= now();

  if p_guests is null or jsonb_typeof(p_guests) <> 'array' then p_guests := '[]'::jsonb; end if;
  cnt := jsonb_array_length(p_guests);
  if cnt <> rc.guest_count then return res_err('guest_count_mismatch', jsonb_build_object('expected', rc.guest_count)); end if;

  k := case when rc.includes_graduate then 'main' else 'extra' end;
  if k = 'main' and exists (select 1 from orders where season_id = p_season and misis = p_misis and kind = 'main' and status in ('pending_payment', 'paid')) then
    return res_err('order_pending');
  end if;
  if k = 'extra' then
    if not exists (select 1 from tickets where season_id = p_season and misis = p_misis and kind = 'graduate' and status = 'valid') then
      return res_err('main_order_required');
    end if;
    if exists (select 1 from orders where season_id = p_season and misis = p_misis and kind = 'extra' and status = 'pending_payment') then
      return res_err('order_pending');
    end if;
  end if;

  chk := check_group(p_season, g.ceremony_id, p_guests, null);
  if not (chk->>'ok')::boolean then return chk; end if;
  p_guests := chk->'guests';

  r := new_order_ref('GR');
  insert into orders (ref, season_id, misis, kind, status, channel, ceremony_id, zone_id, includes_graduate, guest_count,
                      amount_aed, receipt_number, payer_name, payer_email, payer_relation, expires_at, created_by)
  values (r, p_season, p_misis, k, 'pending_payment', case when rc.source = 'third_party' then 'third_party' else 'counter' end,
          g.ceremony_id, case when cnt > 0 then (p_guests->0->>'zone_id')::bigint end, rc.includes_graduate, cnt,
          rc.amount_aed, rc.receipt_number, rc.payer_name, rc.payer_email, rc.payer_relation, now() + interval '5 minutes', p_actor)
  returning id into oid;
  for item in select value from jsonb_array_elements(p_guests) loop
    pos := pos + 1;
    insert into order_guests (order_id, position, guest_name, zone_id, access, needs_assistance)
    values (oid, pos, regexp_replace(btrim(item->>'name'), '\s+', ' ', 'g'), (item->>'zone_id')::bigint,
            coalesce(item->>'access', 'none'), coalesce(item->>'assist', 'false') in ('true', '1', 'yes'));
  end loop;
  update receipts set status = 'used', used_at = now(), used_order_id = oid where receipt_number = rc.receipt_number;
  perform log_event(p_actor, 'receipt_redeemed', 'finance', p_season, p_misis, oid,
                    jsonb_build_object('receipt', rc.receipt_number, 'guests', cnt, 'graduate_ticket', rc.includes_graduate));
  res := mark_order_paid(oid, 'receipt', rc.receipt_number, p_actor);
  return res || jsonb_build_object('order_id', oid, 'ref', r);
end $$;

-- A parent, guardian or sponsor pays online for a student. On payment the system creates a receipt;
-- the student is told, then chooses the zone and names.
create or replace function start_third_party_order(
  p_season text, p_misis text, p_includes_graduate boolean, p_guests int,
  p_payer_name text, p_payer_email text, p_payer_relation text, p_actor text
) returns jsonb
language plpgsql as $$
declare g graduates; st season_settings; why text; amt numeric; lim int; used int; oid uuid; r text; m text := norm_misis(p_misis);
begin
  if coalesce(p_guests, -1) < 0 or length(btrim(coalesce(p_payer_name, ''))) < 2
     or position('@' in coalesce(p_payer_email, '')) < 2 then
    return res_err('bad_request');
  end if;
  why := eligibility(p_season, m);
  if why is not null then return res_err(why); end if;
  select * into g from graduates where season_id = p_season and misis = m for update;
  select * into st from season_settings where season_id = p_season;
  update orders set status = 'expired'
   where season_id = p_season and misis = m and status = 'pending_payment' and expires_at <= now();
  if p_includes_graduate and graduate_ticket_arranged(p_season, m) then return res_err('graduate_ticket_exists'); end if;
  if not p_includes_graduate and not graduate_ticket_arranged(p_season, m) then return res_err('graduate_ticket_required'); end if;
  if not p_includes_graduate and p_guests = 0 then return res_err('nothing_to_buy'); end if;
  lim := guest_allowance(p_season, m);
  used := guests_committed(p_season, m);
  if used + p_guests > lim then return res_err('limit_reached', jsonb_build_object('limit', lim, 'committed', used)); end if;

  amt := case when p_includes_graduate then st.graduate_price_aed else 0 end + p_guests * st.guest_price_aed;
  if amt = 0 then return res_err('nothing_to_buy'); end if;
  r := new_order_ref('TP');
  insert into orders (ref, season_id, misis, kind, status, channel, ceremony_id, includes_graduate, guest_count, amount_aed,
                      payer_name, payer_email, payer_relation, expires_at, created_by)
  values (r, p_season, m, 'third_party', 'pending_payment', 'third_party', g.ceremony_id, p_includes_graduate, p_guests, amt,
          btrim(p_payer_name), lower(btrim(p_payer_email)), nullif(btrim(coalesce(p_payer_relation, '')), ''),
          now() + make_interval(mins => st.hold_minutes), p_actor)
  returning id into oid;
  perform log_event(p_actor, 'third_party_order_created', 'payments', p_season, m, oid,
                    jsonb_build_object('ref', r, 'amount', amt, 'payer', btrim(p_payer_name)));
  return jsonb_build_object('ok', true, 'order_id', oid, 'ref', r, 'amount', amt);
end $$;

-- ---------------------------------------------------------------------------
-- Needs Attention
-- ---------------------------------------------------------------------------
-- Money was received but tickets could not be issued (zone full after a late payment, cancelled or superseded order):
-- give the student a receipt for what is still owed, so they choose a zone again.
create or replace function attention_to_receipt(p_order uuid, p_actor text) returns jsonb
language plpgsql as $$
declare o orders; inc boolean; owed int; rc text;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.needs_attention is null or o.attention_resolved_at is not null then return res_err('nothing_to_resolve'); end if;
  if o.kind = 'third_party' then return res_err('bad_request'); end if;
  if not exists (select 1 from payments where order_id = o.id) then return res_err('no_payment'); end if;
  if o.needs_attention like 'Amount mismatch%' then return res_err('amount_mismatch'); end if;

  inc := o.includes_graduate
     and not exists (select 1 from tickets where order_id = o.id and kind = 'graduate')
     and not graduate_ticket_arranged(o.season_id, o.misis);
  owed := o.guest_count - (select count(*) from tickets where order_id = o.id and kind = 'guest')::int;
  if owed > 0 or inc then
    rc := new_receipt_number();
    insert into receipts (receipt_number, season_id, misis, source, includes_graduate, guest_count, amount_aed, method, source_order_id, entered_by)
    values (rc, o.season_id, o.misis, 'attention', inc, greatest(owed, 0), 0, 'Converted from order ' || o.ref, o.id, p_actor);
  end if;
  update orders set attention_resolved_at = now(), attention_resolved_by = p_actor where id = o.id;
  perform log_event(p_actor, 'attention_to_receipt', 'finance', o.season_id, o.misis, o.id, jsonb_build_object('receipt', rc, 'guests', owed));
  return jsonb_build_object('ok', true, 'receipt_number', rc);
end $$;

create or replace function resolve_attention(p_order uuid, p_note text, p_actor text) returns jsonb
language plpgsql as $$
declare o orders; m merch_orders;
begin
  if length(btrim(coalesce(p_note, ''))) < 3 then return res_err('reason_required'); end if;
  select * into o from orders where id = p_order for update;
  if found then
    if o.needs_attention is null or o.attention_resolved_at is not null then return res_err('nothing_to_resolve'); end if;
    update orders set attention_resolved_at = now(), attention_resolved_by = p_actor where id = o.id;
    perform log_event(p_actor, 'attention_resolved', 'finance', o.season_id, o.misis, o.id, '{}'::jsonb, p_note);
    return jsonb_build_object('ok', true);
  end if;
  select * into m from merch_orders where id = p_order for update;
  if not found or m.needs_attention is null then return res_err('nothing_to_resolve'); end if;
  update merch_orders set needs_attention = null where id = m.id;
  perform log_event(p_actor, 'attention_resolved', 'merchandise', m.season_id, m.misis, null,
                    jsonb_build_object('order', m.id, 'was', m.needs_attention), p_note);
  return jsonb_build_object('ok', true);
end $$;

create or replace function void_receipt(p_receipt text, p_reason text, p_actor text) returns jsonb
language plpgsql as $$
declare rc receipts;
begin
  if length(btrim(coalesce(p_reason, ''))) < 3 then return res_err('reason_required'); end if;
  select * into rc from receipts where receipt_number = upper(btrim(p_receipt)) for update;
  if not found then return res_err('receipt_invalid'); end if;
  if rc.status <> 'unused' then return res_err('receipt_used'); end if;
  update receipts set status = 'void', void_reason = p_reason where receipt_number = rc.receipt_number;
  perform log_event(p_actor, 'receipt_voided', 'finance', rc.season_id, rc.misis, null, jsonb_build_object('receipt', rc.receipt_number), p_reason);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Financial holds
-- ---------------------------------------------------------------------------
create or replace function place_hold(p_season text, p_misis text, p_reason text, p_amount numeric, p_actor text) returns jsonb
language plpgsql as $$
declare m text := norm_misis(p_misis);
begin
  if not exists (select 1 from graduates where season_id = p_season and misis = m) then return res_err('not_on_master_list'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 2 then return res_err('reason_required'); end if;
  if exists (select 1 from financial_holds where season_id = p_season and misis = m and status = 'active') then return res_err('hold_exists'); end if;
  insert into financial_holds (season_id, misis, reason, amount_aed, created_by) values (p_season, m, btrim(p_reason), p_amount, p_actor);
  update graduates set financial_hold = true where season_id = p_season and misis = m;
  perform log_event(p_actor, 'hold_placed', 'finance', p_season, m, null, jsonb_build_object('amount', p_amount), p_reason);
  return jsonb_build_object('ok', true);
end $$;

create or replace function remove_hold(p_season text, p_misis text, p_note text, p_actor text) returns jsonb
language plpgsql as $$
declare h financial_holds; m text := norm_misis(p_misis);
begin
  select * into h from financial_holds where season_id = p_season and misis = m and status = 'active' for update;
  if not found then return res_err('no_hold'); end if;
  update financial_holds set status = 'removed', removed_by = p_actor, removed_at = now(),
         removal_note = nullif(btrim(coalesce(p_note, '')), ''), dar_notified_at = now()
   where id = h.id;
  update graduates set financial_hold = false where season_id = p_season and misis = m;
  perform log_event(p_actor, 'hold_removed', 'finance', p_season, m, null, jsonb_build_object('hold', h.id), p_note);
  return jsonb_build_object('ok', true);
end $$;

-- Finance tells DAR that the student may be allocated (rule 2)
create or replace function send_finance_request(p_season text, p_misis text, p_actor text) returns jsonb
language plpgsql as $$
declare g graduates; m text := norm_misis(p_misis);
begin
  select * into g from graduates where season_id = p_season and misis = m for update;
  if not found then return res_err('not_on_master_list'); end if;
  if g.financial_hold then return res_err('financial_hold'); end if;
  if g.finance_request_sent_at is not null then return jsonb_build_object('ok', true, 'already', true); end if;
  update graduates set finance_request_sent_at = now() where id = g.id;
  perform log_event(p_actor, 'finance_request_sent', 'finance', p_season, m);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- DAR: confirmation and ceremony allocation
-- ---------------------------------------------------------------------------
create or replace function set_confirmed(p_season text, p_misis text, p_confirmed boolean, p_actor text) returns jsonb
language plpgsql as $$
declare g graduates; m text := norm_misis(p_misis);
begin
  select * into g from graduates where season_id = p_season and misis = m for update;
  if not found then return res_err('not_on_master_list'); end if;
  if not p_confirmed and exists (select 1 from tickets where season_id = p_season and misis = m and status = 'valid') then
    return res_err('has_tickets');
  end if;
  update graduates set confirmed_graduate = p_confirmed,
         ceremony_id = case when p_confirmed then ceremony_id end
   where id = g.id;
  perform log_event(p_actor, case when p_confirmed then 'graduate_confirmed' else 'graduate_unconfirmed' end, 'allocation', p_season, m);
  return jsonb_build_object('ok', true);
end $$;

create or replace function allocate_ceremony(p_season text, p_misis text, p_number int, p_actor text) returns jsonb
language plpgsql as $$
declare g graduates; c ceremonies; m text := norm_misis(p_misis);
begin
  select * into g from graduates where season_id = p_season and misis = m for update;
  if not found then return res_err('not_on_master_list'); end if;
  if exists (select 1 from tickets where season_id = p_season and misis = m and status = 'valid') then return res_err('has_tickets'); end if;
  if p_number is null then
    update graduates set ceremony_id = null where id = g.id;
    perform log_event(p_actor, 'ceremony_removed', 'allocation', p_season, m);
    return jsonb_build_object('ok', true);
  end if;
  select * into c from ceremonies where season_id = p_season and number = p_number;
  if not found then return res_err('no_such_ceremony'); end if;
  if not g.confirmed_graduate then return res_err('not_confirmed'); end if;
  if g.financial_hold then return res_err('financial_hold'); end if;
  if g.finance_request_sent_at is null then return res_err('finance_request_missing'); end if;
  update graduates set ceremony_id = c.id where id = g.id;
  perform log_event(p_actor, 'ceremony_allocated', 'allocation', p_season, m, null, jsonb_build_object('ceremony', c.number));
  return jsonb_build_object('ok', true);
end $$;

-- Allocate every eligible, unallocated graduate whose programme is on the Programme to Ceremony Map
create or replace function auto_allocate(p_season text, p_actor text) returns jsonb
language plpgsql as $$
declare r record; n int := 0; res jsonb;
begin
  for r in
    select g.misis, pm.ceremony_number
      from graduates g join programme_ceremony_map pm on pm.season_id = g.season_id and lower(pm.programme) = lower(g.programme)
     where g.season_id = p_season and g.ceremony_id is null and g.confirmed_graduate and not g.financial_hold
       and g.finance_request_sent_at is not null
  loop
    res := allocate_ceremony(p_season, r.misis, r.ceremony_number, p_actor);
    if (res->>'ok')::boolean then n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'allocated', n);
end $$;

-- ---------------------------------------------------------------------------
-- Master List import: updates existing rows, never removes anyone
-- ---------------------------------------------------------------------------
create or replace function upsert_graduate(p_season text, p_row jsonb, p_actor text) returns jsonb
language plpgsql as $$
declare
  m text := norm_misis(p_row->>'misis');
  e text := lower(btrim(coalesce(p_row->>'email', '')));
  pe text := lower(btrim(coalesce(p_row->>'private_email', '')));
  g graduates; existed boolean; warn text[] := '{}'; cnum int; cid bigint; yn boolean;
begin
  if m !~ '^[A-Z0-9]{4,20}$' then return res_err('bad_misis', jsonb_build_object('misis', p_row->>'misis')); end if;
  if e <> '' and not student_email_ok(e) then return res_err('bad_email', jsonb_build_object('misis', m)); end if;
  if pe <> '' and position('@' in pe) < 2 then pe := ''; warn := warn || 'private_email_ignored'; end if;

  select * into g from graduates where season_id = p_season and misis = m for update;
  existed := found;
  begin
    if not existed then
      if e = '' or length(btrim(coalesce(p_row->>'full_name', ''))) < 1 then
        return res_err('missing_fields', jsonb_build_object('misis', m));
      end if;
      insert into graduates (season_id, misis, email, full_name) values (p_season, m, e, btrim(p_row->>'full_name')) returning * into g;
    end if;
    update graduates set
      email              = case when e <> '' then e else email end,
      full_name          = coalesce(nullif(btrim(coalesce(p_row->>'full_name', '')), ''), full_name),
      mobile             = coalesce(nullif(btrim(coalesce(p_row->>'mobile', '')), ''), mobile),
      private_email      = coalesce(nullif(pe, ''), private_email),
      programme          = coalesce(nullif(btrim(coalesce(p_row->>'programme', '')), ''), programme),
      grad_seat_label    = coalesce(nullif(btrim(coalesce(p_row->>'grad_seat_label', '')), ''), grad_seat_label),
      max_guests         = case when coalesce(p_row->>'max_guests', '') ~ '^[0-9]{1,2}$' then least((p_row->>'max_guests')::int, 20) else max_guests end,
      confirmed_graduate = coalesce(parse_yes_no(p_row->>'confirmed_graduate'), confirmed_graduate),
      potential_graduate = coalesce(parse_yes_no(p_row->>'potential_graduate'), potential_graduate)
     where id = g.id
    returning * into g;
  exception when unique_violation then
    return res_err('email_in_use', jsonb_build_object('misis', m, 'email', e));
  end;

  yn := parse_yes_no(p_row->>'financial_hold');
  if yn is true and not g.financial_hold then
    perform place_hold(p_season, m, 'Master List import', null, p_actor);
  elsif yn is false and g.financial_hold then
    warn := warn || 'hold_kept';
  end if;

  if coalesce(p_row->>'ceremony', '') ~ '[0-9]' then
    cnum := nullif(regexp_replace(p_row->>'ceremony', '[^0-9]', '', 'g'), '')::int;
    select id into cid from ceremonies where season_id = p_season and number = cnum;
    select * into g from graduates where id = g.id;
    if cid is null then
      warn := warn || 'ceremony_unknown';
    elsif cid is distinct from g.ceremony_id then
      if g.confirmed_graduate and not g.financial_hold and g.finance_request_sent_at is not null
         and not exists (select 1 from tickets where season_id = p_season and misis = m and status = 'valid') then
        update graduates set ceremony_id = cid where id = g.id;
      else
        warn := warn || 'ceremony_skipped';
      end if;
    end if;
  end if;

  return jsonb_build_object('ok', true, 'action', case when existed then 'updated' else 'created' end, 'misis', m, 'warnings', to_jsonb(warn));
end $$;

create or replace function update_contact(p_season text, p_misis text, p_email text, p_private_email text, p_mobile text, p_actor text) returns jsonb
language plpgsql as $$
declare g graduates; e text := lower(btrim(coalesce(p_email, ''))); pe text := lower(btrim(coalesce(p_private_email, '')));
begin
  select * into g from graduates where season_id = p_season and misis = norm_misis(p_misis) for update;
  if not found then return res_err('not_on_master_list'); end if;
  if e = '' or not student_email_ok(e) then return res_err('bad_email'); end if;
  if pe <> '' and position('@' in pe) < 2 then return res_err('bad_private_email'); end if;
  begin
    update graduates set email = e, private_email = nullif(pe, ''), mobile = nullif(btrim(coalesce(p_mobile, '')), '') where id = g.id;
  exception when unique_violation then
    return res_err('email_in_use');
  end;
  perform log_event(p_actor, 'contact_updated', 'master_list', p_season, g.misis, null,
                    jsonb_build_object('old', jsonb_build_object('email', g.email, 'private_email', g.private_email, 'mobile', g.mobile),
                                       'new', jsonb_build_object('email', e, 'private_email', nullif(pe, ''), 'mobile', nullif(btrim(coalesce(p_mobile, '')), ''))));
  return jsonb_build_object('ok', true);
end $$;

create or replace function set_graduate_limit(p_season text, p_misis text, p_max_guests int, p_actor text) returns jsonb
language plpgsql as $$
declare g graduates;
begin
  select * into g from graduates where season_id = p_season and misis = norm_misis(p_misis) for update;
  if not found then return res_err('not_on_master_list'); end if;
  if p_max_guests is not null and (p_max_guests < 0 or p_max_guests > 20) then return res_err('bad_request'); end if;
  update graduates set max_guests = p_max_guests where id = g.id;
  perform log_event(p_actor, 'guest_limit_changed', 'limits', p_season, g.misis, null, jsonb_build_object('old', g.max_guests, 'new', p_max_guests));
  return jsonb_build_object('ok', true);
end $$;
