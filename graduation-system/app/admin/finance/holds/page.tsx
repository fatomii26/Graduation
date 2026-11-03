import { sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { studentSummary } from '@/lib/admin-queries';
import { aed, fmtDateTime, normMisis } from '@/lib/format';
import StudentCard from '@/components/StudentCard';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, readParams, SearchBar, type SearchParams } from '@/components/ui';
import { placeHoldAction, removeHoldAction, sendAllRequestsAction, sendRequestAction, uploadHoldsAction } from './actions';

export default async function Holds({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('financial_hold');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const q = normMisis(get('q'));
  const back = `/admin/finance/holds${q ? `?q=${q}` : ''}`;
  const s = q ? await studentSummary(S, q) : null;
  const holds = await sql<{ misis: string; full_name: string; reason: string; amount_aed: number | null; created_by: string; created_at: Date; status: string; removed_by: string | null; removed_at: Date | null }>(
    `select h.misis, g.full_name, h.reason, h.amount_aed, h.created_by, h.created_at, h.status, h.removed_by, h.removed_at
       from financial_holds h join graduates g on g.season_id = h.season_id and g.misis = h.misis
      where h.season_id = $1 and ($2 = '' or h.misis = $2) order by h.status, h.created_at desc limit 300`,
    [S, q],
  );
  const pendingRequests = await sql<{ n: number }>(
    `select count(*)::int as n from graduates where season_id = $1 and not financial_hold and finance_request_sent_at is null`, [S]);

  return (
    <>
      <h1>Financial Hold</h1>
      <p className="page-sub">A student with a hold cannot buy tickets or be allocated to a ceremony. Removing a hold notifies DAR through their list.</p>
      <Flash msg={get('msg')} err={get('err')} />
      <SearchBar action="/admin/finance/holds" q={q} />
      {q && !s ? <div className="flash err">MISIS {q} is not on the Master List.</div> : null}
      {s ? (
        <StudentCard s={s}>
          <div className="grid two">
            {s.financial_hold ? (
              <form action={removeHoldAction} className="card flat">
                <Back to={back} />
                <input type="hidden" name="misis" value={s.misis} />
                <h3>Remove hold</h3>
                <input name="note" placeholder="Note (e.g. balance paid, receipt number)" maxLength={300} />
                <div style={{ marginTop: 8 }}><Submit confirm="Remove the financial hold?">Remove hold</Submit></div>
              </form>
            ) : (
              <form action={placeHoldAction} className="card flat">
                <Back to={back} />
                <input type="hidden" name="misis" value={s.misis} />
                <h3>Place hold</h3>
                <input name="reason" placeholder="Reason" required minLength={2} maxLength={300} />
                <input name="amount" placeholder="Outstanding amount (AED)" inputMode="decimal" style={{ marginTop: 8 }} />
                <div style={{ marginTop: 8 }}><Submit className="btn danger">Place hold</Submit></div>
              </form>
            )}
            <div className="card flat">
              <h3>Clearance request to DAR</h3>
              {s.finance_request_sent_at ? (
                <p>Sent {fmtDateTime(s.finance_request_sent_at)}. DAR can allocate this student to a ceremony.</p>
              ) : s.financial_hold ? (
                <p className="muted">Remove the hold first.</p>
              ) : (
                <form action={sendRequestAction}><Back to={back} /><input type="hidden" name="misis" value={s.misis} /><Submit>Send request to DAR</Submit></form>
              )}
            </div>
          </div>
        </StudentCard>
      ) : null}

      <div className="grid two" style={{ marginBottom: 16 }}>
        <form action={sendAllRequestsAction} className="card">
          <Back to={back} />
          <h3>Send all clearance requests</h3>
          <p className="small muted">{pendingRequests[0]?.n ?? 0} student(s) without a hold have not been sent to DAR yet.</p>
          <Submit className="btn secondary" confirm="Send the clearance request for every student without a hold?">Send to DAR</Submit>
        </form>
        <form action={uploadHoldsAction} className="card">
          <Back to={back} />
          <h3>Upload holds (CSV)</h3>
          <p className="small muted">Columns: <span className="mono">misis, reason, amount</span></p>
          <input type="file" name="file" accept=".csv,text/csv" required />
          <div style={{ marginTop: 8 }}><Submit className="btn secondary">Upload</Submit></div>
        </form>
      </div>

      <h2>Holds</h2>
      {holds.length === 0 ? <Empty>No holds.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>MISIS</th><th>Name</th><th>Reason</th><th className="num">Amount</th><th>Placed</th><th>Status</th></tr></thead>
            <tbody>
              {holds.map((h, i) => (
                <tr key={i} className={h.status === 'removed' ? 'dim' : ''}>
                  <td className="mono">{h.misis}</td><td>{h.full_name}</td><td>{h.reason}</td>
                  <td className="num">{h.amount_aed !== null ? aed(h.amount_aed) : '—'}</td>
                  <td className="small">{fmtDateTime(h.created_at)}<br />{h.created_by}</td>
                  <td>{h.status === 'active' ? <span className="pill bad">active</span> : <span className="small">removed {fmtDateTime(h.removed_at)} by {h.removed_by}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
