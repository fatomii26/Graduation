// Applies db/migrations/*.sql in order, each once, each in its own transaction.
//   npm run db:migrate
import fs from 'node:fs';
import path from 'node:path';
import { connect, loadEnv } from './db-connect.mjs';

loadEnv();
const dir = path.resolve(process.cwd(), 'db/migrations');
const files = fs.readdirSync(dir).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
const client = connect({ direct: true });
await client.connect();
try {
  await client.query(`create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())`);
  const done = new Set((await client.query('select name from schema_migrations')).rows.map((r) => r.name));
  let applied = 0;
  for (const f of files) {
    if (done.has(f)) continue;
    process.stdout.write(`Applying ${f} ... `);
    await client.query('begin');
    try {
      await client.query(fs.readFileSync(path.join(dir, f), 'utf8'));
      await client.query('insert into schema_migrations (name) values ($1)', [f]);
      await client.query('commit');
      applied++;
      console.log('done');
    } catch (e) {
      await client.query('rollback');
      console.log('FAILED');
      throw e;
    }
  }
  console.log(applied ? `${applied} migration(s) applied.` : 'Database is up to date.');
} finally {
  await client.end();
}
