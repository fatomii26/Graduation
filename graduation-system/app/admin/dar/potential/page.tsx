import { sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { normMisis } from '@/lib/format';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, readParams, SearchBar, type SearchParams } from '@/components/ui';
import { bulkConfirmAction, confirmAction } from '../actions';

export default async function Potential({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('potential_graduates');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const q = normMisis(get('q'));
  const f = get('f') || 'POT';
  const back = `/admin/dar/potential?${new URLSearchParams({ q, f })}`;
  const rows = await sql<{ misis: string; full_name: string; programme: string; confirmed_graduate: boolean; ceremony: string | null; has_tickets: boolean }>(
    `select g.misis, g.full_name, g.programme, g.confirmed_graduate, c.name as ceremony,
            exists (select 1 from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.status = 'valid') as has_tickets
       from graduates g left join ceremonies c on c.id = g.ceremony_id
      where g.season_id = $1 and ($2 = '' or g.misis = $2)
        and ($3 = 'ALL' or ($3 = 'POT' and not g.confirmed_graduate) or ($3 = 'CONF' and g.confirmed_graduate))
      order by g.misis limit 500`,
    [S, q, f],
  );
  return (
    <>
      <h1>Potential Graduates</h1>
      <p className="page-sub">Students on the Master List who are not yet confirmed to graduate cannot buy tickets or be allocated.</p>
      <Flash msg={get('msg')} err={get('err')} />
      <SearchBar action="/admin/dar/potential" q={q} hidden={{ f }} />
      <div className="row" style={{ marginBottom: 12 }}>
        <form method="get" className="inline">
          {q ? <input type="hidden" name="q" value={q} /> : null}
          <select name="f" defaultValue={f} aria-label="Show">
            <option value="POT">Not yet confirmed</option><option value="CONF">Confirmed</option><option value="ALL">All students</option>
          </select>
          <button className="btn ghost sm">Show</button>
        </form>
        <details>
          <summary>Confirm from a list (CSV)</summary>
          <form action={bulkConfirmAction} className="inline" style={{ marginTop: 8 }}>
            <Back to={back} />
            <input type="file" name="file" accept=".csv,text/csv" required style={{ width: 'auto' }} />
            <Submit className="btn sm">Confirm all in file</Submit>
          </form>
        </details>
      </div>
      {rows.length === 0 ? <Empty>Nobody in this list.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>MISIS</th><th>Name</th><th>Programme</th><th>Status</th><th>Ceremony</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.misis}>
                  <td className="mono">{r.misis}</td><td>{r.full_name}</td><td>{r.programme}</td>
                  <td>{r.confirmed_graduate ? <span className="pill ok">Confirmed</span> : <span className="pill warn">Potential</span>}</td>
                  <td>{r.ceremony ?? '—'}</td>
                  <td>
                    {r.has_tickets ? <span className="small muted">has tickets</span> : (
                      <form action={confirmAction}>
                        <Back to={back} />
                        <input type="hidden" name="misis" value={r.misis} />
                        <input type="hidden" name="confirmed" value={r.confirmed_graduate ? 'no' : 'yes'} />
                        <Submit className={r.confirmed_graduate ? 'btn ghost sm' : 'btn sm'}>{r.confirmed_graduate ? 'Set back to potential' : 'Confirm graduate'}</Submit>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
