import 'server-only';
import { fn, one, sql } from '../db';
import { hmac, safeEqual, sixDigits } from '../crypto';
import { emailProvider } from '../config';
import { queueEmail } from '../email';
import { getAppSettings, testShortcutsAllowed } from '../settings';
import { clientIp } from './session';
import { normMisis } from '../format';

// Students sign in with MISIS + a 6-digit code emailed to the Master List address.
// Codes expire (default 10 minutes), work once, allow 5 tries, and sending is rate limited.

const codeHash = (season: string, misis: string, code: string) => hmac(`otp:${season}:${misis}:${code}`);

export type SendResult =
  | { ok: true; misis: string; season: string | null; email: string | null; testCode?: string }
  | { ok: false; error: string };

export async function sendCode(raw: string): Promise<SendResult> {
  const misis = normMisis(raw);
  if (!/^[A-Z0-9]{4,20}$/.test(misis)) return { ok: false, error: 'bad_misis' };
  const ip = await clientIp();
  const okMisis = await fn<boolean>('rate_limit_hit', [`otp-send:${misis}`, 5, 3600]);
  const okIp = await fn<boolean>('rate_limit_hit', [`otp-ip:${ip}`, 40, 3600]);
  if (!okMisis || !okIp) return { ok: false, error: 'rate_limited' };

  const g = await one<{ season_id: string; email: string; full_name: string }>(
    `select g.season_id, g.email, g.full_name from graduates g join seasons s on s.id = g.season_id
      where g.misis = $1 and s.status = 'open' and s.cleaned_at is null order by s.sort desc limit 1`,
    [misis],
  );
  // Same answer whether or not the MISIS exists, so the form cannot be used to look people up.
  if (!g) return { ok: true, misis, season: null, email: null };

  const minutes = (await getAppSettings()).otp_minutes;
  const code = sixDigits();
  await sql(
    `insert into otp_codes (season_id, misis, code_hash, expires_at) values ($1, $2, $3, now() + make_interval(mins => $4))`,
    [g.season_id, misis, codeHash(g.season_id, misis, code), minutes],
  );
  await queueEmail(g.email, 'sign_in_code', { name: g.full_name, misis, code, minutes });
  const testCode = emailProvider() === 'log' && (await testShortcutsAllowed()) ? code : undefined;
  return { ok: true, misis, season: g.season_id, email: g.email, testCode };
}

export async function verifyCode(misis: string, season: string | null, code: string): Promise<{ ok: boolean; error?: string }> {
  const ip = await clientIp();
  if (!(await fn<boolean>('rate_limit_hit', [`otp-verify:${misis}`, 10, 900]))) return { ok: false, error: 'rate_limited' };
  const fail = async (reason: string) => {
    await sql(`insert into login_attempts (kind, subject, ok, method, reason, ip) values ('student', $1, false, 'code', $2, $3)`, [misis, reason, ip]);
    return { ok: false, error: reason === 'code_missing' ? 'code_missing' : 'code_wrong' };
  };
  if (!season || !/^\d{6}$/.test(code)) return fail('code_wrong');
  const row = await one<{ id: number; code_hash: string; attempts: number }>(
    `select id, code_hash, attempts from otp_codes
      where season_id = $1 and misis = $2 and used_at is null and expires_at > now()
      order by created_at desc limit 1`,
    [season, misis],
  );
  if (!row || row.attempts >= 5) return fail('code_missing');
  await sql('update otp_codes set attempts = attempts + 1 where id = $1', [row.id]);
  if (!safeEqual(row.code_hash, codeHash(season, misis, code))) return fail('code_wrong');
  await sql('update otp_codes set used_at = now() where id = $1', [row.id]);
  await sql(`insert into login_attempts (kind, subject, ok, method, ip) values ('student', $1, true, 'code', $2)`, [misis, ip]);
  return { ok: true };
}
