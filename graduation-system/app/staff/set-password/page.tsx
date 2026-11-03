import Submit from '@/components/Submit';
import { Flash, readParams, type SearchParams } from '@/components/ui';
import { setPasswordAction } from '../actions';

export default async function SetPassword({ searchParams }: { searchParams: SearchParams }) {
  const get = await readParams(searchParams);
  return (
    <div className="narrow">
      <form className="card" action={setPasswordAction}>
        <h1>Set your password</h1>
        <p className="muted">This one-time link is valid for 24 hours. Nobody, including administrators, can see your password.</p>
        <Flash err={get('err')} />
        <input type="hidden" name="token" value={get('token')} />
        <label className="f" htmlFor="password">New password (at least 12 characters)</label>
        <input id="password" name="password" type="password" minLength={12} autoComplete="new-password" required />
        <label className="f" htmlFor="confirm">Type it again</label>
        <input id="confirm" name="confirm" type="password" minLength={12} autoComplete="new-password" required />
        <div style={{ marginTop: 14 }}><Submit className="btn block">Save password</Submit></div>
      </form>
    </div>
  );
}
