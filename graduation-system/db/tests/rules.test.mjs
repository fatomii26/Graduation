// Business-rule tests. Runs every migration on an in-memory PostgreSQL (PGlite) — no database server needed.
//   npm run test:db
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const migrations = fs.readdirSync(path.join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();

async function freshDb() {
  const db = new PGlite();
  for (const f of migrations) {
    try {
      await db.exec(fs.readFileSync(path.join(root, 'migrations', f), 'utf8'));
    } catch (e) {
      console.error(`Migration ${f} failed:`, e.message);
      throw e;
    }
  }
  return db;
}

let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) pass++;
  else {
    fail++;
    console.log('FAIL:', msg);
  }
};

const db = await freshDb();
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const one = async (sql, params = []) => Object.values((await q(sql, params))[0] ?? {})[0];
const throws = async (sql, params = []) => {
  try {
    await db.query(sql, params);
    return false;
  } catch {
    return true;
  }
};

const S = 'TEST-1';
// ---------------------------------------------------------------------------
// Set-up: one season, four ceremonies, two zones
// ---------------------------------------------------------------------------
let r = await one(`select create_season($1, 'Test season', null, 'test')`, [S]);
ok(r.ok, 'create season ' + JSON.stringify(r));
await db.exec(`update season_settings set graduate_price_aed = 100, guest_price_aed = 50, sales_open = true where season_id = '${S}'`);
r = await one(`select save_zone($1, null, 'A', 'Zone A', 'Door 2A', '#7A1128', 3, 1, 1, true, 'test')`, [S]);
ok(r.ok, 'zone A');
const ZA = Number(r.id);
r = await one(`select save_zone($1, null, 'B', 'Zone B', 'Door 2B', '#1F3A5F', 12, 0, 2, true, 'test')`, [S]);
const ZB = Number(r.id);
const cer = async (n) => Number(await one(`select id from ceremonies where season_id = $1 and number = $2`, [S, n]));
const C1 = await cer(1);
const C2 = await cer(2);

const addGrad = async (misis, { confirmed = true, sent = true, ceremony = 1, hold = false } = {}) => {
  await q(`insert into graduates (season_id, misis, email, full_name, programme, confirmed_graduate, finance_request_sent_at)
           values ($1, $2, lower($2) || '@live.mdx.ac.uk', 'Grad ' || $2, 'BSc Test', $3, case when $4 then now() end)`,
    [S, misis, confirmed, sent]);
  if (ceremony && confirmed && sent && !hold) await one(`select allocate_ceremony($1, $2, $3, 'test')`, [S, misis, ceremony]);
  if (hold) await one(`select place_hold($1, $2, 'Balance', 100, 'test')`, [S, misis]);
};
for (const m of ['G001', 'G002', 'G006', 'G007', 'G008', 'G009', 'G010', 'G011', 'G012', 'G013']) await addGrad(m);
await addGrad('G003', { hold: true, ceremony: null });
await addGrad('G004', { confirmed: false, ceremony: null });
await addGrad('G005', { ceremony: 2 });
await addGrad('G014', { sent: false, ceremony: null });

const guests = (...list) => JSON.stringify(list.map(([name, zone, access]) => ({ name, zone_id: zone, access: access ?? 'none' })));
const book = (misis, list, kind = 'main', code = null) =>
  one(`select book_order($1, $2, $3, $4::jsonb, $5, 'student:' || $2)`, [S, misis, kind, list, code]);
let evt = 0;
const pay = (orderId, amount, ref = null) =>
  one(`select record_payment($1, 'ccavenue', 'ticket', $2, 'paid', $3, $4, '{}'::jsonb, 'gateway')`,
    [`k${++evt}`, orderId, amount, ref ?? `T${evt}`]);
const tickets = (misis) => q(`select * from tickets where season_id = $1 and misis = $2 order by kind, created_at`, [S, misis]);

// ---------------------------------------------------------------------------
// Rule 2: allocation
// ---------------------------------------------------------------------------
ok(await throws(`insert into graduates (season_id, misis, email, full_name, ceremony_id) values ($1, 'BAD1', 'bad1@live.mdx.ac.uk', 'Bad', $2)`, [S, C1]),
  'allocation trigger blocks unconfirmed graduate');
