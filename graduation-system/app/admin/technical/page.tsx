import { one, sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { emailProvider, paymentMode } from '@/lib/config';
import { getAppSettings, getSeasonSettings, getSeasons, secretStatus, SECRET_KEYS } from '@/lib/settings';
import { TEMPLATES, type TemplateKey } from '@/lib/email/templates';
import { fmtDateTime } from '@/lib/format';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, Kpi, readParams, Tabs, type SearchParams } from '@/components/ui';
import {
  cleanupAction, clearSecretAction, featuresAction, jobAction, maintenanceAction, otpMinutesAction, publicTextAction, saveEmailSettingsAction,
  saveSecretAction, setModeAction, signOutUserAction, templateAction, testConnectionsAction, uploadRulesAction,
} from './actions';

const TABS: [string, string][] = [
  ['connection', '1. Connection Settings'], ['modes', '2. Test and Maintenance'], ['features', '3. Feature Switches'], ['text', '4. Public Page Text'],
  ['templates', '5. Email Templates'], ['jobs', '6. Scheduled Tasks'], ['health', '7. Errors and Health'], ['security', '8. Security Log'],
  ['backups', '9. Backups'], ['cleanup', '10. Data Clean-Up'], ['uploads', '11. Upload Rules'], ['changes', '12. Change Log'],
];

