import { NextResponse } from 'next/server';
import { one } from '@/lib/db';
import { getStaff } from '@/lib/auth/staff';
import { techChange } from '@/lib/audit';

// Technical Settings → Backups: JSON export of one season (contains personal data; Technical Super Admin only).
const TABLES: [string, string][] = [
  ['season_settings', 'season_id = $1'],
  ['ceremonies', 'season_id = $1'],
  ['zones', 'season_id = $1'],
  ['programme_ceremony_map', 'season_id = $1'],
  ['graduates', 'season_id = $1'],
  ['financial_holds', 'season_id = $1'],
  ['orders', 'season_id = $1'],
  ['order_guests', 'order_id in (select id from orders where season_id = $1)'],
  ['receipts', 'season_id = $1'],
  ['extra_ticket_requests', 'season_id = $1'],
  ['extra_ticket_codes', 'season_id = $1'],
  ['tickets', 'season_id = $1'],
  ['transfers', 'season_id = $1'],
  ['name_change_requests', 'season_id = $1'],
  ['scans', 'season_id = $1'],
  ['payments', 'season_id = $1'],
  ['package_collections', 'season_id = $1'],
  ['merch_items', 'season_id = $1'],
  ['merch_orders', 'season_id = $1'],
  ['merch_order_lines', 'order_id in (select id from merch_orders where season_id = $1)'],
  ['audit_log', 'season_id = $1'],
];

export async function GET(req: Request) {
  const staff = await getStaff();
  if (!staff?.can('tech_admin')) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const season = new URL(req.url).searchParams.get('season') ?? staff.season.id;
  if (!staff.seasons.some((s) => s.id === season)) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const out: Record<string, unknown> = { exported_at: new Date().toISOString(), season, exported_by: staff.email };
  out.season_row = await one('select * from seasons where id = $1', [season]);
  for (const [t, where] of TABLES) {
    out[t] = (await one<{ rows: unknown }>(`select coalesce(json_agg(x), '[]'::json) as rows from (select * from ${t} where ${where}) x`, [season]))?.rows ?? [];
  }
  await techChange(staff.email, 'backups', 'export', null, season);
  return new NextResponse(JSON.stringify(out), {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="graduation-${season}-${new Date().toISOString().slice(0, 10)}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
