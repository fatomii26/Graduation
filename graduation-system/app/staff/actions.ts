'use server';
import { redirect } from 'next/navigation';
import { fn, one, sql } from '@/lib/db';
import { hashPassword, sha256, verifyPassword } from '@/lib/crypto';
import { clientIp, createSession } from '@/lib/auth/session';
import { getAppSettings, testShortcutsAllowed } from '@/lib/settings';
import { errorText } from '@/lib/errors';
import { str } from '@/lib/forms';

function back(m: string, path = '/staff/login'): never {
  redirect(`${path}?err=${encodeURIComponent(m)}`);
}

/** Fallback sign-in (only when switched on in Technical Settings): email + password set through a one-time link. */
export async function passwordLoginAction(fd: FormData) {
  if (!(await getAppSettings()).staff_password_login) back('Password sign-in is switched off. Use Microsoft sign-in.');
  const email = str(fd, 'email', 200).toLowerCase();
  const ip = await clientIp();
  if (!(await fn<boolean>('rate_limit_hit', [`staff-pw:${email}`, 8, 900])) || !(await fn<boolean>('rate_limit_hit', [`staff-pw-ip:${ip}`, 30, 900]))) {
    back(errorText('rate_limited'));
  }
  const row = await one<{ password_hash: string | null }>('select password_hash from staff where email = $1', [email]);
  if (!row || !verifyPassword(str(fd, 'password', 200), row.password_hash)) {
    await sql(`insert into login_attempts (kind, subject, ok, method, reason, ip) values ('staff', $1, false, 'password', 'wrong_password', $2)`, [email || '?', ip]);
    back('Email or password is not right.');
  }
  const r = await fn('staff_signed_in', [email, 'password', ip]);
  if (!r.ok) back(errorText(r.error));
  await createSession('staff', email, null);
  redirect('/admin');
}

/** Test mode only: sign in as a staff member without Microsoft (absent in Live mode). */
export async function testLoginAction(fd: FormData) {
  if (!(await testShortcutsAllowed())) back('Test sign-in is not available.');
  const email = str(fd, 'email', 200).toLowerCase();
  const r = await fn('staff_signed_in', [email, 'test_shortcut', await clientIp()]);
  if (!r.ok) back(errorText(r.error));
  await createSession('staff', email, null);
  redirect('/admin');
}

export async function setPasswordAction(fd: FormData) {
  const token = str(fd, 'token', 100);
  const pw = str(fd, 'password', 200);
  const path = `/staff/set-password`;
  if (pw.length < 12) redirect(`${path}?token=${encodeURIComponent(token)}&err=${encodeURIComponent('Use at least 12 characters.')}`);
  if (pw !== str(fd, 'confirm', 200)) redirect(`${path}?token=${encodeURIComponent(token)}&err=${encodeURIComponent('The two passwords are different.')}`);
  const t = await one<{ email: string }>(
    `update staff_tokens set used_at = now() where token_hash = $1 and purpose = 'set_password' and used_at is null and expires_at > now() returning email`,
    [sha256(token)],
  );
  if (!t) back('This link has expired or was already used. Ask an administrator for a new one.');
  await sql('update staff set password_hash = $2 where email = $1', [t.email, hashPassword(pw)]);
  await fn('log_event', [t.email, 'password_set', 'access', null, null, null, '{}', null]);
  redirect('/staff/login?msg=' + encodeURIComponent('Password set. You can sign in now.'));
}
