# MDX Dubai Graduation System

One system for the whole graduation operation at Middlesex University Dubai: ticket sales, guest **zones**, payments, e-tickets,
two-door scanning, merchandise, package collection and staff administration. One codebase, one PostgreSQL database, one set of
business rules (in the database), one sign-in, one audit log.

- **Spec:** [`docs/SYSTEM.md`](docs/SYSTEM.md) (build specification v1.0)
- **Decisions that change the spec** (zones instead of seat numbers, and other choices): [`docs/DECISIONS.md`](docs/DECISIONS.md)
- **Stack:** Next.js 16 (App Router, TypeScript strict) · PostgreSQL 15+ (rules as SQL functions) · `pg` · CCAvenue · Microsoft Entra ID · SMTP
- **Hosting:** testing on Supabase (database only) + Vercel; production on Azure UAE North (container + Azure Database for PostgreSQL)

---

## What is in the box

| Area | Where |
|---|---|
| Public site: home and ticket box, sign-in (MISIS + emailed code), zone booking with live places-left counts, payment, My E-Tickets (share, email, image, PDF, name-change and transfer requests), receipt redemption, extra ticket codes and requests, pay for a student, merchandise shop, public ticket page `/t/<token>` | `app/(public)`, `app/t` |
| Staff back office: Dashboard, Master List, Finance Entry (7 tabs incl. Needs Attention), Financial Hold, Reconciliation, Graduation Day Payments, E-Tickets and Seating (Issued, Seating Plan, Hall Layout, Transfers, Name Changes), Live Seating, Entry Check-In, Package Collection, Merchandise, Extra Tickets, DAR allocation, Potential Graduates, Scanner, Technical Settings (12 sections), Admin Access (8 headings), Version Changes | `app/admin` |
| Business rules (eligibility, limits, zone capacity with row locks, holds, payments, receipts, transfers, reissue, two-door scanning, never-delete triggers, row level security) | `db/migrations/*.sql` |
| Automated tests of every rule (in-memory PostgreSQL, no server needed) | `db/tests/rules.test.mjs` |
| Fictional demo data (4 seasons, 100 graduates, staff in every role, demo cases from the prototype) | `db/seed/demo.sql` |
| Sign-in (sessions, student codes, Microsoft OIDC) | `lib/auth/` |
| Payment gateway adapter (CCAvenue only lives here) | `lib/payments/ccavenue.ts` |
| Email adapter and outbox with retry; editable templates | `lib/email/` |
| Scheduled jobs | `lib/jobs.ts`, `app/api/cron/tick`, `.github/workflows/graduation-scheduler.yml` |
| Container and local database | `Dockerfile`, `docker-compose.yml` |

---

## 1. Run it on your computer

You need **Node.js 22** and a PostgreSQL database (Docker Desktop is easiest).

```bash
cd graduation-system
npm install
cp .env.example .env.local
docker compose up -d db
npm run db:migrate
npm run db:seed
npm run test:db
npm run dev
```

Open http://localhost:3000. Staff back office: http://localhost:3000/staff/login → **Test mode: Staff View** → pick someone
(for example *F. Akter · Technical Super Admin*). Student view: sign in with `M00123457` on the home page; in Test mode with
`EMAIL_PROVIDER=log` the code is shown on screen. Demo IDs:

| MISIS | Demo case |
|---|---|
| M00123456 | 1 graduate + 1 guest, e-tickets issued, extra ticket and name change requests waiting |
| M00123457 | Eligible, nothing bought |
| M00123458 | 1 graduate + 2 guests, can buy 2 more; a transfer request is waiting |
| M00123459 | Financial hold |
| M00123461 | Potential graduate, not yet confirmed |
| M00123462 | Graduate ticket only, package collected |
| M00987001 | Paid at the counter, receipt **RC482193**, zone and names still to choose |

---

## 2. GitHub

The code lives in the `graduation-system/` folder of this repository (the old single-file prototype stays at the root).

1. Commit and push:
   ```bash
   git add graduation-system .github
   git commit -m "Graduation ticketing system v1"
   git push
   ```
2. **CI** (`.github/workflows/graduation-ci.yml`) runs on every push: business-rule tests, type check, build.
3. Add repository secrets (*Settings → Secrets and variables → Actions*):

