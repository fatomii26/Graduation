import 'server-only';
import { fn, one } from './db';

export type PendingOrder = { id: string; ref: string; kind: string; amount_aed: number; guest_count: number; includes_graduate: boolean; expires_at: string };

export type BookingStatus = {
  eligibility: string | null;
  allowance: number;
  committed: number;
  gradArranged: boolean;
  validTickets: number;
  hasPaidMain: boolean;
  pending: PendingOrder | null;
  unusedReceipts: number;
  openCodes: number;
};

export async function bookingStatus(seasonId: string, misis: string): Promise<BookingStatus> {
  await fn('release_expired_holds', []).catch(() => 0);
  const eligibility = await fn<string | null>('eligibility', [seasonId, misis]);
  const r = await one<{
    allowance: number; committed: number; grad_arranged: boolean; valid_tickets: number; has_paid_main: boolean;
    pending: PendingOrder | null; unused_receipts: number; open_codes: number;
  }>(
    `select coalesce(guest_allowance($1, $2), 0) as allowance, guests_committed($1, $2) as committed,
            graduate_ticket_arranged($1, $2) as grad_arranged,
            (select count(*) from tickets where season_id = $1 and misis = $2 and status = 'valid')::int as valid_tickets,
            exists (select 1 from orders where season_id = $1 and misis = $2 and kind = 'main' and status = 'paid') as has_paid_main,
            (select row_to_json(x) from (select id, ref, kind, amount_aed, guest_count, includes_graduate, expires_at
                                           from orders where season_id = $1 and misis = $2 and status = 'pending_payment'
                                            and kind in ('main', 'extra') and expires_at > now()
                                          order by created_at desc limit 1) x) as pending,
            (select count(*) from receipts where season_id = $1 and misis = $2 and status = 'unused')::int as unused_receipts,
            (select count(*) from extra_ticket_codes where season_id = $1 and misis = $2 and used_at is null and expires_at > now())::int as open_codes`,
    [seasonId, misis],
  );
  return {
    eligibility,
    allowance: r?.allowance ?? 0,
    committed: r?.committed ?? 0,
    gradArranged: !!r?.grad_arranged,
    validTickets: r?.valid_tickets ?? 0,
    hasPaidMain: !!r?.has_paid_main,
    pending: r?.pending ?? null,
    unusedReceipts: r?.unused_receipts ?? 0,
    openCodes: r?.open_codes ?? 0,
  };
}
