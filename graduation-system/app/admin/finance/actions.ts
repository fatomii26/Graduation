'use server';
import { fn, one, sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { siteUrl } from '@/lib/config';
import { queueEmail } from '@/lib/email';
import { recordGatewayResult } from '@/lib/payments';
import { aed, normMisis, ticketsText } from '@/lib/format';
import { errorText } from '@/lib/errors';
import { backPath, bool, fail, finish, int, num, ok, str } from '@/lib/forms';

async function emailReceipt(season: string, receipt: string) {
  const r = await one<{ email: string; full_name: string; misis: string; includes_graduate: boolean; guest_count: number; amount_aed: number }>(
    `select g.email, g.full_name, g.misis, r.includes_graduate, r.guest_count, r.amount_aed
       from receipts r join graduates g on g.season_id = r.season_id and g.misis = r.misis
      where r.receipt_number = $1 and r.season_id = $2`,
    [receipt, season],
  );
  if (!r) return null;
  await queueEmail(r.email, 'receipt_number', {
    name: r.full_name, misis: r.misis, receipt, tickets: ticketsText(r.includes_graduate, r.guest_count), paid: aed(r.amount_aed), link: `${siteUrl()}/receipt`,
  });
  return r.email;
}

export async function counterPaymentAction(fd: FormData) {
  const source = str(fd, 'source') === 'graduation_day' ? 'graduation_day' : 'counter';
  const staff = await requireStaff(source === 'graduation_day' ? 'graduation_day_payments' : 'finance_entry');
  const back = backPath(fd, '/admin/finance');
  const misis = normMisis(str(fd, 'misis', 20));
  const r = await fn('record_counter_payment', [
    staff.season.id, misis, bool(fd, 'graduate'), int(fd, 'guests') ?? 0, num(fd, 'amount'), str(fd, 'method', 40), source, str(fd, 'payer_name', 120), staff.email,
  ]);
  if (!r.ok) fail(back, `${errorText(r.error)}${r.expected !== undefined ? ` Expected ${aed(Number(r.expected))}.` : ''}`);
  const to = await emailReceipt(staff.season.id, String(r.receipt_number));
  ok(back, `Payment of ${aed(Number(r.amount))} recorded. Receipt ${r.receipt_number} emailed to ${to}. The student redeems it on the public page to choose the zone.`);
}

export async function resendReceiptAction(fd: FormData) {
  const staff = await requireStaff('finance_entry', 'graduation_day_payments');
  const back = backPath(fd, '/admin/finance?tab=receipts');
  const to = await emailReceipt(staff.season.id, str(fd, 'receipt', 20));
  if (!to) fail(back, errorText('receipt_invalid'));
  await fn('log_event', [staff.email, 'receipt_resent', 'finance', staff.season.id, null, null, JSON.stringify({ receipt: str(fd, 'receipt', 20) }), null]);
  ok(back, `Receipt emailed again to ${to}.`);
}

export async function voidReceiptAction(fd: FormData) {
  const staff = await requireStaff('finance_entry');
  const back = backPath(fd, '/admin/finance?tab=receipts');
  finish(back, await fn('void_receipt', [str(fd, 'receipt', 20), str(fd, 'reason', 300), staff.email]), 'Receipt voided. Refund the money outside the system if needed.');
}

export async function attentionToReceiptAction(fd: FormData) {
  const staff = await requireStaff('finance_entry');
  const back = backPath(fd, '/admin/finance?tab=attention');
  const r = await fn('attention_to_receipt', [str(fd, 'order', 40), staff.email]);
  if (!r.ok) fail(back, errorText(r.error));
  if (r.receipt_number) {
    const to = await emailReceipt(staff.season.id, String(r.receipt_number));
    ok(back, `Converted to receipt ${r.receipt_number} and emailed to ${to}.`);
  }
  ok(back, 'Marked as resolved.');
}

export async function resolveAttentionAction(fd: FormData) {
  const staff = await requireStaff('finance_entry', 'merchandise');
  const back = backPath(fd, '/admin/finance?tab=attention');
  finish(back, await fn('resolve_attention', [str(fd, 'order', 40), str(fd, 'note', 300), staff.email]), 'Marked as resolved.');
}

/** Finance confirms a payment the gateway did not report (verified in the CCAvenue dashboard). Same rules as the callback. */
export async function manualPaidAction(fd: FormData) {
  const staff = await requireStaff('finance_entry');
  const back = backPath(fd, '/admin/finance?tab=online');
  const id = str(fd, 'order', 40);
  const ref = str(fd, 'reference', 80);
  if (ref.length < 4) fail(back, 'Enter the CCAvenue tracking or bank reference.');
  const o = await one<{ amount_aed: number }>('select amount_aed from orders where id::text = $1 and season_id = $2', [id, staff.season.id]);
  if (!o) fail(back, errorText('no_such_order'));
  const r = await recordGatewayResult({
    eventKey: `manual:${id}:${ref}`, gateway: 'manual', target: 'ticket', orderId: id, status: 'paid',
    amount: num(fd, 'amount') ?? o.amount_aed, gatewayRef: ref, payload: { recorded_by: staff.email }, actor: staff.email,
  });
  finish(back, r, r.attention ? 'Payment recorded; the order needs attention (zone full).' : 'Payment recorded and tickets issued.');
}

export async function emailStudentsAction(fd: FormData) {
  const staff = await requireStaff('finance_entry');
  const back = backPath(fd, '/admin/finance?tab=email');
  const subject = str(fd, 'subject', 200);
  const body = str(fd, 'body', 8000);
  if (subject.length < 3 || body.length < 5) fail(back, 'Enter a subject and a message.');
  const audience = str(fd, 'audience', 20);
  const S = staff.season.id;
  const where =
    audience === 'one' ? `g.misis = $2`
    : audience === 'ceremony' ? `c.number = $2::int`
    : audience === 'no_tickets' ? `eligibility(g.season_id, g.misis) is null and not exists (select 1 from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.status = 'valid')`
    : audience === 'hold' ? `g.financial_hold`
    : `true`;
  const arg = audience === 'one' ? normMisis(str(fd, 'misis', 20)) : audience === 'ceremony' ? String(int(fd, 'ceremony') ?? 0) : null;
  const rows = await sql<{ email: string; full_name: string; misis: string; ceremony: string | null; tickets: number }>(
    `select g.email, g.full_name, g.misis, c.name as ceremony,
            (select count(*) from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.status = 'valid')::int as tickets
       from graduates g left join ceremonies c on c.id = g.ceremony_id
      where g.season_id = $1 and ${where} limit 5000`,
    arg === null ? [S] : [S, arg],
  );
  if (!rows.length) fail(back, 'No students match.');
  for (const r of rows) {
    await queueEmail(r.email, null, { name: r.full_name, misis: r.misis, ceremony: r.ceremony ?? '', tickets: `${r.tickets} ticket(s)` }, { subject, body }, false);
  }
  await fn('log_event', [staff.email, 'students_emailed', 'finance', S, null, null, JSON.stringify({ audience, count: rows.length, subject }), null]);
  ok(back, `${rows.length} email(s) queued.`);
}
