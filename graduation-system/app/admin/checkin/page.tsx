import { sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { getAppSettings, getCeremonies } from '@/lib/settings';
import { fmtTime, normMisis } from '@/lib/format';
import AutoRefresh from '@/components/AutoRefresh';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, readParams, SearchBar, type SearchParams } from '@/components/ui';
import { manualCheckinAction } from './actions';

type Row = {
  misis: string; full_name: string; grad_ticket: string | null; grad_in: Date | null;
  guests: { id: string; name: string; zone: string | null; door: string; door1: string | null; door2: string | null }[] | null;
};

export default async function EntryCheckIn({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('entry_checkin');
  const get = await readParams(searchParams);
  const ceremonies = await getCeremonies(staff.season.id);
  const c = ceremonies.find((x) => String(x.id) === get('c')) ?? ceremonies[0];
  if (!c) return <Empty>No ceremonies in this season.</Empty>;
  const q = normMisis(get('q'));
  const f = get('f') || 'ALL';
  const back = `/admin/checkin?${new URLSearchParams({ c: String(c.id), q, f })}`;
  const override = (await getAppSettings()).manual_checkin_override;
  const rows = await sql<Row>(
    `select g.misis, g.full_name,
            (select t.id::text from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.kind = 'graduate' and t.status = 'valid' and t.ceremony_id = $1) as grad_ticket,
            (select t.door1_at from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.kind = 'graduate' and t.status = 'valid' and t.ceremony_id = $1) as grad_in,
            (select json_agg(json_build_object('id', t.id, 'name', t.holder_name, 'zone', z.name, 'door', t.door, 'door1', t.door1_at, 'door2', t.door2_at) order by t.created_at)
               from tickets t left join zones z on z.id = t.zone_id
              where t.season_id = g.season_id and t.misis = g.misis and t.kind = 'guest' and t.status = 'valid' and t.ceremony_id = $1) as guests
       from graduates g
      where g.season_id = $2 and ($3 = '' or g.misis = $3)
        and exists (select 1 from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.status = 'valid' and t.ceremony_id = $1)
      order by g.full_name limit 1500`,
    [c.id, staff.season.id, q],
  );
  const shown = rows.filter((r) => {
    const allIn = !!r.grad_in && (r.guests ?? []).every((g) => g.door2);
    const anyIn = !!r.grad_in || (r.guests ?? []).some((g) => g.door1 || g.door2);
    return f === 'ALL' || (f === 'IN' ? allIn : f === 'PART' ? anyIn && !allIn : !anyIn);
  });

  return (
    <>
      <div className="row between">
        <h1>Entry Check-In</h1>
        <AutoRefresh seconds={3} />
      </div>
      <p className="page-sub">One row per graduate. Read only: scans are made on the Scanner page.{override ? ' Manual override is switched ON (reason required, audited).' : ''}</p>
      <Flash msg={get('msg')} err={get('err')} />
      <form method="get" className="inline" style={{ marginBottom: 12 }}>
        <select name="c" defaultValue={String(c.id)} aria-label="Ceremony">{ceremonies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select name="f" defaultValue={f} aria-label="Status">
          <option value="ALL">All</option><option value="IN">Everyone in</option><option value="PART">Partly arrived</option><option value="OUT">Not arrived</option>
        </select>
        {q ? <input type="hidden" name="q" value={q} /> : null}
        <button className="btn ghost sm">Show</button>
      </form>
      <SearchBar action="/admin/checkin" q={q} hidden={{ c: String(c.id), f }} />
      {shown.length === 0 ? <Empty>No graduates match.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Graduate</th><th>Graduate ticket</th><th>Guests · Door 1 · Door 2</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.misis}>
                  <td><strong>{r.full_name}</strong><div className="small mono">{r.misis}</div></td>
                  <td>
                    {!r.grad_ticket ? <span className="muted">no ticket</span> : r.grad_in ? <span className="pill ok">in {fmtTime(r.grad_in)}</span> : <span className="pill">not yet</span>}
                    {override && r.grad_ticket && !r.grad_in ? <Manual ticket={r.grad_ticket} checkpoint="graduate" back={back} /> : null}
                  </td>
                  <td>
                    {(r.guests ?? []).length === 0 ? <span className="muted">no guests</span> : (
                      <table className="t" style={{ fontSize: '0.82rem' }}>
                        <tbody>
                          {(r.guests ?? []).map((g) => (
                            <tr key={g.id}>
                              <td>{g.name}<div className="small muted">{g.zone} · {g.door}</div></td>
                              <td>{g.door1 ? <span className="pill ok">D1 {fmtTime(g.door1)}</span> : <span className="pill">D1 —</span>}
                                {override && !g.door1 ? <Manual ticket={g.id} checkpoint="door1" back={back} /> : null}</td>
                              <td>{g.door2 ? <span className="pill ok">D2 {fmtTime(g.door2)}</span> : <span className="pill">D2 —</span>}
                                {override && !g.door2 ? <Manual ticket={g.id} checkpoint="door2" back={back} /> : null}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
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

function Manual({ ticket, checkpoint, back }: { ticket: string; checkpoint: string; back: string }) {
  return (
    <details>
      <summary className="small">Manual</summary>
      <form action={manualCheckinAction}>
        <Back to={back} />
        <input type="hidden" name="ticket" value={ticket} />
        <input type="hidden" name="checkpoint" value={checkpoint} />
        <input name="reason" placeholder="Reason (scanner failed…)" required minLength={3} style={{ width: 180 }} />
        <Submit className="btn sm" confirm="Check in manually? This is recorded with your name.">Check in</Submit>
      </form>
    </details>
  );
}
