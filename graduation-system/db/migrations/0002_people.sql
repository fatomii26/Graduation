-- Ceremonies, zones (hall layout), graduates, financial holds, staff, permissions, sign-in

-- ---------------------------------------------------------------------------
-- Ceremonies: all ceremonies of a season use the same hall, one after the other
-- ---------------------------------------------------------------------------
create table ceremonies (
  id                 bigserial primary key,
  season_id          text not null references seasons(id),
  number             int  not null check (number between 1 and 20),
  name               text not null,
  starts_at          timestamptz,
  doors_open_at      timestamptz,
  graduate_entrance  text not null default 'Graduate entrance',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (season_id, number)
);

-- Guest zones of the season's hall. Each zone has its own door (Door 2) and a capacity per ceremony.
create table zones (
  id                   bigserial primary key,
  season_id            text not null references seasons(id),
  code                 text not null check (code ~ '^[A-Z0-9]{1,4}$'),
  name                 text not null,
  door                 text not null check (length(trim(door)) between 1 and 40),
  color                text not null default '#7A1128' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  capacity             int  not null check (capacity >= 0),
  wheelchair_capacity  int  not null default 0 check (wheelchair_capacity >= 0),
  sort                 int  not null default 0,
  active               boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (season_id, code)
);

create table programme_ceremony_map (
  season_id        text not null references seasons(id),
  programme        text not null,
  ceremony_number  int  not null check (ceremony_number between 1 and 20),
  updated_at       timestamptz not null default now(),
  primary key (season_id, programme)
);

-- ---------------------------------------------------------------------------
-- Master List
-- ---------------------------------------------------------------------------
create table graduates (
  id                       bigserial primary key,
  season_id                text not null references seasons(id),
  misis                    text not null check (misis ~ '^[A-Z0-9]{4,20}$'),
  email                    text not null check (email = lower(email) and position('@' in email) > 1),
  private_email            text check (private_email is null or position('@' in private_email) > 1),
  mobile                   text,
  full_name                text not null check (length(trim(full_name)) between 1 and 120),
  programme                text not null default '',
  potential_graduate       boolean not null default true,
  confirmed_graduate       boolean not null default false,
  financial_hold           boolean not null default false,
  finance_request_sent_at  timestamptz,
  ceremony_id              bigint references ceremonies(id),
  max_guests               int check (max_guests between 0 and 20),
  grad_seat_label          text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (season_id, misis),
  unique (season_id, email)
);
create index graduates_ceremony on graduates (ceremony_id);

-- Rule 2: a student can be allocated to a ceremony only when confirmed, free of hold, and Finance has sent the request.
-- A graduate who already holds tickets cannot be moved to another ceremony.
create or replace function graduates_allocation_guard() returns trigger
language plpgsql as $$
begin
  if new.ceremony_id is not null and (tg_op = 'INSERT' or new.ceremony_id is distinct from old.ceremony_id) then
    if not new.confirmed_graduate or new.financial_hold or new.finance_request_sent_at is null then
      raise exception 'allocation_not_allowed' using errcode = 'P0001',
        hint = 'A graduate must be confirmed, free of financial hold and cleared by Finance before ceremony allocation';
    end if;
    if not exists (select 1 from ceremonies c where c.id = new.ceremony_id and c.season_id = new.season_id) then
      raise exception 'ceremony_not_in_season' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.ceremony_id is distinct from old.ceremony_id
     and exists (select 1 from tickets t where t.season_id = old.season_id and t.misis = old.misis and t.status = 'valid') then
    raise exception 'has_tickets' using errcode = 'P0001', hint = 'This graduate already holds tickets for their ceremony';
  end if;
  return new;
end $$;

create table financial_holds (
  id               bigserial primary key,
  season_id        text not null references seasons(id),
  misis            text not null,
  reason           text not null check (length(trim(reason)) between 2 and 300),
  amount_aed       numeric(10,2),
  status           text not null default 'active' check (status in ('active', 'removed')),
  created_by       text not null,
  created_at       timestamptz not null default now(),
  removed_by       text,
  removed_at       timestamptz,
  removal_note     text,
  dar_notified_at  timestamptz,
  foreign key (season_id, misis) references graduates (season_id, misis)
);
create unique index financial_holds_one_active on financial_holds (season_id, misis) where status = 'active';

