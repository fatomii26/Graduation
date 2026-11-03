import 'server-only';
import { fn, sql } from './db';

export async function logEvent(
  actor: string, action: string, category: string, seasonId: string | null, misis: string | null = null, details: Record<string, unknown> = {}, reason: string | null = null,
) {
  await fn('log_event', [actor, action, category, seasonId, misis, null, JSON.stringify(details), reason]);
}

/** Technical Change Log: old and new value of every Technical Settings change. Secrets are never written here. */
export async function techChange(actor: string, area: string, setting: string, oldValue: unknown, newValue: unknown) {
  const show = (v: unknown): string | null =>
    v === null || v === undefined ? null : (typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 2000);
  await sql('insert into technical_change_log (actor, area, setting, old_value, new_value) values ($1, $2, $3, $4, $5)', [
    actor, area, setting, show(oldValue), show(newValue),
  ]);
  await logEvent(actor, 'technical_change', 'technical', null, null, { area, setting });
}

export async function logError(source: string, err: unknown, path?: string) {
  try {
    await sql('insert into error_log (source, message, path, detail) values ($1, $2, $3, $4)', [
      source, String((err as Error)?.message ?? err).slice(0, 1000), path ?? null, JSON.stringify({ stack: String((err as Error)?.stack ?? '').slice(0, 2000) }),
    ]);
  } catch {
    // the error log must never throw
  }
}
