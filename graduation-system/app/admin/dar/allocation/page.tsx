import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { ceremonyOptions } from '@/lib/admin-queries';
import { fmtDateTime, normMisis } from '@/lib/format';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, Kpi, readParams, SearchBar, type SearchParams } from '@/components/ui';
import { allocateAction, autoAllocateAction } from '../actions';

type Row = {
  misis: string; full_name: string; programme: string; confirmed_graduate: boolean; financial_hold: boolean; hold_reason: string | null;
  hold_removed_at: Date | null; finance_request_sent_at: Date | null; ceremony_number: number | null; mapped: number | null; has_tickets: boolean;
};

export default async function Allocation({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('ceremony_allocation');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const q = normMisis(get('q'));
  const f = get('f') || 'READY';
  const back = `/admin/dar/allocation?${new URLSearchParams({ q, f })}`;
  const ceremonies = await ceremonyOptions(S);
  const rows = await sql<Row>(
    `select g.misis, g.full_name, g.programme, g.confirmed_graduate, g.financial_hold,
            (select reason from financial_holds h where h.season_id = g.season_id and h.misis = g.misis and h.status = 'active') as hold_reason,
            (select max(removed_at) from financial_holds h where h.season_id = g.season_id and h.misis = g.misis and h.status = 'removed') as hold_removed_at,
            g.finance_request_sent_at, c.number as ceremony_number, pm.ceremony_number as mapped,
            exists (select 1 from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.status = 'valid') as has_tickets
       from graduates g left join ceremonies c on c.id = g.ceremony_id
       left join programme_ceremony_map pm on pm.season_id = g.season_id and lower(pm.programme) = lower(g.programme)
      where g.season_id = $1 and ($2 = '' or g.misis = $2)
        and ($3 = 'ALL'
          or ($3 = 'READY' and g.ceremony_id is null and g.confirmed_graduate and not g.financial_hold and g.finance_request_sent_at is not null)
          or ($3 = 'BLOCKED' and g.ceremony_id is null and (not g.confirmed_graduate or g.financial_hold or g.finance_request_sent_at is null))
          or ($3 = 'HOLD' and g.financial_hold)
          or ($3 = 'DONE' and g.ceremony_id is not null))
      order by g.misis limit 500`,
    [S, q, f],
  );
  const stats = (await sql<{ ready: number; blocked: number; done: number; hold: number }>(
    `select count(*) filter (where ceremony_id is null and confirmed_graduate and not financial_hold and finance_request_sent_at is not null)::int as ready,
            count(*) filter (where ceremony_id is null and (not confirmed_graduate or financial_hold or finance_request_sent_at is null))::int as blocked,
            count(*) filter (where ceremony_id is not null)::int as done,
            count(*) filter (where financial_hold)::int as hold
       from graduates where season_id = $1`, [S]))[0];

  return (
    <>
      <h1>Financial Hold and Allocation</h1>
      <p className="page-sub">A student can be allocated to a ceremony only when confirmed as a graduate, free of financial hold, and Finance has sent the clearance request.</p>
      <Flash msg={get('msg')} err={get('err')} />
      <div className="grid four" style={{ marginBottom: 16 }}>
        <Kpi label="Ready to allocate" value={stats?.ready ?? 0} />
        <Kpi label="Allocated" value={stats?.done ?? 0} />
        <Kpi label="Blocked (not confirmed, hold or no Finance request)" value={stats?.blocked ?? 0} />
        <Kpi label="On financial hold" value={stats?.hold ?? 0} />
      </div>
      <div className="row" style={{ marginBottom: 12 }}>
        <form action={autoAllocateAction}>
          <Back to={back} />
          <Submit confirm="Allocate every ready graduate using the Programme to Ceremony Map?">Allocate by programme map</Submit>
        </form>
        {staff.can('programme_map') ? <Link className="btn ghost" href="/admin/access?tab=programmes">Programme to Ceremony Map</Link> : null}
      </div>
      <SearchBar action="/admin/dar/allocation" q={q} hidden={{ f }} />
      <form method="get" className="inline" style={{ marginBottom: 12 }}>
        {q ? <input type="hidden" name="q" value={q} /> : null}
        <select name="f" defaultValue={f} aria-label="Show">
          <option value="READY">Ready to allocate</option><option value="BLOCKED">Blocked</option><option value="HOLD">Financial hold list</option>
          <option value="DONE">Allocated</option><option value="ALL">Everyone</option>
        </select>
        <button className="btn ghost sm">Show</button>
      </form>
      {rows.length === 0 ? <Empty>Nobody in this list.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>MISIS</th><th>Name</th><th>Programme</th><th>Confirmed</th><th>Financial hold</th><th>Finance request</th><th>Ceremony</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.misis}>
                  <td className="mono">{r.misis}</td><td>{r.full_name}</td><td>{r.programme}{r.mapped ? <div className="small muted">map: Ceremony {r.mapped}</div> : null}</td>
                  <td>{r.confirmed_graduate ? <span className="pill ok">yes</span> : <span className="pill warn">potential</span>}</td>
                  <td>{r.financial_hold ? <span className="pill bad">{r.hold_reason ?? 'hold'}</span> : r.hold_removed_at ? <span className="small">removed {fmtDateTime(r.hold_removed_at)}</span> : <span className="pill ok">none</span>}</td>
                  <td>{r.finance_request_sent_at ? <span className="small">sent {fmtDateTime(r.finance_request_sent_at)}</span> : <span className="pill">not sent</span>}</td>
                  <td>
                    {r.has_tickets ? <strong>Ceremony {r.ceremony_number} (tickets issued)</strong> : (
                      <form action={allocateAction} className="inline">
                        <Back to={back} />
                        <input type="hidden" name="misis" value={r.misis} />
                        <select name="ceremony" defaultValue={String(r.ceremony_number ?? r.mapped ?? '')} aria-label="Ceremony" style={{ width: 'auto' }}>
                          <option value="">Not allocated</option>
                          {ceremonies.map((c) => <option key={c.id} value={c.number}>{c.name}</option>)}
                        </select>
                        <Submit className="btn sm">Save</Submit>
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
