// Formatting helpers used on the server and in the browser. All times are shown in Asia/Dubai, money in AED.

export const TZ = 'Asia/Dubai';

const dt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts });

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return dt({ day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return dt({ weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));
}

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return '—';
  return dt({ hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(d));
}

export function aed(n: number | string | null | undefined): string {
  const v = Number(n ?? 0);
  return `AED ${v.toLocaleString('en-US', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}

/** Value for <input type="datetime-local"> in Dubai time */
export function toDubaiInput(d: Date | string | null | undefined): string {
  if (!d) return '';
  const p = Object.fromEntries(
    dt({ year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
      .formatToParts(new Date(d))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}

/** Dubai has no daylight saving: local time is always UTC+04:00 */
export function fromDubaiInput(s: string | null | undefined): string | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return null;
  return `${s}:00+04:00`;
}

export function maskEmail(e: string | null | undefined): string {
  if (!e) return '';
  const [u, d] = e.split('@');
  return `${u.slice(0, 2)}${'•'.repeat(Math.max(1, u.length - 2))}@${d}`;
}

export function ticketsText(graduate: boolean, guests: number): string {
  const parts: string[] = [];
  if (graduate) parts.push('1 graduate ticket');
  if (guests) parts.push(`${guests} guest ticket${guests === 1 ? '' : 's'}`);
  return parts.join(' and ') || 'no tickets';
}

export const normMisis = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

export const SCAN_RESULT: Record<string, string> = {
  admit: 'Admitted',
  already_used: 'Already used',
  wrong_ceremony: 'Wrong ceremony',
  void: 'Void',
  replaced: 'Replaced',
  not_found: 'Not found',
  wrong_door: 'Wrong door',
  wrong_entrance: 'Wrong entrance',
};
