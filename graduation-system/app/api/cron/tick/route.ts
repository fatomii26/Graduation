import { NextResponse } from 'next/server';
import { safeEqual } from '@/lib/crypto';
import { runDueJobs } from '@/lib/jobs';

// Scheduler entry point. Call every 1–5 minutes with:  Authorization: Bearer <CRON_SECRET>
// (GitHub Actions workflow .github/workflows/scheduler.yml, Vercel Cron, or an Azure timer).
async function handle(req: Request) {
  const secret = process.env.CRON_SECRET ?? '';
  const given = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (secret.length < 12 || !safeEqual(given, secret)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const ran = await runDueJobs();
  return NextResponse.json({ ok: true, ran }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = handle;
export const POST = handle;
