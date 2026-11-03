import Link from 'next/link';
import { fn } from '@/lib/db';
import { clientIp } from '@/lib/auth/session';
import { ticketByToken } from '@/lib/tickets';
import TicketCard from '@/components/TicketCard';
import PrintButton from '@/components/PrintButton';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Graduation e-ticket', robots: { index: false, follow: false } };

// One ticket, public by link. Anyone with the link can view it; only staff can admit it.
export default async function TicketPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const allowed = await fn<boolean>('rate_limit_hit', [`ticket-page:${await clientIp()}`, 120, 60]);
  const t = allowed ? await ticketByToken(token) : null;
  return (
    <>
      <header className="site-header noprint">
        <div className="in">
          <Link className="brand" href="/">
            <span className="crest" aria-hidden="true">MDX</span>
            <span>Graduation e-ticket<small>Middlesex University Dubai</small></span>
          </Link>
        </div>
      </header>
      <main id="main" className="narrow" style={{ maxWidth: 460 }}>
        {!allowed ? (
          <div className="flash err">Too many requests. Please wait a minute and try again.</div>
        ) : !t ? (
          <div className="card center"><h1>Ticket not found</h1><p>Check the link, or ask the graduate to share it again.</p></div>
        ) : t.status === 'void' ? (
          <div className="card center">
            <h1>{t.replaced ? 'This ticket was replaced' : 'This ticket is no longer valid'}</h1>
            <p>{t.replaced ? 'A new ticket with a new QR code was issued (a name change or a transfer). Ask the graduate for the new link.' : 'Please contact the graduation team.'}</p>
          </div>
        ) : (
          <>
            <TicketCard t={t} />
            <p className="small muted center" style={{ marginTop: 12 }}>Show this QR code at the doors. Screen brightness up helps the scanner.</p>
            <div className="center noprint"><PrintButton /></div>
          </>
        )}
      </main>
    </>
  );
}
