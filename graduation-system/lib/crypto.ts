import 'server-only';
import crypto from 'node:crypto';
import { appSecret } from './config';

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

export const hmac = (s: string) => crypto.createHmac('sha256', appSecret()).update(s).digest('hex');

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** 6-digit code from a cryptographic source */
export const sixDigits = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Signs a small JSON value for a short-lived cookie */
export function sealCookie(value: unknown): string {
  const body = Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${body}.${hmac('cookie:' + body)}`;
}

export function openCookie<T>(sealed: string | undefined): T | null {
  if (!sealed) return null;
  const [body, sig] = sealed.split('.');
  if (!body || !sig || !safeEqual(sig, hmac('cookie:' + body))) return null;
  try {
    return JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}

// Connection secrets saved from Technical Settings: AES-256-GCM, key derived from APP_SECRET (never stored in the database).
const secretKey = () => Buffer.from(crypto.hkdfSync('sha256', appSecret(), 'mdx-graduation', 'connection-secrets', 32));

export function encryptSecret(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', secretKey(), iv);
  const enc = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv.toString('base64'), c.getAuthTag().toString('base64'), enc.toString('base64')].join('.');
}

export function decryptSecret(sealed: string): string | null {
  try {
    const [iv, tag, enc] = sealed.split('.').map((p) => Buffer.from(p, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', secretKey(), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

// Staff password fallback (only when Microsoft sign-in is unavailable). scrypt, never reversible.
export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string | null): boolean {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, salt, key] = stored.split('$');
  const test = crypto.scryptSync(password, Buffer.from(salt, 'base64'), 64, { N: 16384, r: 8, p: 1 });
  const k = Buffer.from(key, 'base64');
  return k.length === test.length && crypto.timingSafeEqual(k, test);
}
