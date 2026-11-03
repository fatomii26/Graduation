'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { fn, one, type FnResult } from '@/lib/db';
import { sealCookie, openCookie } from '@/lib/crypto';
import { secureCookies, siteUrl } from '@/lib/config';
import { sendCode, verifyCode } from '@/lib/auth/otp';
import { clientIp, createSession } from '@/lib/auth/session';
import { requireStudent } from '@/lib/auth/student';
import { currentPublicSeason, simulateAllowed } from '@/lib/settings';
import { recordGatewayResult } from '@/lib/payments';
import { queueEmail } from '@/lib/email';
import { errorText } from '@/lib/errors';
import { bool, fail, int, ok, str, withMessage } from '@/lib/forms';

export type Pending = { misis: string; season: string | null; email: string | null; testCode?: string; next: string };

const safeNext = (s: string) => (s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') ? s : '/book');

function describe(r: FnResult): string {
  const base = errorText(r.error);
  if (r.error === 'zone_full' || r.error === 'no_wheelchair_space') return `${base} ${r.zone_name ?? ''}: ${r.left ?? 0} left.`;
  if (r.error === 'limit_reached' && r.limit !== undefined) return `${base} Your limit is ${r.limit} guest ticket(s)${r.committed !== undefined ? `, and ${r.committed} are already taken or on the way` : ''}.`;
  if (r.error === 'guest_count_mismatch') return `${base} (${r.expected} guest(s))`;
  return base;
}

type GuestIn = { name: string; zone_id: number | null; access: 'none' | 'wheelchair' | 'companion'; assist: boolean };

function parseGuests(raw: string): GuestIn[] {
  try {
    const list = JSON.parse(raw || '[]') as unknown[];
    if (!Array.isArray(list)) return [];
    return list.slice(0, 20).map((g) => {
      const o = (g ?? {}) as Record<string, unknown>;
      const access = ['wheelchair', 'companion'].includes(String(o.access)) ? (o.access as GuestIn['access']) : 'none';
      const zone = Number(o.zone_id);
      return {
        name: String(o.name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
        zone_id: Number.isInteger(zone) && zone > 0 ? zone : null,
        access,
        assist: o.assist === true,
      };
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Sign-in
// ---------------------------------------------------------------------------
export async function sendCodeAction(fd: FormData) {
  const next = safeNext(str(fd, 'next', 200));
  const r = await sendCode(str(fd, 'misis', 40));
  if (!r.ok) redirect(`/signin?next=${encodeURIComponent(next)}&err=${encodeURIComponent(errorText(r.error))}`);
  const pending: Pending = { misis: r.misis, season: r.season, email: r.email, testCode: r.testCode, next };
  (await cookies()).set('gs_otp', sealCookie(pending), { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/', maxAge: 900 });
  redirect(`/signin?step=code&next=${encodeURIComponent(next)}`);
}

export async function verifyCodeAction(fd: FormData) {
  const jar = await cookies();
  const p = openCookie<Pending>(jar.get('gs_otp')?.value);
  if (!p) redirect(`/signin?err=${encodeURIComponent('Your sign-in expired. Please start again.')}`);
  const r = await verifyCode(p.misis, p.season, str(fd, 'code', 6));
  if (!r.ok) redirect(`/signin?step=code&next=${encodeURIComponent(p.next)}&err=${encodeURIComponent(errorText(r.error))}`);
  await createSession('student', p.misis, p.season);
  jar.delete('gs_otp');
  redirect(safeNext(p.next));
}

// ---------------------------------------------------------------------------
// Booking (main, extra), receipts, cancellation
// ---------------------------------------------------------------------------
export async function bookAction(fd: FormData) {
  const kind = str(fd, 'kind') === 'extra' ? 'extra' : 'main';
  const code = str(fd, 'code', 20).toUpperCase() || null;
  const back = kind === 'extra' ? `/extra?code=${encodeURIComponent(code ?? '')}` : '/book';
  const st = await requireStudent(back);
  const r = await fn('book_order', [st.season_id, st.misis, kind, JSON.stringify(parseGuests(str(fd, 'guests', 20000))), code, `student:${st.misis}`]);
  if (!r.ok) fail(back, describe(r));
  if (r.paid) ok('/tickets', 'Your tickets are ready.');
  redirect(`/pay/${r.order_id}`);
}

export async function cancelOrderAction(fd: FormData) {
  const st = await requireStudent('/book');
  const r = await fn('cancel_order', [str(fd, 'order', 40), st.misis, `student:${st.misis}`]);
  if (!r.ok) fail('/book', describe(r));
  ok('/book', 'Your unpaid booking was cancelled and the places were released.');
}

export async function redeemAction(fd: FormData) {
  const receipt = str(fd, 'receipt', 20).toUpperCase();
  const back = `/receipt?receipt=${encodeURIComponent(receipt)}`;
  const st = await requireStudent(back);
  if (!(await fn<boolean>('rate_limit_hit', [`receipt:${st.misis}`, 15, 3600]))) fail(back, errorText('rate_limited'));
  const r = await fn('redeem_receipt', [st.season_id, st.misis, receipt, JSON.stringify(parseGuests(str(fd, 'guests', 20000))), `student:${st.misis}`]);
  if (!r.ok) fail(back, describe(r));
  ok('/tickets', 'Receipt redeemed. Your e-tickets are ready.');
}

export async function requestExtraAction(fd: FormData) {
  const st = await requireStudent('/extra');
  const r = await fn('request_extra_tickets', [st.season_id, st.misis, int(fd, 'guests'), str(fd, 'reason', 500), `student:${st.misis}`]);
  if (!r.ok) fail('/extra', describe(r));
  ok('/extra', 'Your request has been sent. Marketing will email you a code if it is approved.');
}

// ---------------------------------------------------------------------------
// Paid by someone else (no sign-in)
// ---------------------------------------------------------------------------
export async function thirdPartyAction(fd: FormData) {
  const back = '/pay-for-student';
  const season = await currentPublicSeason();
  if (!season) fail(back, errorText('no_such_season'));
  if (!(await fn<boolean>('rate_limit_hit', [`third:${await clientIp()}`, 20, 3600]))) fail(back, errorText('rate_limited'));
  const r = await fn('start_third_party_order', [
    season.id, str(fd, 'misis', 40), bool(fd, 'graduate'), int(fd, 'guests') ?? 0,
    str(fd, 'payer_name', 120), str(fd, 'payer_email', 200), str(fd, 'relation', 40), 'third_party',
  ]);
  if (!r.ok) fail(`${back}?misis=${encodeURIComponent(str(fd, 'misis', 40))}`, describe(r));
  redirect(`/pay/${r.order_id}`);
}

// ---------------------------------------------------------------------------
// Merchandise (anyone with a graduate's MISIS; not checked against the Master List)
// ---------------------------------------------------------------------------
export async function merchOrderAction(fd: FormData) {
  const season = await currentPublicSeason();
  if (!season) fail('/shop', errorText('no_such_season'));
  if (!(await fn<boolean>('rate_limit_hit', [`merch:${await clientIp()}`, 30, 3600]))) fail('/shop', errorText('rate_limited'));
  const lines: { item_id: number; qty: number }[] = [];
  for (const [k, v] of fd.entries()) {
    const m = k.match(/^qty_(\d+)$/);
    const q = Number(v);
    if (m && Number.isInteger(q) && q > 0) lines.push({ item_id: Number(m[1]), qty: Math.min(q, 50) });
  }
  const r = await fn('create_merch_order', [season.id, str(fd, 'misis', 40), str(fd, 'buyer_name', 120), str(fd, 'buyer_email', 200), JSON.stringify(lines), 'online', null, 'public']);
  if (!r.ok) fail('/shop', describe(r));
  redirect(`/pay/${r.order_id}`);
}

// ---------------------------------------------------------------------------
// Simulated payment (Test mode only; refuses in Live mode)
// ---------------------------------------------------------------------------
export async function simulatePayAction(fd: FormData) {
  const id = str(fd, 'order', 40);
  if (!(await simulateAllowed())) fail(`/pay/${id}`, 'Simulated payments are switched off.');
  const t = await one<{ target: 'ticket' | 'merch'; amount: number }>(
    `select 'ticket' as target, amount_aed as amount from orders where id::text = $1
     union all select 'merch', amount_aed from merch_orders where id::text = $1`,
    [id],
  );
  if (!t) fail('/', errorText('no_such_order'));
  const outcome = str(fd, 'outcome') === 'paid' ? 'paid' : 'failed';
  const ref = `SIM-${Date.now()}`;
  await recordGatewayResult({
    eventKey: `simulate:${id}:${ref}`, gateway: 'simulate', target: t.target, orderId: id, status: outcome,
    amount: t.amount, gatewayRef: ref, payload: { simulated: true }, actor: 'simulator',
  });
  redirect(`/pay/return?order=${id}&kind=${t.target}${outcome === 'paid' ? '' : '&failed=1'}`);
}

// ---------------------------------------------------------------------------
// My E-Tickets: share by email, name change, transfer
// ---------------------------------------------------------------------------
export async function emailTicketAction(fd: FormData) {
  const st = await requireStudent('/tickets');
  if (!(await fn<boolean>('rate_limit_hit', [`share:${st.misis}`, 30, 3600]))) fail('/tickets', errorText('rate_limited'));
  const t = await one<{ id: string; token: string; holder_name: string; kind: string; door: string; ceremony: string }>(
    `select t.id, t.token, t.holder_name, t.kind, t.door, c.name as ceremony from tickets t join ceremonies c on c.id = t.ceremony_id
      where t.id::text = $1 and t.season_id = $2 and t.misis = $3 and t.status = 'valid'`,
    [str(fd, 'ticket', 40), st.season_id, st.misis],
  );
  if (!t) fail('/tickets', errorText('no_such_ticket'));
  const to = str(fd, 'to', 10);
  const address = to === 'mdx' ? st.graduate.email : to === 'private' ? st.graduate.private_email ?? '' : str(fd, 'address', 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) fail('/tickets', 'Enter a valid email address.');
  await queueEmail(address, 'ticket_share', {
    holder: t.holder_name, name: st.graduate.full_name, misis: st.misis, ceremony: t.ceremony,
    door: t.kind === 'guest' ? `Show it at Door 1 (venue entrance) and at ${t.door}.` : `Use the graduate entrance.`,
    link: `${siteUrl()}/t/${t.token}`,
  });
  await fn('log_ticket_send', [t.id, 'email', address, 'share', `student:${st.misis}`]);
  ok('/tickets', `Ticket for ${t.holder_name} sent to ${address}.`);
}

export async function nameChangeAction(fd: FormData) {
  const st = await requireStudent('/tickets');
  const r = await fn('request_name_change', [st.season_id, st.misis, str(fd, 'ticket', 40), str(fd, 'new_name', 120), str(fd, 'reason', 300), `student:${st.misis}`]);
  if (!r.ok) fail('/tickets', describe(r));
  ok('/tickets', 'Name change requested. Marketing will review it, and you will get an email with the decision.');
}

export async function transferAction(fd: FormData) {
  const st = await requireStudent('/tickets');
  const ids = fd.getAll('ticket').map(String).filter((s) => /^[0-9a-f-]{36}$/i.test(s)).slice(0, 20);
  if (!ids.length) fail('/tickets', 'Choose at least one guest ticket to transfer.');
  const r = await fn('request_transfer', [st.season_id, st.misis, str(fd, 'to', 40), ids, str(fd, 'note', 500), `student:${st.misis}`]);
  if (!r.ok) fail('/tickets', describe(r));
  ok('/tickets', 'Transfer requested. Marketing will review it. Your tickets stay valid until it is approved.');
}

export async function cancelTransferAction(fd: FormData) {
  const st = await requireStudent('/tickets');
  const r = await fn('cancel_transfer', [str(fd, 'id', 40), st.misis, `student:${st.misis}`]);
  if (!r.ok) fail('/tickets', describe(r));
  redirect(withMessage('/tickets', 'msg', 'Transfer request cancelled.'));
}