r = await one(`select allocate_ceremony($1, 'G004', 1, 'dar')`, [S]); ok(r.error === 'not_confirmed', 'allocate: not confirmed');
r = await one(`select allocate_ceremony($1, 'G003', 1, 'dar')`, [S]); ok(r.error === 'financial_hold', 'allocate: hold');
r = await one(`select allocate_ceremony($1, 'G014', 1, 'dar')`, [S]); ok(r.error === 'finance_request_missing', 'allocate: finance request missing');
r = await one(`select send_finance_request($1, 'G014', 'finance')`, [S]); ok(r.ok, 'finance request sent');
r = await one(`select allocate_ceremony($1, 'G014', 1, 'dar')`, [S]); ok(r.ok, 'allocate after request');

// ---------------------------------------------------------------------------
// Rule 1: eligibility
// ---------------------------------------------------------------------------
ok((await one(`select eligibility($1, 'NOPE')`, [S])) === 'not_on_master_list', 'eligibility: not on list');
ok((await one(`select eligibility($1, 'G003')`, [S])) === 'financial_hold', 'eligibility: hold');
ok((await one(`select eligibility($1, 'G004')`, [S])) === 'not_confirmed', 'eligibility: not confirmed');
ok((await one(`select eligibility($1, 'G001')`, [S])) === null, 'eligibility: ok');
await db.exec(`update season_settings set sales_open = false where season_id = '${S}'`);
r = await book('G001', guests(['Anna One', ZA]));
ok(r.error === 'sales_closed', 'sales closed blocks booking');
await db.exec(`update season_settings set sales_open = true where season_id = '${S}'`);

// ---------------------------------------------------------------------------
// Zones, holds, limits
// ---------------------------------------------------------------------------
r = await book('G001', guests(['Anna One', ZA], ['Ben One', ZA]));
ok(r.ok && Number(r.amount) === 200, 'book main 1 grad + 2 guests ' + JSON.stringify(r));
const o1 = r.order_id;
let av = await one(`select zone_availability($1)`, [C1]);
ok(av.find((z) => z.code === 'A').left === 1, 'zone A shows 1 place left');
r = await book('G001', guests(['X Y', ZB])); ok(r.error === 'order_exists', 'one active main order');
r = await book('G002', guests(['Cara Two', ZA], ['Dan Two', ZA])); ok(r.error === 'zone_full' && r.left === 1, 'zone full ' + JSON.stringify(r));
r = await book('G006', guests(['Eve Six', ZB], ['Finn Six', ZA])); ok(r.error === 'keep_together', 'keep the group together when the first zone has room');
r = await book('G002', guests(['Cara Two', ZA], ['Dan Two', ZB])); ok(r.ok, 'split allowed when first zone cannot take the group');
const o2 = r.order_id;
r = await book('G007', guests(['A a', ZB], ['B b', ZB], ['C c', ZB], ['D d', ZB], ['E e', ZB])); ok(r.error === 'limit_reached', 'guest limit 4');
r = await book('G007', guests(['Wh Comp', ZB, 'companion'])); ok(r.error === 'companion_needs_wheelchair', 'companion needs wheelchair');
r = await book('G007', guests(['N', ZB])); ok(r.error === 'name_required', 'guest name required');
r = await book('G007', guests(['Wheel One', ZB, 'wheelchair'])); ok(r.error === 'no_wheelchair_space', 'no wheelchair space in zone B');
r = await book('G007', JSON.stringify([{ name: 'Nobody Here', zone_id: 999999 }])); ok(r.error === 'no_such_zone', 'unknown zone');
r = await book('G003', guests(['Hold Guest', ZB])); ok(r.error === 'financial_hold', 'hold blocks booking');

// hold expiry frees places
await db.query(`update orders set expires_at = now() - interval '1 second' where id = $1`, [o2]);
av = await one(`select zone_availability($1)`, [C1]);
ok(av.find((z) => z.code === 'A').left === 1 && av.find((z) => z.code === 'B').left === 12, 'expired hold no longer counts');
ok((await one(`select release_expired_holds()`)) >= 1, 'release job expires orders');
ok((await one(`select status from orders where id = $1`, [o2])) === 'expired', 'order expired');

