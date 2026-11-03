import 'server-only';
import { Pool, types } from 'pg';

// bigint ids and counts, and numeric money values, as JavaScript numbers (all well within safe range here)
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => parseFloat(v));

// One small pool per server instance. Works with Supabase's transaction pooler, Azure PostgreSQL or a local container.
declare global {
  // eslint-disable-next-line no-var
  var __gradPool: Pool | undefined;
}

function makePool() {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const url = new URL(raw);
  url.searchParams.delete('sslmode');
  const mode = process.env.DATABASE_SSL ?? (['localhost', '127.0.0.1', 'db'].includes(url.hostname) ? 'disable' : 'require');
  return new Pool({
    connectionString: url.toString(),
    ssl: mode === 'disable' ? false : { rejectUnauthorized: mode === 'verify' },
    max: Number(process.env.DATABASE_POOL_MAX ?? 5),
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 8_000,
  });
}

export function pool(): Pool {
  globalThis.__gradPool ??= makePool();
  return globalThis.__gradPool;
}

export async function sql<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool().query(text, params as unknown[]);
  return r.rows as T[];
}

export async function one<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  return (await sql<T>(text, params))[0] ?? null;
}

export type FnResult = { ok: boolean; error?: string; [key: string]: unknown };

/** Calls a database rule function: select name($1, $2, ...). Arguments that are jsonb must be passed as JSON strings. */
export async function fn<T = FnResult>(name: string, args: unknown[]): Promise<T> {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new Error('Invalid function name');
  const placeholders = args.map((_, i) => `$${i + 1}`).join(', ');
  const r = await pool().query(`select ${name}(${placeholders}) as r`, args as unknown[]);
  return r.rows[0]?.r as T;
}
