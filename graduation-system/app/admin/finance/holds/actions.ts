'use server';
import { fn, sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { getAppSettings } from '@/lib/settings';
import { csvObjects } from '@/lib/csv';
import { backPath, fail, finish, num, ok, str } from '@/lib/forms';

export async function placeHoldAction(fd: FormData) {
  const staff = await requireStaff('financial_hold');
  const back = backPath(fd, '/admin/finance/holds');
  finish(back, await fn('place_hold', [staff.season.id, str(fd, 'misis', 20), str(fd, 'reason', 300), num(fd, 'amount'), staff.email]), 'Financial hold placed. The student cannot buy tickets until it is removed.');
}

export async function removeHoldAction(fd: FormData) {
  const staff = await requireStaff('financial_hold');
  const back = backPath(fd, '/admin/finance/holds');
  finish(back, await fn('remove_hold', [staff.season.id, str(fd, 'misis', 20), str(fd, 'note', 300), staff.email]), 'Hold removed. DAR can see the change on their list.');
}

export async function sendRequestAction(fd: FormData) {
  const staff = await requireStaff('financial_hold');
  const back = backPath(fd, '/admin/finance/holds');
  finish(back, await fn('send_finance_request', [staff.season.id, str(fd, 'misis', 20), staff.email]), 'Clearance request sent to DAR.');
}

export async function sendAllRequestsAction(fd: FormData) {
  const staff = await requireStaff('financial_hold');
  const back = backPath(fd, '/admin/finance/holds');
  const rows = await sql<{ misis: string }>(
    `select misis from graduates where season_id = $1 and not financial_hold and finance_request_sent_at is null`, [staff.season.id]);
  for (const r of rows) await fn('send_finance_request', [staff.season.id, r.misis, staff.email]);
  ok(back, `Clearance request sent to DAR for ${rows.length} student(s) without a hold.`);
}

export async function uploadHoldsAction(fd: FormData) {
  const staff = await requireStaff('financial_hold');
  const back = backPath(fd, '/admin/finance/holds');
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size) fail(back, 'Choose a CSV file.');
  const { header, rows } = csvObjects(await file.text());
  const need = (await getAppSettings()).upload_rules.financial_hold ?? ['misis', 'reason'];
  const missing = need.filter((c) => !header.includes(c));
  if (missing.length) fail(back, `Missing column(s): ${missing.join(', ')}.`);
  let placed = 0;
  const skipped: string[] = [];
  for (const r of rows.slice(0, 10000)) {
    const res = await fn('place_hold', [staff.season.id, r.misis, r.reason || 'Finance hold', r.amount && /^\d+(\.\d+)?$/.test(r.amount) ? Number(r.amount) : null, staff.email]);
    if (res.ok) placed++;
    else if (skipped.length < 10) skipped.push(`${r.misis}: ${res.error}`);
  }
  ok(back, `${placed} hold(s) placed.${skipped.length ? ` Skipped: ${skipped.join('; ')}` : ''}`);
}
