'use server';
import { fn, one, sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { getAppSettings } from '@/lib/settings';
import { csvObjects } from '@/lib/csv';
import { backPath, fail, ok, str } from '@/lib/forms';

function toDate(s: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

export async function uploadSapAction(fd: FormData) {
  const staff = await requireStaff('reconciliation');
  const back = backPath(fd, '/admin/finance/reconciliation');
  const kind = str(fd, 'kind') === 'sap_invoice' ? 'sap_invoice' : 'sap_balance';
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size) fail(back, 'Choose a CSV file.');
  if (file.size > 8_000_000) fail(back, 'The file is too large (max 8 MB).');
  const { header, rows } = csvObjects(await file.text());
  const need = (await getAppSettings()).upload_rules[kind] ?? ['reference', 'amount'];
  const missing = need.filter((c) => !header.includes(c));
  if (missing.length) fail(back, `Missing column(s): ${missing.join(', ')}. Required: ${need.join(', ')}.`);
  const up = await one<{ id: number }>(
    'insert into reconciliation_uploads (season_id, kind, filename, row_count, uploaded_by) values ($1, $2, $3, $4, $5) returning id',
    [staff.season.id, kind, file.name.slice(0, 200), rows.length, staff.email],
  );
  const list = rows.slice(0, 50000);
  await sql(
    `insert into reconciliation_lines (upload_id, reference, misis, amount_aed, line_date, description, raw)
     select $1, r, m, a, d, x, j from unnest($2::text[], $3::text[], $4::numeric[], $5::date[], $6::text[], $7::jsonb[]) as u(r, m, a, d, x, j)`,
    [
      up!.id,
      list.map((r) => (r.reference || '').toUpperCase().slice(0, 120) || null),
      list.map((r) => (r.misis || '').toUpperCase().replace(/[^A-Z0-9]/g, '') || null),
      list.map((r) => (/^-?\d+(\.\d+)?$/.test((r.amount || '').replace(/,/g, '')) ? Number(r.amount.replace(/,/g, '')) : null)),
      list.map((r) => toDate(r.date || r.posting_date || '')),
      list.map((r) => (r.description || r.text || '').slice(0, 300) || null),
      list.map((r) => JSON.stringify(r)),
    ],
  );
  await fn('log_event', [staff.email, 'sap_upload', 'finance', staff.season.id, null, null, JSON.stringify({ kind, file: file.name, rows: list.length }), null]);
  ok(back, `${file.name}: ${list.length} line(s) loaded. The comparison below is updated.`);
}
