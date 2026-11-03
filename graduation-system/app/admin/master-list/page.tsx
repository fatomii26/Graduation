import { sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { testShortcutsAllowed } from '@/lib/settings';
import { ceremonyOptions } from '@/lib/admin-queries';
import { normMisis } from '@/lib/format';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, readParams, SearchBar, type SearchParams } from '@/components/ui';
import { importMasterListAction, setLimitAction, studentViewAction, updateContactAction } from './actions';

type Row = {
  misis: string; full_name: string; email: string; private_email: string | null; mobile: string | null; programme: string;
  confirmed_graduate: boolean; financial_hold: boolean; ceremony: string | null; max_guests: number | null; grad_seat_label: string | null;
  grad_ticket: boolean; guests: number;
};

export default async function MasterList({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('master_list');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const q = get('q');
  const cer = get('c');
  const back = `/admin/master-list?${new URLSearchParams({ q, c: cer })}`;
  const like = `%${q.toLowerCase()}%`;
  const rows = await sql<Row>(
    `select g.misis, g.full_name, g.email, g.private_email, g.mobile, g.programme, g.confirmed_graduate, g.financial_hold,
            c.name as ceremony, g.max_guests, g.grad_seat_label,
            exists (select 1 from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.kind = 'graduate' and t.status = 'valid') as grad_ticket,
            (select count(*) from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.kind = 'guest' and t.status = 'valid')::int as guests
       from graduates g left join ceremonies c on c.id = g.ceremony_id
      where g.season_id = $1
        and ($2 = '' or g.misis = $3 or lower(g.full_name) like $4 or g.email like $4)
        and ($5 = '' or ($5 = 'none' and g.ceremony_id is null) or c.number::text = $5)
      order by g.misis limit 300`,
    [S, q, normMisis(q), like, cer],
  );
  const total = await sql<{ n: number }>('select count(*)::int as n from graduates where season_id = $1', [S]);
  const ceremonies = await ceremonyOptions(S);
  const shortcuts = await testShortcutsAllowed();
  const canLimit = staff.can('prices', 'extra_tickets_approve');

  return (
    <>
      <h1>Master List</h1>
      <p className="page-sub">{total[0]?.n ?? 0} graduates in {staff.season.name}. Re-importing updates existing rows and never removes anyone.</p>
      <Flash msg={get('msg')} err={get('err')} />
      <SearchBar action="/admin/master-list" q={q} label="Search" placeholder="MISIS, name or email" hidden={{ c: cer }} />
      <div className="row" style={{ marginBottom: 12 }}>
        <form method="get" className="inline">
          {q ? <input type="hidden" name="q" value={q} /> : null}
          <select name="c" defaultValue={cer} aria-label="Ceremony">
            <option value="">All ceremonies</option>
            {ceremonies.map((c) => <option key={c.id} value={String(c.number)}>{c.name}</option>)}
            <option value="none">Not allocated</option>
          </select>
          <button className="btn ghost sm">Filter</button>
        </form>
        <a className="btn ghost sm" href={`/api/export?type=master_list`}>Download CSV</a>
      </div>

      <details className="card" style={{ marginBottom: 16 }}>
        <summary>Upload Master List (CSV)</summary>
        <form action={importMasterListAction}>
          <Back to={back} />
          <p className="small muted">
            Columns: <span className="mono">misis, email, mobile, full_name, programme, confirmed_graduate, financial_hold, ceremony, grad_seat_label, max_guests</span>.
            MISIS is 4 to 20 letters or digits; the email must be the university address. Empty cells leave the stored value unchanged.
            A ceremony is applied only when the student is confirmed, has no hold and Finance has sent the request.
          </p>
          <input type="file" name="file" accept=".csv,text/csv" required />
          <div style={{ marginTop: 10 }}><Submit>Upload and update</Submit></div>
        </form>
      </details>

      {rows.length === 0 ? (
        <Empty>No graduates match.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>MISIS</th><th>Name</th><th>Programme</th><th>Status</th><th>Ceremony</th><th>Tickets</th><th>Contact</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.misis}>
                  <td className="mono">{r.misis}</td>
                  <td><strong>{r.full_name}</strong>{r.grad_seat_label ? <div className="small muted">Seat label (staff only): {r.grad_seat_label}</div> : null}</td>
                  <td>{r.programme}</td>
                  <td>
                    <span className={`pill ${r.confirmed_graduate ? 'ok' : 'warn'}`}>{r.confirmed_graduate ? 'Confirmed' : 'Potential'}</span>{' '}
                    {r.financial_hold ? <span className="pill bad">Hold</span> : null}
                  </td>
                  <td>{r.ceremony ?? <span className="muted">—</span>}</td>
                  <td>{r.grad_ticket ? 'G' : '–'} + {r.guests}{r.max_guests !== null ? <div className="small muted">limit {r.max_guests}</div> : null}</td>
                  <td style={{ minWidth: 260 }}>
                    <details>
                      <summary className="small">{r.email}</summary>
                      <form action={updateContactAction}>
                        <Back to={back} />
                        <input type="hidden" name="misis" value={r.misis} />
                        <label className="f">University email</label>
                        <input name="email" defaultValue={r.email} required />
                        <label className="f">Private email</label>
                        <input name="private_email" defaultValue={r.private_email ?? ''} />
                        <label className="f">Mobile</label>
                        <input name="mobile" defaultValue={r.mobile ?? ''} />
                        <div style={{ marginTop: 8 }}><Submit className="btn sm">Save contact</Submit></div>
                      </form>
                      {canLimit ? (
                        <form action={setLimitAction} className="inline" style={{ marginTop: 10 }}>
                          <Back to={back} />
                          <input type="hidden" name="misis" value={r.misis} />
                          <label className="small">Personal guest limit</label>
                          <input name="max_guests" defaultValue={r.max_guests ?? ''} placeholder="season" style={{ width: 80 }} />
                          <Submit className="btn ghost sm">Save</Submit>
                        </form>
                      ) : null}
                      {shortcuts ? (
                        <form action={studentViewAction} style={{ marginTop: 10 }}>
                          <Back to={back} />
                          <input type="hidden" name="misis" value={r.misis} />
                          <Submit className="btn gold sm">Open student view (test mode)</Submit>
                        </form>
                      ) : null}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 300 ? <p className="small muted">Showing the first 300. Search or filter to narrow down.</p> : null}
    </>
  );
}
