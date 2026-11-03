import { sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { getSeasonSettings } from '@/lib/settings';
import { studentSummary } from '@/lib/admin-queries';
import { aed, fmtDateTime, normMisis, ticketsText } from '@/lib/format';
import StudentCard from '@/components/StudentCard';
import CounterForm from '@/components/CounterForm';
import { Empty, Flash, Kpi, readParams, SearchBar, type SearchParams } from '@/components/ui';
import { counterPaymentAction } from '../actions';

export default async function GraduationDay({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('graduation_day_payments');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const q = normMisis(get('q'));
  const back = `/admin/finance/graduation-day${q ? `?q=${q}` : ''}`;
  const money = staff.can('view_revenue');
  const settings = (await getSeasonSettings(S))!;
  const s = q ? await studentSummary(S, q) : null;
  const rows = await sql<{ receipt_number: string; misis: string; full_name: string; includes_graduate: boolean; guest_count: number; amount_aed: number; method: string; entered_by: string; created_at: Date; status: string }>(
    `select r.receipt_number, r.misis, g.full_name, r.includes_graduate, r.guest_count, r.amount_aed, r.method, r.entered_by, r.created_at, r.status
       from receipts r join graduates g on g.season_id = r.season_id and g.misis = r.misis
      where r.season_id = $1 and r.source = 'graduation_day' order by r.created_at desc limit 300`,
    [S],
  );
  const today = rows.filter((r) => new Date(r.created_at).toDateString() === new Date().toDateString());

  return (
    <>
      <h1>Graduation Day Payments</h1>
      <p className="page-sub">Payments taken on the day, with the same counter flow. They work even when online sales are closed.</p>
      <Flash msg={get('msg')} err={get('err')} />
      <div className="grid four" style={{ marginBottom: 16 }}>
        <Kpi label="Payments today" value={today.length} />
        {money ? <Kpi label="Taken today" value={aed(today.reduce((a, r) => a + r.amount_aed, 0))} /> : null}
        <Kpi label="All Graduation Day payments" value={rows.length} />
      </div>
      <SearchBar action="/admin/finance/graduation-day" q={q} />
      {q && !s ? <div className="flash err">MISIS {q} is not on the Master List.</div> : null}
      {s ? <StudentCard s={s}><CounterForm s={s} settings={settings} source="graduation_day" back={back} action={counterPaymentAction} /></StudentCard> : null}
      {rows.length === 0 ? <Empty>No Graduation Day payments yet.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Time</th><th>Receipt</th><th>MISIS</th><th>Name</th><th>For</th>{money ? <th className="num">Amount</th> : null}<th>Method</th><th>By</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.receipt_number}>
                  <td>{fmtDateTime(r.created_at)}</td><td className="mono">{r.receipt_number}</td><td className="mono">{r.misis}</td><td>{r.full_name}</td>
                  <td>{ticketsText(r.includes_graduate, r.guest_count)}</td>{money ? <td className="num">{aed(r.amount_aed)}</td> : null}
                  <td>{r.method}</td><td className="small">{r.entered_by}</td>
                  <td><span className={`pill ${r.status === 'used' ? 'ok' : 'warn'}`}>{r.status === 'used' ? 'tickets issued' : 'zone to choose'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
