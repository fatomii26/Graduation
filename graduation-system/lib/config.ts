import 'server-only';

export const siteUrl = () => (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

export function appSecret(): string {
  const s = process.env.APP_SECRET;
  if (!s || s.length < 32) throw new Error('APP_SECRET must be set to at least 32 characters');
  return s;
}

export const paymentMode = (): 'simulate' | 'ccavenue' => (process.env.PAYMENT_MODE === 'ccavenue' ? 'ccavenue' : 'simulate');

export const emailProvider = (): 'log' | 'smtp' => (process.env.EMAIL_PROVIDER === 'smtp' ? 'smtp' : 'log');

export const testShortcutsConfigured = () => process.env.ALLOW_TEST_SHORTCUTS === 'true';

export const entraConfigured = () =>
  !!(process.env.ENTRA_TENANT_ID && process.env.ENTRA_CLIENT_ID && process.env.ENTRA_CLIENT_SECRET);

export const secureCookies = () => siteUrl().startsWith('https://');
