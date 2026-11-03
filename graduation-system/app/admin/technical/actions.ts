'use server';
import { fn, one, sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { encryptSecret, decryptSecret } from '@/lib/crypto';
import { entraConfigured, paymentMode } from '@/lib/config';
import { techChange } from '@/lib/audit';
import { testSmtp } from '@/lib/email';
import { TEMPLATES, type TemplateKey } from '@/lib/email/templates';
import { JOBS, runJob, type JobName } from '@/lib/jobs';
import { SECRET_KEYS, getAppSettings, type SecretKey } from '@/lib/settings';
import { credentials, encrypt, decrypt } from '@/lib/payments/ccavenue';
import { errorText } from '@/lib/errors';
import { backPath, bool, fail, finish, int, ok, str } from '@/lib/forms';

const tech = () => requireStaff('tech_admin');

// 1. Connection settings ------------------------------------------------------
export async function saveSecretAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=connection');
  const key = str(fd, 'key', 40) as SecretKey;
  const value = String(fd.get('value') ?? '').trim();
  if (!SECRET_KEYS.includes(key)) fail(back, 'Unknown setting.');
  if (value.length < 3 || value.length > 500) fail(back, 'Enter the new value.');
  const sealed = encryptSecret(value);
  if (decryptSecret(sealed) !== value) fail(back, 'Encryption check failed. Is APP_SECRET set?');
  await sql(`insert into app_secrets (key, ciphertext, updated_by) values ($1, $2, $3)
             on conflict (key) do update set ciphertext = excluded.ciphertext, updated_by = excluded.updated_by, updated_at = now()`, [key, sealed, staff.email]);
  await techChange(staff.email, 'connection', key, '(hidden)', '(replaced)');
  ok(back, `${key} replaced. Secrets are write-only and can never be shown again.`);
}

export async function clearSecretAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=connection');
  const key = str(fd, 'key', 40);
  await sql('delete from app_secrets where key = $1', [key]);
  await techChange(staff.email, 'connection', key, '(hidden)', '(back to environment value)');
  ok(back, `${key} now uses the environment value.`);
}

export async function saveEmailSettingsAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=connection');
  const a = await getAppSettings();
  const next = {
    email_from: str(fd, 'email_from', 200) || a.email_from,
    smtp_host: str(fd, 'smtp_host', 200) || null,
    smtp_port: int(fd, 'smtp_port'),
    smtp_user: str(fd, 'smtp_user', 200) || null,
  };
  await sql('update app_settings set email_from = $1, smtp_host = $2, smtp_port = $3, smtp_user = $4', [next.email_from, next.smtp_host, next.smtp_port, next.smtp_user]);
  for (const k of Object.keys(next) as (keyof typeof next)[]) if (a[k] !== next[k]) await techChange(staff.email, 'connection', k, a[k], next[k]);
  ok(back, 'Email sender saved.');
}

export async function testConnectionsAction(fd: FormData) {
  await tech();
  const back = backPath(fd, '/admin/technical?tab=connection');
  const out: string[] = [];
  const t = Date.now();
  await one('select 1');
  out.push(`Database: OK (${Date.now() - t} ms)`);
  try {
    out.push(`Email: ${await testSmtp()}`);
  } catch (e) {
    out.push(`Email: FAILED (${(e as Error).message})`);
  }
  try {
    const c = await credentials();
    out.push(`CCAvenue: credentials set${decrypt(encrypt('check', c.workingKey), c.workingKey) === 'check' ? ', working key format OK' : ''}; mode ${paymentMode()}`);
  } catch (e) {
    out.push(`CCAvenue: ${(e as Error).message}`);
  }
  out.push(`Microsoft sign-in: ${entraConfigured() ? 'configured' : 'not configured'}`);
  ok(back, out.join(' · '));
}

// 2. Test mode and Maintenance Mode -----------------------------------------------
export async function setModeAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=modes');
  const toLive = str(fd, 'mode') === 'live';
  if (str(fd, 'confirm', 10).toUpperCase() !== (toLive ? 'LIVE' : 'TEST')) fail(back, `Type ${toLive ? 'LIVE' : 'TEST'} to confirm.`);
  const a = await getAppSettings();
  await sql('update app_settings set test_mode = $1', [!toLive]);
  await techChange(staff.email, 'modes', 'test_mode', a.test_mode, !toLive);
  ok(back, toLive ? 'The system is now LIVE. Simulated payments and test shortcuts are switched off.' : 'The system is now in TEST mode.');
}

