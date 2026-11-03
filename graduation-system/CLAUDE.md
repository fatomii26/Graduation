# Project instructions

Middlesex University Dubai graduation ticketing system. Read `docs/SYSTEM.md` (the build specification) and
`docs/DECISIONS.md` (decisions that override it — most importantly **zones, not seat numbers**) before changing code.

- One system: one codebase, one PostgreSQL database, one set of rules, one sign-in, one audit log.
- Every business rule lives in a SQL function in `db/migrations/` and has a test in `db/tests/rules.test.mjs`. Add a new numbered migration; never edit an applied one.
- Pages hold no business rules. Server Actions and route handlers check permissions on the server (`requireStaff(...)`, `requireStudent(...)`).
- Orders, tickets, payments, scans, transfers and the audit log are never deleted; changes are status changes.
- Keep vendor code behind `lib/auth/`, `lib/payments/`, `lib/email/`. No Supabase-specific features in business logic.
- Times in Asia/Dubai, money in AED, English interface. Never use real student data in the testing environment.
- Next.js 16: `params`/`searchParams`/`cookies()`/`headers()` are async; page files may only export the page and Next config fields.