export default async function Technical({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('tech_admin');
  const get = await readParams(searchParams);
  const tab = TABS.some(([k]) => k === get('tab')) ? get('tab') : 'connection';
  const back = `/admin/technical?tab=${tab}`;
  const started = Date.now();
  const a = await getAppSettings();
  const s = (await getSeasonSettings(staff.season.id))!;
  return (
    <>
      <h1>Technical Settings</h1>
      <p className="page-sub">Every change is recorded in the Technical Change Log with the old and new value. Secrets are never logged or shown.</p>
      <Flash msg={get('msg')} err={get('err')} />
      <Tabs base="/admin/technical" tabs={TABS} current={tab} />

      {tab === 'connection' ? <Connection back={back} a={a} /> : null}

      {tab === 'modes' ? (
        <div className="grid two">
          <form action={setModeAction} className="card">
            <Back to={back} />
            <h2>Test mode / Live mode</h2>
            <p>The system is now <strong>{a.test_mode ? 'in TEST mode' : 'LIVE'}</strong>. Payment mode: <span className="mono">{paymentMode()}</span>.</p>
            <p className="small muted">Test mode shows a strip on every page, allows simulated payments (PAYMENT_MODE=simulate) and the test shortcuts. Live mode switches all of them off.</p>
            <input type="hidden" name="mode" value={a.test_mode ? 'live' : 'test'} />
            <label className="f">Type {a.test_mode ? 'LIVE' : 'TEST'} to confirm</label>
            <input name="confirm" autoComplete="off" required />
            <div style={{ marginTop: 10 }}><Submit className={a.test_mode ? 'btn danger' : 'btn'}>{a.test_mode ? 'Switch to LIVE' : 'Switch to TEST'}</Submit></div>
          </form>
          <form action={maintenanceAction} className="card">
            <Back to={back} />
            <h2>Maintenance Mode</h2>
            <label className="check"><input type="checkbox" name="maintenance_mode" defaultChecked={a.maintenance_mode} /> Close the public page (staff keep working)</label>
            <label className="f">Message on the public page</label>
            <textarea name="maintenance_message" defaultValue={a.maintenance_message} />
            <div style={{ marginTop: 10 }}><Submit>Save</Submit></div>
          </form>
        </div>
      ) : null}

      {tab === 'features' ? (
        <form action={featuresAction} className="card">
          <Back to={back} />
          <h2>Feature switches · {staff.season.name}</h2>
          {([
            ['sales_open', 'Ticket sales (online booking open)', s.sales_open],
            ['zone_selection_enabled', 'Guest zone selection (off = the system places each group in the zone with most room)', s.zone_selection_enabled],
            ['merch_enabled', 'Merchandise shop', s.merch_enabled],
            ['transfers_enabled', 'Transfers between graduates', s.transfers_enabled],
            ['extra_requests_enabled', 'Extra ticket requests', s.extra_requests_enabled],
            ['name_changes_enabled', 'Guest name change requests', s.name_changes_enabled],
          ] as const).map(([k, label, v]) => <label key={k} className="check"><input type="checkbox" name={k} defaultChecked={v} /> {label}</label>)}
          <h3 style={{ marginTop: 16 }}>System-wide</h3>
          <label className="check"><input type="checkbox" name="manual_checkin_override" defaultChecked={a.manual_checkin_override} /> Entry Check-In manual override for a failed scanner (reason required, audited)</label>
          <label className="check"><input type="checkbox" name="tech_admin_sees_revenue" defaultChecked={a.tech_admin_sees_revenue} /> Technical Super Admin sees finance and revenue figures</label>
          <label className="check"><input type="checkbox" name="staff_password_login" defaultChecked={a.staff_password_login} /> Fallback staff sign-in with a password set by a 24-hour one-time link</label>
          <label className="f">University email domains for students (comma separated)</label>
          <input name="student_email_domains" defaultValue={a.student_email_domains} />
          <div style={{ marginTop: 12 }}><Submit>Save switches</Submit></div>
        </form>
      ) : null}

      {tab === 'text' ? (
        <form action={publicTextAction} className="card">
          <Back to={back} />
          <h2>Public page text · {staff.season.name}</h2>
          <label className="f">Sales window text</label>
          <input name="sales_window_text" defaultValue={s.sales_window_text} maxLength={300} placeholder="Ticket sales are open until …" />
          <label className="f">Optional notice</label>
          <textarea name="public_notice" defaultValue={s.public_notice} maxLength={1000} />
          <div style={{ marginTop: 10 }}><Submit>Save text</Submit></div>
        </form>
      ) : null}

      {tab === 'templates' ? <Templates back={back} current={get('t')} otp={a.otp_minutes} /> : null}
      {tab === 'jobs' ? <Jobs back={back} /> : null}
      {tab === 'health' ? <Health started={started} /> : null}
      {tab === 'security' ? <Security back={back} /> : null}

      {tab === 'backups' ? (
        <section className="card">
          <h2>Backups</h2>
          <p>
            <strong>Platform backups</strong> (the real protection): Supabase Pro point-in-time recovery during testing, Azure Database for PostgreSQL automated backups with
            point-in-time restore in production. Test a restore before sales open.
          </p>
          <p><a className="btn secondary" href={`/api/backup?season=${staff.season.id}`}>Download data export for {staff.season.name} (JSON)</a></p>
          <p className="small muted">The export contains personal data: store it only in an approved university location. The daily backup check job records that the database is reachable.</p>
          <details>
            <summary>Restore</summary>
            <p className="small">
              Because orders, tickets, payments and logs can never be deleted or rewritten, a restore is done at database level, not from this page:
              in the hosting console choose point-in-time restore to a new database, check it, then point DATABASE_URL to it and redeploy. Record the restore in the Change Log.
            </p>
          </details>
        </section>
      ) : null}

      {tab === 'cleanup' ? <Cleanup back={back} /> : null}

      {tab === 'uploads' ? (
        <form action={uploadRulesAction} className="card">
          <Back to={back} />
          <h2>Upload rules</h2>
          <p className="small muted">Required columns for each upload file. Uploads missing a required column are refused.</p>
          <textarea name="rules" defaultValue={JSON.stringify(a.upload_rules, null, 2)} style={{ minHeight: 220 }} className="mono" />
          <div style={{ marginTop: 10 }}><Submit>Save rules</Submit></div>
        </form>
      ) : null}

      {tab === 'changes' ? <Changes /> : null}
    </>
  );
}

async function Connection({ back, a }: { back: string; a: Awaited<ReturnType<typeof getAppSettings>> }) {
  const status = await secretStatus();
  return (
    <>
      <section className="card" style={{ marginBottom: 16 }}>
        <h2>CCAvenue and email secrets</h2>
        <p className="small muted">Write-only: a value can be replaced but never read back. Saved values are encrypted with a key held only in the server environment.</p>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Setting</th><th>Status</th><th>Replace</th></tr></thead>
            <tbody>
              {SECRET_KEYS.map((k) => (
                <tr key={k}>
                  <td className="mono">{k}</td>
                  <td>{status[k].set ? <span className="pill ok">set · {status[k].source}</span> : <span className="pill warn">not set</span>}{status[k].updated_at ? <div className="small muted">{fmtDateTime(status[k].updated_at)}</div> : null}</td>
                  <td>
                    <form action={saveSecretAction} className="inline">
                      <Back to={back} />
                      <input type="hidden" name="key" value={k} />
                      <input name="value" type="password" autoComplete="new-password" placeholder="New value" style={{ width: 220 }} required />
                      <Submit className="btn sm">Replace</Submit>
                    </form>
                    {status[k].source === 'Technical Settings' ? (
                      <form action={clearSecretAction} style={{ marginTop: 4 }}><Back to={back} /><input type="hidden" name="key" value={k} /><Submit className="btn ghost sm">Use environment value</Submit></form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <form action={saveEmailSettingsAction} className="card" style={{ marginBottom: 16 }}>
        <Back to={back} />
        <h2>Email sender</h2>
        <p className="small muted">Provider: <span className="mono">{emailProvider()}</span> (EMAIL_PROVIDER). Empty fields use the environment values.</p>
        <div className="grid four">
          <div><label className="f">From</label><input name="email_from" defaultValue={a.email_from} /></div>
          <div><label className="f">SMTP host</label><input name="smtp_host" defaultValue={a.smtp_host ?? ''} placeholder={process.env.SMTP_HOST ?? ''} /></div>
          <div><label className="f">SMTP port</label><input name="smtp_port" defaultValue={a.smtp_port ?? ''} placeholder={process.env.SMTP_PORT ?? '587'} /></div>
          <div><label className="f">SMTP user</label><input name="smtp_user" defaultValue={a.smtp_user ?? ''} /></div>
        </div>
        <div style={{ marginTop: 10 }}><Submit>Save sender</Submit></div>
      </form>
      <form action={testConnectionsAction}><Back to={back} /><Submit className="btn secondary">Test Connections</Submit></form>
    </>
  );
}

async function Templates({ back, current, otp }: { back: string; current: string; otp: number }) {
  const keys = Object.keys(TEMPLATES) as TemplateKey[];
  const key = (keys.includes(current as TemplateKey) ? current : keys[0]) as TemplateKey;
  const o = await one<{ subject: string; body: string; updated_by: string; updated_at: Date }>('select subject, body, updated_by, updated_at from email_templates where key = $1', [key]);
  const t = o ?? TEMPLATES[key];
  return (
    <div className="grid two">
      <nav className="card">
        <h3>Templates</h3>
        <ul style={{ paddingLeft: 18 }}>{keys.map((k) => <li key={k}><a href={`/admin/technical?tab=templates&t=${k}`} aria-current={k === key ? 'page' : undefined}>{k === key ? <strong>{TEMPLATES[k].label}</strong> : TEMPLATES[k].label}</a></li>)}</ul>
        <form action={otpMinutesAction} className="inline" style={{ marginTop: 12 }}>
          <Back to={back} />
          <label className="small">Sign-in code valid for (minutes)</label>
          <input name="otp_minutes" defaultValue={otp} style={{ width: 70 }} inputMode="numeric" />
          <Submit className="btn sm">Save</Submit>
        </form>
      </nav>
      <form action={templateAction} className="card">
        <Back to={`/admin/technical?tab=templates&t=${key}`} />
        <input type="hidden" name="key" value={key} />
        <h3>{TEMPLATES[key].label}</h3>
        <p className="small muted">Placeholders: {'{name} {misis} {tickets} {ceremony} {paid} {team}'} {TEMPLATES[key].extra}. {o ? `Changed by ${o.updated_by}, ${fmtDateTime(o.updated_at)}.` : 'Original wording.'}</p>
        <label className="f">Subject</label>
        <input name="subject" defaultValue={t.subject} />
        <label className="f">Wording</label>
        <textarea name="body" defaultValue={t.body} style={{ minHeight: 240 }} />
        <div className="row" style={{ marginTop: 10 }}>
          <Submit>Save template</Submit>
          {o ? <Submit className="btn ghost" name="reset" value="yes" confirm="Reset to the original wording?">Reset to original</Submit> : null}
        </div>
      </form>
    </div>
  );
}

async function Jobs({ back }: { back: string }) {
  const jobs = await sql<{ name: string; label: string; schedule_text: string; paused: boolean; last_run_at: Date | null; last_status: string | null; last_message: string | null }>(
    'select * from scheduled_jobs order by name');
  return (
    <>
      <p className="small muted">The scheduler calls /api/cron/tick every few minutes (see the setup guide). Holds also stop counting the moment they expire, so a paused job never lets a zone be overbooked.</p>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Task</th><th>Schedule</th><th>Last run</th><th>Result</th><th /></tr></thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.name}>
                <td><strong>{j.label}</strong><div className="small mono">{j.name}</div></td>
                <td>{j.schedule_text}{j.paused ? <div><span className="pill warn">paused</span></div> : null}</td>
                <td>{fmtDateTime(j.last_run_at)}</td>
                <td><span className={`pill ${j.last_status === 'ok' ? 'ok' : j.last_status === 'failed' ? 'bad' : ''}`}>{j.last_status ?? '—'}</span><div className="small">{j.last_message}</div></td>
                <td>
                  <div className="row">
                    <form action={jobAction}><Back to={back} /><input type="hidden" name="job" value={j.name} /><input type="hidden" name="op" value="run" /><Submit className="btn sm">Run now</Submit></form>
                    <form action={jobAction}><Back to={back} /><input type="hidden" name="job" value={j.name} /><input type="hidden" name="op" value={j.paused ? 'resume' : 'pause'} /><Submit className="btn ghost sm">{j.paused ? 'Restart' : 'Pause'}</Submit></form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

async function Health({ started }: { started: number }) {
  const t = Date.now();
  await one('select 1');
  const db = Date.now() - t;
  const c = await one<{ errors24: number; queued: number; failed: number; sessions: number }>(
    `select (select count(*) from error_log where at > now() - interval '24 hours')::int as errors24,
            (select count(*) from email_outbox where status = 'queued')::int as queued,
            (select count(*) from email_outbox where status = 'failed')::int as failed,
            (select count(*) from sessions where revoked_at is null and expires_at > now())::int as sessions`);
  const errors = await sql<{ at: Date; source: string; message: string; path: string | null }>('select at, source, message, path from error_log order by at desc limit 50');
  const outbox = await sql<{ at: Date; to_address: string; subject: string; status: string; attempts: number; last_error: string | null }>(
    'select created_at as at, to_address, subject, status, attempts, last_error from email_outbox order by id desc limit 30');
  return (
    <>
      <div className="grid four">
        <Kpi label="Server uptime" value={`${Math.floor(process.uptime() / 3600)} h ${Math.floor((process.uptime() % 3600) / 60)} min`} sub="this server instance" />
        <Kpi label="Database round trip" value={`${db} ms`} />
        <Kpi label="This page built in" value={`${Date.now() - started} ms`} />
        <Kpi label="Signed-in sessions" value={c?.sessions ?? 0} />
        <Kpi label="Errors (24 h)" value={c?.errors24 ?? 0} />
        <Kpi label="Emails waiting / failed" value={`${c?.queued ?? 0} / ${c?.failed ?? 0}`} />
      </div>
      <h2 style={{ marginTop: 18 }}>Error log</h2>
      {errors.length === 0 ? <Empty>No logged problems.</Empty> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Source</th><th>Message</th><th>Path</th></tr></thead>
          <tbody>{errors.map((e, i) => <tr key={i}><td>{fmtDateTime(e.at)}</td><td className="mono small">{e.source}</td><td>{e.message}</td><td className="small">{e.path}</td></tr>)}</tbody></table></div>
      )}
      <h2 style={{ marginTop: 18 }}>Email outbox</h2>
      {outbox.length === 0 ? <Empty>No emails yet.</Empty> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead>
          <tbody>{outbox.map((m, i) => <tr key={i}><td>{fmtDateTime(m.at)}</td><td className="small">{m.to_address}</td><td>{m.subject}</td><td><span className={`pill ${m.status === 'sent' ? 'ok' : m.status === 'failed' ? 'bad' : 'warn'}`}>{m.status}</span>{m.last_error ? <div className="small">{m.last_error}</div> : null}</td></tr>)}</tbody></table></div>
      )}
    </>
  );
}

async function Security({ back }: { back: string }) {
  const sessions = await sql<{ kind: string; subject: string; n: number; last: Date; ip: string | null }>(
    `select kind, subject, count(*)::int as n, max(last_seen_at) as last, max(ip) as ip from sessions
      where revoked_at is null and expires_at > now() group by kind, subject order by max(last_seen_at) desc limit 200`);
  const attempts = await sql<{ at: Date; kind: string; subject: string; ok: boolean; method: string; reason: string | null; ip: string | null }>(
    'select at, kind, subject, ok, method, reason, ip from login_attempts order by at desc limit 100');
  return (
    <>
      <h2>Signed in now</h2>
      {sessions.length === 0 ? <Empty>Nobody is signed in.</Empty> : (
        <div className="table-wrap"><table className="t"><thead><tr><th>Who</th><th>Type</th><th>Sessions</th><th>Last seen</th><th>IP</th><th /></tr></thead>
          <tbody>{sessions.map((s) => (
            <tr key={s.kind + s.subject}><td>{s.subject}</td><td>{s.kind}</td><td>{s.n}</td><td>{fmtDateTime(s.last)}</td><td className="small mono">{s.ip}</td>
              <td><form action={signOutUserAction}><Back to={back} /><input type="hidden" name="subject" value={s.subject} /><input type="hidden" name="kind" value={s.kind} /><Submit className="btn ghost sm" confirm={`Sign ${s.subject} out everywhere?`}>Sign out</Submit></form></td></tr>
          ))}</tbody></table></div>
      )}
      <h2 style={{ marginTop: 18 }}>Sign-in history</h2>
      <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Who</th><th>Method</th><th>Result</th><th>IP</th></tr></thead>
        <tbody>{attempts.map((x, i) => <tr key={i}><td>{fmtDateTime(x.at)}</td><td>{x.subject} <span className="small muted">({x.kind})</span></td><td>{x.method}</td><td>{x.ok ? <span className="pill ok">signed in</span> : <span className="pill bad">failed{x.reason ? `: ${x.reason}` : ''}</span>}</td><td className="small mono">{x.ip}</td></tr>)}</tbody></table></div>
    </>
  );
}

async function Cleanup({ back }: { back: string }) {
  const seasons = (await getSeasons()).filter((s) => s.status === 'closed');
  return (
    <section className="card">
      <h2>Data Clean-Up</h2>
      <p>Removes names, emails and mobile numbers from a <strong>closed</strong> season. MISIS numbers, orders, tickets (as records) and payments are kept. This cannot be undone.</p>
      <p className="small muted">IT and legal confirm the retention period under UAE data protection law before running this.</p>
      {seasons.length === 0 ? <Empty>No closed seasons.</Empty> : seasons.map((s) => (
        <form key={s.id} action={cleanupAction} className="inline" style={{ marginBottom: 8 }}>
          <Back to={back} />
          <input type="hidden" name="season" value={s.id} />
          <strong style={{ minWidth: 120 }}>{s.name}</strong>
          {s.cleaned_at ? <span className="pill">cleaned {fmtDateTime(s.cleaned_at)}</span> : (
            <>
              <input name="confirm" placeholder={`Type ${s.id}`} style={{ width: 160 }} required />
              <Submit className="btn danger sm" confirm={`Remove personal data from ${s.name}? This cannot be undone.`}>Remove personal data</Submit>
            </>
          )}
        </form>
      ))}
    </section>
  );
}

async function Changes() {
  const rows = await sql<{ at: Date; actor: string; area: string; setting: string; old_value: string | null; new_value: string | null }>(
    'select at, actor, area, setting, old_value, new_value from technical_change_log order by at desc limit 300');
  return rows.length === 0 ? <Empty>No technical changes yet.</Empty> : (
    <div className="table-wrap"><table className="t"><thead><tr><th>When</th><th>Who</th><th>Area</th><th>Setting</th><th>Old</th><th>New</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}><td>{fmtDateTime(r.at)}</td><td className="small">{r.actor}</td><td>{r.area}</td><td className="mono small">{r.setting}</td><td className="small" style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{r.old_value?.slice(0, 300)}</td><td className="small" style={{ maxWidth: 260, whiteSpace: 'pre-wrap' }}>{r.new_value?.slice(0, 300)}</td></tr>)}</tbody></table></div>
  );
}
