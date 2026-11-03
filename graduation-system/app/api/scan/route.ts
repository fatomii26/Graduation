import { NextResponse } from 'next/server';
import { fn, one } from '@/lib/db';
import { getStaff } from '@/lib/auth/staff';

const sameOrigin = (req: Request) => {
  const o = req.headers.get('origin');
  const h = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  try {
    return !!o && !!h && new URL(o).host === h;
  } catch {
    return false;
  }
};

// Every scan goes to the server, so each guest is admitted once per door even with many scanner phones.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, result: 'forbidden' }, { status: 403 });
  const staff = await getStaff();
  if (!staff?.can('scanner')) return NextResponse.json({ ok: false, result: 'forbidden' }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as { code?: string; ceremony?: number; checkpoint?: string; door?: string };
  const ceremony = Number(b.ceremony);
  const ok = await one<{ ok: boolean }>('select exists (select 1 from ceremonies where id = $1 and season_id = $2) as ok', [ceremony, staff.season.id]);
  if (!ok?.ok) return NextResponse.json({ ok: false, result: 'bad_checkpoint' });
  const text = String(b.code ?? '').trim();
  const token = text.match(/\/t\/([A-Za-z0-9_-]{40,64})/)?.[1] ?? (/^[A-Za-z0-9_-]{40,64}$/.test(text) ? text : 'invalid');
  const r = await fn('scan_ticket', [token, ceremony, String(b.checkpoint ?? ''), b.checkpoint === 'door2' ? String(b.door ?? '').slice(0, 40) : null, staff.email, false, null]);
  return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
}
