import 'server-only';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { one } from '../db';
import { getSeasons, type Season } from '../settings';
import { readSession } from './session';
import { firstAllowedPath } from '../menu';

export type StaffCtx = {
  email: string;
  full_name: string;
  role: string;
  department: string;
  perms: Set<string>;
  seasons: Season[];
  season: Season;
  can: (...perms: string[]) => boolean;
};

export const SEASON_COOKIE = 'gs_season';

export async function getStaff(): Promise<StaffCtx | null> {
  const s = await readSession('staff');
  if (!s) return null;
  const row = await one<{
    email: string; full_name: string; role: string; department: string; status: string; all_seasons: boolean; seasons: string[]; perms: string[];
  }>(
    `select email, full_name, role, department, status, all_seasons, seasons, effective_permissions(email) as perms
       from staff where email = $1`,
    [s.subject],
  );
  if (!row || row.status !== 'active') return null;
  const all = await getSeasons();
  const seasons = row.all_seasons ? all : all.filter((x) => row.seasons.includes(x.id));
  if (!seasons.length) return null;
  const chosen = (await cookies()).get(SEASON_COOKIE)?.value;
  const season = seasons.find((x) => x.id === chosen) ?? seasons.find((x) => x.status === 'open') ?? seasons[0];
  const perms = new Set(row.perms);
  return {
    email: row.email,
    full_name: row.full_name,
    role: row.role,
    department: row.department,
    perms,
    seasons,
    season,
    can: (...p: string[]) => p.some((x) => perms.has(x)),
  };
}

/** For pages and Server Actions. Signed-out staff go to sign-in; staff without the permission go to their first allowed page. */
export async function requireStaff(...anyOf: string[]): Promise<StaffCtx> {
  const s = await getStaff();
  if (!s) redirect('/staff/login');
  if (anyOf.length && !s.can(...anyOf)) {
    const home = firstAllowedPath(s.perms);
    redirect(home ? `${home}?err=${encodeURIComponent('You do not have access to that page.')}` : '/staff/login?err=no_access');
  }
  return s;
}
