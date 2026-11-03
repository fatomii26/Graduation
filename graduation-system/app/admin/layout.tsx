import { requireStaff } from '@/lib/auth/staff';
import { getAppSettings } from '@/lib/settings';
import { NAV } from '@/lib/menu';
import AdminNav from '@/components/AdminNav';
import A11yMenu from '@/components/A11yMenu';
import { setSeasonAction } from './actions';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Staff · Graduation · MDX Dubai', robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const staff = await requireStaff();
  const settings = await getAppSettings();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => i.perms.some((p) => staff.perms.has(p))) })).filter((g) => g.items.length);
  return (
    <div className="shell">
      <AdminNav groups={groups} />
      <div className="main" id="main">
        <div className="topbar noprint">
          <form action={setSeasonAction} className="inline">
            <label className="small" htmlFor="season"><strong>Season</strong></label>
            <select id="season" name="season" defaultValue={staff.season.id} style={{ width: 'auto' }}>
              {staff.seasons.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
              ))}
            </select>
            <button className="btn ghost sm">Switch</button>
          </form>
          {settings.maintenance_mode ? <span className="pill bad">Maintenance Mode: public site closed</span> : null}
          {settings.test_mode ? <span className="pill warn">Test mode</span> : <span className="pill ok">Live</span>}
          {staff.season.status === 'closed' ? <span className="pill">Closed season: no online sales</span> : null}
          <div className="who">
            <strong>{staff.full_name}</strong> · {staff.role}
            <div className="inline" style={{ justifyContent: 'flex-end' }}>
              <A11yMenu className="btn ghost sm" />
              <form action="/api/auth/signout?kind=staff" method="post">
                <button className="btn ghost sm">Sign out</button>
              </form>
            </div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