// ---------------------------------------------------------------------------
// Payments (rules 10–12)
// ---------------------------------------------------------------------------
r = await pay(o1, 150);
ok(r.error === 'amount_mismatch', 'amount mismatch flagged');
ok((await tickets('G001')).length === 0, 'no tickets on mismatch');
ok(/Amount mismatch/.test(await one(`select needs_attention from orders where id = $1`, [o1])), 'needs attention set');
r = await one(`select record_payment('k-dup', 'ccavenue', 'ticket', $1, 'paid', 200, 'REF-1', '{}', 'gateway')`, [o1]);
ok(r.ok && !r.already_paid, 'payment confirmed ' + JSON.stringify(r));
r = await one(`select record_payment('k-dup', 'ccavenue', 'ticket', $1, 'paid', 200, 'REF-1', '{}', 'gateway')`, [o1]);
ok(r.duplicate, 'duplicate notification ignored');
r = await one(`select record_payment('k-dup-2', 'ccavenue', 'ticket', $1, 'paid', 200, 'REF-1', '{}', 'gateway')`, [o1]);
ok(r.already_paid, 'second key same ref is idempotent');
let t1 = await tickets('G001');
ok(t1.length === 3 && t1.filter((t) => t.kind === 'guest').length === 2, 'one graduate + two guest tickets');
ok((await one(`select count(*)::int from payments where order_id = $1 and reference = 'REF-1'`, [o1])) === 1, 'payment ledger has one row for REF-1');
ok(t1.every((t) => t.token.length >= 40 && /^[A-Za-z0-9_-]+$/.test(t.token)), 'token format');
ok(new Set(t1.map((t) => t.token)).size === 3, 'tokens unique');
ok(t1.find((t) => t.kind === 'guest').door === 'Door 2A', 'guest ticket carries zone door');
ok(t1.find((t) => t.kind === 'graduate').zone_id === null, 'graduate ticket has no zone');
ok(await throws(`update tickets set token = 'x' || token where id = $1`, [t1[0].id]), 'QR token cannot change');
ok(await throws(`update tickets set holder_name = 'Someone Else' where id = $1`, [t1[1].id]), 'name changes only through reissue');

// late payment, zone now full -> Needs Attention, graduate ticket only, then convert to receipt
r = await book('G006', guests(['Gia Six', ZA]));
const o6 = r.order_id;
await db.query(`update orders set expires_at = now() - interval '1 second' where id = $1`, [o6]);
r = await book('G008', guests(['Hal Eight', ZA])); ok(r.ok, 'another student takes the last place in A');
await pay(r.order_id, 150);
r = await pay(o6, 150);
ok(r.ok && r.attention, 'late payment accepted with attention ' + JSON.stringify(r));
let t6 = await tickets('G006');
ok(t6.length === 1 && t6[0].kind === 'graduate', 'only graduate ticket issued when zone full');
r = await one(`select attention_to_receipt($1, 'finance')`, [o6]);
ok(r.ok && r.receipt_number, 'attention converted to receipt');
r = await one(`select redeem_receipt($1, 'G006', $2, $3::jsonb, 'student:G006')`, [S, r.receipt_number, guests(['Gia Six', ZB])]);
ok(r.ok, 'redeem converted receipt in zone B ' + JSON.stringify(r));
ok((await tickets('G006')).length === 2, 'guest ticket issued after conversion');

