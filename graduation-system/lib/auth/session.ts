import 'server-only';
import { cookies, headers } from 'next/headers';
import { one, sql } from '../db';
import { randomToken, sha256 } from '../crypto';
import { secureCookies } from '../config';

export type SessionKind = 'staff' | 'student';
const COOKIE: Record<SessionKind, string> = { staff: 'gs_staff', student: 'gs_student' };
const HOURS: Record<SessionKind, number> = { staff: 12, student: 3 };

export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? '').trim().slice(0, 64);
}

/** Only from Server Actions and Route Handlers (cookies can be set there). */
export async function createSession(kind: SessionKind, subject: string, seasonId: string | null) {
  const token = randomToken(32);
  const h = await headers();
  await sql(
    `insert into sessions (id_hash, kind, subject, season_id, expires_at, ip, user_agent)
     values ($1, $2, $3, $4, now() + make_interval(hours => $5), $6, $7)`,
    [sha256(token), kind, subject, seasonId, HOURS[kind], await clientIp(), (h.get('user-agent') ?? '').slice(0, 200)],
  );
  (await cookies()).set(COOKIE[kind], token, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: HOURS[kind] * 3600,
  });
}

export async function readSession(kind: SessionKind): Promise<{ subject: string; season_id: string | null } | null> {
  const token = (await cookies()).get(COOKIE[kind])?.value;
  if (!token || token.length > 100) return null;
  const row = await one<{ subject: string; season_id: string | null; stale: boolean }>(
    `select subject, season_id, last_seen_at < now() - interval '2 minutes' as stale
       from sessions where id_hash = $1 and kind = $2 and revoked_at is null and expires_at > now()`,
    [sha256(token), kind],
  );
  if (!row) return null;
  if (row.stale) await sql('update sessions set last_seen_at = now() where id_hash = $1', [sha256(token)]);
  return { subject: row.subject, season_id: row.season_id };
}

/** Only from Server Actions and Route Handlers. */
export async function endSession(kind: SessionKind) {
  const jar = await cookies();
  const token = jar.get(COOKIE[kind])?.value;
  if (token) await sql('update sessions set revoked_at = now(), revoked_by = subject where id_hash = $1 and revoked_at is null', [sha256(token)]);
  jar.delete(COOKIE[kind]);
}