export async function maintenanceAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=modes');
  const a = await getAppSettings();
  const on = bool(fd, 'maintenance_mode');
  const msg = str(fd, 'maintenance_message', 500) || a.maintenance_message;
  await sql('update app_settings set maintenance_mode = $1, maintenance_message = $2', [on, msg]);
  if (a.maintenance_mode !== on) await techChange(staff.email, 'modes', 'maintenance_mode', a.maintenance_mode, on);
  if (a.maintenance_message !== msg) await techChange(staff.email, 'modes', 'maintenance_message', a.maintenance_message, msg);
  ok(back, on ? 'Maintenance Mode is ON: the public site is closed; staff keep working.' : 'Maintenance Mode is off.');
}

// 3. Feature switches ------------------------------------------------------------
export async function featuresAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=features');
  const season = staff.season.id;
  const sKeys = ['sales_open', 'zone_selection_enabled', 'merch_enabled', 'transfers_enabled', 'extra_requests_enabled', 'name_changes_enabled'] as const;
  const aKeys = ['manual_checkin_override', 'tech_admin_sees_revenue', 'staff_password_login'] as const;
  const oldS = await one<Record<string, boolean>>(`select ${sKeys.join(', ')} from season_settings where season_id = $1`, [season]);
  const oldA = await one<Record<string, boolean>>(`select ${aKeys.join(', ')} from app_settings`);
  for (const k of sKeys) {
    const v = bool(fd, k);
    if (oldS && oldS[k] !== v) {
      await sql(`update season_settings set ${k} = $2 where season_id = $1`, [season, v]);
      await techChange(staff.email, `features (${season})`, k, oldS[k], v);
    }
  }
  for (const k of aKeys) {
    const v = bool(fd, k);
    if (oldA && oldA[k] !== v) {
      await sql(`update app_settings set ${k} = $1`, [v]);
      await techChange(staff.email, 'features', k, oldA[k], v);
    }
  }
  const domains = str(fd, 'student_email_domains', 300).toLowerCase().replace(/\s+/g, '');
  const a = await getAppSettings();
  if (domains && domains !== a.student_email_domains && /^[a-z0-9.-]+(,[a-z0-9.-]+)*$/.test(domains)) {
    await sql('update app_settings set student_email_domains = $1', [domains]);
    await techChange(staff.email, 'features', 'student_email_domains', a.student_email_domains, domains);
  }
  ok(back, 'Feature switches saved.');
}

// 4. Public page text -------------------------------------------------------------
export async function publicTextAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=text');
  const old = await one<{ sales_window_text: string; public_notice: string }>('select sales_window_text, public_notice from season_settings where season_id = $1', [staff.season.id]);
  const s = str(fd, 'sales_window_text', 300);
  const n = str(fd, 'public_notice', 1000);
  await sql('update season_settings set sales_window_text = $2, public_notice = $3 where season_id = $1', [staff.season.id, s, n]);
  if (old?.sales_window_text !== s) await techChange(staff.email, 'public text', 'sales_window_text', old?.sales_window_text, s);
  if (old?.public_notice !== n) await techChange(staff.email, 'public text', 'public_notice', old?.public_notice, n);
  ok(back, 'Public page text saved.');
}

