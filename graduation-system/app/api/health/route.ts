import { NextResponse } from 'next/server';
import { one } from '@/lib/db';

export async function GET() {
  const t = Date.now();
  try {
    await one('select 1');
    return NextResponse.json({ ok: true, db_ms: Date.now() - t }, { headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ ok: false }, { status: 503 });
  }
}
