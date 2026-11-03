import Link from 'next/link';
import { currentPublicSeason, getCeremonies, getSeasonSettings } from '@/lib/settings';
import { getStudent } from '@/lib/auth/student';
import { bookingStatus } from '@/lib/student-status';
import { errorText } from '@/lib/errors';
import { aed, fmtDate, fmtTime } from '@/lib/format';
import { Flash, readParams, type SearchParams } from '@/components/ui';

export default async function Home({ searchParams }: { searchParams: SearchParams }) {
  const get = await readParams(searchParams);
  const season = await currentPublicSeason();
  if (!season) {
    return (
      <div className="narrow">
        <div className="card center">
          <h1>Graduation tickets</h1>
          <p>Ticket sales have not opened yet. Please check back soon.</p>
        </div>
      </div>
    );
  }
  const [settings, ceremonies, student] = await Promise.all([getSeasonSettings(season.id), getCeremonies(season.id), getStudent()]);
  const status = student && student.season_id === season.id ? await bookingStatus(season.id, student.misis) : null;
  const myCeremony = student ? ceremonies.find((c) => c.id === student.graduate.ceremony_id) : null;

  return (
    <div className="wrap stack">
      <Flash msg={get('msg')} err={get('err')} />
      <section className="hero">
        <h1>Graduation {season.name}</h1>
        <p>
          {settings?.venue_name}
          {settings?.venue_area ? `, ${settings.venue_area}` : ''}
        </p>
        {settings?.sales_window_text ? <p><strong>{settings.sales_window_text}</strong></p> : null}
        {!settings?.sales_open ? <p><span className="pill warn">Online ticket sales are closed at the moment</span></p> : null}
      </section>
      {settings?.public_notice ? <div className="flash info">{settings.public_notice}</div> : null}

      <div className="grid two">
        <section className="card" aria-labelledby="box">
          <h2 id="box">Ticket box</h2>
          {student && status ? (
            <>
              <p>
                Welcome, <strong>{student.graduate.full_name}</strong> ({student.misis})
                {myCeremony ? <> · {myCeremony.name}</> : null}
              </p>
              {status.pending ? (
                <div className="flash warn">
                  You have an unpaid booking ({status.pending.ref}). <Link href={`/pay/${status.pending.id}`}>Pay now</Link> or{' '}
                  <Link href="/book">change it</Link> before the hold ends.
                </div>
              ) : null}
              {status.eligibility ? (
                <div className="flash err">{errorText(status.eligibility)}</div>
              ) : null}
              <div className="row">
                {!status.eligibility && !status.hasPaidMain ? <Link className="btn" href="/book">Buy tickets</Link> : null}
                {status.validTickets ? <Link className="btn" href="/tickets">My E-Tickets ({status.validTickets})</Link> : null}
                {status.unusedReceipts ? <Link className="btn gold" href="/receipt">Redeem receipt</Link> : null}
                {status.openCodes || status.hasPaidMain ? <Link className="btn secondary" href="/extra">Extra tickets</Link> : null}
              </div>
            </>
          ) : (
            <>
              <p>Graduates sign in with their MISIS number. We email a 6-digit code to the address on the Master List.</p>
              <Link className="btn block" href="/signin?next=/book">Buy tickets</Link>
            </>
          )}
          <hr />
          <ul className="small" style={{ paddingLeft: 18, margin: 0 }}>
            <li><Link href="/pay-for-student">Pay for a student</Link> (parent, guardian or sponsor)</li>
            <li><Link href="/receipt">I paid at the Finance Office</Link> (receipt number)</li>
            <li><Link href="/extra">I have an extra ticket code</Link></li>
            <li><Link href="/shop">Graduation merchandise</Link></li>
          </ul>
        </section>

        <section className="card" aria-labelledby="how">
          <h2 id="how">How it works</h2>
          <ol style={{ paddingLeft: 18 }}>
            <li>One graduate ticket ({aed(settings?.graduate_price_aed)}) and up to {settings?.guest_limit} guest tickets ({aed(settings?.guest_price_aed)} each).</li>
            <li>Choose the zone where your guests sit. Places are first come, first served, and each zone shows how many places are left.</li>
            <li>Your places are held for {settings?.hold_minutes} minutes while you pay.</li>
            <li>Your e-tickets appear on screen straight after payment. Share each guest&apos;s ticket with them.</li>
            <li>On the day, guests show their QR code at Door 1 (venue entrance) and at their zone door.</li>
          </ol>
          <p className="small muted">Children under 4 do not need a ticket or a seat. Graduates are seated by the University on the day.</p>
        </section>
      </div>

      <section className="card">
        <h2>Ceremonies</h2>
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>Ceremony</th><th>Date</th><th>Starts</th><th>Doors open</th></tr>
            </thead>
            <tbody>
              {ceremonies.map((c) => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.starts_at ? fmtDate(c.starts_at) : 'To be announced'}</td>
                  <td>{c.starts_at ? fmtTime(c.starts_at) : '—'}</td>
                  <td>{c.doors_open_at ? fmtTime(c.doors_open_at) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
