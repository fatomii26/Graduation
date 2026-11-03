import { NextResponse } from 'next/server';
import { siteUrl } from '@/lib/config';
import { endSession } from '@/lib/auth/session';

export async function POST(req: Request) {
  const kind = new URL(req.url).searchParams.get('kind') === 'staff' ? 'staff' : 'student';
  await endSession(kind);
  return NextResponse.redirect(`${siteUrl()}${kind === 'staff' ? '/staff/login?msg=Signed%20out' : '/?msg=Signed%20out'}`, 303);
}
