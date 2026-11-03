-- Graduation Ticketing System · foundation
-- Plain PostgreSQL 15+. No vendor-specific features: the same files run on Supabase, Azure or a local container.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function forbid_change() returns trigger
language plpgsql as $$
begin
  raise exception 'Rows in % cannot be deleted or rewritten (use a status change instead)', tg_table_name
    using errcode = 'P0001';
end $$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- 244 random bits (two v4 UUIDs), URL-safe. Never derived from the student or the zone.
create or replace function new_token() returns text
language sql volatile as $$
  select translate(
    encode(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex'), 'base64'),
    '+/=', '-_')
$$;

-- Short human code from an unambiguous alphabet, e.g. new_code('RC', 8) -> 'RC7K3P9QXM'
create or replace function new_code(p_prefix text, p_len int) returns text
language plpgsql volatile as $$
declare
  a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea := decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex');
  r text := coalesce(p_prefix, '');
  i int;
begin
  for i in 0 .. least(p_len, 32) - 1 loop
    r := r || substr(a, 1 + (get_byte(b, i) % 32), 1);
  end loop;
  return r;
end $$;

create or replace function res_err(p_code text, p_extra jsonb default '{}'::jsonb) returns jsonb
language sql immutable as $$
  select jsonb_build_object('ok', false, 'error', p_code) || coalesce(p_extra, '{}'::jsonb)
$$;

-- ---------------------------------------------------------------------------
-- System-wide settings (one row). Season-specific settings live in season_settings.
-- ---------------------------------------------------------------------------
create table app_settings (
  id                       boolean primary key default true check (id),
  test_mode                boolean not null default true,
  maintenance_mode         boolean not null default false,
  maintenance_message      text    not null default 'The graduation ticket site is closed for maintenance. Please try again soon.',
  tech_admin_sees_revenue  boolean not null default false,
  manual_checkin_override  boolean not null default false,
  staff_password_login     boolean not null default false,
  student_email_domains    text    not null default 'mdx.ac.ae,live.mdx.ac.uk',
  otp_minutes              int     not null default 10 check (otp_minutes between 2 and 60),
  email_from               text    not null default 'MDX Dubai Graduation <graduation@mdx.ac.ae>',
  smtp_host                text,
  smtp_port                int,
  smtp_user                text,
  upload_rules             jsonb   not null default '{
    "master_list": ["misis", "email", "full_name"],
    "financial_hold": ["misis", "reason"],
    "programme_map": ["programme", "ceremony"],
    "sap_balance": ["reference", "amount"],
    "sap_invoice": ["reference", "amount"]
  }'::jsonb,
  updated_at               timestamptz not null default now()
);
insert into app_settings default values;

-- ---------------------------------------------------------------------------
-- Seasons. Every table that holds season data carries season_id.
-- ---------------------------------------------------------------------------
create table seasons (
  id          text primary key check (id ~ '^[A-Z0-9-]{3,20}$'),
  name        text not null,
  status      text not null default 'open' check (status in ('open', 'closed')),
  sort        int  not null default 0,
  cleaned_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table season_settings (
  season_id               text primary key references seasons(id),
  graduate_price_aed      numeric(10,2) not null default 0   check (graduate_price_aed >= 0),
  guest_price_aed         numeric(10,2) not null default 150 check (guest_price_aed >= 0),
  guest_limit             int  not null default 4  check (guest_limit between 0 and 20),
  hold_minutes            int  not null default 10 check (hold_minutes between 1 and 120),
  extra_code_hours        int  not null default 72 check (extra_code_hours between 1 and 720),
  sales_open              boolean not null default false,
  zone_selection_enabled  boolean not null default true,
  transfers_enabled       boolean not null default true,
  extra_requests_enabled  boolean not null default true,
  name_changes_enabled    boolean not null default true,
  merch_enabled           boolean not null default true,
  shop_close_date         date,
  reminder_enabled        boolean not null default false,
  reminder_days_before    int  not null default 3 check (reminder_days_before between 0 and 60),
  reminder_last_sent_on   date,
  venue_name              text not null default 'Graduation Hall',
  venue_area              text not null default '',
  graduate_capacity       int  not null default 250 check (graduate_capacity >= 0),
  sales_window_text       text not null default '',
  public_notice           text not null default '',
  updated_at              timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Logs
-- ---------------------------------------------------------------------------
create table audit_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  season_id  text,
  actor      text not null,
  action     text not null,
  category   text not null default 'general',
  misis      text,
  order_id   uuid,
  details    jsonb not null default '{}'::jsonb,
  reason     text
);
create index audit_log_season_at on audit_log (season_id, at desc);
create index audit_log_misis on audit_log (season_id, misis);

create table technical_change_log (
  id         bigserial primary key,
  at         timestamptz not null default now(),
  actor      text not null,
  area       text not null,
  setting    text not null,
  old_value  text,
  new_value  text
);

create table error_log (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  source   text not null,
  message  text not null,
  path     text,
  detail   jsonb not null default '{}'::jsonb
);
create index error_log_at on error_log (at desc);

create table rate_limits (
  key           text primary key,
  window_start  timestamptz not null,
  hits          int not null
);

create or replace function log_event(
  p_actor    text,
  p_action   text,
  p_category text  default 'general',
  p_season   text  default null,
  p_misis    text  default null,
  p_order    uuid  default null,
  p_details  jsonb default '{}'::jsonb,
  p_reason   text  default null
) returns void
language sql as $$
  insert into audit_log (season_id, actor, action, category, misis, order_id, details, reason)
  values (p_season, coalesce(p_actor, 'system'), p_action, coalesce(p_category, 'general'), p_misis, p_order,
          coalesce(p_details, '{}'::jsonb), p_reason);
$$;

-- true = allowed, false = over the limit for this window
create or replace function rate_limit_hit(p_key text, p_max int, p_window_seconds int) returns boolean
language plpgsql as $$
declare r rate_limits;
begin
  insert into rate_limits (key, window_start, hits) values (p_key, now(), 1)
  on conflict (key) do update set
    hits = case when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then 1 else rate_limits.hits + 1 end,
    window_start = case when rate_limits.window_start < now() - make_interval(secs => p_window_seconds) then now() else rate_limits.window_start end
  returning * into r;
  return r.hits <= p_max;
end $$;

create trigger app_settings_touch before update on app_settings for each row execute function touch_updated_at();
create trigger seasons_touch before update on seasons for each row execute function touch_updated_at();
create trigger season_settings_touch before update on season_settings for each row execute function touch_updated_at();
