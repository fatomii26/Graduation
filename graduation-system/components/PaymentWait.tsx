'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';

type Status = { status: string; kind: string; attention: boolean } | null;

/** Waits for the gateway's confirmation (normally a few seconds), then shows the tickets link. */
export default function PaymentWait({ order, kind, failed }: { order: string; kind: 'ticket' | 'merch'; failed: boolean }) {
  const [s, setS] = useState<Status>(null);
  const [tries, setTries] = useState(0);
  const done = s?.status === 'paid' || s?.status === 'cancelled' || s?.status === 'expired';

  useEffect(() => {
    if (done || tries > 90) return;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/orders/${order}/status?kind=${kind}`, { cache: 'no-store' });
        if (r.ok) setS((await r.json()) as Status);
      } catch {}
      setTries((n) => n + 1);
    }, tries === 0 ? 0 : 2000);
    return () => clearTimeout(t);
  }, [order, kind, tries, done]);

  if (s?.status === 'paid') {
    if (s.attention) {
      return (
        <div className="card">
          <h2>Payment received</h2>
          <p>Your payment needs a quick check by the Finance team before every ticket can be issued (for example, it arrived after the hold ended and the zone filled up). They have been alerted and will contact you.</p>
          <Link className="btn" href="/tickets">See my e-tickets</Link>
        </div>
      );
    }
    if (kind === 'merch') {
      return (
        <div className="card">
          <h2>Thank you, your order is paid</h2>
          <p>Collect your items at the graduation desk. Bring the MISIS you used for the order.</p>
          <Link className="btn" href="/shop">Back to the shop</Link>
        </div>
      );
    }
    if (s.kind === 'third_party') {
      return (
        <div className="card">
          <h2>Thank you, the payment is complete</h2>
          <p>We have emailed you a receipt, and emailed the student a receipt number. The student now chooses the zone and guest names.</p>
          <Link className="btn" href="/">Done</Link>
        </div>
      );
    }
    return (
      <div className="card center">
        <h2>Payment received. Your e-tickets are ready.</h2>
        <p>Each person has their own e-ticket with its own QR code. Share each guest&apos;s ticket with them.</p>
        <Link className="btn" href="/tickets">Show my e-tickets</Link>
      </div>
    );
  }
  if (failed || s?.status === 'cancelled' || s?.status === 'expired') {
    return (
      <div className="card">
        <h2>The payment did not go through</h2>
        <p>No tickets were issued. {s?.status === 'pending_payment' ? 'Your places are still held for a few minutes.' : ''}</p>
        <div className="row">
          {s?.status === 'pending_payment' ? <Link className="btn" href={`/pay/${order}`}>Try again</Link> : null}
          <Link className="btn ghost" href={kind === 'merch' ? '/shop' : '/'}>Back</Link>
        </div>
      </div>
    );
  }
  return (
    <div className="card center" role="status" aria-live="polite">
      <h2>Confirming your payment…</h2>
      <p className="muted">This normally takes a few seconds. Please keep this page open.</p>
      {tries > 90 ? (
        <p>This is taking longer than usual. If money has left your account, your tickets will appear in <Link href="/tickets">My E-Tickets</Link> as soon as the bank confirms.</p>
      ) : null}
    </div>
  );
}
