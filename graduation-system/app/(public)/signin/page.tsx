import { cookies } from 'next/headers';
import Link from 'next/link';
import { openCookie } from '@/lib/crypto';
import { maskEmail } from '@/lib/format';
import Submit from '@/components/Submit';
import { Flash, readParams, type SearchParams } from '@/components/ui';
import { sendCodeAction, verifyCodeAction, type Pending } from '../actions';

export default async function SignIn({ searchParams }: { searchParams: SearchParams }) {
  const get = await readParams(searchParams);
  const next = get('next') || '/book';
  const pending = get('step') === 'code' ? openCookie<Pending>((await cookies()).get('gs_otp')?.value) : null;

  return (
    <div className="narrow">
      <div className="card">
        <h1>Graduate sign-in</h1>
        <Flash msg={get('msg')} err={get('err')} />
        {pending ? (
          <form action={verifyCodeAction}>
            <p>
              If <strong>{pending.misis}</strong> is on the graduation Master List, we have emailed a 6-digit code
              {pending.email ? <> to <strong>{maskEmail(pending.email)}</strong></> : null}. It is valid for a few minutes.
            </p>
            {pending.testCode ? (
              <div className="flash warn">Test mode (emails are not sent): your code is <strong className="mono">{pending.testCode}</strong></div>
            ) : null}
            <label className="f" htmlFor="code">6-digit code</label>
            <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus />
            <input type="hidden" name="next" value={pending.next} />
            <div className="row" style={{ marginTop: 14 }}>
              <Submit>Sign in</Submit>
              <Link className="btn ghost" href={`/signin?next=${encodeURIComponent(pending.next)}`}>Use a different MISIS or resend</Link>
            </div>
          </form>
        ) : (
          <form action={sendCodeAction}>
            <p className="muted">Enter your MISIS student number. We will email a sign-in code to your university email address on the Master List.</p>
            <label className="f" htmlFor="misis">MISIS</label>
            <input id="misis" name="misis" autoComplete="username" placeholder="e.g. M00123456" required autoFocus />
            <input type="hidden" name="next" value={next} />
            <div style={{ marginTop: 14 }}>
              <Submit className="btn block">Email me a code</Submit>
            </div>
          </form>
        )}
      </div>
      <p className="small muted center">Paying for a student? <Link href="/pay-for-student">Pay without signing in</Link>.</p>
    </div>
  );
}
