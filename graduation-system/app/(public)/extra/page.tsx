import Link from 'next/link';
import { fn, one, sql } from '@/lib/db';
import { requireStudent } from '@/lib/auth/student';
import { getSeasonSettings, type ZoneAvailability } from '@/lib/settings';
import { errorText } from '@/lib/errors';
import { fmtDateTime } from '@/lib/format';
import ZonePicker from '@/components/ZonePicker';
import Submit from '@/components/Submit';
import { Flash, readParams, type SearchParams } from '@/components/ui';
import { bookAction, requestExtraAction } from '../actions';

export default async function Extra({ searchParams }: { searchParams: SearchParams }) {
  const get = await readParams(searchParams);
  const code = get('code').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const st = await requireStudent(`/extra${code ? `?code=${code}` : ''}`);
  const settings = await getSeasonSettings(st.season_id);
  const c = code
    ? await one<{ code: string; extra_guests: number; expires_at: Date; used_at: Date | null }>(
        'select code, extra_guests, expires_at, used_at from extra_ticket_codes where code = $1 and season_id = $2 and misis = $3',
        [code, st.season_id, st.misis],
      )
    : null;
  const hasGrad = await one<{ n: number }>(
    `select count(*)::int as n from tickets where season_id = $1 and misis = $2 and kind = 'graduate' and status = 'valid'`,
    [st.season_id, st.misis],
  );
  const requests = await sql<{ requested_guests: number; status: string; created_at: Date; decision_note: string | null }>(
    'select requested_guests, status, created_at, decision_note from extra_ticket_requests where season_id = $1 and misis = $2 order by created_at desc',
    [st.season_id, st.misis],
  );
  const why = await fn<string | null>('eligibility', [st.season_id, st.misis]);
  const zones = st.graduate.ceremony_id ? await fn<ZoneAvailability[]>('zone_availability', [st.graduate.ceremony_id]) : [];
  const codeProblem = code && (!c ? 'code_invalid' : c.used_at ? 'code_used' : new Date(c.expires_at) < new Date() ? 'code_expired' : null);

  return (
    <div className="narrow" style={{ maxWidth: 860 }}>
      <h1>Extra tickets</h1>
      <p className="muted">The guest limit can only be raised by an approved request. Marketing emails you a code valid for {settings?.extra_code_hours ?? 72} hours.</p>
      <Flash msg={get('msg')} err={get('err')} />

      {c && !codeProblem && !why && hasGrad?.n && settings && st.graduate.ceremony_id ? (
        <>
          <div className="card flat">Code <strong className="mono">{c.code}</strong> · up to {c.extra_guests} extra guest ticket(s) · valid until {fmtDateTime(c.expires_at)}</div>
          <ZonePicker
            ceremonyId={st.graduate.ceremony_id}
            zones={zones}
            zoneSelection={settings.zone_selection_enabled}
            maxGuests={c.extra_guests}
            includesGraduate={false}
            gradPrice={settings.graduate_price_aed}
            guestPrice={settings.guest_price_aed}
            showPrice
            holdMinutes={settings.hold_minutes}
            kind="extra"
            code={c.code}
            submitLabel="Continue to payment"
            action={bookAction}
          />
        </>
      ) : (
        <div className="grid two">
          <section className="card">
            <h2>I have a code</h2>
            {codeProblem ? <div className="flash err">{errorText(codeProblem)}</div> : null}
            {why ? <div className="flash err">{errorText(why)}</div> : null}
            {!hasGrad?.n ? <div className="flash warn">Buy your graduate ticket first. <Link href="/book">Buy tickets</Link></div> : null}
            <form method="get" action="/extra">
              <label className="f" htmlFor="code">Extra ticket code</label>
              <input id="code" name="code" placeholder="e.g. EX7K3P9QXM" defaultValue={code} required />
              <button className="btn" style={{ marginTop: 12 }}>Continue</button>
            </form>
          </section>
          <section className="card">
            <h2>Request extra tickets</h2>
            {settings?.extra_requests_enabled ? (
              <form action={requestExtraAction}>
                <label className="f" htmlFor="guests">How many extra guests?</label>
                <select id="guests" name="guests" defaultValue="1">
                  {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                <label className="f" htmlFor="reason">Reason</label>
                <textarea id="reason" name="reason" maxLength={500} placeholder="For example: grandparents travelling from abroad" />
                <div style={{ marginTop: 12 }}><Submit>Send request</Submit></div>
              </form>
            ) : (
              <p className="muted">{errorText('requests_closed')}</p>
            )}
            {requests.length ? (
              <ul className="small" style={{ paddingLeft: 18, marginTop: 14 }}>
                {requests.map((r, i) => (
                  <li key={i}>
                    {fmtDateTime(r.created_at)}: {r.requested_guests} guest(s) · <span className={`pill ${r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn'}`}>{r.status}</span>
                    {r.decision_note ? ` · ${r.decision_note}` : ''}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
