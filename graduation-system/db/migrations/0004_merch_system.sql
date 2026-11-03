-- Merchandise, reconciliation, emails, scheduled jobs, connection secrets

create table merch_items (
  id           bigserial primary key,
  season_id    text not null references seasons(id),
  name         text not null check (length(trim(name)) between 2 and 80),
  description  text not null default '',
  price_aed    numeric(10,2) not null check (price_aed >= 0),
  image        text not null default '',          -- https URL, data URL (small upload) or an emoji drawing
  active       boolean not null default true,
  removed      boolean not null default false,
  sort         int not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table merch_orders (
  id               uuid primary key default gen_random_uuid(),
  ref              text not null unique,
  season_id        text not null references seasons(id),
  misis            text not null check (misis ~ '^[A-Z0-9]{4,20}$'),   -- not checked against the Master List
  buyer_name       text not null,
  buyer_email      text,
  channel          text not null check (channel in ('online', 'counter')),
  status           text not null check (status in ('pending_payment', 'paid', 'cancelled', 'expired')),
  amount_aed       numeric(10,2) not null check (amount_aed >= 0),
  payment_method   text,
  payment_ref      text,
  needs_attention  text,
  collected        boolean not null default false,
  collected_by     text,
  collected_at     timestamptz,
  expires_at       timestamptz,
  paid_at          timestamptz,
  created_by       text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (not collected or status = 'paid')
);
create index merch_orders_season on merch_orders (season_id, status);
create index merch_orders_misis on merch_orders (season_id, misis);

create table merch_order_lines (
  order_id    uuid not null references merch_orders(id),
  item_id     bigint not null references merch_items(id),
  item_name   text not null,
  quantity    int not null check (quantity between 1 and 50),
  unit_price  numeric(10,2) not null check (unit_price >= 0),
  primary key (order_id, item_id)
);

create table reconciliation_uploads (
  id           bigserial primary key,
  season_id    text not null references seasons(id),
  kind         text not null check (kind in ('sap_balance', 'sap_invoice')),
  filename     text not null,
  row_count    int not null default 0,
  uploaded_by  text not null,
  created_at   timestamptz not null default now()
);

create table reconciliation_lines (
  id           bigserial primary key,
  upload_id    bigint not null references reconciliation_uploads(id),
  reference    text,
  misis        text,
  amount_aed   numeric(10,2),
  line_date    date,
  description  text,
  raw          jsonb not null default '{}'::jsonb
);
create index reconciliation_lines_ref on reconciliation_lines (reference);

create table email_templates (
  key         text primary key,
  subject     text not null,
  body        text not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

create table email_outbox (
  id               bigserial primary key,
  to_address       text not null,
  subject          text not null,
  body             text not null,
  template         text,
  status           text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts         int not null default 0,
  last_error       text,
  next_attempt_at  timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  sent_at          timestamptz
);
create index email_outbox_due on email_outbox (status, next_attempt_at);

create table scheduled_jobs (
  name           text primary key,
  label          text not null,
  schedule_text  text not null,
  paused         boolean not null default false,
  last_run_at    timestamptz,
  last_status    text,
  last_message   text
);

create table scheduled_job_runs (
  id           bigserial primary key,
  job          text not null references scheduled_jobs(name),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null default 'running' check (status in ('running', 'ok', 'failed', 'skipped')),
  message      text
);
create index scheduled_job_runs_job on scheduled_job_runs (job, started_at desc);

-- Connection secrets replaced from Technical Settings. Stored only as AES-256-GCM ciphertext; the key lives
-- in the environment (APP_ENCRYPTION_KEY), never here. Secrets are write-only: no screen ever reads them back.
create table app_secrets (
  key         text primary key check (key in ('CCAVENUE_MERCHANT_ID', 'CCAVENUE_ACCESS_CODE', 'CCAVENUE_WORKING_KEY', 'SMTP_PASSWORD')),
  ciphertext  text not null,
  updated_by  text not null,
  updated_at  timestamptz not null default now()
);

insert into scheduled_jobs (name, label, schedule_text) values
  ('release_holds',     'Release expired holds',               'Every minute'),
  ('email_outbox',      'Send queued emails (with retry)',     'Every 5 minutes'),
  ('package_reminder',  'Package collection reminder',         'Daily'),
  ('payment_compare',   'Daily payment comparison with SAP',   'Daily'),
  ('backup_check',      'Daily backup check',                  'Daily'),
  ('season_close',      'Season close tasks',                  'Daily');

create trigger merch_items_touch before update on merch_items for each row execute function touch_updated_at();
create trigger merch_orders_touch before update on merch_orders for each row execute function touch_updated_at();