// ---------------------------------------------------------------------------
// Counter payments and receipts (rule 13)
// ---------------------------------------------------------------------------
r = await one(`select record_counter_payment($1, 'G009', false, 2, null, 'Cash', 'counter', null, 'finance')`, [S]);
ok(r.error === 'graduate_ticket_required', 'counter: graduate ticket required first');
r = await one(`select record_counter_payment($1, 'G009', true, 2, 999, 'Cash', 'counter', null, 'finance')`, [S]);
ok(r.error === 'amount_mismatch' && Number(r.expected) === 200, 'counter: wrong amount refused');
r = await one(`select record_counter_payment($1, 'G009', true, 2, 200, 'Card at Desk', 'counter', null, 'finance')`, [S]);
ok(r.ok && /^RC[A-Z0-9]{8}$/.test(r.receipt_number), 'counter: receipt created');
const rc9 = r.receipt_number;
r = await one(`select record_counter_payment($1, 'G009', true, 1, null, 'Cash', 'counter', null, 'finance')`, [S]);
ok(r.error === 'graduate_ticket_exists', 'counter: graduate ticket only once');
r = await one(`select redeem_receipt($1, 'G009', $2, $3::jsonb, 'student:G009')`, [S, rc9, guests(['Ivy Nine', ZB])]);
ok(r.error === 'guest_count_mismatch', 'receipt: guest count must match');
r = await one(`select redeem_receipt($1, 'G002', $2, $3::jsonb, 'student:G002')`, [S, rc9, guests(['Ivy Nine', ZB], ['Jon Nine', ZB])]);
ok(r.error === 'receipt_invalid', 'receipt belongs to one student');
r = await one(`select redeem_receipt($1, 'G009', $2, $3::jsonb, 'student:G009')`, [S, rc9, guests(['Ivy Nine', ZB], ['Jon Nine', ZB])]);
ok(r.ok, 'receipt redeemed ' + JSON.stringify(r));
ok((await tickets('G009')).length === 3, 'receipt tickets issued');
r = await one(`select redeem_receipt($1, 'G009', $2, $3::jsonb, 'student:G009')`, [S, rc9, guests(['Ivy Nine', ZB], ['Jon Nine', ZB])]);
ok(r.error === 'receipt_used', 'receipt works once');
await db.exec(`update season_settings set sales_open = false where season_id = '${S}'`);
r = await one(`select record_counter_payment($1, 'G010', true, 0, null, 'Cash', 'graduation_day', null, 'finance')`, [S]);
ok(r.ok, 'graduation day payment works while online sales are closed');
await db.exec(`update season_settings set sales_open = true where season_id = '${S}'`);

// third party payer
r = await one(`select start_third_party_order($1, 'G011', true, 1, 'Parent Eleven', 'parent@example.com', 'Parent', 'public')`, [S]);
ok(r.ok && Number(r.amount) === 150, 'third party order');
r = await pay(r.order_id, 150);
ok(r.ok && r.receipt_number, 'third party payment creates receipt');
r = await one(`select redeem_receipt($1, 'G011', $2, $3::jsonb, 'student:G011')`, [S, r.receipt_number, guests(['Kim Eleven', ZB])]);
ok(r.ok && (await tickets('G011')).length === 2, 'student chooses zone after third party payment');

// ---------------------------------------------------------------------------
// Extra tickets (rule 3, 8.4)
// ---------------------------------------------------------------------------
r = await one(`select request_extra_tickets($1, 'G001', 3, 'Family', 'student:G001')`, [S]);
ok(r.ok, 'extra request');
r = await one(`select request_extra_tickets($1, 'G001', 1, 'Again', 'student:G001')`, [S]);
ok(r.error === 'request_open', 'one open request');
const reqId = r.ok ? null : (await one(`select id from extra_ticket_requests where season_id = $1 and misis = 'G001'`, [S]));
r = await one(`select decide_extra_request($1, true, 3, 'ok', 'marketing')`, [reqId]);
ok(r.ok && /^EX/.test(r.code), 'extra request approved with code');
const code1 = r.code;
ok((await one(`select guest_allowance($1, 'G001')`, [S])) === 7, 'allowance raised by code');
r = await book('G001', guests(['L1', ZB], ['L2', ZB], ['L3', ZB], ['L4', ZB]), 'extra', code1);
ok(r.error === 'limit_reached', 'extra limited to code size');
r = await book('G001', guests(['Lara One', ZB], ['Leo One', ZB]), 'extra', 'EXWRONG');
ok(r.error === 'code_invalid', 'wrong code');
r = await book('G001', guests(['Lara One', ZB], ['Leo One', ZB]), 'extra', code1);
ok(r.ok && Number(r.amount) === 100, 'extra order ' + JSON.stringify(r));
await pay(r.order_id, 100);
ok((await tickets('G001')).length === 5, 'extra tickets issued');
r = await book('G001', guests(['Lou One', ZB]), 'extra', code1);
ok(r.error === 'code_used', 'code works once');
r = await one(`select create_extra_code($1, 'G007', 1, null, 'marketing')`, [S]);
await db.query(`update extra_ticket_codes set expires_at = now() - interval '1 minute' where code = $1`, [r.code]);
const ex7 = await book('G007', guests(['Mo Seven', ZB]));
await pay(ex7.order_id, 150);
r = await book('G007', guests(['Max Seven', ZB]), 'extra', r.code);
ok(r.error === 'code_expired', 'code expires after its window');

