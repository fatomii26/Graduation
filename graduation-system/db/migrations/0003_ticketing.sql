-- Orders, receipts, extra tickets, tickets, transfers, name changes, scans, payments, packages

-- ---------------------------------------------------------------------------
-- Orders
--   main         graduate ticket (+ guests). One active main order per graduate per season.
--   extra        extra guests after the main order (extra ticket code or counter receipt)
--   third_party  paid by a parent / guardian / sponsor; becomes a receipt the student redeems
-- ---------------------------------------------------------------------------
create table orders (
  id                     uuid primary key default gen_random_uuid(),
  ref                    text not null unique,
  season_id              text not null references seasons(id),
  misis                  text not null,
  kind                   text not null check (kind in ('main', 'extra', 'third_party')),
  status                 text not null check (status in ('pending_payment', 'paid', 'cancelled', 'expired')),
  channel                text not null check (channel in ('online', 'counter', 'third_party', 'free')),
  ceremony_id            bigint references ceremonies(id),
  zone_id                bigint references zones(id),
  includes_graduate      boolean not null default false,
  guest_count            int not null check (guest_count between 0 and 20),
  amount_aed             numeric(10,2) not null check (amount_aed >= 0),
  payment_method         text,
  payment_ref            text,
  receipt_number         text,
  extra_code             text,
  payer_name             text,
  payer_email            text,
  payer_relation         text,
  needs_attention        text,
  attention_resolved_at  timestamptz,
  attention_resolved_by  text,
  expires_at             timestamptz,
  paid_at                timestamptz,
  created_by             text not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  foreign key (season_id, misis) references graduates (season_id, misis)
);
create unique index orders_one_active_main on orders (season_id, misis) where kind = 'main' and status in ('pending_payment', 'paid');
create unique index orders_one_pending_extra on orders (season_id, misis) where kind = 'extra' and status = 'pending_payment';
create index orders_season_status on orders (season_id, status);
create index orders_misis on orders (season_id, misis);
create index orders_attention on orders (season_id) where needs_attention is not null and attention_resolved_at is null;

create table order_guests (
  order_id          uuid not null references orders(id),
  position          int  not null check (position between 1 and 20),
  guest_name        text not null check (length(trim(guest_name)) between 1 and 120),
  zone_id           bigint not null references zones(id),
  access            text not null default 'none' check (access in ('none', 'wheelchair', 'companion')),
  needs_assistance  boolean not null default false,
  primary key (order_id, position)
);
create index order_guests_zone on order_guests (zone_id);

-- ---------------------------------------------------------------------------
-- Receipts: money already taken (counter, Graduation Day, third party). The student redeems the
-- receipt number once, chooses the zone and names, and receives the tickets.
-- ---------------------------------------------------------------------------
create table receipts (
  receipt_number     text primary key,
  season_id          text not null references seasons(id),
  misis              text not null,
  source             text not null check (source in ('counter', 'graduation_day', 'third_party', 'attention')),
  includes_graduate  boolean not null default false,
  guest_count        int not null check (guest_count between 0 and 20),
  amount_aed         numeric(10,2) not null check (amount_aed >= 0),
  method             text not null,
  payer_name         text,
  payer_email        text,
  payer_relation     text,
  source_order_id    uuid references orders(id),
  entered_by         text not null,
  created_at         timestamptz not null default now(),
  status             text not null default 'unused' check (status in ('unused', 'used', 'void')),
  used_at            timestamptz,
  used_order_id      uuid references orders(id),
  void_reason        text,
  foreign key (season_id, misis) references graduates (season_id, misis)
);
create index receipts_misis on receipts (season_id, misis);

