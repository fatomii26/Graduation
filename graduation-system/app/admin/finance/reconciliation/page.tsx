import { sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { aed, fmtDateTime, normMisis } from '@/lib/format';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, Kpi, readParams, SearchBar, type SearchParams } from '@/components/ui';
import { uploadSapAction } from './actions';

type Line = { reference: string; misis: string | null; channel: string | null; system_amount: number | null; sap_amount: number | null; at: Date | null; state: string };

export default async function Reconciliation({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('reconciliation');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const money = staff.can('view_revenue');
  const filter = get('f') || 'DISC';
  const q = normMisis(get('q'));
  const back = `/admin/finance/reconciliation?${new URLSearchParams({ f: filter, q })}`;
  const uploads = await sql<{ id: number; kind: string; filename: string; row_count: number; uploaded_by: string; created_at: Date }>(
    'select id, kind, filename, row_count, uploaded_by, created_at from reconciliation_uploads where season_id = $1 order by created_at desc limit 20', [S]);
  const lines = await sql<Line>(
    `with p as (
       select upper(reference) as reference, max(misis) as misis, max(channel) as channel, sum(amount_aed) as amount, max(at) as at
         from payments where season_id = $1 and reference is not null group by upper(reference)),
     l as (
       select upper(l.reference) as reference, max(l.misis) as misis, sum(l.amount_aed) as amount
         from reconciliation_lines l join reconciliation_uploads u on u.id = l.upload_id
        where u.season_id = $1 and l.reference is not null group by upper(l.reference))
     select coalesce(p.reference, l.reference) as reference, coalesce(p.misis, l.misis) as misis, p.channel,
            p.amount as system_amount, l.amount as sap_amount, p.at,
            case when p.reference is null then 'not_in_system'
                 when l.reference is null then 'awaiting'
                 when p.amount <> l.amount then 'amount_differs' else 'matched' end as state
       from p full join l on l.reference = p.reference
      order by p.at desc nulls last limit 2000`,
    [S],
  );
  const by = (s: string) => lines.filter((l) => l.state === s).length;
  const shown = lines.filter((l) =>
    (filter === 'ALL' || (filter === 'DISC' ? ['amount_differs', 'not_in_system'].includes(l.state) : filter === 'AWAIT' ? l.state === 'awaiting' : true))
    && (!q || l.misis === q));
  const label: Record<string, [string, string]> = {
    matched: ['Matched', 'ok'], awaiting: ['Awaiting SAP / invoice', 'warn'], amount_differs: ['Amount differs', 'bad'], not_in_system: ['In SAP only', 'bad'],
  };

  return (
    <>
      <h1>Reconciliation</h1>
      <p className="page-sub">Upload the SAP daily balance and invoice reports. The system compares them with every payment it recorded, by reference (receipt number, CCAvenue tracking id or order reference).</p>
      <Flash msg={get('msg')} err={get('err')} />
      <div className="grid four">
        <Kpi label="Matched" value={by('matched')} />
        <Kpi label="Awaiting SAP" value={by('awaiting')} />
        <Kpi label="Amount differs" value={by('amount_differs')} />
        <Kpi label="In SAP, not in the system" value={by('not_in_system')} />
      </div>
      <form action={uploadSapAction} className="card" style={{ margin: '16px 0' }}>
        <Back to={back} />
        <h3>Upload SAP report (CSV)</h3>
        <div className="inline">
          <select name="kind" defaultValue="sap_balance" aria-label="Report type">
            <option value="sap_balance">SAP daily balance</option>
            <option value="sap_invoice">SAP invoices</option>
          </select>
          <input type="file" name="file" accept=".csv,text/csv" required style={{ width: 'auto' }} />
          <Submit>Upload</Submit>
        </div>
        <p className="small muted">Columns: <span className="mono">reference, amount</span> (optional <span className="mono">misis, date, description</span>).</p>
      </form>
      <SearchBar action="/admin/finance/reconciliation" q={q} hidden={{ f: filter }} />
      <form method="get" className="inline" style={{ marginBottom: 12 }}>
        {q ? <input type="hidden" name="q" value={q} /> : null}
        <select name="f" defaultValue={filter} aria-label="Filter">
          <option value="ALL">All payments</option>
          <option value="DISC">Discrepancies only</option>
          <option value="AWAIT">Awaiting invoice</option>
        </select>
        <button className="btn ghost sm">Show</button>
      </form>
      {shown.length === 0 ? <Empty>Nothing to show.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Reference</th><th>MISIS</th><th>Channel</th><th>Date</th>{money ? <><th className="num">System</th><th className="num">SAP</th></> : null}<th>Result</th></tr></thead>
            <tbody>
              {shown.map((l) => (
                <tr key={l.reference}>
                  <td className="mono">{l.reference}</td><td className="mono">{l.misis ?? '—'}</td><td>{l.channel?.replace('_', ' ') ?? '—'}</td><td>{fmtDateTime(l.at)}</td>
                  {money ? <><td className="num">{l.system_amount !== null ? aed(l.system_amount) : '—'}</td><td className="num">{l.sap_amount !== null ? aed(l.sap_amount) : '—'}</td></> : null}
                  <td><span className={`pill ${label[l.state][1]}`}>{label[l.state][0]}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2 style={{ marginTop: 20 }}>Uploads</h2>
      {uploads.length === 0 ? <Empty>No SAP files uploaded yet.</Empty> : (
        <ul className="small">{uploads.map((u) => <li key={u.id}>{fmtDateTime(u.created_at)} · {u.kind === 'sap_invoice' ? 'Invoices' : 'Daily balance'} · {u.filename} · {u.row_count} rows · {u.uploaded_by}</li>)}</ul>
      )}
    </>
  );
}
