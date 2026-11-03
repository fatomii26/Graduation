import 'server-only';
import { fn, one, type FnResult } from '../db';
import { siteUrl } from '../config';
import { queueEmail } from '../email';
import { aed, ticketsText } from '../format';

export type PayTarget = 'ticket' | 'merch';

/** Records a gateway (or simulated) result through the database rule, then sends the notices. Safe to call twice. */
export async function recordGatewayResult(r: {
  eventKey: string;
  gateway: string;
  target: PayTarget;
  orderId: string;
  status: string;
  amount: number | null;
  gatewayRef: string;
  payload: Record<string, unknown>;
  actor: string;
}): Promise<FnResult> {
  const res = await fn('record_payment', [
    r.eventKey.slice(0, 200), r.gateway, r.target, r.orderId, r.status, r.amount, r.gatewayRef.slice(0, 120), JSON.stringify(r.payload), r.actor,
  ]);
  if (res.ok && !res.duplicate && !res.already_paid && res.paid !== false && r.target === 'ticket' && !res.attention) {
    await afterTicketPayment(r.orderId).catch(() => {});
  }
  return res;
}

/** Payment confirmation notice (no tickets attached: students share their tickets), or third-party notices. */
export async function afterTicketPayment(orderId: string) {
  const o = await one<{
    kind: string; misis: string; ref: string; includes_graduate: boolean; guest_count: number; amount_aed: number;
    receipt_number: string | null; payer_name: string | null; payer_email: string | null; full_name: string; email: string; ceremony: string | null;
  }>(
    `select o.kind, o.misis, o.ref, o.includes_graduate, o.guest_count, o.amount_aed, o.receipt_number, o.payer_name, o.payer_email,
            g.full_name, g.email, c.name as ceremony
       from orders o join graduates g on g.season_id = o.season_id and g.misis = o.misis
       left join ceremonies c on c.id = o.ceremony_id
      where o.id = $1 and o.status = 'paid'`,
    [orderId],
  );
  if (!o) return;
  const vars = {
    name: o.full_name, misis: o.misis, tickets: ticketsText(o.includes_graduate, o.guest_count), ceremony: o.ceremony ?? '',
    paid: aed(o.amount_aed), receipt: o.receipt_number, payer: o.payer_name, ref: o.ref,
  };
  if (o.kind === 'third_party') {
    await queueEmail(o.email, 'third_party_payment', { ...vars, link: `${siteUrl()}/receipt` });
    await queueEmail(o.payer_email, 'third_party_receipt', vars);
  } else if (o.amount_aed > 0) {
    await queueEmail(o.email, 'payment_confirmation', { ...vars, link: `${siteUrl()}/tickets` });
  }
}
