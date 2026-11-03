import Link from 'next/link';
import { sql } from '@/lib/db';
import { requireStaff, type StaffCtx } from '@/lib/auth/staff';
import { getCeremonies, getSeasonSettings, getSeasons } from '@/lib/settings';
import { aed, fmtDateTime, toDubaiInput } from '@/lib/format';
import MerchPic from '@/components/MerchPic';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, readParams, Tabs, type SearchParams } from '@/components/ui';
import {
  addUserAction, createSeasonAction, permissionsAction, removeMerchItemAction, resendInviteAction, saveCeremonyAction, saveLimitAction,
  saveMerchItemAction, savePricesAction, saveProgrammeAction, saveReminderAction, saveShopDateAction, saveVenueAccessAction, seasonStatusAction,
  updateUserAction, uploadProgrammesAction, userStatusAction,
} from './actions';

const DEPARTMENTS = ['Finance', 'Marketing', 'DAR and Campus Central', 'Events Team', 'IT', 'Security', 'Other'];

export default async function AdminAccess({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('user_access', 'seasons', 'prices', 'layout_edit', 'programme_map');
  const get = await readParams(searchParams);
  const all: [string, string, string[]][] = [
    ['users', 'User Access', ['user_access']],
    ['seasons', 'Graduation Seasons', ['seasons']],
    ['prices', 'Ticket Prices and Packages', ['prices']],
    ['limit', 'Ticket Purchase Limit', ['prices']],
    ['venue', 'Hall Layout and Venue', ['layout_edit']],
    ['reminder', 'Package Collection Reminder', ['seasons']],
    ['merch', 'Merchandise Items', ['prices']],
    ['programmes', 'Programme to Ceremony Map', ['programme_map']],
  ];
  const allowed = all.filter(([, , p]) => staff.can(...p));
  const tab = allowed.some(([k]) => k === get('tab')) ? get('tab') : allowed[0][0];
  const back = `/admin/access?tab=${tab}`;
  return (
    <>
      <h1>Admin Access</h1>
      <p className="page-sub">Settings for {staff.season.name}. Every change is written to the audit log (Version Changes).</p>
      <Flash msg={get('msg')} err={get('err')} />
      <Tabs base="/admin/access" tabs={allowed.map(([k, l]) => [k, l] as [string, string])} current={tab} />
      {tab === 'users' ? <Users back={back} me={staff} /> : null}
      {tab === 'seasons' ? <Seasons back={back} staff={staff} /> : null}
      {tab === 'prices' ? <Prices back={back} season={staff.season.id} /> : null}
      {tab === 'limit' ? <Limit back={back} season={staff.season.id} /> : null}
      {tab === 'venue' ? <Venue back={back} season={staff.season.id} /> : null}
      {tab === 'reminder' ? <Reminder back={back} season={staff.season.id} /> : null}
      {tab === 'merch' ? <Merch back={back} season={staff.season.id} /> : null}
      {tab === 'programmes' ? <Programmes back={back} season={staff.season.id} /> : null}
    </>
  );
}

async function Users({ back, me }: { back: string; me: StaffCtx }) {
  const [users, roles, perms, seasons] = await Promise.all([
    sql<{ email: string; full_name: string; job_title: string; department: string; role: string; status: string; all_seasons: boolean; seasons: string[]; last_login_at: Date | null; effective: string[] }>(
      `select email, full_name, job_title, department, role, status, all_seasons, seasons, last_login_at,
              (select coalesce(array_agg(p), '{}') from (
                 select rp.permission p from role_permissions rp where rp.role = s.role
                   and not exists (select 1 from staff_permissions sp where sp.email = s.email and sp.permission = rp.permission and not sp.allowed)
                 union select sp.permission from staff_permissions sp where sp.email = s.email and sp.allowed) x) as effective
         from staff s order by (status = 'removed'), department, full_name`),
    sql<{ name: string; description: string }>('select name, description from roles order by sort'),
    sql<{ key: string; label: string; grp: string }>('select key, label, grp from permissions order by sort'),
    getSeasons(),
  ]);
  const UserFields = ({ u }: { u?: (typeof users)[number] }) => (
    <>
      <div className="grid">
        <div><label className="f">Full name</label><input name="full_name" defaultValue={u?.full_name} required /></div>
        <div><label className="f">Job title</label><input name="job_title" defaultValue={u?.job_title} /></div>
        <div>
          <label className="f">Department</label>
          <select name="department" defaultValue={u?.department ?? 'Finance'}>{DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}</select>
        </div>
        <div>
          <label className="f">Role preset</label>
          <select name="role" defaultValue={u?.role ?? 'Finance'}>{roles.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}</select>
        </div>
      </div>
      <fieldset>
        <legend>Visible seasons</legend>
        <label className="check"><input type="radio" name="season_scope" value="all" defaultChecked={u ? u.all_seasons : true} /> All seasons</label>
        <label className="check"><input type="radio" name="season_scope" value="some" defaultChecked={u ? !u.all_seasons : false} /> Only:</label>
        <div className="row">{seasons.map((s) => <label key={s.id} className="check"><input type="checkbox" name="seasons" value={s.id} defaultChecked={u?.seasons.includes(s.id)} /> {s.name}</label>)}</div>
      </fieldset>
    </>
  );
  return (
    <>
      <details className="card" style={{ marginBottom: 16 }} open={users.length < 2}>
        <summary>Add user</summary>
        <form action={addUserAction}>
          <Back to={back} />
          <label className="f">MDX staff email (must end in @mdx.ac.ae)</label>
          <input name="email" type="email" required pattern=".+@mdx\.ac\.ae" placeholder="name@mdx.ac.ae" />
          <UserFields />
          <p className="small muted">A welcome email is sent. They sign in with their university Microsoft account; no password is created or stored. Adjust individual permissions after adding.</p>
          <Submit>Add user and send welcome email</Submit>
        </form>
      </details>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Name</th><th>Department / role</th><th>Status</th><th>Seasons</th><th>Last sign-in</th><th>Manage</th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.email} className={u.status === 'removed' ? 'dim' : ''}>
                <td><strong>{u.full_name}</strong><div className="small muted">{u.job_title} · {u.email}</div></td>
                <td>{u.department}<div className="small">{u.role}</div></td>
                <td><span className={`pill ${u.status === 'active' ? 'ok' : u.status === 'invited' ? 'info' : u.status === 'paused' ? 'warn' : ''}`}>{u.status}</span></td>
                <td className="small">{u.all_seasons ? 'All' : u.seasons.join(', ') || 'None'}</td>
                <td className="small">{fmtDateTime(u.last_login_at)}</td>
                <td style={{ minWidth: 300 }}>
                  <div className="row">
                    {u.status === 'invited' ? <form action={resendInviteAction}><Back to={back} /><input type="hidden" name="email" value={u.email} /><Submit className="btn ghost sm">Resend invite</Submit></form> : null}
                    {u.email !== me.email && u.status !== 'removed' ? (
                      <form action={userStatusAction}>
                        <Back to={back} />
                        <input type="hidden" name="email" value={u.email} />
                        <input type="hidden" name="status" value={u.status === 'paused' ? 'active' : 'paused'} />
                        <Submit className="btn ghost sm">{u.status === 'paused' ? 'Activate' : 'Pause'}</Submit>
                      </form>
                    ) : null}
                    {u.email !== me.email && u.status !== 'removed' ? (
                      <form action={userStatusAction}>
                        <Back to={back} />
                        <input type="hidden" name="email" value={u.email} />
                        <input type="hidden" name="status" value="removed" />
                        <Submit className="btn ghost sm" confirm="Remove this user? They are kept in the records but can no longer sign in.">Remove</Submit>
                      </form>
                    ) : null}
                    {u.status === 'removed' ? (
                      <form action={userStatusAction}><Back to={back} /><input type="hidden" name="email" value={u.email} /><input type="hidden" name="status" value="invited" /><Submit className="btn ghost sm">Restore</Submit></form>
                    ) : null}
                  </div>
                  <details style={{ marginTop: 6 }}>
                    <summary className="small">Edit role and permissions</summary>
                    <form action={updateUserAction}>
                      <Back to={back} />
                      <input type="hidden" name="email" value={u.email} />
                      <UserFields u={u} />
                      <Submit className="btn sm">Save user</Submit>
                    </form>
                    <form action={permissionsAction} style={{ marginTop: 12 }}>
                      <Back to={back} />
                      <input type="hidden" name="email" value={u.email} />
                      <p className="small muted">Individual permissions (role preset plus changes). Revenue is never given to Marketing, Events or Security.</p>
                      {Array.from(new Set(perms.map((p) => p.grp))).map((g) => (
                        <fieldset key={g}>
                          <legend>{g}</legend>
                          {perms.filter((p) => p.grp === g).map((p) => (
                            <label key={p.key} className="check small"><input type="checkbox" name="perm" value={p.key} defaultChecked={u.effective.includes(p.key)} /> {p.label}</label>
                          ))}
                        </fieldset>
                      ))}
                      <Submit className="btn sm">Save permissions</Submit>
                    </form>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function Seasons({ back, staff }: { back: string; staff: StaffCtx }) {
  const [seasons, ceremonies] = await Promise.all([getSeasons(), getCeremonies(staff.season.id)]);
  return (
    <>
      <div className="table-wrap" style={{ marginBottom: 16 }}>
        <table className="t">
          <thead><tr><th>Season</th><th>Code</th><th>Status</th><th /></tr></thead>
          <tbody>
            {seasons.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong>{s.cleaned_at ? <div className="small muted">personal data removed {fmtDateTime(s.cleaned_at)}</div> : null}</td>
                <td className="mono">{s.id}</td>
                <td><span className={`pill ${s.status === 'open' ? 'ok' : ''}`}>{s.status}</span></td>
                <td>
                  <form action={seasonStatusAction}>
                    <Back to={back} />
                    <input type="hidden" name="id" value={s.id} />
                    <input type="hidden" name="status" value={s.status === 'open' ? 'closed' : 'open'} />
                    <Submit className="btn ghost sm" confirm={s.status === 'open' ? 'Close this season? Online sales stop.' : 'Reopen this season?'}>{s.status === 'open' ? 'Close' : 'Reopen'}</Submit>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form action={createSeasonAction} className="card" style={{ marginBottom: 16 }}>
        <Back to={back} />
        <h3>Create a season</h3>
        <div className="grid four">
          <div><label className="f">Code</label><input name="id" placeholder="MAR-2027" required pattern="[A-Za-z0-9-]{3,20}" /></div>
          <div><label className="f">Name</label><input name="name" placeholder="Mar 2027" required /></div>
          <div>
            <label className="f">Copy settings from</label>
            <select name="copy_from" defaultValue={seasons[0]?.id}>{seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}<option value="">Nothing (defaults)</option></select>
          </div>
        </div>
        <div style={{ marginTop: 10 }}><Submit>Create season</Submit></div>
      </form>
      <h2>Ceremonies in {staff.season.name}</h2>
      <p className="small muted">Times are Dubai time. Tickets show the ceremony name, date and time, and the graduate entrance.</p>
      {[...ceremonies, { id: 0, number: ceremonies.length + 1, name: '', starts_at: null, doors_open_at: null, graduate_entrance: 'Graduate entrance' }].map((c) => (
        <form key={c.id} action={saveCeremonyAction} className="card flat" style={{ marginBottom: 8 }}>
          <Back to={back} />
          <div className="grid four">
            <div><label className="f">Number</label><input name="number" defaultValue={c.number} readOnly={!!c.id} inputMode="numeric" /></div>
            <div><label className="f">Name</label><input name="name" defaultValue={c.name} placeholder={c.id ? '' : 'Add a ceremony'} required /></div>
            <div><label className="f">Starts</label><input name="starts_at" type="datetime-local" defaultValue={toDubaiInput(c.starts_at)} /></div>
            <div><label className="f">Doors open</label><input name="doors_open_at" type="datetime-local" defaultValue={toDubaiInput(c.doors_open_at)} /></div>
            <div><label className="f">Graduate entrance</label><input name="graduate_entrance" defaultValue={c.graduate_entrance} /></div>
          </div>
          <div style={{ marginTop: 8 }}><Submit className="btn sm">{c.id ? 'Save ceremony' : 'Add ceremony'}</Submit></div>
        </form>
      ))}
    </>
  );
}

async function Prices({ back, season }: { back: string; season: string }) {
  const s = (await getSeasonSettings(season))!;
  return (
    <form action={savePricesAction} className="card">
      <Back to={back} />
      <h2>Ticket prices</h2>
      <div className="grid">
        <div><label className="f">Graduate ticket (AED)</label><input name="graduate_price_aed" defaultValue={s.graduate_price_aed} inputMode="decimal" required /></div>
        <div><label className="f">Guest ticket (AED)</label><input name="guest_price_aed" defaultValue={s.guest_price_aed} inputMode="decimal" required /></div>
      </div>
      <p className="small muted">Packages: graduate only {aed(s.graduate_price_aed)} · graduate + 1 guest {aed(s.graduate_price_aed + s.guest_price_aed)} · graduate + {s.guest_limit} guests {aed(s.graduate_price_aed + s.guest_limit * s.guest_price_aed)}.</p>
      <p className="small muted">Online sales are {s.sales_open ? 'open' : 'closed'} (switched in Technical Settings → Feature Switches).</p>
      <Submit>Save prices</Submit>
    </form>
  );
}

async function Limit({ back, season }: { back: string; season: string }) {
  const s = (await getSeasonSettings(season))!;
  return (
    <form action={saveLimitAction} className="card">
      <Back to={back} />
      <h2>Ticket purchase limit</h2>
      <div className="grid">
        <div><label className="f">Guest tickets per graduate</label><input name="guest_limit" defaultValue={s.guest_limit} inputMode="numeric" required /></div>
        <div><label className="f">Extra ticket code valid for (hours)</label><input name="extra_code_hours" defaultValue={s.extra_code_hours} inputMode="numeric" required /></div>
      </div>
      <p className="small muted">One graduate ticket plus this many guests. The limit is raised for one student only by an approved extra ticket request, or by a personal limit on the Master List.</p>
      <Submit>Save limit</Submit>
    </form>
  );
}

async function Venue({ back, season }: { back: string; season: string }) {
  const s = (await getSeasonSettings(season))!;
  const zones = await sql<{ n: number; cap: number }>('select count(*)::int as n, coalesce(sum(capacity), 0)::int as cap from zones where season_id = $1 and active', [season]);
  return (
    <form action={saveVenueAccessAction} className="card">
      <Back to={back} />
      <h2>Hall layout and venue</h2>
      <div className="grid">
        <div><label className="f">Venue name (shown on the public page)</label><input name="venue_name" defaultValue={s.venue_name} /></div>
        <div><label className="f">Area</label><input name="venue_area" defaultValue={s.venue_area} /></div>
        <div><label className="f">Graduate block (places)</label><input name="graduate_capacity" defaultValue={s.graduate_capacity} inputMode="numeric" /></div>
        <div><label className="f">Hold time while paying (minutes)</label><input name="hold_minutes" defaultValue={s.hold_minutes} inputMode="numeric" /></div>
      </div>
      <p className="small muted">Guest zones: {zones[0]?.n ?? 0} zones, {zones[0]?.cap ?? 0} places per ceremony. <Link href="/admin/tickets?tab=layout">Edit zones, doors and wheelchair spaces</Link>.</p>
      <Submit>Save</Submit>
    </form>
  );
}

async function Reminder({ back, season }: { back: string; season: string }) {
  const s = (await getSeasonSettings(season))!;
  return (
    <form action={saveReminderAction} className="card">
      <Back to={back} />
      <h2>Package collection reminder</h2>
      <label className="check"><input type="checkbox" name="reminder_enabled" defaultChecked={s.reminder_enabled} /> Send an automatic reminder for packages not yet collected</label>
      <label className="f">Days before the ceremony</label>
      <input name="reminder_days_before" defaultValue={s.reminder_days_before} inputMode="numeric" style={{ maxWidth: 160 }} />
      <p className="small muted">Last sent: {s.reminder_last_sent_on ?? 'never'}. Wording is in Technical Settings → Email Templates.</p>
      <Submit>Save reminder</Submit>
    </form>
  );
}

async function Merch({ back, season }: { back: string; season: string }) {
  const s = (await getSeasonSettings(season))!;
  const items = await sql<{ id: number; name: string; description: string; price_aed: number; image: string; active: boolean; sort: number }>(
    'select id, name, description, price_aed, image, active, sort from merch_items where season_id = $1 and not removed order by sort, name', [season]);
  const ItemForm = ({ it }: { it?: (typeof items)[number] }) => (
    <form action={saveMerchItemAction} className="card flat" style={{ marginBottom: 10 }}>
      <Back to={back} />
      {it ? <input type="hidden" name="id" value={it.id} /> : null}
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {it ? <div style={{ width: 110 }}><MerchPic image={it.image} name={it.name} /></div> : null}
        <div style={{ flex: 1 }}>
          <div className="grid four">
            <div><label className="f">Name</label><input name="name" defaultValue={it?.name} required /></div>
            <div><label className="f">Price (AED)</label><input name="price" defaultValue={it?.price_aed} inputMode="decimal" required /></div>
            <div><label className="f">Order</label><input name="sort" defaultValue={it?.sort ?? items.length + 1} inputMode="numeric" /></div>
            <div><label className="f">Picture: emoji or https link</label><input name="image_text" defaultValue={it && !it.image.startsWith('data:') ? it.image : ''} /></div>
          </div>
          <label className="f">Description</label>
          <input name="description" defaultValue={it?.description} />
          <div className="row" style={{ marginTop: 8 }}>
            <label className="small">Upload picture (max 300 KB) <input type="file" name="image_file" accept="image/png,image/jpeg,image/webp,image/gif" style={{ width: 'auto' }} /></label>
            {it ? <label className="check"><input type="checkbox" name="active" defaultChecked={it.active} /> Shown in the shop</label> : null}
            <Submit className="btn sm">{it ? 'Save item' : 'Add item'}</Submit>
          </div>
        </div>
      </div>
    </form>
  );
  return (
    <>
      <form action={saveShopDateAction} className="card inline" style={{ marginBottom: 16 }}>
        <Back to={back} />
        <label className="f" style={{ margin: 0 }}>Online shop closes after</label>
        <input type="date" name="shop_close_date" defaultValue={s.shop_close_date ?? ''} style={{ width: 'auto' }} />
        <Submit className="btn sm">Save date</Submit>
        <span className="small muted">Normally the graduation day. The shop switch itself is in Technical Settings → Feature Switches.</span>
      </form>
      {items.map((it) => (
        <div key={it.id}>
          <ItemForm it={it} />
          <form action={removeMerchItemAction} style={{ margin: '-4px 0 14px' }}>
            <Back to={back} />
            <input type="hidden" name="id" value={it.id} />
            <Submit className="btn ghost sm" confirm={`Remove ${it.name} from the shop?`}>Remove {it.name}</Submit>
          </form>
        </div>
      ))}
      <h3>Add an item</h3>
      <ItemForm />
    </>
  );
}

async function Programmes({ back, season }: { back: string; season: string }) {
  const [rows, ceremonies, unmapped] = await Promise.all([
    sql<{ programme: string; ceremony_number: number; n: number }>(
      `select pm.programme, pm.ceremony_number, (select count(*) from graduates g where g.season_id = pm.season_id and lower(g.programme) = lower(pm.programme))::int as n
         from programme_ceremony_map pm where pm.season_id = $1 order by pm.ceremony_number, pm.programme`, [season]),
    getCeremonies(season),
    sql<{ programme: string; n: number }>(
      `select g.programme, count(*)::int as n from graduates g where g.season_id = $1 and g.programme <> ''
          and not exists (select 1 from programme_ceremony_map pm where pm.season_id = g.season_id and lower(pm.programme) = lower(g.programme))
        group by g.programme order by n desc`, [season]),
  ]);
  return (
    <>
      <div className="grid two" style={{ marginBottom: 16 }}>
        <form action={saveProgrammeAction} className="card">
          <Back to={back} />
          <h3>Map a programme</h3>
          <input name="programme" placeholder="Programme exactly as on the Master List" required list="unmapped" />
          <datalist id="unmapped">{unmapped.map((u) => <option key={u.programme} value={u.programme} />)}</datalist>
          <select name="ceremony" style={{ marginTop: 8 }}>{ceremonies.map((c) => <option key={c.id} value={c.number}>{c.name}</option>)}</select>
          <div style={{ marginTop: 8 }}><Submit>Save</Submit></div>
        </form>
        <form action={uploadProgrammesAction} className="card">
          <Back to={back} />
          <h3>Upload programme list (CSV)</h3>
          <p className="small muted">Columns: <span className="mono">programme, ceremony</span></p>
          <input type="file" name="file" accept=".csv,text/csv" required />
          <div style={{ marginTop: 8 }}><Submit className="btn secondary">Upload</Submit></div>
        </form>
      </div>
      {unmapped.length ? <div className="flash warn">Programmes on the Master List with no ceremony: {unmapped.map((u) => `${u.programme} (${u.n})`).join(', ')}</div> : null}
      {rows.length === 0 ? <Empty>No programmes mapped yet.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Programme</th><th>Ceremony</th><th className="num">Graduates</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.programme}>
                  <td>{r.programme}</td>
                  <td>{ceremonies.find((c) => c.number === r.ceremony_number)?.name ?? `Ceremony ${r.ceremony_number}`}</td>
                  <td className="num">{r.n}</td>
                  <td>
                    <form action={saveProgrammeAction}>
                      <Back to={back} />
                      <input type="hidden" name="programme" value={r.programme} />
                      <input type="hidden" name="ceremony" value={r.ceremony_number} />
                      <input type="hidden" name="remove" value="yes" />
                      <Submit className="btn ghost sm" confirm="Remove this mapping?">Remove</Submit>
                    </form>
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
