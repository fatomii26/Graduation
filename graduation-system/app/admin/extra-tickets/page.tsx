import { fn, one, sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { siteUrl } from '@/lib/config';
import { queueEmail } from '@/lib/email';
import { errorText } from '@/lib/errors';
import { fmtDateTime, normMisis } from '@/lib/format';
import { backPath, fail, int, ok, str } from '@/lib/forms';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, readParams, SearchBar, type SearchParams } from '@/components/ui';

async function emailCode(season: string, misis: string, code: string, guests: number, expires: string) {
  const g = await one<{ email: string; full_name: string }>('select email, full_name from graduates where season_id = $1 and misis = $2', [season, misis]);
  if (g) await queueEmail(g.email, 'extra_ticket_code', { name: g.full_name, misis, code, count: guests, expires: fmtDateTime(expires), link: `${siteUrl()}/extra?code=${code}` });
}

async function decideAction(fd: FormData) {
  'use server';
  const staff = await requireStaff('extra_tickets_approve');
  const back = backPath(fd, '/admin/extra-tickets');
  const approve = str(fd, 'decision') === 'approve';
  const r = await fn('decide_extra_request', [str(fd, 'id', 40), approve, int(fd, 'guests'), str(fd, 'note', 300), staff.email]);
  if (!r.ok) fail(back, errorText(r.error));
  if (approve) {
    const q = await one<{ misis: string; code: string }>('select misis, code from extra_ticket_requests where id::text = $1', [str(fd, 'id', 40)]);
    if (q) await emailCode(staff.season.id, q.misis, String(r.code), int(fd, 'guests') ?? 1, String(r.expires_at));
    ok(back, `Approved. Code ${r.code} emailed to the student (valid until ${fmtDateTime(String(r.expires_at))}).`);
  }
  ok(back, 'Request rejected.');
}

async function createCodeAction(fd: FormData) {
  'use server';
  const staff = await requireStaff('extra_tickets_approve');
  const back = backPath(fd, '/admin/extra-tickets');
  const misis = normMisis(str(fd, 'misis', 20));
  const guests = int(fd, 'guests') ?? 1;
  const r = await fn('create_extra_code', [staff.season.id, misis, guests, null, staff.email]);
  if (!r.ok) fail(back, errorText(r.error));
  await emailCode(staff.season.id, misis, String(r.code), guests, String(r.expires_at));
  ok(back, `Code ${r.code} created for ${misis} and emailed.`);
}

export default async function ExtraTickets({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('extra_tickets', 'extra_tickets_approve');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const q = normMisis(get('q'));
  const back = `/admin/extra-tickets${q ? `?q=${q}` : ''}`;
  const canDecide = staff.can('extra_tickets_approve');
  const requests = await sql<{ id: string; misis: string; full_name: string; requested_guests: number; reason: string; status: string; created_at: Date; decided_by: string | null; code: string | null; tickets: number }>(
    `select r.id::text, r.misis, g.full_name, r.requested_guests, r.reason, r.status, r.created_at, r.decided_by, r.code,
            (select count(*) from tickets t where t.season_id = r.season_id and t.misis = r.misis and t.kind = 'guest' and t.status = 'valid')::int as tickets
       from extra_ticket_requests r join graduates g on g.season_id = r.season_id and g.misis = r.misis
      where r.season_id = $1 and ($2 = '' or r.misis = $2) order by (r.status = 'requested') desc, r.created_at desc limit 300`,
    [S, q],
  );
  const codes = await sql<{ code: string; misis: string; extra_guests: number; approved_by: string; expires_at: Date; used_at: Date | null }>(
    `select code, misis, extra_guests, approved_by, expires_at, used_at from extra_ticket_codes where season_id = $1 and ($2 = '' or misis = $2) order by created_at desc limit 200`,
    [S, q],
  );

  return (
    <>
      <h1>Extra Tickets</h1>
      <p className="page-sub">Students request more guest tickets with a form. Approval creates a code valid for the season&apos;s code window (normally 72 hours).</p>
      <Flash msg={get('msg')} err={get('err')} />
      <SearchBar action="/admin/extra-tickets" q={q} />
      {canDecide ? (
        <form action={createCodeAction} className="card inline" style={{ marginBottom: 16 }}>
          <Back to={back} />
          <strong>Create a code directly</strong>
          <input name="misis" placeholder="MISIS" required style={{ width: 140 }} />
          <select name="guests" defaultValue="1" aria-label="Extra guests">{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} guest(s)</option>)}</select>
          <Submit className="btn sm">Create and email code</Submit>
        </form>
      ) : null}
      <h2>Requests</h2>
      {requests.length === 0 ? <Empty>No requests.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Date</th><th>Graduate</th><th className="num">Has</th><th className="num">Asks</th><th>Reason</th><th>Status</th>{canDecide ? <th>Decision</th> : null}</tr></thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.created_at)}</td>
                  <td>{r.full_name}<div className="small mono">{r.misis}</div></td>
                  <td className="num">{r.tickets}</td><td className="num">{r.requested_guests}</td><td>{r.reason}</td>
                  <td><span className={`pill ${r.status === 'approved' ? 'ok' : r.status === 'requested' ? 'warn' : ''}`}>{r.status}</span>{r.code ? <div className="small mono">{r.code}</div> : null}</td>
                  {canDecide ? (
                    <td>
                      {r.status === 'requested' ? (
                        <form action={decideAction} className="inline">
                          <Back to={back} />
                          <input type="hidden" name="id" value={r.id} />
                          <select name="guests" defaultValue={String(r.requested_guests)} aria-label="Guests to approve">{[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select>
                          <input name="note" placeholder="Note" style={{ width: 120 }} />
                          <Submit className="btn sm" name="decision" value="approve">Approve</Submit>
                          <Submit className="btn ghost sm" name="decision" value="reject">Reject</Submit>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2 style={{ marginTop: 18 }}>Codes</h2>
      {codes.length === 0 ? <Empty>No codes.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Code</th><th>MISIS</th><th className="num">Guests</th><th>Approved by</th><th>Valid until</th><th>Status</th></tr></thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.code}>
                  <td className="mono">{c.code}</td><td className="mono">{c.misis}</td><td className="num">{c.extra_guests}</td><td className="small">{c.approved_by}</td><td>{fmtDateTime(c.expires_at)}</td>
                  <td>{c.used_at ? <span className="pill ok">used {fmtDateTime(c.used_at)}</span> : new Date(c.expires_at) < new Date() ? <span className="pill">expired</span> : <span className="pill warn">open</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
