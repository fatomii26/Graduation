'use server';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getStaff, SEASON_COOKIE } from '@/lib/auth/staff';
import { secureCookies } from '@/lib/config';
import { str } from '@/lib/forms';

export async function setSeasonAction(fd: FormData) {
  const staff = await getStaff();
  if (!staff) redirect('/staff/login');
  const id = str(fd, 'season', 20);
  if (staff.seasons.some((s) => s.id === id)) {
    (await cookies()).set(SEASON_COOKIE, id, { httpOnly: true, secure: secureCookies(), sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 30 });
  }
  const ref = (await headers()).get('referer') ?? '';
  let path = '/admin';
  try {
    const u = new URL(ref);
    if (u.pathname.startsWith('/admin')) path = u.pathname;
  } catch {}
  redirect(path);
}
