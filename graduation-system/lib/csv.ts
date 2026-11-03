/** Minimal CSV parser (quoted fields, commas and line breaks inside quotes). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Rows as objects keyed by the lower-case header names */
export function csvObjects(text: string): { header: string[]; rows: Record<string, string>[] } {
  const all = parseCsv(text);
  const header = (all.shift() ?? []).map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return { header, rows: all.map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

export function toCsv(rows: (string | number | boolean | null | undefined | Date)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const t = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v);
          const safe = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t; // stop spreadsheet formula injection
          return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
        })
        .join(','),
    )
    .join('\r\n');
}