-- ---------------------------------------------------------------------------
-- Extra tickets: request (form) -> Marketing approval -> code valid for 72 hours
-- ---------------------------------------------------------------------------
create table extra_ticket_requests (
  id                uuid primary key default gen_random_uuid(),
  season_id         text not null references seasons(id),
  misis             text not null,
  requested_guests  int not null check (requested_guests between 1 and 10),
  reason            text not null default '',
  status            text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  decided_by        text,
  decided_at        timestamptz,
  decision_note     text,
  code              text,
  created_at        timestamptz not null default now(),
  foreign key (season_id, misis) references graduates (season_id, misis)
);
create unique index extra_requests_one_open on extra_ticket_requests (season_id, misis) where status = 'requested';

create table extra_ticket_codes (
  code           text primary key,
  season_id      text not null references seasons(id),
  misis          text not null,
  extra_guests   int  not null check (extra_guests between 1 and 10),
  request_id     uuid references extra_ticket_requests(id),
  approved_by    text not null,
  expires_at     timestamptz not null,
  used_at        timestamptz,
  used_order_id  uuid references orders(id),
  created_at     timestamptz not null default now(),
  foreign key (season_id, misis) references graduates (season_id, misis)
);

-- ---------------------------------------------------------------------------
-- Tickets: one per person. The token is the value inside the QR code and never changes;
-- a change (transfer, name correction) voids the ticket and issues a new one.
-- ---------------------------------------------------------------------------
create table tickets (
  id                uuid primary key default gen_random_uuid(),
  season_id         text not null references seasons(id),
  order_id          uuid not null references orders(id),
  misis             text not null,                 -- the graduate who holds the ticket
  kind              text not null check (kind in ('graduate', 'guest')),
  holder_name       text not null,
  ceremony_id       bigint not null references ceremonies(id),
  zone_id           bigint references zones(id),   -- null for graduate tickets
  door              text not null,                 -- zone door for guests, graduate entrance for graduates
  access            text not null default 'none' check (access in ('none', 'wheelchair', 'companion')),
  needs_assistance  boolean not null default false,
  token             text not null unique check (length(token) >= 40),
  status            text not null default 'valid' check (status in ('valid', 'void')),
  void_reason       text,
  replaces          uuid references tickets(id),
  replaced_by       uuid references tickets(id),
  door1_at          timestamptz,
  door1_by          text,
  door2_at          timestamptz,
  door2_by          text,
  last_scan_at      timestamptz,
  created_at        timestamptz not null default now(),
  check ((kind = 'guest') = (zone_id is not null)),
  foreign key (season_id, misis) references graduates (season_id, misis)
);
create unique index tickets_one_graduate_ticket on tickets (season_id, misis) where kind = 'graduate' and status = 'valid';
create index tickets_order on tickets (order_id);
create index tickets_holder on tickets (season_id, misis);
create index tickets_ceremony on tickets (ceremony_id, status);
create index tickets_zone on tickets (ceremony_id, zone_id) where status = 'valid';

-- The QR token, holder, ceremony and zone never change on an issued ticket.
create or replace function tickets_guard() returns trigger
language plpgsql as $$
begin
  if new.token <> old.token or new.kind <> old.kind or new.misis <> old.misis or new.order_id <> old.order_id
     or new.ceremony_id <> old.ceremony_id or new.zone_id is distinct from old.zone_id or new.door <> old.door then
    raise exception 'Issued tickets cannot be changed; void and reissue instead' using errcode = 'P0001';
  end if;
  if new.holder_name <> old.holder_name and coalesce(current_setting('app.allow_cleanup', true), '') <> 'on' then
    raise exception 'Ticket names change only through the reissue step' using errcode = 'P0001';
  end if;
  if old.status = 'void' and new.status <> 'void' then
    raise exception 'A void ticket cannot be made valid again' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger tickets_guard before update on tickets for each row execute function tickets_guard();

create trigger graduates_allocation_guard before insert or update on graduates
  for each row execute function graduates_allocation_guard();

