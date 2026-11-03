import Link from 'next/link';
import { fn, one, sql } from '@/lib/db';
import { requireStudent } from '@/lib/auth/student';
import { getSeasonSettings, type ZoneAvailability } from '@/lib/settings';
import { errorText } from '@/lib/errors';
import { aed, fmtDateTime, ticketsText } from '@/lib/format';
import ZonePicker from '@/components/ZonePicker';
import Submit from '@/components/Submit';
import { Flash, readParams, type SearchParams } from '@/components/ui';
import { redeemAction } from '../actions';

type Receipt = { receipt_number: string; includes_graduate: boolean; guest_count: number; amount_aed: number; status: string; source: string; created_at: Date; payer_name: string | null };

export default async function ReceiptPage({ searchParams }: { searchParams: SearchParams }) {
  const get = await readParams(searchParams);
  const code = get('receipt').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const st = await requireStudent(`/receipt${code ? `?receipt=${code}` : ''}`);
  const mine = await sql<Receipt>(
    `select receipt_number, includes_graduate, guest_count, amount_aed, status, source, created_at, payer_name
       from receipts where season_id = $1 and misis = $2 order by created_at desc`,
    [st.season_id, st.misis],
  );
  const rc = code ? mine.find((r) => r.receipt_number === code) ?? null : null;
  const why = await fn<string | null>('eligibility', [st.season_id, st.misis, true]);
  const settings = await getSeasonSettings(st.season_id);
  const zones = st.graduate.ceremony_id ? await fn<ZoneAvailability[]>('zone_availability', [st.graduate.ceremony_id]) : [];
  const busy = await one<{ n: number }>(
    `select count(*)::int as n from orders where season_id = $1 and misis = $2 and status = 'pending_payment' and expires_at > now()`,
    [st.season_id, st.misis],
  );

  return (
    <div className="narrow" style={{ maxWidth: 860 }}>
      <h1>Paid at the Finance Office</h1>
      <p className="muted">Enter your receipt number, choose your guests&apos; zone and names, and your e-tickets are issued at once. A receipt number works once.</p>
      <Flash msg={get('msg')} err={get('err')} />
      {why ? <div className="flash err">{errorText(why)}</div> : null}
      {busy?.n ? <div className="flash warn">You have an unpaid online booking. <Link href="/book">Cancel it</Link> first if you want to use your receipt instead.</div> : null}

      {!rc ? (
        <div className="card">
          <form method="get" action="/receipt" className="inline">
            <label className="f" htmlFor="receipt" style={{ margin: 0 }}>Receipt number</label>
            <input id="receipt" name="receipt" placeholder="e.g. RC7K3P9QXM" defaultValue={code} required style={{ minWidth: 220 }} />
            <button className="btn">Continue</button>
          </form>
          {code ? <p className="flash err" style={{ marginTop: 12 }}>{errorText('receipt_invalid')}</p> : null}
          {mine.length ? (
            <>
              <h3 style={{ marginTop: 18 }}>Your receipts</h3>
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>Receipt</th><th>For</th><th>Paid</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    {mine.map((r) => (
                      <tr key={r.receipt_number}>
                        <td className="mono">{r.receipt_number}</td>
                        <td>{ticketsText(r.includes_graduate, r.guest_count)}{r.payer_name ? ` · paid by ${r.payer_name}` : ''}</td>
                        <td>{fmtDateTime(r.created_at)}</td>
                        <td><span className={`pill ${r.status === 'unused' ? 'warn' : r.status === 'used' ? 'ok' : ''}`}>{r.status}</span></td>
                        <td>{r.status === 'unused' ? <Link className="btn sm" href={`/receipt?receipt=${r.receipt_number}`}>Use</Link> : null}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : null}
        </div>
      ) : rc.status !== 'unused' ? (
        <div className="card">
          <div className="flash err">{errorText(rc.status === 'used' ? 'receipt_used' : 'receipt_invalid')}</div>
          <Link className="btn" href="/tickets">My E-Tickets</Link>
        </div>
      ) : !st.graduate.ceremony_id || !settings || why ? null : (
        <>
          <div className="card flat">
            Receipt <strong className="mono">{rc.receipt_number}</strong>: {ticketsText(rc.includes_graduate, rc.guest_count)}
            {rc.amount_aed ? ` · ${aed(rc.amount_aed)} paid` : ''}
          </div>
          {rc.guest_count === 0 ? (
            <form action={redeemAction} className="card">
              <input type="hidden" name="receipt" value={rc.receipt_number} />
              <input type="hidden" name="guests" value="[]" />
              <p>Your graduate ticket is paid. Confirm to issue it.</p>
              <Submit className="btn block">Issue my e-ticket</Submit>
            </form>
          ) : (
            <ZonePicker
              ceremonyId={st.graduate.ceremony_id}
              zones={zones}
              zoneSelection={settings.zone_selection_enabled}
              maxGuests={rc.guest_count}
              fixedGuests={rc.guest_count}
              includesGraduate={rc.includes_graduate}
              gradPrice={0}
              guestPrice={0}
              showPrice={false}
              holdMinutes={settings.hold_minutes}
              kind="receipt"
              receipt={rc.receipt_number}
              submitLabel="Issue my e-tickets"
              action={redeemAction}
            />
          )}
        </>
      )}
    </div>
  );
}
