-- Extra tickets, transfers, name changes, reissue, Lost Ticket log, packages, scanning, live stats

-- ---------------------------------------------------------------------------
-- Extra tickets
-- ---------------------------------------------------------------------------
create or replace function create_extra_code(p_season text, p_misis text, p_guests int, p_request uuid, p_actor text) returns jsonb
language plpgsql as $$
declare st season_settings; c text; m text := norm_misis(p_misis); exp timestamptz;
begin
  if coalesce(p_guests, 0) not between 1 and 10 then return res_err('bad_request'); end if;
  if not exists (select 1 from graduates where season_id = p_season and misis = m) then return res_err('not_on_master_list'); end if;
  select * into st from season_settings where season_id = p_season;
  loop
    c := new_code('EX', 8);
    exit when not exists (select 1 from extra_ticket_codes where code = c);
  end loop;
  exp := now() + make_interval(hours => st.extra_code_hours);
  insert into extra_ticket_codes (code, season_id, misis, extra_guests, request_id, approved_by, expires_at)
  values (c, p_season, m, p_guests, p_request, p_actor, exp);
  perform log_event(p_actor, 'extra_code_created', 'extra_tickets', p_season, m, null,
                    jsonb_build_object('code', c, 'guests', p_guests, 'expires_at', exp));
  return jsonb_build_object('ok', true, 'code', c, 'expires_at', exp);
end $$;

create or replace function request_extra_tickets(p_season text, p_misis text, p_guests int, p_reason text, p_actor text) returns jsonb
language plpgsql as $$
declare st season_settings; rid uuid;
begin
  select * into st from season_settings where season_id = p_season;
  if not found or not st.extra_requests_enabled then return res_err('requests_closed'); end if;
  if coalesce(p_guests, 0) not between 1 and 10 then return res_err('bad_request'); end if;
  if not exists (select 1 from graduates where season_id = p_season and misis = p_misis) then return res_err('not_on_master_list'); end if;
  begin
    insert into extra_ticket_requests (season_id, misis, requested_guests, reason)
    values (p_season, p_misis, p_guests, left(btrim(coalesce(p_reason, '')), 500)) returning id into rid;
  exception when unique_violation then
    return res_err('request_open');
  end;
  perform log_event(p_actor, 'extra_requested', 'extra_tickets', p_season, p_misis, null, jsonb_build_object('guests', p_guests), p_reason);
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