-- ---------------------------------------------------------------------------
-- Transfers and name changes (requested by the student, decided by Marketing)
-- ---------------------------------------------------------------------------
create table transfers (
  id              uuid primary key default gen_random_uuid(),
  season_id       text not null references seasons(id),
  from_misis      text not null,
  to_misis        text not null,
  ticket_ids      uuid[] not null check (cardinality(ticket_ids) between 1 and 20),
  status          text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'cancelled')),
  student_note    text not null default '',
  requested_by    text not null,
  decided_by      text,
  decided_at      timestamptz,
  decision_note   text,
  new_ticket_ids  uuid[],
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  foreign key (season_id, from_misis) references graduates (season_id, misis),
  foreign key (season_id, to_misis) references graduates (season_id, misis),
  check (from_misis <> to_misis)
);

create table name_change_requests (
  id             uuid primary key default gen_random_uuid(),
  season_id      text not null references seasons(id),
  ticket_id      uuid not null references tickets(id),
  misis          text not null,
  old_name       text not null,
  new_name       text not null,
  reason         text not null default '',
  status         text not null default 'requested' check (status in ('requested', 'approved', 'rejected')),
  requested_by   text not null,
  decided_by     text,
  decided_at     timestamptz,
  decision_note  text,
  new_ticket_id  uuid references tickets(id),
  created_at     timestamptz not null default now()
);
create unique index name_changes_one_open on name_change_requests (ticket_id) where status = 'requested';

-- Lost Ticket resends and student shares
create table ticket_sends (
  id         bigserial primary key,
  ticket_id  uuid not null references tickets(id),
  channel    text not null check (channel in ('email', 'mobile')),
  address    text not null,
  kind       text not null check (kind in ('lost_ticket', 'share')),
  sent_by    text not null,
  sent_at    timestamptz not null default now()
);

-- Every scan, including refused ones (append-only)
create table scans (
  id           bigserial primary key,
  at           timestamptz not null default now(),
  season_id    text,
  ticket_id    uuid references tickets(id),
  ceremony_id  bigint,
  checkpoint   text not null check (checkpoint in ('door1', 'door2', 'graduate')),
  door         text,
  result       text not null,
  holder_name  text,
  kind         text,
  staff        text not null,
  manual       boolean not null default false,
  reason       text
);
create index scans_ceremony_at on scans (ceremony_id, at desc);

-- ---------------------------------------------------------------------------
-- Money in (append-only ledger) and raw gateway notifications (append-only)
-- ---------------------------------------------------------------------------
create table payments (
  id              bigserial primary key,
  at              timestamptz not null default now(),
  season_id       text not null references seasons(id),
  misis           text,
  order_id        uuid references orders(id),
  merch_order_id  uuid,
  receipt_number  text,
  channel         text not null check (channel in ('online', 'third_party', 'counter', 'graduation_day', 'merch_online', 'merch_counter')),
  method          text not null,
  amount_aed      numeric(10,2) not null,
  reference       text,
  recorded_by     text not null
);
create index payments_season_at on payments (season_id, at desc);
create index payments_reference on payments (reference);

create table payment_events (
  id           bigserial primary key,
  event_key    text not null unique,
  gateway      text not null,
  target       text not null check (target in ('ticket', 'merch')),
  target_id    text not null,
  gateway_ref  text,
  status       text not null,
  amount       numeric(10,2),
  payload      jsonb not null default '{}'::jsonb,
  received_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Package collection (cap, gown, scarf, name card)
-- ---------------------------------------------------------------------------
create table package_collections (
  season_id     text not null references seasons(id),
  misis         text not null,
  cap           boolean not null default false,
  gown          boolean not null default false,
  scarf         boolean not null default false,
  name_card     boolean not null default false,
  collected_by  text not null,
  updated_at    timestamptz not null default now(),
  primary key (season_id, misis),
  foreign key (season_id, misis) references graduates (season_id, misis)
);

create trigger orders_touch before update on orders for each row execute function touch_updated_at();
create trigger transfers_touch before update on transfers for each row execute function touch_updated_at();
