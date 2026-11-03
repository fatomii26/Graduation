'use server';
import { fn, one, sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { siteUrl } from '@/lib/config';
import { randomToken, sha256 } from '@/lib/crypto';
import { queueEmail } from '@/lib/email';
import { getAppSettings } from '@/lib/settings';
import { csvObjects } from '@/lib/csv';
import { errorText } from '@/lib/errors';
import { fromDubaiInput } from '@/lib/format';
import { backPath, bool, fail, finish, int, num, ok, str } from '@/lib/forms';

async function invite(email: string, actor: string) {
  const s = await one<{ full_name: string; role: string }>('select full_name, role from staff where email = $1', [email]);
  if (!s) return;
  await queueEmail(email, 'staff_welcome', { name: s.full_name, role: s.role, link: `${siteUrl()}/staff/login` });
  if ((await getAppSettings()).staff_password_login) {
    const token = randomToken(32);
    await sql(`insert into staff_tokens (token_hash, email, purpose, expires_at, created_by) values ($1, $2, 'set_password', now() + interval '24 hours', $3)`, [sha256(token), email, actor]);
    await queueEmail(email, 'staff_password_link', { name: s.full_name, link: `${siteUrl()}/staff/set-password?token=${token}` });
  }
}

// ---------------------------------------------------------------- User Access
export async function addUserAction(fd: FormData) {
  const staff = await requireStaff('user_access');
  const back = backPath(fd, '/admin/access?tab=users');
  const allSeasons = str(fd, 'season_scope') !== 'some';
  const seasons = fd.getAll('seasons').map(String).filter((s) => /^[A-Z0-9-]{3,20}$/.test(s));
  const r = await fn('add_staff', [str(fd, 'email', 200), str(fd, 'full_name', 120), str(fd, 'job_title', 120), str(fd, 'department', 40), str(fd, 'role', 60), allSeasons, seasons, staff.email]);
  if (!r.ok) fail(back, errorText(r.error));
  await invite(String(r.email), staff.email);
  ok(back, `${r.email} added. A welcome email was sent; they sign in with their Microsoft account. Adjust individual permissions below if needed.`);
}

export async function updateUserAction(fd: FormData) {
  const staff = await requireStaff('user_access');
  const back = backPath(fd, '/admin/access?tab=users');
  const allSeasons = str(fd, 'season_scope') !== 'some';
  const seasons = fd.getAll('seasons').map(String).filter((s) => /^[A-Z0-9-]{3,20}$/.test(s));
  finish(back, await fn('update_staff', [str(fd, 'email', 200), str(fd, 'full_name', 120), str(fd, 'job_title', 120), str(fd, 'department', 40), str(fd, 'role', 60), allSeasons, seasons, staff.email]), 'User saved.');
}

export async function userStatusAction(fd: FormData) {
  const staff = await requireStaff('user_access');
  const back = backPath(fd, '/admin/access?tab=users');
  const status = str(fd, 'status', 20);
  finish(back, await fn('set_staff_status', [str(fd, 'email', 200), status, staff.email]), status === 'removed' ? 'User removed (kept in the records, cannot sign in).' : `User ${status}.`);
}

export async function resendInviteAction(fd: FormData) {
  const staff = await requireStaff('user_access');
  const back = backPath(fd, '/admin/access?tab=users');
  const email = str(fd, 'email', 200);
  await invite(email, staff.email);
  await fn('log_event', [staff.email, 'invite_resent', 'access', null, null, null, JSON.stringify({ email }), null]);
  ok(back, `Invitation sent again to ${email}.`);
}

/** Saves the whole permission grid for one person as differences from their role preset. */
export async function permissionsAction(fd: FormData) {
  const staff = await requireStaff('user_access');
  const back = backPath(fd, '/admin/access?tab=users');
  const email = str(fd, 'email', 200);
  const want = new Set(fd.getAll('perm').map(String));
  const target = await one<{ role: string }>('select role from staff where email = $1', [email]);
  if (!target) fail(back, errorText('no_such_staff'));
  const preset = new Set((await sql<{ permission: string }>('select permission from role_permissions where role = $1', [target.role])).map((r) => r.permission));
  const current = new Map((await sql<{ permission: string; allowed: boolean }>('select permission, allowed from staff_permissions where email = $1', [email])).map((r) => [r.permission, r.allowed]));
  const all = (await sql<{ key: string }>('select key from permissions')).map((r) => r.key);
  let changed = 0;
  for (const k of all) {
    const desired = want.has(k);
    const override: boolean | null = desired === preset.has(k) ? null : desired;
    if ((current.has(k) ? current.get(k)! : null) !== override) {
      await fn('set_staff_permission', [email, k, override, staff.email]);
      changed++;
    }
  }
  ok(back, changed ? `${changed} permission change(s) saved for ${email}.` : 'No changes.');
}

// ---------------------------------------------------------------- Seasons and ceremonies
export async function createSeasonAction(fd: FormData) {
  const staff = await requireStaff('seasons');
  const back = backPath(fd, '/admin/access?tab=seasons');
  finish(back, await fn('create_season', [str(fd, 'id', 20).toUpperCase(), str(fd, 'name', 60), str(fd, 'copy_from', 20) || null, staff.email]),
    'Season created. It copied the previous season\'s prices, zones, merchandise items and ceremonies; the guest limit is 4 and sales are closed.');
}

export async function seasonStatusAction(fd: FormData) {
  const staff = await requireStaff('seasons');
  const back = backPath(fd, '/admin/access?tab=seasons');
  const status = str(fd, 'status') === 'open' ? 'open' : 'closed';
  finish(back, await fn('set_season_status', [str(fd, 'id', 20), status, staff.email]), status === 'open' ? 'Season reopened.' : 'Season closed: online sales stop; staff can still edit its data.');
}

export async function saveCeremonyAction(fd: FormData) {
  const staff = await requireStaff('seasons');
  const back = backPath(fd, '/admin/access?tab=seasons');
  finish(back, await fn('save_ceremony', [staff.season.id, int(fd, 'number'), str(fd, 'name', 120), fromDubaiInput(str(fd, 'starts_at', 20)), fromDubaiInput(str(fd, 'doors_open_at', 20)), str(fd, 'graduate_entrance', 120), staff.email]), 'Ceremony saved.');
}

// ---------------------------------------------------------------- Prices, limit, reminder
async function updateSettings(actor: string, season: string, changes: Record<string, unknown>, action: string, category: string) {
  const cols = Object.keys(changes);
  const old = await one(`select ${cols.join(', ')} from season_settings where season_id = $1`, [season]);
  await sql(`update season_settings set ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} where season_id = $1`, [season, ...cols.map((c) => changes[c])]);
  await fn('log_event', [actor, action, category, season, null, null, JSON.stringify({ old, new: changes }), null]);
}

export async function savePricesAction(fd: FormData) {
  const staff = await requireStaff('prices');
  const back = backPath(fd, '/admin/access?tab=prices');
  const g = num(fd, 'graduate_price_aed');
  const p = num(fd, 'guest_price_aed');
  if (g === null || p === null) fail(back, 'Enter both prices in AED.');
  await updateSettings(staff.email, staff.season.id, { graduate_price_aed: g, guest_price_aed: p }, 'prices_changed', 'prices');
  ok(back, 'Prices saved. They apply to new bookings; paid orders keep their price.');
}

export async function saveLimitAction(fd: FormData) {
  const staff = await requireStaff('prices');
  const back = backPath(fd, '/admin/access?tab=limit');
  const lim = int(fd, 'guest_limit');
  const hours = int(fd, 'extra_code_hours');
  if (lim === null || lim < 0 || lim > 20 || hours === null || hours < 1 || hours > 720) fail(back, errorText('bad_request'));
  await updateSettings(staff.email, staff.season.id, { guest_limit: lim, extra_code_hours: hours }, 'limit_changed', 'limits');
  ok(back, 'Ticket purchase limit saved.');
}

export async function saveReminderAction(fd: FormData) {
  const staff = await requireStaff('seasons');
  const back = backPath(fd, '/admin/access?tab=reminder');
  const days = int(fd, 'reminder_days_before');
  if (days === null || days < 0 || days > 60) fail(back, errorText('bad_request'));
  await updateSettings(staff.email, staff.season.id, { reminder_enabled: bool(fd, 'reminder_enabled'), reminder_days_before: days }, 'reminder_changed', 'packages');
  ok(back, 'Reminder saved. The daily job sends it to graduates with a ticket who have not collected everything.');
}

export async function saveVenueAccessAction(fd: FormData) {
  const staff = await requireStaff('layout_edit');
  const back = backPath(fd, '/admin/access?tab=venue');
  const hold = int(fd, 'hold_minutes');
  const gcap = int(fd, 'graduate_capacity');
  if (hold === null || hold < 1 || hold > 120 || gcap === null || gcap < 0) fail(back, errorText('bad_request'));
  await updateSettings(staff.email, staff.season.id, {
    venue_name: str(fd, 'venue_name', 120) || 'Graduation Hall', venue_area: str(fd, 'venue_area', 120), graduate_capacity: gcap, hold_minutes: hold,
  }, 'venue_saved', 'hall_layout');
  ok(back, 'Hall layout and venue saved.');
}

// ---------------------------------------------------------------- Merchandise items
export async function saveMerchItemAction(fd: FormData) {
  const staff = await requireStaff('prices');
  const back = backPath(fd, '/admin/access?tab=merch');
  let image = str(fd, 'image_text', 2000);
  const file = fd.get('image_file');
  if (file instanceof File && file.size) {
    if (file.size > 300_000) fail(back, errorText('image_too_large'));
    if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) fail(back, 'Use a PNG, JPEG, WebP or GIF picture.');
    image = `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`;
  }
  if (image && !/^(https:\/\/|data:image\/)/.test(image) && image.length > 8) fail(back, 'The picture must be an https:// link, an upload, or a short emoji.');
  const id = int(fd, 'id');
  const r = await fn('save_merch_item', [staff.season.id, id, str(fd, 'name', 80), str(fd, 'description', 300), num(fd, 'price'), image || (id ? null : ''), id ? bool(fd, 'active') : true, int(fd, 'sort') ?? 0, staff.email]);
  finish(back, r, id ? 'Item saved.' : 'Item added.');
}

