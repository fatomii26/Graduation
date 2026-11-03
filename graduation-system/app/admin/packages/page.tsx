import { revalidatePath } from 'next/cache';
import { fn, sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { studentSummary } from '@/lib/admin-queries';
import { fmtDateTime, normMisis } from '@/lib/format';
import { backPath, bool, finish, str } from '@/lib/forms';
import StudentCard from '@/components/StudentCard';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, Kpi, readParams, type SearchParams } from '@/components/ui';

async function savePackageAction(fd: FormData) {
  'use server';
  const staff = await requireStaff('package_collection');
  const back = backPath(fd, '/admin/packages');
  const r = await fn('set_package', [staff.season.id, str(fd, 'misis', 20), bool(fd, 'cap'), bool(fd, 'gown'), bool(fd, 'scarf'), bool(fd, 'name_card'), staff.email]);
  revalidatePath('/admin/packages');
  finish(back, r, 'Package collection saved.');
}

export default async function Packages({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('package_collection');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const q = normMisis(get('q'));
  const back = `/admin/packages${q ? `?q=${q}` : ''}`;
  const s = q ? await studentSummary(S, q) : null;
  const p = q ? (await sql<{ cap: boolean; gown: boolean; scarf: boolean; name_card: boolean; collected_by: string; updated_at: Date }>(
    'select cap, gown, scarf, name_card, collected_by, updated_at from package_collections where season_id = $1 and misis = $2', [S, q]))[0] : null;
  const stats = (await sql<{ eligible: number; complete: number; partial: number }>(
    `select (select count(*) from tickets where season_id = $1 and kind = 'graduate' and status = 'valid')::int as eligible,
            count(*) filter (where cap and gown and scarf and name_card)::int as complete,
            count(*) filter (where not (cap and gown and scarf and name_card))::int as partial
       from package_collections where season_id = $1`, [S]))[0];
  const recent = await sql<{ misis: string; full_name: string; cap: boolean; gown: boolean; scarf: boolean; name_card: boolean; collected_by: string; updated_at: Date }>(
    `select p.misis, g.full_name, p.cap, p.gown, p.scarf, p.name_card, p.collected_by, p.updated_at
       from package_collections p join graduates g on g.season_id = p.season_id and g.misis = p.misis
      where p.season_id = $1 order by p.updated_at desc limit 50`, [S]);
  const tick = (v: boolean) => (v ? '✓' : '—');

  return (
    <>
      <h1>Package Collection</h1>
      <p className="page-sub">Cap, gown, scarf and name card. Reminders for uncollected packages are set in Admin Access.</p>
      <Flash msg={get('msg')} err={get('err')} />
      <div className="grid four" style={{ marginBottom: 16 }}>
        <Kpi label="Graduates with a ticket" value={stats?.eligible ?? 0} />
        <Kpi label="Fully collected" value={stats?.complete ?? 0} />
        <Kpi label="Partly collected" value={stats?.partial ?? 0} />
      </div>
      <form className="searchbar" method="get">
        <label htmlFor="q">Graduate MISIS</label>
        <input id="q" name="q" defaultValue={q} placeholder="Scan or type the MISIS" autoFocus />
        <button className="btn sm">Open</button>
      </form>
      {q && !s ? <div className="flash err">MISIS {q} is not on the Master List.</div> : null}
      {s ? (
        <StudentCard s={s}>
          <form action={savePackageAction} className="card flat">
            <Back to={back} />
            <input type="hidden" name="misis" value={s.misis} />
            <div className="row">
              {(['cap', 'gown', 'scarf', 'name_card'] as const).map((k) => (
                <label className="check" key={k} style={{ fontSize: '1.05rem' }}>
                  <input type="checkbox" name={k} defaultChecked={!!p?.[k]} style={{ width: 22, height: 22 }} /> {k === 'name_card' ? 'Name card' : k[0].toUpperCase() + k.slice(1)}
                </label>
              ))}
            </div>
            {p ? <p className="small muted">Last updated {fmtDateTime(p.updated_at)} by {p.collected_by}</p> : null}
            <Submit>Save collection</Submit>
          </form>
        </StudentCard>
      ) : null}
      <h2>Latest collections</h2>
      {recent.length === 0 ? <Empty>No packages collected yet.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>MISIS</th><th>Name</th><th>Cap</th><th>Gown</th><th>Scarf</th><th>Name card</th><th>By</th><th>When</th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.misis}><td className="mono">{r.misis}</td><td>{r.full_name}</td><td>{tick(r.cap)}</td><td>{tick(r.gown)}</td><td>{tick(r.scarf)}</td><td>{tick(r.name_card)}</td><td className="small">{r.collected_by}</td><td>{fmtDateTime(r.updated_at)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
