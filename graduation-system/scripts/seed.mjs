// Loads the fictional demo data (db/seed/demo.sql). Refuses to run when the system is in Live mode.
//   npm run db:seed
import fs from 'node:fs';
import path from 'node:path';
import { connect, loadEnv } from './db-connect.mjs';

loadEnv();
const client = connect({ direct: true });
await client.connect();
try {
  const live = (await client.query('select not test_mode as live from app_settings')).rows[0]?.live;
  if (live) throw new Error('The system is in Live mode. Demo data is only for testing environments.');
  const seeded = (await client.query(`select count(*)::int as n from seasons where id = 'OCT-2026'`)).rows[0].n;
  if (seeded) {
    console.log('Demo data is already loaded (season OCT-2026 exists). Nothing to do.');
  } else {
    await client.query('begin');
    await client.query(fs.readFileSync(path.resolve(process.cwd(), 'db/seed/demo.sql'), 'utf8'));
    await client.query('commit');
    console.log('Demo data loaded: 4 seasons, 100 fictional graduates, staff in every role, zones, merchandise.');
  }
} catch (e) {
  await client.query('rollback').catch(() => {});
  console.error(e.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