export async function removeMerchItemAction(fd: FormData) {
  const staff = await requireStaff('prices');
  const back = backPath(fd, '/admin/access?tab=merch');
  finish(back, await fn('remove_merch_item', [int(fd, 'id'), staff.email]), 'Item removed from the shop (past orders keep it).');
}

export async function saveShopDateAction(fd: FormData) {
  const staff = await requireStaff('prices');
  const back = backPath(fd, '/admin/access?tab=merch');
  const d = str(fd, 'shop_close_date', 10);
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(back, errorText('bad_request'));
  await updateSettings(staff.email, staff.season.id, { shop_close_date: d || null }, 'shop_close_date_changed', 'merchandise');
  ok(back, 'Shop close date saved.');
}

// ---------------------------------------------------------------- Programme to Ceremony Map
export async function saveProgrammeAction(fd: FormData) {
  const staff = await requireStaff('programme_map');
  const back = backPath(fd, '/admin/access?tab=programmes');
  const programme = str(fd, 'programme', 200);
  const n = int(fd, 'ceremony');
  if (programme.length < 2 || !n) fail(back, 'Enter the programme and the ceremony.');
  if (str(fd, 'remove') === 'yes') {
    await sql('delete from programme_ceremony_map where season_id = $1 and programme = $2', [staff.season.id, programme]);
  } else {
    await sql(`insert into programme_ceremony_map (season_id, programme, ceremony_number) values ($1, $2, $3)
               on conflict (season_id, programme) do update set ceremony_number = excluded.ceremony_number, updated_at = now()`, [staff.season.id, programme, n]);
  }
  await fn('log_event', [staff.email, 'programme_map_changed', 'allocation', staff.season.id, null, null, JSON.stringify({ programme, ceremony: n, removed: str(fd, 'remove') === 'yes' }), null]);
  ok(back, 'Programme map saved.');
}

export async function uploadProgrammesAction(fd: FormData) {
  const staff = await requireStaff('programme_map');
  const back = backPath(fd, '/admin/access?tab=programmes');
  const file = fd.get('file');
  if (!(file instanceof File) || !file.size) fail(back, 'Choose a CSV file.');
  const { header, rows } = csvObjects(await file.text());
  if (!header.includes('programme') || !header.includes('ceremony')) fail(back, 'The file needs programme and ceremony columns.');
  let n = 0;
  for (const r of rows.slice(0, 2000)) {
    const c = Number(String(r.ceremony).replace(/[^0-9]/g, ''));
    if (!r.programme || !c) continue;
    await sql(`insert into programme_ceremony_map (season_id, programme, ceremony_number) values ($1, $2, $3)
               on conflict (season_id, programme) do update set ceremony_number = excluded.ceremony_number, updated_at = now()`, [staff.season.id, r.programme.slice(0, 200), c]);
    n++;
  }
  await fn('log_event', [staff.email, 'programme_map_uploaded', 'allocation', staff.season.id, null, null, JSON.stringify({ rows: n, file: file.name }), null]);
  ok(back, `${n} programme(s) mapped.`);
}
