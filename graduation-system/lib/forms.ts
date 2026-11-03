import 'server-only';
import { redirect } from 'next/navigation';
import type { FnResult } from './db';
import { errorText } from './errors';

// Helpers for Server Actions that answer with a redirect back to the page and a short message.

export function str(fd: FormData, key: string, max = 500): string {
  return String(fd.get(key) ?? '').trim().slice(0, max);
}

export function int(fd: FormData, key: string): number | null {
  const v = String(fd.get(key) ?? '').trim();
  return /^-?\d{1,9}$/.test(v) ? Number(v) : null;
}

export function num(fd: FormData, key: string): number | null {
  const v = String(fd.get(key) ?? '').trim();
  return /^\d{1,7}(\.\d{1,2})?$/.test(v) ? Number(v) : null;
}

export const bool = (fd: FormData, key: string) => ['on', 'true', '1', 'yes'].includes(String(fd.get(key) ?? ''));

/** Only same-site paths, so a form can never redirect to another site */
export function backPath(fd: FormData, fallback: string): string {
  const s = String(fd.get('_back') ?? '');
  return s.startsWith('/') && !s.startsWith('//') && !s.includes('\\') ? s : fallback;
}

export function withMessage(path: string, kind: 'msg' | 'err', text: string): string {
  const [p, q = ''] = path.split('?');
  const params = new URLSearchParams(q);
  params.delete('msg');
  params.delete('err');
  params.set(kind, text.slice(0, 600));
  return `${p}?${params}`;
}

export function finish(back: string, res: FnResult | { ok: boolean; error?: string }, okMessage: string): never {
  redirect(res.ok ? withMessage(back, 'msg', okMessage) : withMessage(back, 'err', errorText(res.error)));
}

export function fail(back: string, message: string): never {
  redirect(withMessage(back, 'err', message));
}

export function ok(back: string, message: string): never {
  redirect(withMessage(back, 'msg', message));
}
