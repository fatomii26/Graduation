import Link from 'next/link';
import { fn } from '@/lib/db';
import { requireStudent } from '@/lib/auth/student';
import { getCeremonies, getSeasonSettings, type ZoneAvailability } from '@/lib/settings';
import { bookingStatus } from '@/lib/student-status';
import { errorText } from '@/lib/errors';
import { aed, fmtDate, fmtTime, ticketsText } from '@/lib/format';
import ZonePicker from '@/components/ZonePicker';
import Submit from '@/components/Submit';
import Countdown from '@/components/Countdown';
import { Flash, readParams, type SearchParams } from '@/components/ui';
import { bookAction, cancelOrderAction } from '../actions';

export default async function Book({ searchParams }: { searchParams: SearchParams }) {
  const get = await readParams(searchParams);
  const st = await requireStudent('/book');
  const [settings, ceremonies, status] = await Promise.all([
    getSeasonSettings(st.season_id), getCeremonies(st.season_id), bookingStatus(st.season_id, st.misis),
  ]);
  const ceremony = ceremonies.find((c) => c.id === st.graduate.ceremony_id);
  const zones = ceremony ? await fn<ZoneAvailability[]>('zone_availability', [ceremony.id]) : [];
  const canBuy = Math.max(0, status.allowance - status.committed);

  return (
    <div className="narrow" style={{ maxWidth: 860 }}>
      <h1>Buy tickets</h1>
      <p className="muted">
        {st.graduate.full_name} · MISIS {st.misis}
        {ceremony ? <> · <strong>{ceremony.name}</strong>{ceremony.starts_at ? `, ${fmtDate(ceremony.starts_at)} at ${fmtTime(ceremony.starts_at)}` : ''}</> : null}
      </p>
      <Flash msg={get('msg')} err={get('err')} />

      {status.pending ? (
        <div className="card">
          <h2>Your booking is waiting for payment</h2>
          <p>
            Booking {status.pending.ref}: {ticketsText(status.pending.includes_graduate, status.pending.guest_count)} · <strong>{aed(status.pending.amount_aed)}</strong>
          </p>
          <p>Places held for <Countdown until={status.pending.expires_at} />. After that the places are released.</p>
          <div className="row">
            <Link className="btn" href={`/pay/${status.pending.id}`}>Pay now</Link>
            <form action={cancelOrderAction}>
              <input type="hidden" name="order" value={status.pending.id} />
              <Submit className="btn ghost" confirm="Cancel this booking and release the places?">Cancel booking</Submit>
            </form>
          </div>
        </div>
      ) : status.eligibility ? (
        <div className="card">
          <h2>You cannot buy tickets yet</h2>
          <div className="flash err">{errorText(status.eligibility)}</div>
          {status.validTickets ? <Link className="btn" href="/tickets">My E-Tickets</Link> : null}
        </div>
      ) : status.unusedReceipts ? (
        <div className="card">
          <h2>You have a receipt to redeem</h2>
          <p>Finance (or someone paying for you) has already paid. Enter your receipt number to choose your guests&apos; zone and get your e-tickets.</p>
          <Link className="btn gold" href="/receipt">Redeem receipt</Link>
        </div>
      ) : status.hasPaidMain || (status.gradArranged && canBuy === 0) ? (
        <div className="card">
          <h2>You already have your tickets</h2>
          <p>Each graduate can have one booking. To add guests you need an extra ticket code from Marketing.</p>
          <div className="row">
            <Link className="btn" href="/tickets">My E-Tickets</Link>
            <Link className="btn secondary" href="/extra">Extra tickets</Link>
          </div>
        </div>
      ) : !ceremony || !settings ? (
        <div className="flash err">{errorText('no_ceremony')}</div>
      ) : (
        <ZonePicker
          ceremonyId={ceremony.id}
          zones={zones}
          zoneSelection={settings.zone_selection_enabled}
          maxGuests={canBuy}
          includesGraduate={!status.gradArranged}
          gradPrice={settings.graduate_price_aed}
          guestPrice={settings.guest_price_aed}
          showPrice
          holdMinutes={settings.hold_minutes}
          kind="main"
          submitLabel="Continue to payment"
          action={bookAction}
        />
      )}
    </div>
  );
}