// ---------------------------------------------------------------------------
// Transfers (rules 14–15) and name changes (rule 16)
// ---------------------------------------------------------------------------
t1 = (await tickets('G001')).filter((t) => t.kind === 'guest' && t.status === 'valid');
r = await one(`select request_transfer($1, 'G001', 'G005', $2::uuid[], '', 'student:G001')`, [S, `{${t1[0].id}}`]);
ok(r.error === 'different_ceremony', 'transfer only within the same ceremony');
r = await one(`select request_transfer($1, 'G001', 'G002', $2::uuid[], 'Cousin', 'student:G001')`, [S, `{${t1[0].id}}`]);
ok(r.ok, 'transfer requested');
const trId = r.id;
r = await one(`select request_transfer($1, 'G001', 'G012', $2::uuid[], '', 'student:G001')`, [S, `{${t1[0].id}}`]);
ok(r.error === 'transfer_pending', 'one open transfer per ticket');
r = await one(`select approve_transfer($1, 'ok', 'marketing')`, [trId]);
ok(r.ok, 'transfer approved');
const old = (await q(`select * from tickets where id = $1`, [t1[0].id]))[0];
const neu = (await q(`select * from tickets where id = $1`, [old.replaced_by]))[0];
ok(old.status === 'void' && neu.status === 'valid', 'old void, new valid');
ok(neu.misis === 'G002' && neu.zone_id === old.zone_id && neu.door === old.door && neu.token !== old.token, 'new holder, same zone, new QR');

r = await one(`select request_name_change($1, 'G001', $2, 'Benjamin One', 'Spelling', 'student:G001')`, [S, t1[1].id]);
ok(r.ok, 'name change requested');
r = await one(`select decide_name_change($1, true, 'ok', 'marketing')`, [r.id]);
ok(r.ok && r.new_ticket_id, 'name change approved');
const nt = (await q(`select * from tickets where id = $1`, [r.new_ticket_id]))[0];
ok(nt.holder_name === 'Benjamin One' && nt.replaces === t1[1].id, 'reissued with new name');

