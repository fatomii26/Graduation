import 'server-only';
import { fn, one, sql } from './db';
import { processOutbox, queueEmail } from './email';
import { logError } from './audit';

// Scheduled jobs. The database marks each run, honours "paused", and Technical Settings can run any job now.
// Called every few minutes by /api/cron/tick (GitHub Actions, Vercel Cron or an Azure timer).

export const JOBS = ['release_holds', 'email_outbox', 'package_reminder', 'payment_compare', 'backup_check', 'season_close'] as const;
export type JobName = (typeof JOBS)[number];
const DAILY: JobName[] = ['package_reminder', 'payment_compare', 'backup_check', 'season_close'];

async function body(name: JobName): Promise<string> {
  switch (name) {
    case 'release_holds': {
      const n = await fn<number>('release_expired_holds', []);
      return `${n} unpaid booking(s) expired`;
    }
    case 'email_outbox': {
      const r = await processOutbox(100);
      return `${r.sent} sent, ${r.failed} still waiting`;
    }
    case 'package_reminder':
      return packageReminder();
    case 'payment_compare':
      return paymentCompare();
    case 'backup_check': {
      const r = await one<{ m: string | null; t: number }>(
        `select (select max(name) from schema_migrations) as m, (select count(*) from tickets) as t`,
      ).catch(() => one<{ m: string | null; t: number }>(`select null as m, (select count(*) from tickets) as t`));
      return `Database reachable (latest migration ${r?.m ?? 'unknown'}, ${r?.t ?? 0} tickets). Check point-in-time restore in the hosting console.`;
    }
    case 'season_close': {
      const r = await sql<{ id: string }>(
        `select s.id from seasons s where s.status = 'open'
            and (select max(starts_at) from ceremonies c where c.season_id = s.id) < now() - interval '30 days'`,
      );
      return r.length ? `Season(s) ${r.map((x) => x.id).join(', ')} ended over 30 days ago; close them in Admin Access.` : 'Nothing to close';
    }
  }
}

export async function runJob(name: JobName, force = false): Promise<{ status: string; message: string }> {
  const run = force
    ? (await one<{ id: number }>('insert into scheduled_job_runs (job) values ($1) returning id', [name]))?.id ?? null
    : await fn<number | null>('job_start', [name]);
  if (!run) return { status: 'skipped', message: 'Paused' };
  try {
    const message = await body(name);
    await fn('job_finish', [run, 'ok', message]);
    return { status: 'ok', message };
  } catch (e) {
    await fn('job_finish', [run, 'failed', String((e as Error).message)]);
    await logError(`job:${name}`, e);
    return { status: 'failed', message: String((e as Error).message) };
  }
}

/** Every tick: holds and email. Daily jobs: once per Dubai calendar day. */
export async function runDueJobs() {
  const out: Record<string, string> = {};
  for (const j of ['release_holds', 'email_outbox'] as JobName[]) out[j] = (await runJob(j)).status;
  const due = await sql<{ name: JobName }>(
    `select name from scheduled_jobs
      where name = any($1) and (last_run_at is null or (last_run_at at time zone 'Asia/Dubai')::date < (now() at time zone 'Asia/Dubai')::date)`,
    [DAILY],
  );
  for (const d of due) out[d.name] = (await runJob(d.name)).status;
  return out;
}

async function packageReminder(): Promise<string> {
  const seasons = await sql<{ season_id: string; days: number }>(
    `select ss.season_id, ss.reminder_days_before as days
       from season_settings ss join seasons s on s.id = ss.season_id
      where s.status = 'open' and ss.reminder_enabled
        and (ss.reminder_last_sent_on is null or ss.reminder_last_sent_on < (now() at time zone 'Asia/Dubai')::date)
        and exists (select 1 from ceremonies c where c.season_id = ss.season_id and c.starts_at is not null
                      and c.starts_at > now() and c.starts_at < now() + make_interval(days => ss.reminder_days_before + 1))`,
  );
  let sent = 0;
  for (const s of seasons) {
    const rows = await sql<{ email: string; full_name: string; misis: string; ceremony: string; cap: boolean | null; gown: boolean | null; scarf: boolean | null; name_card: boolean | null }>(
      `select g.email, g.full_name, g.misis, c.name as ceremony, p.cap, p.gown, p.scarf, p.name_card
         from graduates g join ceremonies c on c.id = g.ceremony_id
         left join package_collections p on p.season_id = g.season_id and p.misis = g.misis
        where g.season_id = $1 and c.starts_at > now() and c.starts_at < now() + make_interval(days => $2 + 1)
          and exists (select 1 from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.kind = 'graduate' and t.status = 'valid')
          and not (coalesce(p.cap, false) and coalesce(p.gown, false) and coalesce(p.scarf, false) and coalesce(p.name_card, false))`,
      [s.season_id, s.days],
    );
    for (const r of rows) {
      const items = [!r.cap && 'cap', !r.gown && 'gown', !r.scarf && 'scarf', !r.name_card && 'name card'].filter(Boolean).join(', ');
      await queueEmail(r.email, 'package_reminder', { name: r.full_name, misis: r.misis, ceremony: r.ceremony, items });
      sent++;
    }
    await sql(`update season_settings set reminder_last_sent_on = (now() at time zone 'Asia/Dubai')::date where season_id = $1`, [s.season_id]);
  }
  return `${sent} reminder(s) queued`;
}

async function paymentCompare(): Promise<string> {
  const r = await one<{ missing: number; diff: number }>(
    `with p as (
       select reference, sum(amount_aed) as amount from payments
        where channel in ('counter', 'graduation_day', 'online', 'third_party', 'merch_counter', 'merch_online') and reference is not null
          and season_id in (select id from seasons where status = 'open') group by reference),
     l as (select reference, sum(amount_aed) as amount from reconciliation_lines where reference is not null group by reference)
     select count(*) filter (where l.reference is null)::int as missing,
            count(*) filter (where l.reference is not null and l.amount <> p.amount)::int as diff
       from p left join l on l.reference = p.reference`,
  );
  return `${r?.missing ?? 0} payment(s) not yet in SAP files, ${r?.diff ?? 0} amount difference(s)`;
}
