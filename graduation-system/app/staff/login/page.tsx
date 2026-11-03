import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { entraConfigured } from '@/lib/config';
import { getAppSettings, testShortcutsAllowed } from '@/lib/settings';
import { getStaff } from '@/lib/auth/staff';
import Submit from '@/components/Submit';
import { Flash, readParams, type SearchParams } from '@/components/ui';
import { passwordLoginAction, testLoginAction } from '../actions';

export default async function StaffLogin({ searchParams }: { searchParams: SearchParams }) {
  const get = await readParams(searchParams);
  if (await getStaff()) redirect('/admin');
  const settings = await getAppSettings();
  const shortcuts = await testShortcutsAllowed();
  const staff = shortcuts
    ? await sql<{ email: string; full_name: string; role: string }>(`select email, full_name, role from staff where status in ('active', 'invited') order by role, full_name`)
    : [];
  const err = get('err') === 'no_access' ? 'Your account has no pages assigned. Ask a super admin to give you access.' : get('err');

  return (
    <div className="narrow">
      <div className="card">
        <h1>Staff sign-in</h1>
        <p className="muted">Sign in with your university Microsoft account. Your role and permissions come from the staff list.</p>
        <Flash msg={get('msg')} err={err} />
        {entraConfigured() ? (
          <a className="btn block" href="/api/auth/microsoft/start">Sign in with Microsoft</a>
        ) : (
          <div className="flash warn">Microsoft sign-in is not configured yet (ENTRA_TENANT_ID, ENTRA_CLIENT_ID, ENTRA_CLIENT_SECRET).</div>
        )}
        {settings.staff_password_login ? (
          <form action={passwordLoginAction} style={{ marginTop: 18 }}>
            <h3>Or with a password</h3>
            <label className="f" htmlFor="email">MDX email</label>
            <input id="email" name="email" type="email" autoComplete="username" required />
            <label className="f" htmlFor="password">Password</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
            <div style={{ marginTop: 12 }}><Submit className="btn secondary block">Sign in</Submit></div>
          </form>
        ) : null}
      </div>
      {shortcuts ? (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Test mode: Staff View</h2>
          <p className="small muted">Only in Test mode with ALLOW_TEST_SHORTCUTS=true. This box does not exist in Live mode.</p>
          <form action={testLoginAction} className="inline">
            <select name="email" aria-label="Staff member">
              {staff.map((s) => <option key={s.email} value={s.email}>{s.full_name} · {s.role}</option>)}
            </select>
            <Submit className="btn gold">Sign in as</Submit>
          </form>
        </div>
      ) : null}
    </div>
  );
}