| Secret | Used by | Value |
|---|---|---|
| `DATABASE_URL_DIRECT` | migrations workflow | Supabase **direct** or **session pooler** connection string (port 5432) |
| `SITE_URL` | scheduler workflow | `https://<your-vercel-or-university-domain>` |
| `CRON_SECRET` | scheduler workflow | same value as `CRON_SECRET` in Vercel |

4. After the first `npm install`, commit `package-lock.json` too, so CI and Vercel install exactly the same versions.

---

## 3. Supabase (testing environment: database only)

The system uses Supabase **only as a PostgreSQL host**. It does not use Supabase Auth, Storage, Realtime or the Data API,
so moving to Azure later changes nothing in the business logic. **Fictional data only** in this environment.

1. Go to supabase.com → **New project**. There is no UAE region: choose the closest one your IT/data policy allows (for example Mumbai or Frankfurt). Save the database password.
2. **Database → Extensions** → enable **pg_cron** (optional but recommended: it releases expired holds every minute inside the database).
3. **Project Settings → Database → Connection string**:
   - **Transaction pooler** (port **6543**) → this is `DATABASE_URL` for Vercel.
   - **Session pooler** or **Direct connection** (port **5432**) → this is `DATABASE_URL_DIRECT` for migrations.
   Replace `[YOUR-PASSWORD]` in both.
4. Create the tables and rules, using **one** of:
   - **GitHub:** Actions → *Graduation system - apply database migrations* → **Run workflow** (tick *demo data* for testing).
   - **Your computer:** put `DATABASE_URL=<direct url>` and `DATABASE_SSL=require` in `.env.local`, then `npm run db:migrate` and `npm run db:seed`.
   - **SQL Editor:** paste and run each file in `db/migrations/` in number order (0001 → 0011), then `db/seed/demo.sql`.
5. Optional hardening: **Project Settings → API → Data API** → turn it off. (Even when on, row level security with no policies and revoked grants mean the public API can read or call nothing.)
6. Before real sales: upgrade to **Pro** and enable **Point-in-Time Recovery**, then do a test restore.

---

## 4. Vercel

1. vercel.com → **Add New → Project → Import** this GitHub repository.
2. **Root Directory:** `graduation-system` (important). Framework preset: Next.js.
3. **Environment Variables** (Production and Preview):

| Name | Value |
|---|---|
| `DATABASE_URL` | Supabase transaction pooler URL (port 6543). If the password has special characters (`@ # / ? %`), URL-encode them |
| `DATABASE_SSL` | `require` |
| `NEXT_PUBLIC_SITE_URL` | `https://<project>.vercel.app` or your university domain |
| `APP_SECRET` | 48+ random characters (`openssl rand -base64 48`). Never change it after go-live (it also encrypts secrets saved in Technical Settings) |
| `CRON_SECRET` | random string; also a GitHub secret |
| `ALLOW_TEST_SHORTCUTS` | `true` while testing; **remove** for production |
| `PAYMENT_MODE` | `simulate` while testing; `ccavenue` with the CCAvenue test account; `ccavenue` + `CCAVENUE_ENV=live` for real sales |
| `CCAVENUE_ENV` | `test` or `live` |
| `CCAVENUE_MERCHANT_ID`, `CCAVENUE_ACCESS_CODE`, `CCAVENUE_WORKING_KEY` | from Finance's CCAvenue account (or set them later in Technical Settings) |
| `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, `ENTRA_CLIENT_SECRET` | from section 5 |
| `EMAIL_PROVIDER` | `log` (nothing is sent) or `smtp` |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM` | your mail relay |

4. **Deploy.** Every push to `main` redeploys.
5. Optional: **Settings → Domains** → add e.g. `graduation.mdx.ac.ae`, ask IT for the DNS record, then update `NEXT_PUBLIC_SITE_URL` and the redirect URLs in Entra and CCAvenue.
6. Scheduler: `vercel.json` runs `/api/cron/tick` once a day (allowed on every plan). The GitHub workflow *Graduation system - scheduler* calls it every 5 minutes for email retries (Vercel Pro can instead run the cron every few minutes).

---

## 5. Microsoft sign-in for staff (Entra ID)

1. Azure Portal → **Microsoft Entra ID → App registrations → New registration**.
   - Supported account types: **Accounts in this organizational directory only** (single tenant).
   - Redirect URI (Web): `https://<your-domain>/api/auth/microsoft/callback` (add `http://localhost:3000/api/auth/microsoft/callback` for local testing).