// ---------------------------------------------------------------------------
// Scanning (rules 17–19)
// ---------------------------------------------------------------------------
const scan = (token, ceremony, cp, door = null) => one(`select scan_ticket($1, $2, $3, $4, 'security')`, [token, ceremony, cp, door]);
const g9 = await tickets('G009');
const guest9 = g9.find((t) => t.kind === 'guest');
const grad9 = g9.find((t) => t.kind === 'graduate');
r = await scan(guest9.token, C1, 'door1'); ok(r.result === 'admit', 'door 1 admits guest');
r = await scan(guest9.token, C1, 'door1'); ok(r.result === 'already_used', 'door 1 refuses second scan');
r = await scan(guest9.token, C1, 'door2', 'Door 2A'); ok(r.result === 'wrong_door', 'door 2 wrong zone door');
r = await scan(guest9.token, C1, 'door2', 'Door 2B'); ok(r.result === 'admit' && !r.missed_door1, 'door 2 admits once');
r = await scan(guest9.token, C1, 'door2', 'Door 2B'); ok(r.result === 'already_used', 'door 2 refuses second scan');
r = await scan(guest9.token, C1, 'graduate'); ok(r.result === 'wrong_entrance', 'guest refused at graduate entrance');
for (const [cp, d] of [['graduate', null], ['door1', null], ['door1', null], ['door2', 'Door 2A'], ['graduate', null]]) {
  r = await scan(grad9.token, C1, cp, d);
  ok(r.result === 'admit', `graduate admitted at every scan (${cp})`);
}
r = await scan(grad9.token, C2, 'graduate'); ok(r.result === 'wrong_ceremony', 'wrong ceremony refused');
r = await scan('nope-not-a-token', C1, 'door1'); ok(r.result === 'not_found', 'unknown refused');
r = await scan(old.token, C1, 'door1'); ok(r.result === 'replaced', 'replaced ticket refused');
const g11 = (await tickets('G011')).find((t) => t.kind === 'guest');
r = await scan(g11.token, C1, 'door2', 'Door 2B'); ok(r.result === 'admit' && r.missed_door1, 'door 2 without door 1: admitted and flagged');
ok((await one(`select count(*)::int from scans where result <> 'admit'`)) >= 7, 'refused scans are logged');
r = await one(`select manual_checkin($1, 'door1', 'Scanner broken', 'security')`, [g11.id]);
ok(r.error === 'override_disabled', 'manual override off by default');
await db.exec(`update app_settings set manual_checkin_override = true`);
r = await one(`select manual_checkin($1, 'door1', '', 'security')`, [g11.id]); ok(r.error === 'reason_required', 'manual override needs a reason');
r = await one(`select manual_checkin($1, 'door1', 'Scanner broken', 'security')`, [g11.id]); ok(r.result === 'admit', 'manual override admits');
const ls = await one(`select live_stats($1)`, [C1]);
ok(ls.guests_in === 2 && ls.graduates_in === 1, 'live stats ' + JSON.stringify({ in: ls.guests_in, g: ls.graduates_in }));

// ---------------------------------------------------------------------------
// Hall layout (acceptance 8)
// ---------------------------------------------------------------------------
r = await one(`select save_zone($1, $2, 'B', 'Zone B', 'Door 2B', '#1F3A5F', 1, 0, 2, true, 'events')`, [S, ZB]);
ok(r.error === 'below_usage', 'zone cannot shrink below sold places');
r = await one(`select save_zone($1, $2, 'B', 'Zone B', 'Door 9', '#1F3A5F', 20, 0, 2, true, 'events')`, [S, ZB]);
ok(r.error === 'door_in_use', 'door cannot change once tickets carry it');
r = await one(`select save_zone($1, $2, 'B', 'Zone B', 'Door 2B', '#1F3A5F', 12, 0, 2, false, 'events')`, [S, ZB]);
ok(r.error === 'zone_in_use', 'zone in use cannot be switched off');
r = await one(`select save_zone($1, $2, 'B', 'Zone B (rear)', 'Door 2B', '#1F3A5F', 30, 2, 2, true, 'events')`, [S, ZB]);
ok(r.ok, 'zone can grow');

// ---------------------------------------------------------------------------
// Never delete (rule 20, acceptance 14)
// ---------------------------------------------------------------------------
for (const t of ['orders', 'tickets', 'payments', 'scans', 'audit_log', 'transfers', 'receipts', 'payment_events', 'graduates']) {
  ok(await throws(`delete from ${t}`), `no delete on ${t}`);
  ok(await throws(`truncate ${t} cascade`), `no truncate on ${t}`);
}
ok(await throws(`update audit_log set actor = 'x'`), 'audit log append-only');
ok(await throws(`update scans set result = 'admit'`), 'scan log append-only');
ok(await throws(`update payments set amount_aed = 0`), 'payment ledger append-only');

// ---------------------------------------------------------------------------
// Merchandise (11.3)
// ---------------------------------------------------------------------------
r = await one(`select save_merch_item($1, null, 'Teddy', '', 50, '🧸', true, 1, 'admin')`, [S]);
const teddy = Number(r.id);
r = await one(`select create_merch_order($1, 'Z9999', 'Buyer Name', 'buyer@example.com', $2::jsonb, 'online', null, 'public')`,
  [S, JSON.stringify([{ item_id: teddy, qty: 2 }])]);
