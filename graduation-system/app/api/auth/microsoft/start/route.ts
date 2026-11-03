import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { entraConfigured, secureCookies, siteUrl } from '@/lib/config';
import { randomToken, sealCookie } from '@/lib/crypto';
import { authorizeUrl, newPkce } from '@/lib/auth/microsoft';

export async function GET() {
  if (!entraConfigured()) return NextResponse.redirect(`${siteUrl()}/staff/login?err=${encodeURIComponent('Microsoft sign-in is not set up yet.')}`);
  const state = randomToken(16);
  const nonce = randomToken(16);
  const { verifier, challenge } = newPkce();
  (await cookies()).set('gs_oidc', sealCookie({ state, nonce, verifier }), {
    httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/api/auth/microsoft', maxAge: 600,
  });
  return NextResponse.redirect(authorizeUrl(state, nonce, challenge));
}