2. **Certificates & secrets → New client secret** → copy the *Value* → `ENTRA_CLIENT_SECRET`.
3. **Overview** → copy *Application (client) ID* → `ENTRA_CLIENT_ID`, and *Directory (tenant) ID* → `ENTRA_TENANT_ID`.
4. **Token configuration → Add optional claim → ID token → email**.
5. Staff can sign in only if their `@mdx.ac.ae` email is an active user in **Admin Access → User Access**. Role and permissions come from the database.
6. If IT cannot enable this in time: Technical Settings → Feature Switches → *Fallback staff sign-in with a password*. New and re-invited users then get a 24-hour one-time link to set a password (nobody can see it).

---

## 6. CCAvenue

1. Ask Finance for the CCAvenue (UAE) **test** merchant account: Merchant ID, Access Code, Working Key.
2. In the CCAvenue merchant dashboard, register the website URL and set the redirect/cancel URL to `https://<your-domain>/api/pay/ccavenue/response`.
3. Set `PAYMENT_MODE=ccavenue`, `CCAVENUE_ENV=test` and the three credentials (Vercel, or Technical Settings → Connection Settings, which stores them encrypted and never shows them again). Press **Test Connections**.
4. Make test payments for tickets, merchandise and a third-party payment. Check *Finance Entry → Online Payments Live* and *Needs Attention*.
5. Go live: live credentials, `CCAVENUE_ENV=live`, Technical Settings → switch to **LIVE**. Make one real small payment and refund it in CCAvenue.
6. All gateway code is in `lib/payments/ccavenue.ts`. **Confirm the exact field names against CCAvenue's current integration document with Finance before go-live** (the standard encRequest/encResp AES scheme is implemented).

---

## 7. Email

`EMAIL_PROVIDER=smtp` with the university Microsoft 365 relay or a provider (SendGrid, Postmark, Resend SMTP). Every email
goes through the outbox table first and is retried by the scheduler, so a mail failure never blocks a payment.
Wording is editable in **Technical Settings → Email Templates**. Check that sign-in codes do not land in junk mail.

---

## 8. First run and go-live checklist

- [ ] Migrations applied; demo data only in the testing database.
- [ ] Sign in (Test mode Staff View or Microsoft) as a super admin; in **Admin Access → User Access** add the real team with the right role presets.
- [ ] **Admin Access**: season, ceremonies (dates and times), prices, guest limit, hall layout and zones (doors, capacities, wheelchair spaces), programme map, merchandise items, shop close date.
- [ ] **Master List** upload (CSV), Finance holds and clearance requests, DAR confirmation and allocation.
- [ ] Email templates checked; SMTP sending to student mailboxes.
- [ ] CCAvenue test payments pass; then live credentials.
- [ ] Load test (~500 people booking at once) and a scanning rehearsal with real phones at the venue (≥ 200 scans at both doors).
- [ ] Backup restore tested.
- [ ] `ALLOW_TEST_SHORTCUTS` removed, Technical Settings → **LIVE**, Feature Switches → **Ticket sales** on at the announced time.
- [ ] Watch **Finance Entry → Needs Attention** during the sales window.

---

## 9. Moving to Azure UAE North (production)

- **Database:** Azure Database for PostgreSQL – Flexible Server (PostgreSQL 16), UAE North, automated backups with point-in-time restore. Allow-list `pg_cron` in *Server parameters* (azure.extensions and shared_preload_libraries) if you want the in-database minute job. Run `node scripts/migrate.mjs` against it (from the container or a build agent). Do **not** run the demo seed.
- **App:** build the `Dockerfile` (it sets Next.js standalone output) and run it on Azure Container Apps or App Service for Containers. Same environment variables; secrets from **Azure Key Vault** references.
- **Scheduler:** an Azure timer (Logic App or Container Apps job) calling `GET /api/cron/tick` with `Authorization: Bearer <CRON_SECRET>` every few minutes.
- **Sign-in:** unchanged (Entra ID). Update redirect URIs to the new domain. Nothing else changes: business rules live in the database, and the only vendor-specific code is in `lib/auth/`, `lib/payments/` and `lib/email/`.
- Real student data must not be loaded into the testing environment.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build / run |
| `npm run typecheck` | TypeScript strict check |
| `npm run test:db` | Business-rule tests on an in-memory PostgreSQL |
| `npm run db:migrate` | Apply `db/migrations` (uses `DATABASE_URL_DIRECT` if set) |
| `npm run db:seed` | Load the fictional demo data (refused in Live mode) |