-- ---------------------------------------------------------------------------
-- Staff, roles and permissions
-- ---------------------------------------------------------------------------
create table permissions (
  key    text primary key,
  label  text not null,
  grp    text not null,
  sort   int  not null default 0
);

create table roles (
  name         text primary key,
  description  text not null default '',
  sort         int  not null default 0
);

create table role_permissions (
  role        text not null references roles(name),
  permission  text not null references permissions(key),
  primary key (role, permission)
);

create table staff (
  email          text primary key check (email = lower(email) and email ~ '^[a-z0-9._%+-]+@mdx\.ac\.ae$'),
  full_name      text not null check (length(trim(full_name)) between 2 and 120),
  job_title      text not null default '',
  department     text not null check (department in ('Finance', 'Marketing', 'DAR and Campus Central', 'Events Team', 'IT', 'Security', 'Other')),
  role           text not null references roles(name),
  status         text not null default 'invited' check (status in ('invited', 'active', 'paused', 'removed')),
  all_seasons    boolean not null default true,
  seasons        text[] not null default '{}',
  password_hash  text,
  invited_at     timestamptz not null default now(),
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Individual overrides on top of the role preset (allowed = true adds, false removes)
create table staff_permissions (
  email       text not null references staff(email),
  permission  text not null references permissions(key),
  allowed     boolean not null,
  primary key (email, permission)
);

-- Effective permissions for one person. Revenue is never given to Marketing, Events or Security,
-- and to the Technical Super Admin only when the system setting allows it.
create or replace function effective_permissions(p_email text) returns text[]
language sql stable as $$
  with s as (select * from staff where email = lower(p_email) and status = 'active'),
  base as (
    select rp.permission p from s join role_permissions rp on rp.role = s.role
     where not exists (select 1 from staff_permissions sp where sp.email = s.email and sp.permission = rp.permission and not sp.allowed)
    union
    select sp.permission from s join staff_permissions sp on sp.email = s.email where sp.allowed
    union
    select 'view_revenue' from s, app_settings a where s.role = 'Technical Super Admin' and a.tech_admin_sees_revenue
  )
  select coalesce(array_agg(distinct p order by p), '{}')
    from base, s
   where not (p = 'view_revenue' and (s.role in ('Super Admin (Marketing)', 'Marketing', 'Events Team', 'Security')
                                       or s.department in ('Marketing', 'Events Team', 'Security')))
$$;

-- ---------------------------------------------------------------------------
-- Sign-in: sessions, attempts, student codes, staff one-time links
-- ---------------------------------------------------------------------------
create table sessions (
  id_hash       text primary key,
  kind          text not null check (kind in ('staff', 'student')),
  subject       text not null,               -- staff email, or MISIS for students
  season_id     text references seasons(id),
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  revoked_by    text,
  ip            text,
  user_agent    text
);
create index sessions_subject on sessions (kind, subject);

create table login_attempts (
  id       bigserial primary key,
  at       timestamptz not null default now(),
  kind     text not null,
  subject  text not null,
  ok       boolean not null,
  method   text not null,
  reason   text,
  ip       text
);
create index login_attempts_at on login_attempts (at desc);

create table otp_codes (
  id          bigserial primary key,
  season_id   text not null references seasons(id),
  misis       text not null,
  code_hash   text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  attempts    int not null default 0,
  created_at  timestamptz not null default now()
);
create index otp_codes_lookup on otp_codes (season_id, misis, created_at desc);

create table staff_tokens (
  token_hash  text primary key,
  email       text not null references staff(email),
  purpose     text not null check (purpose in ('set_password')),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_by  text not null,
  created_at  timestamptz not null default now()
);

create trigger ceremonies_touch before update on ceremonies for each row execute function touch_updated_at();
create trigger zones_touch before update on zones for each row execute function touch_updated_at();
create trigger graduates_touch before update on graduates for each row execute function touch_updated_at();
create trigger staff_touch before update on staff for each row execute function touch_updated_at();
