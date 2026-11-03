import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import { getStaff } from '@/lib/auth/staff';
import { toCsv } from '@/lib/csv';
import { VERSION_TABS } from '@/lib/menu';
import { normMisis } from '@/lib/format';

const csv = (name: string, rows: (string | number | boolean | null | Date)[][]) =>
  new NextResponse(toCsv(rows), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' },
  });

// CSV downloads for the back office. Each type checks its own permission.
export async function GET(req: Request) {
  const staff = await getStaff();
  if (!staff) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const type = p.get('type');
  const S = staff.season.id;
  const money = staff.can('view_revenue');

  if (type === 'master_list' && staff.can('master_list')) {
    const rows = await sql<Record<string, string | number | boolean | null>>(
      `select g.misis, g.email, g.mobile, g.full_name, g.programme, g.confirmed_graduate, g.financial_hold, c.number as ceremony,
              g.grad_seat_label, g.max_guests, g.private_email,
              (select count(*) from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.status = 'valid')::int as tickets_held
         from graduates g left join ceremonies c on c.id = g.ceremony_id where g.season_id = $1 order by g.misis`, [S]);
    const cols = ['misis', 'email', 'mobile', 'full_name', 'programme', 'confirmed_graduate', 'financial_hold', 'ceremony', 'grad_seat_label', 'max_guests', 'private_email', 'tickets_held'];
    return csv(`master-list-${S}.csv`, [cols, ...rows.map((r) => cols.map((c) => r[c]))]);
  }

  if (type === 'ticket_updates' && staff.can('finance_entry')) {
    const rows = await sql<{ at: Date; misis: string; full_name: string; ceremony: string | null; type: string; added: string; amount: number; ref: string; entered_by: string; now_held: number }>(
      `select x.at, x.misis, g.full_name, c.name as ceremony, x.type, x.added, x.amount, x.ref, x.entered_by,
              (select count(*) from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.status = 'valid')::int as now_held
         from (select r.created_at as at, r.misis, r.source as type,
                      (case when r.includes_graduate then 1 else 0 end) || ' graduate + ' || r.guest_count || ' guest' as added,
                      r.amount_aed as amount, r.receipt_number as ref, r.entered_by from receipts r where r.season_id = $1
               union all
               select o.paid_at, o.misis, 'online ' || o.kind, (case when o.includes_graduate then 1 else 0 end) || ' graduate + ' || o.guest_count || ' guest',
                      o.amount_aed, o.ref, o.created_by from orders o
                where o.season_id = $1 and o.status = 'paid' and o.channel in ('online', 'free') and o.kind <> 'third_party') x
         join graduates g on g.season_id = $1 and g.misis = x.misis left join ceremonies c on c.id = g.ceremony_id
        order by x.at desc`, [S]);
    const head = ['date', 'misis', 'name', 'ceremony', 'type', 'tickets_added', ...(money ? ['amount_aed'] : []), 'order_or_receipt', 'entered_by', 'tickets_now_held'];
    return csv(`students-with-tickets-updated-${S}.csv`, [head, ...rows.map((r) => [r.at, r.misis, r.full_name, r.ceremony, r.type, r.added, ...(money ? [r.amount] : []), r.ref, r.entered_by, r.now_held])]);
  }

  if (type === 'audit' && staff.can('version_changes')) {
    const cats = VERSION_TABS.find(([k]) => k === p.get('cat'))?.[2] ?? [];
    const q = normMisis(p.get('q'));
    const rows = await sql<{ at: Date; actor: string; action: string; category: string; misis: string | null; details: unknown; reason: string | null }>(
      `select at, actor, action, category, misis, details, reason from audit_log
        where (season_id = $1 or season_id is null) and ($2 = '' or misis = $2) and (cardinality($3::text[]) = 0 or category = any($3))
        order by at desc limit 20000`, [S, q, cats]);
    return csv(`version-changes-${S}.csv`, [['when', 'who', 'action', 'category', 'misis', 'details', 'reason'], ...rows.map((r) => [r.at, r.actor, r.action, r.category, r.misis, JSON.stringify(r.details), r.reason])]);
  }

  return NextResponse.json({ error: 'forbidden' }, { status: 403 });
}
