import { NextResponse } from 'next/server';
import { getStudent } from '@/lib/auth/student';
import { ticketsForGraduate, ticketsPdf } from '@/lib/tickets';

export async function GET() {
  const st = await getStudent();
  if (!st) return NextResponse.redirect(new URL('/signin?next=/tickets', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'));
  const tickets = await ticketsForGraduate(st.season_id, st.misis);
  if (!tickets.length) return NextResponse.json({ error: 'no_tickets' }, { status: 404 });
  const pdf = await ticketsPdf(tickets);
  const body = pdf.buffer.slice(pdf.byteOffset, pdf.byteOffset + pdf.byteLength) as ArrayBuffer;
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="graduation-tickets-${st.misis}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
