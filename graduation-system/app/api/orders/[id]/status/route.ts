import { NextResponse } from 'next/server';
import { one } from '@/lib/db';

// Order status for the payment waiting page. The order id is an unguessable UUID; no personal data is returned.
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  const merch = new URL(req.url).searchParams.get('kind') === 'merch';
  const r = merch
    ? await one<{ status: string; kind: string; attention: boolean }>(
        `select status, 'merch' as kind, needs_attention is not null as attention from merch_orders where id::text = $1`, [id])
    : await one<{ status: string; kind: string; attention: boolean }>(
        `select status, kind, (needs_attention is not null and attention_resolved_at is null) as attention from orders where id::text = $1`, [id]);
  if (!r) return NextResponse.json({ error: 'not_found' }, { status: 404 });
  return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
}
