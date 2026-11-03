'use server';
import { fn, one, sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { siteUrl } from '@/lib/config';
import { queueEmail } from '@/lib/email';
import { errorText } from '@/lib/errors';
import { backPath, bool, fail, finish, int, ok, str } from '@/lib/forms';

type TicketRow = { id: string; token: string; holder_name: string; kind: string; door: string; ceremony: string; email: string; private_email: string | null; full_name: string; misis: string };

async function ticketRow(season: string, id: string) {
  return one<TicketRow>(
    `select t.id::text, t.token, t.holder_name, t.kind, t.door, c.name as ceremony, g.email, g.private_email, g.full_name, g.misis
       from tickets t join ceremonies c on c.id = t.ceremony_id join graduates g on g.season_id = t.season_id and g.misis = t.misis
      where t.id::text = $1 and t.season_id = $2 and t.status = 'valid'`,
    [id, season],
  );
}

/** Lost Ticket: the same QR code is sent again to the student or the guest, and the send is logged. */
export async function lostTicketAction(fd: FormData) {
  const staff = await requireStaff('lost_ticket');
  const back = backPath(fd, '/admin/tickets');
  const t = await ticketRow(staff.season.id, str(fd, 'ticket', 40));
  if (!t) fail(back, errorText('no_such_ticket'));
  const to = str(fd, 'to', 10);
  const address = to === 'mdx' ? t.email : to === 'private' ? t.private_email ?? '' : str(fd, 'address', 200).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) fail(back, 'Enter a valid email address.');
  await queueEmail(address, 'lost_ticket', {
    holder: t.holder_name, name: t.full_name, misis: t.misis, ceremony: t.ceremony, link: `${siteUrl()}/t/${t.token}`,
    door: t.kind === 'guest' ? `Show it at Door 1 (venue entrance) and at ${t.door}.` : 'Use the graduate entrance.',
  });
  await fn('log_ticket_send', [t.id, 'email', address, 'lost_ticket', staff.email]);
  ok(back, `Ticket for ${t.holder_name} sent again to ${address} (same QR code).`);
}

export async function logMobileSendAction(fd: FormData) {
  const staff = await requireStaff('lost_ticket');
  const back = backPath(fd, '/admin/tickets');
  const mobile = str(fd, 'mobile', 40).replace(/[^\d+]/g, '');
  if (mobile.length < 7) fail(back, 'Enter the mobile number.');
  finish(back, await fn('log_ticket_send', [str(fd, 'ticket', 40), 'mobile', mobile, 'lost_ticket', staff.email]), `WhatsApp send to ${mobile} logged.`);
}

/** Guest name correction by Marketing: the same reissue step as transfers (same zone, new QR code). */
export async function correctNameAction(fd: FormData) {
  const staff = await requireStaff('transfer_approve');
  const back = backPath(fd, '/admin/tickets');
  const r = await fn('reissue_ticket', [str(fd, 'ticket', 40), str(fd, 'new_name', 120), null, `Name corrected: ${str(fd, 'reason', 200)}`, staff.email]);
  finish(back, r, 'Ticket reissued with the new name and a new QR code. The old QR code no longer works.');
}

export async function decideTransferAction(fd: FormData) {
  const staff = await requireStaff('transfer_approve');
  const back = backPath(fd, '/admin/tickets?tab=transfers');
  const id = str(fd, 'id', 40);
  const approve = str(fd, 'decision') === 'approve';
  const note = str(fd, 'note', 300);
  const r = await fn(approve ? 'approve_transfer' : 'reject_transfer', [id, note, staff.email]);
  if (!r.ok) fail(back, errorText(r.error));
  const t = await one<{ from_misis: string; to_misis: string; n: number; email: string; full_name: string }>(
    `select tr.from_misis, tr.to_misis, cardinality(tr.ticket_ids) as n, g.email, g.full_name
       from transfers tr join graduates g on g.season_id = tr.season_id and g.misis = tr.from_misis where tr.id::text = $1`, [id]);
  if (t) {
    await queueEmail(t.email, 'transfer_decision', {
      name: t.full_name, misis: t.from_misis, to: t.to_misis, tickets: `${t.n} guest ticket(s)`,
      decision: approve ? 'approved' : 'rejected', note: note ? ` Note from the team: ${note}` : '',
    });
  }
  ok(back, approve ? 'Transfer approved: old QR codes are void and new tickets were issued for the same zone.' : 'Transfer rejected.');
}

export async function decideNameAction(fd: FormData) {
  const staff = await requireStaff('transfer_approve');
  const back = backPath(fd, '/admin/tickets?tab=names');
  const id = str(fd, 'id', 40);
  const approve = str(fd, 'decision') === 'approve';
  const note = str(fd, 'note', 300);
  const r = await fn('decide_name_change', [id, approve, note, staff.email]);
  if (!r.ok) fail(back, errorText(r.error));
  const n = await one<{ old_name: string; new_name: string; email: string; full_name: string; misis: string }>(
    `select q.old_name, q.new_name, g.email, g.full_name, g.misis from name_change_requests q
       join graduates g on g.season_id = q.season_id and g.misis = q.misis where q.id::text = $1`, [id]);
  if (n) {
    await queueEmail(n.email, 'name_change_decision', {
      name: n.full_name, misis: n.misis, tickets: `the ticket for ${n.old_name} (new name: ${n.new_name})`,
      decision: approve ? 'approved' : 'rejected', note: note ? ` Note from the team: ${note}` : '',
    });
  }
  ok(back, approve ? 'Name change approved and the ticket was reissued.' : 'Name change rejected.');
}

export async function saveZoneAction(fd: FormData) {
  const staff = await requireStaff('layout_edit');
  const back = backPath(fd, '/admin/tickets?tab=layout');
  const id = int(fd, 'id');
  const r = await fn('save_zone', [
    staff.season.id, id, str(fd, 'code', 4), str(fd, 'name', 60), str(fd, 'door', 40), str(fd, 'color', 7),
    int(fd, 'capacity'), int(fd, 'wheelchair') ?? 0, int(fd, 'sort') ?? 0, id ? bool(fd, 'active') : true, staff.email,
  ]);
  if (!r.ok) fail(back, `${errorText(r.error)}${r.in_use !== undefined ? ` (${r.in_use} in use)` : ''}`);
  ok(back, id ? 'Zone saved.' : 'Zone added.');
}

export async function saveVenueAction(fd: FormData) {
  const staff = await requireStaff('layout_edit');
  const back = backPath(fd, '/admin/tickets?tab=layout');
  const hold = int(fd, 'hold_minutes');
  const gcap = int(fd, 'graduate_capacity');
  if (hold === null || hold < 1 || hold > 120 || gcap === null || gcap < 0) fail(back, errorText('bad_request'));
  const old = await one('select venue_name, venue_area, graduate_capacity, hold_minutes from season_settings where season_id = $1', [staff.season.id]);
  await sql('update season_settings set venue_name = $2, venue_area = $3, graduate_capacity = $4, hold_minutes = $5 where season_id = $1', [
    staff.season.id, str(fd, 'venue_name', 120) || 'Graduation Hall', str(fd, 'venue_area', 120), gcap, hold,
  ]);
  await fn('log_event', [staff.email, 'venue_saved', 'hall_layout', staff.season.id, null, null,
    JSON.stringify({ old, new: { venue_name: str(fd, 'venue_name', 120), venue_area: str(fd, 'venue_area', 120), graduate_capacity: gcap, hold_minutes: hold } }), null]);
  ok(back, 'Venue saved.');
}
