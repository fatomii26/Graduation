import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { one } from '@/lib/db';
import { paymentMode } from '@/lib/config';
import { simulateAllowed } from '@/lib/settings';
import { checkoutForm, type Checkout } from '@/lib/payments/ccavenue';
import { logError } from '@/lib/audit';
import { errorText } from '@/lib/errors';
import { aed, ticketsText } from '@/lib/format';
import AutoPost from '@/components/AutoPost';
import Submit from '@/components/Submit';
import Countdown from '@/components/Countdown';
import { Flash, readParams, type SearchParams } from '@/components/ui';
import { simulatePayAction } from '../../actions';

type Payable = {
  target: 'ticket' | 'merch'; id: string; ref: string; status: string; amount_aed: number; expires_at: string; misis: string;
  kind: string; includes_graduate: boolean; guest_count: number; name: string; email: string;
};

export default async function Pay({ params, searchParams }: { params: Promise<{ orderId: string }>; searchParams: SearchParams }) {
  const { orderId } = await params;
  const get = await readParams(searchParams);
  if (!/^[0-9a-f-]{36}$/i.test(orderId)) notFound();
  const o = await one<Payable>(
    `select 'ticket' as target, o.id::text, o.ref, o.status, o.amount_aed, o.expires_at, o.misis, o.kind, o.includes_graduate, o.guest_count,
            coalesce(case when o.kind = 'third_party' then o.payer_name end, g.full_name) as name,
            coalesce(case when o.kind = 'third_party' then o.payer_email end, g.email) as email
       from orders o join graduates g on g.season_id = o.season_id and g.misis = o.misis where o.id::text = $1
     union all
     select 'merch', m.id::text, m.ref, m.status, m.amount_aed, m.expires_at, m.misis, 'merch', false, 0, m.buyer_name, coalesce(m.buyer_email, '')
       from merch_orders m where m.id::text = $1`,
    [orderId],
  );
  if (!o) notFound();
  if (o.status === 'paid') redirect(`/pay/return?order=${o.id}&kind=${o.target}`);
  const live = o.status === 'pending_payment' && new Date(o.expires_at) > new Date();
  const what = o.target === 'merch' ? 'Merchandise order' : ticketsText(o.includes_graduate, o.guest_count);

  let checkout: Checkout | null = null;
  let problem = '';
  const sim = live && (await simulateAllowed());
  if (live && !sim) {
    if (paymentMode() === 'ccavenue') {
      try {
        checkout = await checkoutForm({ id: o.id, ref: o.ref, target: o.target, amount: o.amount_aed, name: o.name, email: o.email, misis: o.misis });
      } catch (e) {
        await logError('ccavenue:checkout', e, `/pay/${o.id}`);
        problem = errorText('payments_unavailable');
      }
    } else problem = errorText('payments_unavailable');
  }

  return (
    <div className="narrow">
      <h1>Payment</h1>
      <Flash msg={get('msg')} err={get('err') || problem} />
      <div className="card">
        <p>
          Order <strong className="mono">{o.ref}</strong> · {what}
          {o.kind === 'third_party' ? <> for MISIS {o.misis}</> : null}
        </p>
        <p style={{ fontSize: '1.3rem' }}>Amount: <strong>{aed(o.amount_aed)}</strong></p>
        {!live ? (
          <>
            <div className="flash err">This order has {o.status === 'cancelled' ? 'been cancelled' : 'expired'} and the places were released.</div>
            <Link className="btn" href={o.target === 'merch' ? '/shop' : o.kind === 'third_party' ? '/pay-for-student' : '/book'}>Start again</Link>
          </>
        ) : sim ? (
          <>
            <p>Places held for <Countdown until={o.expires_at} />.</p>
            <div className="flash warn">Test mode: no money is taken. Choose the result to simulate.</div>
            <div className="row">
              <form action={simulatePayAction}>
                <input type="hidden" name="order" value={o.id} />
                <input type="hidden" name="outcome" value="paid" />
                <Submit>Simulate successful payment</Submit>
              </form>
              <form action={simulatePayAction}>
                <input type="hidden" name="order" value={o.id} />
                <input type="hidden" name="outcome" value="failed" />
                <Submit className="btn ghost">Simulate failed payment</Submit>
              </form>
            </div>
          </>
        ) : checkout ? (
          <>
            <p>Places held for <Countdown until={o.expires_at} />. You are being taken to the secure CCAvenue payment page.</p>
            <AutoPost action={checkout.action} fields={checkout.fields} />
          </>
        ) : null}
      </div>
    </div>
  );
}
