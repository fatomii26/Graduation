'use server';
import { fn } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { errorText } from '@/lib/errors';
import { aed } from '@/lib/format';
import { backPath, fail, finish, ok, str } from '@/lib/forms';

export async function counterMerchAction(fd: FormData) {
  const staff = await requireStaff('merchandise');
  const back = backPath(fd, '/admin/merchandise?tab=otc');
  const lines: { item_id: number; qty: number }[] = [];
  for (const [k, v] of fd.entries()) {
    const m = k.match(/^qty_(\d+)$/);
    const q = Number(v);
    if (m && Number.isInteger(q) && q > 0) lines.push({ item_id: Number(m[1]), qty: Math.min(q, 50) });
  }
  const r = await fn('create_merch_order', [staff.season.id, str(fd, 'misis', 20), str(fd, 'buyer_name', 120), str(fd, 'buyer_email', 200), JSON.stringify(lines), 'counter', str(fd, 'method', 40), staff.email]);
  if (!r.ok) fail(back, errorText(r.error));
  ok(back, `Counter order ${r.ref} paid (${aed(Number(r.amount))}). Hand over the items and mark it collected.`);
}

export async function collectAction(fd: FormData) {
  const staff = await requireStaff('merchandise');
  const back = backPath(fd, '/admin/merchandise');
  finish(back, await fn('mark_collected', [str(fd, 'order', 40), staff.email]), 'Marked as collected.');
}