ok(r.ok && Number(r.amount) === 100, 'merch order (MISIS not checked against the Master List)');
const mo = r.order_id;
r = await one(`select mark_collected($1, 'marketing')`, [mo]); ok(r.error === 'not_paid', 'cannot collect before payment');
ok(await throws(`update merch_orders set collected = true where id = $1`, [mo]), 'collected requires paid (constraint)');
r = await one(`select record_payment('m1', 'ccavenue', 'merch', $1, 'paid', 100, 'MREF', '{}', 'gateway')`, [mo]); ok(r.ok, 'merch paid');
r = await one(`select mark_collected($1, 'marketing')`, [mo]); ok(r.ok, 'collect after payment');
r = await one(`select create_merch_order($1, 'Z9999', 'Desk Buyer', null, $2::jsonb, 'counter', 'Cash', 'finance')`, [S, JSON.stringify([{ item_id: teddy, qty: 1 }])]);
ok(r.ok && (await one(`select status from merch_orders where id = $1`, [r.order_id])) === 'paid', 'counter merch paid at once');
r = await one(`select create_merch_order($1, 'Z9999', 'Buyer', 'b@example.com', $2::jsonb, 'online', null, 'public')`, [S, JSON.stringify([{ item_id: 999999, qty: 1 }])]);
ok(r.error === 'item_unavailable', 'unknown item refused');
ok((await one(`select count(*)::int from merch_orders where buyer_name = 'Buyer'`)) === 0, 'failed merch order rolled back');

// ---------------------------------------------------------------------------
// Master List import
// ---------------------------------------------------------------------------
r = await one(`select upsert_graduate($1, $2::jsonb, 'dar')`, [S, JSON.stringify({ misis: 'm 777 777', email: 'new@live.mdx.ac.uk', full_name: 'New Grad', confirmed_graduate: 'yes', ceremony: '1' })]);
ok(r.ok && r.action === 'created' && r.warnings.includes('ceremony_skipped'), 'import creates, skips allocation without Finance request ' + JSON.stringify(r));
r = await one(`select upsert_graduate($1, $2::jsonb, 'dar')`, [S, JSON.stringify({ misis: 'M777777', email: 'someone@gmail.com' })]);
ok(r.error === 'bad_email', 'import needs the university email');
r = await one(`select upsert_graduate($1, $2::jsonb, 'dar')`, [S, JSON.stringify({ misis: 'M777777', mobile: '+971500000000', financial_hold: 'yes' })]);
ok(r.ok && r.action === 'updated', 'import updates');
ok((await one(`select financial_hold from graduates where season_id = $1 and misis = 'M777777'`, [S])) === true, 'import can place a hold');
r = await one(`select update_contact($1, 'M777777', 'new2@live.mdx.ac.uk', 'me@example.com', '+971501111111', 'marketing')`, [S]);
ok(r.ok, 'contact details edited');

// ---------------------------------------------------------------------------
// Permissions (3.3)
// ---------------------------------------------------------------------------
await db.exec(`insert into staff (email, full_name, department, role, status) values
  ('mk@mdx.ac.ae', 'Mark Eting', 'Marketing', 'Marketing', 'active'),
  ('it@mdx.ac.ae', 'Tech Admin', 'IT', 'Technical Super Admin', 'active'),
  ('fin@mdx.ac.ae', 'Fin Ance', 'Finance', 'Finance', 'active')`);
await one(`select set_staff_permission('mk@mdx.ac.ae', 'view_revenue', true, 'admin')`);
let perms = await one(`select effective_permissions('mk@mdx.ac.ae')`);
ok(!perms.includes('view_revenue') && perms.includes('transfer_approve'), 'Marketing never receives revenue');
perms = await one(`select effective_permissions('it@mdx.ac.ae')`);
ok(perms.includes('tech_admin') && !perms.includes('view_revenue'), 'tech admin: no revenue by default');
await db.exec(`update app_settings set tech_admin_sees_revenue = true`);
perms = await one(`select effective_permissions('it@mdx.ac.ae')`);
ok(perms.includes('view_revenue'), 'tech admin revenue when setting is on');
await one(`select set_staff_permission('fin@mdx.ac.ae', 'reconciliation', false, 'admin')`);
perms = await one(`select effective_permissions('fin@mdx.ac.ae')`);
ok(!perms.includes('reconciliation') && perms.includes('view_revenue'), 'individual permission removed');
r = await one(`select set_staff_status('fin@mdx.ac.ae', 'paused', 'admin')`);
ok(r.ok && (await one(`select effective_permissions('fin@mdx.ac.ae')`)).length === 0, 'paused staff have no permissions');
ok(await throws(`insert into staff (email, full_name, department, role) values ('x@gmail.com', 'Xx', 'IT', 'Intern')`), 'only @mdx.ac.ae staff');
r = await one(`select add_staff('new.person@mdx.ac.ae', 'New Person', 'Officer', 'Finance', 'Finance', true, '{}', 'admin')`);
ok(r.ok, 'add user');
r = await one(`select staff_signed_in('new.person@mdx.ac.ae', 'microsoft', '1.1.1.1')`);
ok(r.ok && (await one(`select status from staff where email = 'new.person@mdx.ac.ae'`)) === 'active', 'invited becomes active on first sign-in');

