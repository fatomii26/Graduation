// Shared PostgreSQL connection for the command-line scripts (same rules as lib/db.ts).
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv() {
  for (const f of ['.env.local', '.env']) {
    const p = path.resolve(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\s+#.*$/, '');
    }
  }
}

export function connect({ direct = false } = {}) {
  const raw = (direct && process.env.DATABASE_URL_DIRECT) || process.env.DATABASE_URL;
  if (!raw) throw new Error('DATABASE_URL is not set');
  const url = new URL(raw);
  url.searchParams.delete('sslmode');
  const mode = process.env.DATABASE_SSL ?? (['localhost', '127.0.0.1', 'db'].includes(url.hostname) ? 'disable' : 'require');
  const ssl = mode === 'disable' ? false : { rejectUnauthorized: mode === 'verify' };
  return new pg.Client({ connectionString: url.toString(), ssl });
}
