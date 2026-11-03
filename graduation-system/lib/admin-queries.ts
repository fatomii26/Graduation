import 'server-only';
import { fn, one, sql } from './db';
import type { Graduate } from './auth/student';

export type StudentSummary = Graduate & {
  ceremony_name: string | null;
  ceremony_number: number | null;
  eligibility: string | null;
  allowance: number;
  committed: number;
  grad_arranged: boolean;
  grad_ticket: boolean;
  guest_tickets: number;
  hold_reason: string | null;
};

export async function studentSummary(seasonId: string, misis: string): Promise<StudentSummary | null> {
  if (!misis) return null;
  return one<StudentSummary>(
    `select g.*, c.name as ceremony_name, c.number as ceremony_number,
            eligibility(g.season_id, g.misis, true) as eligibility,
            coalesce(guest_allowance(g.season_id, g.misis), 0) as allowance, guests_committed(g.season_id, g.misis) as committed,
            graduate_ticket_arranged(g.season_id, g.misis) as grad_arranged,
            exists (select 1 from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.kind = 'graduate' and t.status = 'valid') as grad_ticket,
            (select count(*) from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.kind = 'guest' and t.status = 'valid')::int as guest_tickets,
            (select reason from financial_holds h where h.season_id = g.season_id and h.misis = g.misis and h.status = 'active') as hold_reason
       from graduates g left join ceremonies c on c.id = g.ceremony_id
      where g.season_id = $1 and g.misis = $2`,
    [seasonId, misis],
  );
}

export const releaseHolds = () => fn('release_expired_holds', []).catch(() => 0);

export async function ceremonyOptions(seasonId: string) {
  return sql<{ id: number; number: number; name: string }>('select id, number, name from ceremonies where season_id = $1 order by number', [seasonId]);
}