// 5. Email templates ------------------------------------------------------------
export async function templateAction(fd: FormData) {
  const staff = await tech();
  const key = str(fd, 'key', 40) as TemplateKey;
  const back = backPath(fd, `/admin/technical?tab=templates&t=${key}`);
  if (!(key in TEMPLATES)) fail(back, 'Unknown template.');
  const old = await one<{ subject: string; body: string }>('select subject, body from email_templates where key = $1', [key]);
  if (str(fd, 'reset') === 'yes') {
    await sql('delete from email_templates where key = $1', [key]);
    await techChange(staff.email, 'email templates', key, old ? `${old.subject}\n${old.body}` : '(original)', '(original)');
    ok(back, 'Template reset to the original wording.');
  }
  const subject = str(fd, 'subject', 300);
  const body = str(fd, 'body', 8000);
  if (subject.length < 3 || body.length < 10) fail(back, 'Enter a subject and the wording.');
  await sql(`insert into email_templates (key, subject, body, updated_by) values ($1, $2, $3, $4)
             on conflict (key) do update set subject = excluded.subject, body = excluded.body, updated_by = excluded.updated_by, updated_at = now()`, [key, subject, body, staff.email]);
  await techChange(staff.email, 'email templates', key, old ? `${old.subject}\n${old.body}` : '(original)', `${subject}\n${body}`);
  ok(back, 'Template saved.');
}

export async function otpMinutesAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=templates');
  const m = int(fd, 'otp_minutes');
  if (m === null || m < 2 || m > 60) fail(back, 'Choose between 2 and 60 minutes.');
  const a = await getAppSettings();
  await sql('update app_settings set otp_minutes = $1', [m]);
  await techChange(staff.email, 'email templates', 'otp_minutes', a.otp_minutes, m);
  ok(back, 'Sign-in code validity saved.');
}

// 6. Scheduled tasks ------------------------------------------------------------
export async function jobAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=jobs');
  const name = str(fd, 'job', 40) as JobName;
  if (!JOBS.includes(name)) fail(back, 'Unknown job.');
  const op = str(fd, 'op', 10);
  if (op === 'run') {
    const r = await runJob(name, true);
    await techChange(staff.email, 'scheduled tasks', name, null, `run now: ${r.status}`);
    ok(back, `${name}: ${r.status} · ${r.message}`);
  }
  const paused = op === 'pause';
  await sql('update scheduled_jobs set paused = $2 where name = $1', [name, paused]);
  await techChange(staff.email, 'scheduled tasks', name, paused ? 'running' : 'paused', paused ? 'paused' : 'running');
  ok(back, `${name} ${paused ? 'paused' : 'restarted'}.`);
}

// 8. Security log: sign out any user ----------------------------------------------
export async function signOutUserAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=security');
  const subject = str(fd, 'subject', 200);
  const kind = str(fd, 'kind') === 'student' ? 'student' : 'staff';
  await sql('update sessions set revoked_at = now(), revoked_by = $3 where kind = $1 and subject = $2 and revoked_at is null', [kind, subject, staff.email]);
  await techChange(staff.email, 'security', 'sign_out', subject, 'signed out');
  ok(back, `${subject} has been signed out everywhere.`);
}

// 10. Data Clean-Up ---------------------------------------------------------------
export async function cleanupAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=cleanup');
  const season = str(fd, 'season', 20);
  if (str(fd, 'confirm', 20) !== season) fail(back, `Type the season code (${season}) to confirm.`);
  const r = await fn('clean_up_season', [season, staff.email]);
  if (!r.ok) fail(back, errorText(r.error));
  await techChange(staff.email, 'data clean-up', season, 'personal data present', 'names, emails and mobiles removed');
  ok(back, `Personal data removed from ${season} (${r.graduates ?? 0} graduates). MISIS numbers and payments were kept.`);
}

// 11. Upload rules ---------------------------------------------------------------
export async function uploadRulesAction(fd: FormData) {
  const staff = await tech();
  const back = backPath(fd, '/admin/technical?tab=uploads');
  let parsed: unknown;
  try {
    parsed = JSON.parse(str(fd, 'rules', 5000));
  } catch {
    fail(back, 'The rules must be valid JSON.');
  }
  const valid = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    && Object.values(parsed as Record<string, unknown>).every((v) => Array.isArray(v) && v.every((c) => typeof c === 'string' && /^[a-z_]{2,40}$/.test(c)));
  if (!valid) fail(back, 'Each upload needs a list of lower-case column names, e.g. {"master_list": ["misis", "email", "full_name"]}.');
  const a = await getAppSettings();
  await sql('update app_settings set upload_rules = $1', [JSON.stringify(parsed)]);
  await techChange(staff.email, 'upload rules', 'upload_rules', a.upload_rules, parsed);
  finish(back, { ok: true }, 'Upload rules saved.');
}
