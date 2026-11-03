import { NextResponse } from 'next/server';
import { fn } from '@/lib/db';

// Places left per zone for one ceremony (students see these counts). Polled every 3 seconds by the booking page.
export async function GET(req: Request) {
  const c = Number(new URL(req.url).searchParams.get('ceremony'));
  if (!Number.isInteger(c) || c < 1) return NextResponse.json([], { status: 400 });
  const zones = await fn<unknown[]>('zone_availability', [c]);
  return NextResponse.json(zones, { headers: { 'Cache-Control': 'no-store' } });
}
