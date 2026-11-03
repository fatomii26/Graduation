'use server';
import { fn } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { errorText } from '@/lib/errors';
import { SCAN_RESULT } from '@/lib/format';
import { backPath, fail, ok, str } from '@/lib/forms';

/** Manual override for a failed scanner (only when switched on in Technical Settings). Needs a reason; audited. */
export async function manualCheckinAction(fd: FormData) {
  const staff = await requireStaff('entry_checkin');
  const back = backPath(fd, '/admin/checkin');
  const cp = str(fd, 'checkpoint');
  const r = await fn('manual_checkin', [str(fd, 'ticket', 40), cp === 'door2' ? 'door2' : cp === 'graduate' ? 'graduate' : 'door1', str(fd, 'reason', 300), staff.email]);
  if (r.error) fail(back, errorText(r.error));
  if (r.result !== 'admit') fail(back, `Not admitted: ${SCAN_RESULT[String(r.result)] ?? r.result}.`);
  ok(back, 'Checked in manually. The override is recorded in the scan log and the audit log.');
}
