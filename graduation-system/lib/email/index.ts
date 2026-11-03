import 'server-only';
import nodemailer, { type Transporter } from 'nodemailer';
import { one, sql } from '../db';
import { emailProvider } from '../config';
import { getAppSettings, getSecret } from '../settings';
import { TEMPLATES, render, type TemplateKey } from './templates';

// Every email goes through the outbox table first, so a mail failure never blocks a payment or a booking.
// Sending is attempted at once and retried by the scheduler (email_outbox job) with back-off.

export async function templateFor(key: TemplateKey) {
  const o = await one<{ subject: string; body: string }>('select subject, body from email_templates where key = $1', [key]);
  return o ?? { subject: TEMPLATES[key].subject, body: TEMPLATES[key].body };
}

export async function queueEmail(
  to: string | null | undefined,
  key: TemplateKey | null,
  vars: Record<string, string | number | null | undefined>,
  custom?: { subject: string; body: string },
  deliverNow = true,
): Promise<number | null> {
  const address = (to ?? '').trim().toLowerCase();
  if (!address.includes('@')) return null;
  const t = custom ?? (key ? await templateFor(key) : null);
  if (!t) return null;
  const row = await one<{ id: number }>(
    'insert into email_outbox (to_address, subject, body, template) values ($1, $2, $3, $4) returning id',
    [address, render(t.subject, vars).slice(0, 300), render(t.body, vars), key],
  );
  if (row && deliverNow) await deliver(row.id).catch(() => {});
  return row?.id ?? null;
}

let transport: { key: string; t: Transporter } | null = null;

async function smtp(): Promise<{ t: Transporter; from: string }> {
  const a = await getAppSettings();
  const host = a.smtp_host || process.env.SMTP_HOST;
  const port = Number(a.smtp_port || process.env.SMTP_PORT || 587);
  const user = a.smtp_user || process.env.SMTP_USER;
  const pass = await getSecret('SMTP_PASSWORD');
  if (!host) throw new Error('SMTP host is not set');
  const key = `${host}:${port}:${user}:${pass?.length}`;
  if (!transport || transport.key !== key) {
    transport = {
      key,
      t: nodemailer.createTransport({ host, port, secure: port === 465, auth: user ? { user, pass: pass ?? '' } : undefined }),
    };
  }
  return { t: transport.t, from: a.email_from || process.env.EMAIL_FROM || 'graduation@mdx.ac.ae' };
}

async function deliver(id: number) {
  const m = await one<{ id: number; to_address: string; subject: string; body: string; attempts: number }>(
    `update email_outbox set attempts = attempts + 1
      where id = $1 and status = 'queued' and next_attempt_at <= now()
      returning id, to_address, subject, body, attempts`,
    [id],
  );
  if (!m) return;
  try {
    if (emailProvider() === 'smtp') {
      const { t, from } = await smtp();
      await t.sendMail({ from, to: m.to_address, subject: m.subject, text: m.body });
    }
    await sql(`update email_outbox set status = 'sent', sent_at = now(), last_error = null where id = $1`, [m.id]);
  } catch (e) {
    const failed = m.attempts >= 6;
    await sql(
      `update email_outbox set status = $2, last_error = $3, next_attempt_at = now() + make_interval(mins => $4) where id = $1`,
      [m.id, failed ? 'failed' : 'queued', String((e as Error).message).slice(0, 500), 2 ** m.attempts],
    );
  }
}

export async function processOutbox(limit = 50): Promise<{ sent: number; failed: number }> {
  const due = await sql<{ id: number }>(
    `select id from email_outbox where status = 'queued' and next_attempt_at <= now() order by id limit $1`,
    [limit],
  );
  for (const d of due) await deliver(d.id).catch(() => {});
  const r = await one<{ sent: number; failed: number }>(
    `select count(*) filter (where status = 'sent' and id = any($1))::int as sent,
            count(*) filter (where status <> 'sent' and id = any($1))::int as failed
       from email_outbox where id = any($1)`,
    [due.map((d) => d.id)],
  );
  return r ?? { sent: 0, failed: 0 };
}

export async function testSmtp(): Promise<string> {
  if (emailProvider() !== 'smtp') return 'Email provider is "log": emails are kept in the outbox and not sent.';
  const { t } = await smtp();
  await t.verify();
  return 'SMTP connection works.';
}