// ---------------------------------------------------------------------------
// Seasons and Data Clean-Up
// ---------------------------------------------------------------------------
r = await one(`select create_season('TEST-2', 'Next season', $1, 'admin')`, [S]);
ok(r.ok, 'new season');
ok((await one(`select count(*)::int from zones where season_id = 'TEST-2'`)) === 2, 'zones copied');
ok((await one(`select count(*)::int from merch_items where season_id = 'TEST-2'`)) === 1, 'merch items copied');
ok((await one(`select guest_limit from season_settings where season_id = 'TEST-2'`)) === 4, 'guest limit 4');
ok(Number(await one(`select guest_price_aed from season_settings where season_id = 'TEST-2'`)) === 50, 'prices copied');
r = await one(`select clean_up_season($1, 'admin')`, [S]); ok(r.error === 'season_open', 'clean-up only for closed seasons');
await one(`select set_season_status($1, 'closed', 'admin')`, [S]);
ok((await one(`select eligibility($1, 'G012')`, [S])) === 'season_closed', 'closing a season stops sales');
const paymentsBefore = await one(`select count(*)::int from payments where season_id = $1`, [S]);
r = await one(`select clean_up_season($1, 'admin')`, [S]); ok(r.ok, 'clean-up');
ok((await one(`select count(*)::int from graduates where season_id = $1 and full_name <> 'Removed'`, [S])) === 0, 'names removed');
ok((await one(`select count(*)::int from tickets where season_id = $1 and holder_name <> 'Removed'`, [S])) === 0, 'ticket names removed');
ok((await one(`select count(*)::int from payments where season_id = $1`, [S])) === paymentsBefore, 'payments kept');
ok((await one(`select count(*)::int from graduates where season_id = $1 and misis = 'G001'`, [S])) === 1, 'MISIS kept');

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------
let allowed = 0;
for (let i = 0; i < 7; i++) if (await one(`select rate_limit_hit('otp:G001', 5, 3600)`)) allowed++;
ok(allowed === 5, 'rate limit allows 5 per window');

// ---------------------------------------------------------------------------
// Demo seed runs cleanly on a fresh database
// ---------------------------------------------------------------------------
const demo = await freshDb();
try {
  await demo.exec(fs.readFileSync(path.join(root, 'seed', 'demo.sql'), 'utf8'));
  const n = (await demo.query(`select count(*)::int c from graduates where season_id = 'OCT-2026'`)).rows[0].c;
  ok(n === 100, 'demo: 100 graduates');
  const tk = (await demo.query(`select count(*)::int c from tickets where season_id = 'OCT-2026'`)).rows[0].c;
  ok(tk > 30, 'demo: tickets issued ' + tk);
  const rc = (await demo.query(`select status from receipts where receipt_number = 'RC482193'`)).rows[0];
  ok(rc?.status === 'unused', 'demo: counter receipt waiting');
  const tr = (await demo.query(`select count(*)::int c from transfers where status = 'requested'`)).rows[0].c;
  ok(tr === 1, 'demo: transfer request waiting');
  const closed = (await demo.query(`select count(*)::int c from seasons where status = 'closed'`)).rows[0].c;
  ok(closed === 3, 'demo: three closed seasons');
} catch (e) {
  ok(false, 'demo seed failed: ' + e.message);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
