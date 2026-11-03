import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireStudent } from '@/lib/auth/student';
import { getSeasonSettings } from '@/lib/settings';
import { ticketsForGraduate } from '@/lib/tickets';
import { bookingStatus } from '@/lib/student-status';
import { fmtDateTime } from '@/lib/format';
import TicketWallet from '@/components/TicketWallet';
import Submit from '@/components/Submit';
import { Flash, readParams, type SearchParams } from '@/components/ui';
import { cancelTransferAction, emailTicketAction, nameChangeAction, transferAction } from '../actions';

export default async function MyTickets({ searchParams }: { searchParams: SearchParams }) {
  const get = await readParams(searchParams);
  const st = await requireStudent('/tickets');
  const [tickets, settings, status] = await Promise.all([
    ticketsForGraduate(st.season_id, st.misis), getSeasonSettings(st.season_id), bookingStatus(st.season_id, st.misis),
  ]);
  const transfers = await sql<{ id: string; to_misis: string; status: string; created_at: Date; n: number; decision_note: string | null }>(
    `select id, to_misis, status, created_at, cardinality(ticket_ids) as n, decision_note from transfers
      where season_id = $1 and from_misis = $2 order by created_at desc limit 10`,
    [st.season_id, st.misis],
  );
  const names = await sql<{ ticket_id: string; old_name: string; new_name: string; status: string; created_at: Date; decision_note: string | null }>(
    `select ticket_id, old_name, new_name, status, created_at, decision_note from name_change_requests
      where season_id = $1 and misis = $2 order by created_at desc limit 10`,
    [st.season_id, st.misis],
  );
  const guests = tickets.filter((t) => t.kind === 'guest');
  const pendingTransferIds = new Set(
    (await sql<{ id: string }>(`select unnest(ticket_ids)::text as id from transfers where season_id = $1 and from_misis = $2 and status = 'requested'`, [st.season_id, st.misis])).map((r) => r.id),
  );

  return (
    <div className="wrap stack">
      <div className="row between">
        <div>
          <h1 style={{ marginBottom: 4 }}>My E-Tickets</h1>
          <p className="muted" style={{ margin: 0 }}>{st.graduate.full_name} · MISIS {st.misis}</p>
        </div>
        {tickets.length ? (
          <div className="row noprint">
            <a className="btn secondary" href="/api/tickets/pdf">Download all (PDF)</a>
          </div>
        ) : null}
      </div>
      <Flash msg={get('msg')} err={get('err')} />
      {status.pending ? <div className="flash warn">You have an unpaid booking. <Link href={`/pay/${status.pending.id}`}>Pay now</Link></div> : null}
      {status.unusedReceipts ? <div className="flash info">You have a paid receipt waiting. <Link href="/receipt">Choose your zone and get your tickets</Link></div> : null}

      {tickets.length === 0 ? (
        <div className="card center">
          <p>You have no e-tickets yet.</p>
          <Link className="btn" href="/book">Buy tickets</Link>
        </div>
      ) : (
        <>
          <p className="small muted noprint">
            The portal does not email tickets automatically. Share each guest&apos;s ticket with them using Share or Email. Each QR code works once at Door 1 and once at your zone door.
          </p>
          <TicketWallet
            tickets={tickets}
            hasPrivateEmail={!!st.graduate.private_email}
            nameChanges={!!settings?.name_changes_enabled}
            pendingNameTickets={names.filter((n) => n.status === 'requested').map((n) => n.ticket_id)}
            emailAction={emailTicketAction}
            nameAction={nameChangeAction}
          />
        </>
      )}

      {guests.length && settings?.transfers_enabled ? (
        <section className="card noprint">
          <h2>Transfer guest tickets</h2>
          <p className="small muted">
            You can ask to give guest tickets to another graduate in the same ceremony. Marketing approves or rejects each request.
            On approval your tickets stop working and the other graduate receives new tickets for the same zone.
          </p>
          <form action={transferAction}>
            <fieldset>
              <legend>Guest tickets</legend>
              {guests.map((t) => (
                <label className="check" key={t.id}>
                  <input type="checkbox" name="ticket" value={t.id} disabled={pendingTransferIds.has(t.id)} />
                  {t.holder} · {t.zone}{pendingTransferIds.has(t.id) ? ' (transfer waiting)' : ''}
                </label>
              ))}
            </fieldset>
            <div className="grid">
              <div>
                <label className="f" htmlFor="to">Receiving graduate&apos;s MISIS</label>
                <input id="to" name="to" required placeholder="e.g. M00123457" />
              </div>
              <div>
                <label className="f" htmlFor="note">Note for Marketing</label>
                <input id="note" name="note" maxLength={500} />
              </div>
            </div>
            <div style={{ marginTop: 12 }}><Submit className="btn secondary">Request transfer</Submit></div>
          </form>
        </section>
      ) : null}

      {transfers.length || names.length ? (
        <section className="card noprint">
          <h2>Your requests</h2>
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Date</th><th>Request</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {transfers.map((t) => (
                  <tr key={t.id}>
                    <td>{fmtDateTime(t.created_at)}</td>
                    <td>Transfer {t.n} ticket(s) to {t.to_misis}{t.decision_note ? ` · ${t.decision_note}` : ''}</td>
                    <td><span className={`pill ${t.status === 'approved' ? 'ok' : t.status === 'requested' ? 'warn' : 'bad'}`}>{t.status}</span></td>
                    <td>
                      {t.status === 'requested' ? (
                        <form action={cancelTransferAction}><input type="hidden" name="id" value={t.id} /><Submit className="btn ghost sm">Cancel</Submit></form>
                      ) : null}
                    </td>
                  </tr>
                ))}
                {names.map((n, i) => (
                  <tr key={`n${i}`}>
                    <td>{fmtDateTime(n.created_at)}</td>
                    <td>Name change: {n.old_name} → {n.new_name}{n.decision_note ? ` · ${n.decision_note}` : ''}</td>
                    <td><span className={`pill ${n.status === 'approved' ? 'ok' : n.status === 'requested' ? 'warn' : 'bad'}`}>{n.status}</span></td>
                    <td />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </div>
  );
}
