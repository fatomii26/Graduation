import 'server-only';
import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { siteUrl } from '../config';

// Staff sign-in with Microsoft Entra ID (single tenant), OpenID Connect authorization code flow with PKCE.
// The email in the token must match an active row in the staff table; role and permissions come from the database.

const tenant = () => process.env.ENTRA_TENANT_ID ?? '';
const clientId = () => process.env.ENTRA_CLIENT_ID ?? '';
export const redirectUri = () => `${siteUrl()}/api/auth/microsoft/callback`;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const keys = () => (jwks ??= createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${tenant()}/discovery/v2.0/keys`)));

export function newPkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizeUrl(state: string, nonce: string, challenge: string) {
  const p = new URLSearchParams({
    client_id: clientId(),
    response_type: 'code',
    redirect_uri: redirectUri(),
    response_mode: 'query',
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return `https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/authorize?${p}`;
}

export async function emailFromCode(code: string, verifier: string, nonce: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant()}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId(),
      client_secret: process.env.ENTRA_CLIENT_SECRET ?? '',
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(),
      code_verifier: verifier,
      scope: 'openid profile email',
    }),
    cache: 'no-store',
  });
  const body = (await res.json()) as { id_token?: string; error_description?: string };
  if (!res.ok || !body.id_token) throw new Error(body.error_description ?? 'Token exchange failed');
  const { payload } = await jwtVerify(body.id_token, keys(), {
    issuer: `https://login.microsoftonline.com/${tenant()}/v2.0`,
    audience: clientId(),
  });
  if (payload.nonce !== nonce) throw new Error('Sign-in check failed (nonce)');
  if (payload.tid !== tenant()) throw new Error('This account is not from the university tenant');
  const email = String(payload.email ?? payload.preferred_username ?? payload.upn ?? '').toLowerCase();
  if (!email.includes('@')) throw new Error('No email address in the Microsoft account');
  return email;
}
