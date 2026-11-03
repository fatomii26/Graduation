'use server';
import { fn } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { csvObjects } from '@/lib/csv';
import { errorText } from '@/lib/errors';
import { backPath, fail, finish, int, ok, str } from '@/lib/forms';

export async function allocateAction(fd: FormData) {
  const staff = await requireStaff('ceremony_allocation');
  const back = backPath(fd, '/admin/dar/allocation');
  const n = int(fd, 'ceremony');
  finish(back, await fn('allocate_ceremony', [staff.season.id, str(fd, 'misis', 20), n && n > 0 ? n : null, staff.email]), n ? 'Ceremony allocated.' : 'Allocation removed.');
}

export async function autoAllocateAction(fd: FormData) {
  const staff = await requireStaff('ceremony_allocation');
  const back = backPath(fd, '/admin/dar/allocation');
  const r = await fn('auto_allocate', [staff.season.id, staff.email]);
  ok(back, `${r.allocated} graduate(s) allocated using the Programme to Ceremony Map.`);
}

export async function confirmAction(fd: FormData) {
  const staff = await requireStaff('potential_graduates');
  const back = backPath(fd, '/admin/dar/potential');
  const yes = str(fd, 'confirmed') === 'yes';
  finish(back, await fn('set_confirmed', [staff.season.id, str(fd, 'misis', 20), yes, staff.email]), yes ? 'Confirmed as a graduate.' : 'Set back to potential graduate.');
}

export async function bulkConfirmAction(fd: FormData) {
  const staff = await requireStaff('potential_graduates');
  const back = backPath(fd, '/admin/dar/potential');
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size) fail(back, 'Choose a CSV file with a misis column.');
  const { header, rows } = csvObjects(await file.text());
  if (!header.includes('misis')) fail(back, 'The file needs a misis column.');
  let n = 0;
  const bad: string[] = [];
  for (const r of rows.slice(0, 10000)) {
    const res = await fn('set_confirmed', [staff.season.id, r.misis, true, staff.email]);
    if (res.ok) n++;
    else if (bad.length < 8) bad.push(`${r.misis}: ${errorText(res.error)}`);
  }
  ok(back, `${n} graduate(s) confirmed.${bad.length ? ` Not changed: ${bad.join('; ')}` : ''}`);
}
