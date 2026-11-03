import { sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { fmtDateTime, normMisis } from '@/lib/format';
import { Empty, Flash, readParams, Tabs, type SearchParams } from '@/components/ui';
import { VERSION_TABS } from '@/lib/menu';

export default async function Versions({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('version_changes');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const cat = VERSION_TABS.some(([k]) => k === get('tab')) ? get('tab') : 'ALL';
  const q = normMisis(get('q'));
  const cats = VERSION_TABS.find(([k]) => k === cat)![2];
  const rows = await sql<{ at: Date; actor: string; action: string; category: string; misis: string | null; details: Record<string, unknown>; reason: string | null }>(
    `select at, actor, action, category, misis, details, reason from audit_log
      where (season_id = $1 or season_id is null) and ($2 = '' or misis = $2) and (cardinality($3::text[]) = 0 or category = any($3))
      order by at desc limit 500`,
    [S, q, cats],
  );
  return (
    <>
      <h1>Version Changes</h1>
      <p className="page-sub">A record of every change, with who made it and when. Pick a tab to see the changes made there, or search a student to see everything that happened to that record. The log cannot be edited or deleted.</p>
      <Flash msg={get('msg')} err={get('err')} />
      <form className="searchbar" method="get">
        <label htmlFor="q">Student History</label>
        <input type="hidden" name="tab" value={cat} />
        <input id="q" name="q" defaultValue={q} placeholder="Enter MISIS, e.g. M00123456" />
        <button className="btn sm">Show History</button>
        {q ? <a className="btn ghost sm" href={`/admin/versions?tab=${cat}`}>Show All Changes</a> : null}
      </form>
      <Tabs base="/admin/versions" tabs={VERSION_TABS.map(([k, l]) => [k, l] as [string, string])} current={cat} keep={{ q }} />
      <p><a className="btn ghost sm" href={`/api/export?type=audit&cat=${cat}&q=${q}`}>Download This View (CSV)</a></p>
      {rows.length === 0 ? <Empty>No changes recorded.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>When</th><th>Who</th><th>What</th><th>MISIS</th><th>Details</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.at)}</td>
                  <td className="small">{r.actor}</td>
                  <td>{r.action.replace(/_/g, ' ')}<div className="small muted">{r.category.replace(/_/g, ' ')}</div></td>
                  <td className="mono">{r.misis ?? ''}</td>
                  <td className="small" style={{ maxWidth: 420, wordBreak: 'break-word' }}>
                    {Object.keys(r.details ?? {}).length ? JSON.stringify(r.details).slice(0, 400) : ''}
                    {r.reason ? <div><strong>Reason:</strong> {r.reason}</div> : null}
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
