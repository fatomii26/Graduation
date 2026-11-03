'use server';
import { redirect } from 'next/navigation';
import { fn, one } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { createSession } from '@/lib/auth/session';
import { getAppSettings, testShortcutsAllowed } from '@/lib/settings';
import { csvObjects } from '@/lib/csv';
import { backPath, fail, finish, int, ok, str } from '@/lib/forms';

export async function importMasterListAction(fd: FormData) {
  const staff = await requireStaff('master_list');
  const back = backPath(fd, '/admin/master-list');
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size) fail(back, 'Choose a CSV file.');
  if (file.size > 4_000_000) fail(back, 'The file is too large (max 4 MB).');
  const { header, rows } = csvObjects(await file.text());
  const need = (await getAppSettings()).upload_rules.master_list ?? ['misis', 'email', 'full_name'];
  const missing = need.filter((c) => !header.includes(c));
  if (missing.length) fail(back, `Missing column(s): ${missing.join(', ')}. Expected: misis, email, mobile, full_name, programme, confirmed_graduate, financial_hold, ceremony, grad_seat_label, max_guests.`);
  let created = 0;
  let updated = 0;
  const problems: string[] = [];
  const warnings: Record<string, number> = {};
  for (const row of rows.slice(0, 20000)) {
    const r = await fn('upsert_graduate', [staff.season.id, JSON.stringify(row), staff.email]);
    if (!r.ok) {
      if (problems.length < 8) problems.push(`${row.misis || '?'}: ${r.error}`);
      continue;
    }
    if (r.action === 'created') created++;
    else updated++;
    for (const w of (r.warnings as string[]) ?? []) warnings[w] = (warnings[w] ?? 0) + 1;
  }
  await fn('log_event', [staff.email, 'master_list_import', 'master_list', staff.season.id, null, null,
    JSON.stringify({ file: file.name, created, updated, failed: problems.length, warnings }), null]);
  const w = Object.entries(warnings).map(([k, n]) => `${n} ${k.replace(/_/g, ' ')}`).join(', ');
  ok(back, `Imported ${file.name}: ${created} new, ${updated} updated, nobody removed.${w ? ` Notes: ${w}.` : ''}${problems.length ? ` Not imported: ${problems.join('; ')}` : ''}`);
}

export async function updateContactAction(fd: FormData) {
  const staff = await requireStaff('master_list');
  const back = backPath(fd, '/admin/master-list');
  const r = await fn('update_contact', [staff.season.id, str(fd, 'misis', 20), str(fd, 'email', 200), str(fd, 'private_email', 200), str(fd, 'mobile', 40), staff.email]);
  finish(back, r, 'Contact details saved.');
}

export async function setLimitAction(fd: FormData) {
  const staff = await requireStaff('prices', 'extra_tickets_approve');
  const back = backPath(fd, '/admin/master-list');
  const v = str(fd, 'max_guests', 3);
  const r = await fn('set_graduate_limit', [staff.season.id, str(fd, 'misis', 20), v === '' ? null : int(fd, 'max_guests'), staff.email]);
  finish(back, r, 'Guest limit saved.');
}

/** Test mode only: open the student's own view without a sign-in code. */
export async function studentViewAction(fd: FormData) {
  const staff = await requireStaff('master_list');
  const back = backPath(fd, '/admin/master-list');
  if (!(await testShortcutsAllowed())) fail(back, 'Student View is only available in Test mode.');
  const g = await one<{ misis: string }>('select misis from graduates where season_id = $1 and misis = $2', [staff.season.id, str(fd, 'misis', 20)]);
  if (!g) fail(back, 'Student not found.');
  await fn('log_event', [staff.email, 'student_view_opened', 'master_list', staff.season.id, g.misis, null, '{}', 'Test mode']);
  await createSession('student', g.misis, staff.season.id);
  redirect('/book');
}