create or replace function decide_extra_request(p_id uuid, p_approve boolean, p_guests int, p_note text, p_actor text) returns jsonb
language plpgsql as $$
declare q extra_ticket_requests; res jsonb;
begin
  select * into q from extra_ticket_requests where id = p_id for update;
  if not found then return res_err('no_such_request'); end if;
  if q.status <> 'requested' then return res_err('wrong_status'); end if;
  if p_approve then
    res := create_extra_code(q.season_id, q.misis, coalesce(p_guests, q.requested_guests), q.id, p_actor);
    if not (res->>'ok')::boolean then return res; end if;
    update extra_ticket_requests set status = 'approved', decided_by = p_actor, decided_at = now(), decision_note = p_note, code = res->>'code'
     where id = q.id;
    return res;
  end if;
  update extra_ticket_requests set status = 'rejected', decided_by = p_actor, decided_at = now(), decision_note = p_note where id = q.id;
  perform log_event(p_actor, 'extra_rejected', 'extra_tickets', q.season_id, q.misis, null, '{}'::jsonb, p_note);
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Reissue: void a ticket and issue a new one with a new QR code, same ceremony, zone and door.
-- Used by transfers (new holder) and by name corrections (new name).
-- ---------------------------------------------------------------------------
create or replace function reissue_ticket(p_ticket uuid, p_new_name text, p_new_misis text, p_reason text, p_actor text) returns jsonb
language plpgsql as $$
declare t tickets; nm text; nid uuid; tok text;
begin
  select * into t from tickets where id = p_ticket for update;
  if not found then return res_err('no_such_ticket'); end if;
  if t.status <> 'valid' then return res_err('ticket_not_valid'); end if;
  nm := regexp_replace(btrim(coalesce(nullif(btrim(coalesce(p_new_name, '')), ''), t.holder_name)), '\s+', ' ', 'g');
  if length(nm) not between 2 and 120 then return res_err('name_required'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return res_err('reason_required'); end if;
  tok := new_token();
  update tickets set status = 'void', void_reason = p_reason where id = t.id;
  insert into tickets (season_id, order_id, misis, kind, holder_name, ceremony_id, zone_id, door, access, needs_assistance, token,
                       replaces, door1_at, door1_by, door2_at, door2_by, last_scan_at)
  values (t.season_id, t.order_id, coalesce(p_new_misis, t.misis), t.kind, nm, t.ceremony_id, t.zone_id, t.door, t.access,
          t.needs_assistance, tok, t.id, t.door1_at, t.door1_by, t.door2_at, t.door2_by, t.last_scan_at)
  returning id into nid;
  update tickets set replaced_by = nid where id = t.id;
  perform log_event(p_actor, 'ticket_reissued', 'tickets', t.season_id, t.misis, t.order_id,
                    jsonb_build_object('old_ticket', t.id, 'new_ticket', nid, 'old_name', t.holder_name, 'new_name', nm,
                                       'new_holder', coalesce(p_new_misis, t.misis)), p_reason);
  return jsonb_build_object('ok', true, 'new_ticket_id', nid, 'token', tok);
end $$;

-- ---------------------------------------------------------------------------
-- Transfers between graduates of the same ceremony (Marketing approves)
-- ---------------------------------------------------------------------------
create or replace function request_transfer(p_season text, p_from text, p_to text, p_ticket_ids uuid[], p_note text, p_actor text) returns jsonb
language plpgsql as $$
declare st season_settings; gf graduates; gt graduates; tid uuid; want int; got int; t_to text := norm_misis(p_to);
begin
  select * into st from season_settings where season_id = p_season;
  if not found or not st.transfers_enabled then return res_err('transfers_closed'); end if;
  if t_to = p_from then return res_err('same_graduate'); end if;
  select * into gf from graduates where season_id = p_season and misis = p_from;
  if not found then return res_err('not_on_master_list'); end if;
  select * into gt from graduates where season_id = p_season and misis = t_to;
  if not found then return res_err('receiver_not_found'); end if;
  if not gt.confirmed_graduate or gt.ceremony_id is null then return res_err('receiver_not_eligible'); end if;
  if gt.ceremony_id is distinct from gf.ceremony_id then return res_err('different_ceremony'); end if;

  want := (select count(distinct x) from unnest(p_ticket_ids) x);
  if coalesce(want, 0) = 0 then return res_err('bad_request'); end if;
  select count(*) into got from tickets
   where id = any (p_ticket_ids) and season_id = p_season and misis = p_from and kind = 'guest' and status = 'valid'
     and ceremony_id = gt.ceremony_id;
  if got <> want then return res_err('ticket_not_valid'); end if;
  if exists (select 1 from transfers where season_id = p_season and status = 'requested' and ticket_ids && p_ticket_ids) then
    return res_err('transfer_pending');
  end if;
  insert into transfers (season_id, from_misis, to_misis, ticket_ids, student_note, requested_by)
  values (p_season, p_from, t_to, (select array_agg(distinct x) from unnest(p_ticket_ids) x), left(btrim(coalesce(p_note, '')), 500), p_actor)
  returning id into tid;
  perform log_event(p_actor, 'transfer_requested', 'transfers', p_season, p_from, null,
                    jsonb_build_object('transfer', tid, 'to', t_to, 'tickets', want));
  return jsonb_build_object('ok', true, 'id', tid);
end $$;

create or replace function approve_transfer(p_id uuid, p_note text, p_actor text) returns jsonb
language plpgsql as $$
declare tr transfers; gt graduates; tid uuid; res jsonb; new_ids uuid[] := '{}';
begin
  select * into tr from transfers where id = p_id for update;
  if not found then return res_err('no_such_transfer'); end if;
  if tr.status <> 'requested' then return res_err('wrong_status'); end if;
  select * into gt from graduates where season_id = tr.season_id and misis = tr.to_misis;
  perform 1 from tickets where id = any (tr.ticket_ids) order by id for update;
  if (select count(*) from tickets where id = any (tr.ticket_ids) and misis = tr.from_misis and status = 'valid'
        and kind = 'guest' and ceremony_id = gt.ceremony_id) <> cardinality(tr.ticket_ids) then
    return res_err('ticket_not_valid');
  end if;
  foreach tid in array tr.ticket_ids loop
    res := reissue_ticket(tid, null, tr.to_misis, 'Transferred to ' || tr.to_misis, p_actor);
    if not (res->>'ok')::boolean then raise exception 'transfer failed: %', res->>'error'; end if;
    new_ids := new_ids || (res->>'new_ticket_id')::uuid;
  end loop;
  update transfers set status = 'approved', decided_by = p_actor, decided_at = now(), decision_note = p_note, new_ticket_ids = new_ids
   where id = tr.id;
  perform log_event(p_actor, 'transfer_approved', 'transfers', tr.season_id, tr.from_misis, null,
                    jsonb_build_object('transfer', tr.id, 'to', tr.to_misis, 'new_tickets', to_jsonb(new_ids)), p_note);
  return jsonb_build_object('ok', true, 'new_ticket_ids', to_jsonb(new_ids));
end $$;

create or replace function reject_transfer(p_id uuid, p_note text, p_actor text) returns jsonb
language plpgsql as $$
declare tr transfers;
begin
  select * into tr from transfers where id = p_id for update;
  if not found then return res_err('no_such_transfer'); end if;
  if tr.status <> 'requested' then return res_err('wrong_status'); end if;
  update transfers set status = 'rejected', decided_by = p_actor, decided_at = now(), decision_note = p_note where id = tr.id;
  perform log_event(p_actor, 'transfer_rejected', 'transfers', tr.season_id, tr.from_misis, null, jsonb_build_object('transfer', tr.id), p_note);
  return jsonb_build_object('ok', true);
end $$;

create or replace function cancel_transfer(p_id uuid, p_misis text, p_actor text) returns jsonb
language plpgsql as $$
declare tr transfers;
begin
  select * into tr from transfers where id = p_id for update;
  if not found or tr.from_misis <> p_misis then return res_err('no_such_transfer'); end if;
  if tr.status <> 'requested' then return res_err('wrong_status'); end if;
  update transfers set status = 'cancelled' where id = tr.id;
  perform log_event(p_actor, 'transfer_cancelled', 'transfers', tr.season_id, tr.from_misis, null, jsonb_build_object('transfer', tr.id));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Name changes: the student places a request; Marketing approves case by case
-- ---------------------------------------------------------------------------
create or replace function request_name_change(p_season text, p_misis text, p_ticket uuid, p_new_name text, p_reason text, p_actor text) returns jsonb
language plpgsql as $$
declare st season_settings; t tickets; nm text := regexp_replace(btrim(coalesce(p_new_name, '')), '\s+', ' ', 'g'); rid uuid;
begin
  select * into st from season_settings where season_id = p_season;
  if not found or not st.name_changes_enabled then return res_err('name_changes_closed'); end if;
  select * into t from tickets where id = p_ticket;
  if not found or t.season_id <> p_season or t.misis <> p_misis then return res_err('no_such_ticket'); end if;
  if t.kind <> 'guest' then return res_err('graduate_ticket'); end if;
  if t.status <> 'valid' then return res_err('ticket_not_valid'); end if;
  if length(nm) not between 2 and 120 then return res_err('name_required'); end if;
  if lower(nm) = lower(t.holder_name) then return res_err('same_name'); end if;
  begin
    insert into name_change_requests (season_id, ticket_id, misis, old_name, new_name, reason, requested_by)
    values (p_season, t.id, p_misis, t.holder_name, nm, left(btrim(coalesce(p_reason, '')), 500), p_actor) returning id into rid;
  exception when unique_violation then
    return res_err('change_pending');
  end;
  perform log_event(p_actor, 'name_change_requested', 'tickets', p_season, p_misis, t.order_id,
                    jsonb_build_object('request', rid, 'ticket', t.id, 'old_name', t.holder_name, 'new_name', nm), p_reason);
  return jsonb_build_object('ok', true, 'id', rid);
end $$;

create or replace function decide_name_change(p_id uuid, p_approve boolean, p_note text, p_actor text) returns jsonb
language plpgsql as $$
declare q name_change_requests; res jsonb;
begin
  select * into q from name_change_requests where id = p_id for update;
  if not found then return res_err('no_such_request'); end if;
  if q.status <> 'requested' then return res_err('wrong_status'); end if;
  if p_approve then
    res := reissue_ticket(q.ticket_id, q.new_name, null, 'Name change approved', p_actor);
    if not (res->>'ok')::boolean then return res; end if;
    update name_change_requests set status = 'approved', decided_by = p_actor, decided_at = now(), decision_note = p_note,
           new_ticket_id = (res->>'new_ticket_id')::uuid
     where id = q.id;
    return res;
  end if;
  update name_change_requests set status = 'rejected', decided_by = p_actor, decided_at = now(), decision_note = p_note where id = q.id;
  perform log_event(p_actor, 'name_change_rejected', 'tickets', q.season_id, q.misis, null, jsonb_build_object('request', q.id), p_note);
  return jsonb_build_object('ok', true);
end $$;

-- Lost Ticket and student shares: the same QR code is sent again, and the send is logged
create or replace function log_ticket_send(p_ticket uuid, p_channel text, p_address text, p_kind text, p_actor text) returns jsonb
language plpgsql as $$
declare t tickets;
begin
  select * into t from tickets where id = p_ticket;
  if not found then return res_err('no_such_ticket'); end if;
  if t.status <> 'valid' then return res_err('ticket_not_valid'); end if;
  insert into ticket_sends (ticket_id, channel, address, kind, sent_by) values (t.id, p_channel, left(p_address, 200), p_kind, p_actor);
  perform log_event(p_actor, case when p_kind = 'lost_ticket' then 'lost_ticket_sent' else 'ticket_shared' end, 'tickets',
                    t.season_id, t.misis, t.order_id, jsonb_build_object('ticket', t.id, 'channel', p_channel, 'to', left(p_address, 200)));
  return jsonb_build_object('ok', true, 'token', t.token);
end $$;

-- ---------------------------------------------------------------------------
-- Package collection
-- ---------------------------------------------------------------------------
create or replace function set_package(p_season text, p_misis text, p_cap boolean, p_gown boolean, p_scarf boolean, p_name_card boolean, p_actor text) returns jsonb
language plpgsql as $$
declare m text := norm_misis(p_misis);
begin
  if not exists (select 1 from graduates where season_id = p_season and misis = m) then return res_err('not_on_master_list'); end if;
  insert into package_collections (season_id, misis, cap, gown, scarf, name_card, collected_by, updated_at)
  values (p_season, m, p_cap, p_gown, p_scarf, p_name_card, p_actor, now())
  on conflict (season_id, misis) do update set cap = excluded.cap, gown = excluded.gown, scarf = excluded.scarf,
    name_card = excluded.name_card, collected_by = excluded.collected_by, updated_at = now();
  perform log_event(p_actor, 'package_updated', 'packages', p_season, m, null,
                    jsonb_build_object('cap', p_cap, 'gown', p_gown, 'scarf', p_scarf, 'name_card', p_name_card));
  return jsonb_build_object('ok', true);
end $$;

-- ---------------------------------------------------------------------------
-- Scanning
--   door1     venue entrance: every guest ticket works once
--   door2     the zone's own door (p_door): every guest ticket works once, only at its own zone door
--   graduate  graduate entrance: guest tickets are refused
-- Graduate tickets are admitted at every scan, any door, any number of times.
-- Void, replaced, wrong-ceremony and unknown tickets are refused. Every scan is logged.
-- ---------------------------------------------------------------------------
create or replace function scan_ticket(
  p_token text, p_ceremony bigint, p_checkpoint text, p_door text, p_actor text,
  p_manual boolean default false, p_reason text default null
) returns jsonb
language plpgsql as $$
declare t tickets; c ceremonies; res text; outp jsonb; zn zones; note text;
begin
  if p_checkpoint not in ('door1', 'door2', 'graduate') or (p_checkpoint = 'door2' and coalesce(btrim(p_door), '') = '') then
    return res_err('bad_checkpoint');
  end if;
  select * into c from ceremonies where id = p_ceremony;
  if not found then return res_err('bad_checkpoint'); end if;

  select * into t from tickets where token = coalesce(p_token, '') for update;
  if not found then
    insert into scans (season_id, ticket_id, ceremony_id, checkpoint, door, result, staff, manual, reason)
    values (c.season_id, null, p_ceremony, p_checkpoint, p_door, 'not_found', p_actor, p_manual, p_reason);
    return jsonb_build_object('ok', false, 'result', 'not_found');
  end if;

  select * into zn from zones where id = t.zone_id;
  outp := jsonb_build_object(
    'holder_name', t.holder_name, 'kind', t.kind, 'door', t.door, 'zone', zn.name, 'zone_code', zn.code, 'zone_color', zn.color,
    'access', t.access, 'needs_assistance', t.needs_assistance,
    'ceremony', (select name from ceremonies where id = t.ceremony_id),
    'door1_at', t.door1_at, 'door2_at', t.door2_at);

  if t.status = 'void' then
    res := case when t.replaced_by is not null then 'replaced' else 'void' end;
  elsif t.ceremony_id <> p_ceremony then
    res := 'wrong_ceremony';
  elsif t.kind = 'graduate' then
    res := 'admit';
    update tickets set door1_at = coalesce(door1_at, now()), door1_by = coalesce(door1_by, p_actor), last_scan_at = now() where id = t.id;
  elsif p_checkpoint = 'graduate' then
    res := 'wrong_entrance';
  elsif p_checkpoint = 'door1' then
    if t.door1_at is not null then
      res := 'already_used';
      outp := outp || jsonb_build_object('used_at', t.door1_at, 'used_where', 'Door 1');
    else
      update tickets set door1_at = now(), door1_by = p_actor, last_scan_at = now() where id = t.id;
      res := 'admit';
    end if;
  else
    if t.door2_at is not null then
      res := 'already_used';
      outp := outp || jsonb_build_object('used_at', t.door2_at, 'used_where', t.door);
    elsif lower(btrim(t.door)) <> lower(btrim(p_door)) then
      res := 'wrong_door';
    else
      update tickets set door2_at = now(), door2_by = p_actor, last_scan_at = now() where id = t.id;
      res := 'admit';
      if t.door1_at is null then
        note := 'Door 1 not scanned';
        outp := outp || jsonb_build_object('missed_door1', true);
      end if;
    end if;
  end if;

  insert into scans (season_id, ticket_id, ceremony_id, checkpoint, door, result, holder_name, kind, staff, manual, reason)
  values (t.season_id, t.id, p_ceremony, p_checkpoint, p_door, res, t.holder_name, t.kind, p_actor, p_manual,
          coalesce(p_reason, note));
  if p_manual then
    perform log_event(p_actor, 'manual_checkin', 'checkin', t.season_id, t.misis, t.order_id,
                      jsonb_build_object('ticket', t.id, 'checkpoint', p_checkpoint, 'result', res), p_reason);
  end if;
  return outp || jsonb_build_object('ok', res = 'admit', 'result', res);
end $$;

-- Manual override for a failed scanner (off unless switched on in Technical Settings). Needs a reason.
create or replace function manual_checkin(p_ticket uuid, p_checkpoint text, p_reason text, p_actor text) returns jsonb
language plpgsql as $$
declare t tickets;
begin
  if not (select manual_checkin_override from app_settings) then return res_err('override_disabled'); end if;
  if length(btrim(coalesce(p_reason, ''))) < 3 then return res_err('reason_required'); end if;
  select * into t from tickets where id = p_ticket;
  if not found then return res_err('no_such_ticket'); end if;
  return scan_ticket(t.token, t.ceremony_id, p_checkpoint, t.door, p_actor, true, btrim(p_reason));
end $$;

-- Live numbers for one ceremony (Live Seating, Entry Check-In, Dashboard)
create or replace function live_stats(p_ceremony bigint) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'graduates_total', (select count(*) from tickets where ceremony_id = p_ceremony and kind = 'graduate' and status = 'valid'),
    'graduates_in',    (select count(*) from tickets where ceremony_id = p_ceremony and kind = 'graduate' and status = 'valid' and door1_at is not null),
    'guests_total',    (select count(*) from tickets where ceremony_id = p_ceremony and kind = 'guest' and status = 'valid'),
    'guests_door1',    (select count(*) from tickets where ceremony_id = p_ceremony and kind = 'guest' and status = 'valid' and door1_at is not null),
    'guests_in',       (select count(*) from tickets where ceremony_id = p_ceremony and kind = 'guest' and status = 'valid' and door2_at is not null),
    'refused',         (select count(*) from scans where ceremony_id = p_ceremony and result <> 'admit'),
    'zones', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', z.id, 'code', z.code, 'name', z.name, 'door', z.door, 'color', z.color, 'capacity', z.capacity,
               'sold', (select count(*) from tickets t where t.ceremony_id = p_ceremony and t.zone_id = z.id and t.status = 'valid'),
               'inside', (select count(*) from tickets t where t.ceremony_id = p_ceremony and t.zone_id = z.id and t.status = 'valid' and t.door2_at is not null)
             ) order by z.sort, z.code)
        from ceremonies c join zones z on z.season_id = c.season_id and z.active
       where c.id = p_ceremony), '[]'::jsonb),
    'latest', coalesce((
      select jsonb_agg(x order by x.at desc) from (
        select at, checkpoint, door, result, holder_name, kind, staff, manual
          from scans where ceremony_id = p_ceremony order by at desc limit 15) x), '[]'::jsonb)
  )
$$;
