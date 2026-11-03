import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { siteUrl } from '@/lib/config';
import { fn } from '@/lib/db';
import { openCookie, safeEqual } from '@/lib/crypto';
import { emailFromCode } from '@/lib/auth/microsoft';
import { clientIp, createSession } from '@/lib/auth/session';
import { errorText } from '@/lib/errors';
import { logError } from '@/lib/audit';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const jar = await cookies();
  const saved = openCookie<{ state: string; nonce: string; verifier: string }>(jar.get('gs_oidc')?.value);
  jar.delete({ name: 'gs_oidc', path: '/api/auth/microsoft' });
  const back = (m: string) => NextResponse.redirect(`${siteUrl()}/staff/login?err=${encodeURIComponent(m)}`);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state') ?? '';
  if (url.searchParams.get('error')) return back(url.searchParams.get('error_description') ?? 'Sign-in was cancelled.');
  if (!saved || !code || !safeEqual(state, saved.state)) return back('Sign-in expired. Please try again.');
  try {
    const email = await emailFromCode(code, saved.verifier, saved.nonce);
    const r = await fn('staff_signed_in', [email, 'microsoft', await clientIp()]);
    if (!r.ok) return back(errorText(r.error));
    await createSession('staff', email, null);
    return NextResponse.redirect(`${siteUrl()}/admin`);
  } catch (e) {
    await logError('auth:microsoft', e, '/api/auth/microsoft/callback');
    return back('Microsoft sign-in failed. Please try again.');
  }
}
