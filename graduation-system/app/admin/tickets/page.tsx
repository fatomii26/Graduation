import { fn, sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { getCeremonies, getSeasonSettings, getZones, type ZoneAvailability } from '@/lib/settings';
import { studentSummary } from '@/lib/admin-queries';
import { siteUrl } from '@/lib/config';
import { fmtDateTime, fmtTime, normMisis } from '@/lib/format';
import StudentCard from '@/components/StudentCard';
import Submit from '@/components/Submit';
import { Back, Bar, Empty, Flash, readParams, SearchBar, Tabs, type SearchParams } from '@/components/ui';
import { correctNameAction, decideNameAction, decideTransferAction, logMobileSendAction, lostTicketAction, saveVenueAction, saveZoneAction } from './actions';

type T = {
  id: string; token: string; misis: string; kind: string; holder_name: string; status: string; zone: string | null; zone_color: string | null; door: string;
  ceremony: string; door1_at: Date | null; door2_at: Date | null; created_at: Date; void_reason: string | null; mobile: string | null; private_email: string | null;
};

export default async function TicketsSeating({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('tickets_seating');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const tab = get('tab') || 'issued';
  const q = normMisis(get('q'));
  const back = `/admin/tickets?${new URLSearchParams({ tab, q })}`;
  const pend = await sql<{ t: number; n: number }>(
    `select (select count(*) from transfers where season_id = $1 and status = 'requested')::int as t,
            (select count(*) from name_change_requests where season_id = $1 and status = 'requested')::int as n`, [S]);
  const tabs: [string, string][] = [
    ['issued', 'Issued E-Tickets'], ['seating', 'Seating Plan'], ['layout', 'Hall Layout'],
    ['transfers', `Transfer Requests (${pend[0]?.t ?? 0})`], ['names', `Name Changes (${pend[0]?.n ?? 0})`],
  ];
  return (
    <>
      <h1>E-Tickets and Seating</h1>
      <Flash msg={get('msg')} err={get('err')} />
      <Tabs base="/admin/tickets" tabs={tabs} current={tab} keep={{ q }} />
      {tab === 'issued' ? <Issued season={S} q={q} back={back} canLost={staff.can('lost_ticket')} canFix={staff.can('transfer_approve')} /> : null}
      {tab === 'seating' ? <Seating season={S} /> : null}
      {tab === 'layout' ? <Layout season={S} back={back} canEdit={staff.can('layout_edit')} /> : null}
      {tab === 'transfers' ? <Transfers season={S} q={q} back={back} canDecide={staff.can('transfer_approve')} /> : null}
      {tab === 'names' ? <Names season={S} q={q} back={back} canDecide={staff.can('transfer_approve')} /> : null}
    </>
  );
}

async function Issued({ season, q, back, canLost, canFix }: { season: string; q: string; back: string; canLost: boolean; canFix: boolean }) {
  const s = q ? await studentSummary(season, q) : null;
  const rows = await sql<T>(
    `select t.id::text, t.token, t.misis, t.kind, t.holder_name, t.status, z.name as zone, z.color as zone_color, t.door, c.name as ceremony,
            t.door1_at, t.door2_at, t.created_at, t.void_reason, g.mobile, g.private_email
       from tickets t join ceremonies c on c.id = t.ceremony_id left join zones z on z.id = t.zone_id
       join graduates g on g.season_id = t.season_id and g.misis = t.misis
      where t.season_id = $1 and ($2 = '' or t.misis = $2)
      order by t.created_at desc limit $3`,
    [season, q, q ? 100 : 200],
  );
  return (
    <>
      <SearchBar action="/admin/tickets" q={q} hidden={{ tab: 'issued' }} />
      {s ? <StudentCard s={s} /> : q ? <div className="flash err">MISIS {q} is not on the Master List.</div> : <p className="small muted">Latest 200 tickets. Search a MISIS to see one graduate and use Lost Ticket.</p>}
      {rows.length === 0 ? <Empty>No tickets.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Holder</th><th>MISIS</th><th>Ceremony</th><th>Zone / door</th><th>Door 1</th><th>Door 2</th><th>Status</th>{q && (canLost || canFix) ? <th>Actions</th> : null}</tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className={t.status === 'void' ? 'dim' : ''}>
                  <td><strong>{t.holder_name}</strong><div className="small muted">{t.kind} · ref {t.id.slice(0, 8).toUpperCase()}</div></td>
                  <td className="mono">{t.misis}</td>
                  <td>{t.ceremony}</td>
                  <td>{t.zone ? <span className="pill" style={{ background: t.zone_color ?? undefined, color: '#fff' }}>{t.zone}</span> : 'Graduate seating'}<div className="small">{t.door}</div></td>
                  <td>{t.door1_at ? fmtTime(t.door1_at) : '—'}</td>
                  <td>{t.door2_at ? fmtTime(t.door2_at) : '—'}</td>
                  <td>{t.status === 'valid' ? <span className="pill ok">valid</span> : <span className="pill">void{t.void_reason ? `: ${t.void_reason}` : ''}</span>}</td>
                  {q && (canLost || canFix) ? (
                    <td style={{ minWidth: 280 }}>
                      {t.status === 'valid' ? (
                        <details>
                          <summary className="small">Lost Ticket / correct name</summary>
                          {canLost ? (
                            <>
                              <form action={lostTicketAction}>
                                <Back to={back} />
                                <input type="hidden" name="ticket" value={t.id} />
                                <label className="check small"><input type="radio" name="to" value="mdx" defaultChecked /> Student MDX email</label>
                                {t.private_email ? <label className="check small"><input type="radio" name="to" value="private" /> Student private email</label> : null}
                                <label className="check small"><input type="radio" name="to" value="other" /> Guest email</label>
                                <input name="address" type="email" placeholder="guest@example.com" />
                                <div style={{ marginTop: 6 }}><Submit className="btn sm">Send ticket again</Submit></div>
                              </form>
                              <form action={logMobileSendAction} className="inline" style={{ marginTop: 8 }}>
                                <Back to={back} />
                                <input type="hidden" name="ticket" value={t.id} />
                                <input name="mobile" defaultValue={t.mobile ?? ''} placeholder="+9715…" style={{ width: 140 }} />
                                <a className="btn ghost sm" target="_blank" rel="noopener noreferrer"
                                  href={`https://wa.me/${(t.mobile ?? '').replace(/[^\d]/g, '')}?text=${encodeURIComponent(`Your graduation e-ticket (${t.holder_name}): ${siteUrl()}/t/${t.token}`)}`}>WhatsApp</a>
                                <Submit className="btn ghost sm">Log mobile send</Submit>
                              </form>
                            </>
                          ) : null}
                          {canFix && t.kind === 'guest' ? (
                            <form action={correctNameAction} style={{ marginTop: 10 }}>
                              <Back to={back} />
                              <input type="hidden" name="ticket" value={t.id} />
                              <input name="new_name" placeholder="Corrected full name" required minLength={2} />
                              <input name="reason" placeholder="Reason" required minLength={3} style={{ marginTop: 6 }} />
                              <div style={{ marginTop: 6 }}><Submit className="btn secondary sm" confirm="Reissue this ticket? The old QR code stops working.">Correct name (new QR)</Submit></div>
                            </form>
                          ) : null}
                        </details>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Seating({ season }: { season: string }) {
  const [ceremonies, settings] = await Promise.all([getCeremonies(season), getSeasonSettings(season)]);
  const data = await Promise.all(ceremonies.map(async (c) => ({
    c,
    zones: await fn<ZoneAvailability[]>('zone_availability', [c.id]),
    grads: (await sql<{ n: number }>(`select count(*)::int as n from tickets where ceremony_id = $1 and kind = 'graduate' and status = 'valid'`, [c.id]))[0]?.n ?? 0,
    sold: await sql<{ zone_id: number; n: number; w: number }>(
      `select zone_id, count(*)::int as n, (count(*) filter (where access = 'wheelchair'))::int as w from tickets
        where ceremony_id = $1 and kind = 'guest' and status = 'valid' group by zone_id`, [c.id]),
  })));
  return (
    <>
      <p className="small muted">Places sold (maroon) and held by unpaid bookings (gold), per zone and ceremony. Graduates sit in the front block and are seated on the day.</p>
      {data.map(({ c, zones, grads, sold }) => (
        <section className="card" key={c.id} style={{ marginBottom: 16 }}>
          <h2>{c.name}</h2>
          <div className="hall">
            <div className="stage">STAGE</div>
            <div className="gradblock">Graduates: {grads} of {settings?.graduate_capacity ?? 0} places</div>
            <div className="zones">
              {zones.map((z) => {
                const s = sold.find((x) => x.zone_id === z.id);
                return (
                  <div className="zone" key={z.id} style={{ cursor: 'default' }}>
                    <div><span className="sw" style={{ background: z.color }} />{z.name} · {z.door}</div>
                    <div className="left">{z.left}</div>
                    <div className="small muted">left of {z.capacity} · {s?.n ?? 0} sold · {Math.max(0, z.taken - (s?.n ?? 0))} held</div>
                    <Bar capacity={z.capacity} sold={s?.n ?? 0} held={Math.max(0, z.taken - (s?.n ?? 0))} />
                    {z.wheelchair_capacity ? <div className="small" style={{ marginTop: 6 }}>♿︎ {z.wheelchair_capacity - z.wheelchair_left} of {z.wheelchair_capacity} wheelchair spaces</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      ))}
    </>
  );
}

async function Layout({ season, back, canEdit }: { season: string; back: string; canEdit: boolean }) {
  const [zones, settings] = await Promise.all([getZones(season), getSeasonSettings(season)]);
  const total = zones.filter((z) => z.active).reduce((a, z) => a + z.capacity, 0);
  return (
    <>
      <p className="small muted">
        One hall per season; every ceremony uses it in turn. Guest capacity per ceremony: <strong>{total}</strong> in {zones.filter((z) => z.active).length} zones,
        plus {settings?.graduate_capacity} graduate places. A zone can never be made smaller than the places already sold or held.
      </p>
      <form action={saveVenueAction} className="card" style={{ marginBottom: 16 }}>
        <Back to={back} />
        <h3>Venue</h3>
        <div className="grid">
          <div><label className="f">Venue name (shown on the public page)</label><input name="venue_name" defaultValue={settings?.venue_name} disabled={!canEdit} /></div>
          <div><label className="f">Area</label><input name="venue_area" defaultValue={settings?.venue_area} disabled={!canEdit} /></div>
          <div><label className="f">Graduate block (places)</label><input name="graduate_capacity" defaultValue={settings?.graduate_capacity} inputMode="numeric" disabled={!canEdit} /></div>
          <div><label className="f">Hold time while paying (minutes)</label><input name="hold_minutes" defaultValue={settings?.hold_minutes} inputMode="numeric" disabled={!canEdit} /></div>
        </div>
        {canEdit ? <div style={{ marginTop: 10 }}><Submit>Save venue</Submit></div> : null}
      </form>
      <div className="table-wrap">
        <table className="t">
          <thead><tr><th>Code</th><th>Name</th><th>Door (Door 2)</th><th>Colour</th><th className="num">Capacity</th><th className="num">Wheelchair spaces</th><th className="num">Order</th><th>Active</th>{canEdit ? <th /> : null}</tr></thead>
          <tbody>
            {zones.map((z) => (
              <tr key={z.id}>
                <td colSpan={canEdit ? 9 : 8} style={{ padding: 0 }}>
                  <form action={saveZoneAction} style={{ display: 'grid', gridTemplateColumns: '70px 1.4fr 1.2fr 80px 100px 110px 70px 70px auto', gap: 6, padding: '6px 10px', alignItems: 'center' }}>
                    <Back to={back} />
                    <input type="hidden" name="id" value={z.id} />
                    <input name="code" defaultValue={z.code} disabled={!canEdit} aria-label="Code" />
                    <input name="name" defaultValue={z.name} disabled={!canEdit} aria-label="Name" />
                    <input name="door" defaultValue={z.door} disabled={!canEdit} aria-label="Door" />
                    <input name="color" type="color" defaultValue={z.color} disabled={!canEdit} aria-label="Colour" style={{ padding: 2, height: 38 }} />
                    <input name="capacity" defaultValue={z.capacity} inputMode="numeric" disabled={!canEdit} aria-label="Capacity" />
                    <input name="wheelchair" defaultValue={z.wheelchair_capacity} inputMode="numeric" disabled={!canEdit} aria-label="Wheelchair spaces" />
                    <input name="sort" defaultValue={z.sort} inputMode="numeric" disabled={!canEdit} aria-label="Order" />
                    <input type="checkbox" name="active" defaultChecked={z.active} disabled={!canEdit} aria-label="Active" />
                    {canEdit ? <Submit className="btn sm">Save</Submit> : null}
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <form action={saveZoneAction} className="card" style={{ marginTop: 16 }}>
          <Back to={back} />
          <h3>Add a zone</h3>
          <div className="grid four">
            <div><label className="f">Code</label><input name="code" required maxLength={4} placeholder="E" /></div>
            <div><label className="f">Name</label><input name="name" required placeholder="Zone E" /></div>
            <div><label className="f">Door</label><input name="door" required placeholder="Door 2E" /></div>
            <div><label className="f">Colour</label><input name="color" type="color" defaultValue="#5B5347" style={{ padding: 2, height: 42 }} /></div>
            <div><label className="f">Capacity</label><input name="capacity" required inputMode="numeric" /></div>
            <div><label className="f">Wheelchair spaces</label><input name="wheelchair" defaultValue="0" inputMode="numeric" /></div>
            <div><label className="f">Order</label><input name="sort" defaultValue={zones.length + 1} inputMode="numeric" /></div>
          </div>
          <div style={{ marginTop: 10 }}><Submit>Add zone</Submit></div>
        </form>
      ) : null}
    </>
  );
}

async function Transfers({ season, q, back, canDecide }: { season: string; q: string; back: string; canDecide: boolean }) {
  const rows = await sql<{ id: string; from_misis: string; from_name: string; to_misis: string; to_name: string; ceremony: string; holders: string; status: string; student_note: string; created_at: Date; decided_by: string | null; decision_note: string | null }>(
    `select tr.id::text, tr.from_misis, gf.full_name as from_name, tr.to_misis, gt.full_name as to_name, c.name as ceremony,
            (select string_agg(t.holder_name || ' (' || coalesce(z.name, '') || ')', ', ') from tickets t left join zones z on z.id = t.zone_id where t.id = any(tr.ticket_ids)) as holders,
            tr.status, tr.student_note, tr.created_at, tr.decided_by, tr.decision_note
       from transfers tr
       join graduates gf on gf.season_id = tr.season_id and gf.misis = tr.from_misis
       join graduates gt on gt.season_id = tr.season_id and gt.misis = tr.to_misis
       left join ceremonies c on c.id = gf.ceremony_id
      where tr.season_id = $1 and ($2 = '' or tr.from_misis = $2 or tr.to_misis = $2)
      order by (tr.status = 'requested') desc, tr.created_at desc limit 200`,
    [season, q],
  );
  return (
    <>
      <SearchBar action="/admin/tickets" q={q} hidden={{ tab: 'transfers' }} />
      <p className="small muted">Transfers are only between graduates of the same ceremony. Approval voids the old QR codes and issues new tickets for the same zone to the receiving graduate.</p>
      {rows.length === 0 ? <Empty>No transfer requests.</Empty> : rows.map((r) => (
        <div className="card flat" key={r.id} style={{ marginBottom: 10 }}>
          <div className="row between">
            <strong>{r.from_name} ({r.from_misis}) → {r.to_name} ({r.to_misis})</strong>
            <span className={`pill ${r.status === 'approved' ? 'ok' : r.status === 'requested' ? 'warn' : ''}`}>{r.status}</span>
          </div>
          <div className="small muted">{r.ceremony} · requested {fmtDateTime(r.created_at)}{r.decided_by ? ` · decided by ${r.decided_by}` : ''}</div>
          <p style={{ margin: '6px 0' }}>Tickets: {r.holders}</p>
          {r.student_note ? <p className="small">Student note: {r.student_note}</p> : null}
          {r.decision_note ? <p className="small">Decision note: {r.decision_note}</p> : null}
          {r.status === 'requested' && canDecide ? (
            <form action={decideTransferAction} className="inline">
              <Back to={back} />
              <input type="hidden" name="id" value={r.id} />
              <input name="note" placeholder="Note to the student (optional)" style={{ width: 280 }} />
              <Submit className="btn sm" name="decision" value="approve" confirm="Approve? The old QR codes stop working.">Approve</Submit>
              <Submit className="btn ghost sm" name="decision" value="reject">Reject</Submit>
            </form>
          ) : null}
        </div>
      ))}
    </>
  );
}

async function Names({ season, q, back, canDecide }: { season: string; q: string; back: string; canDecide: boolean }) {
  const rows = await sql<{ id: string; misis: string; full_name: string; old_name: string; new_name: string; reason: string; status: string; created_at: Date; decided_by: string | null }>(
    `select q.id::text, q.misis, g.full_name, q.old_name, q.new_name, q.reason, q.status, q.created_at, q.decided_by
       from name_change_requests q join graduates g on g.season_id = q.season_id and g.misis = q.misis
      where q.season_id = $1 and ($2 = '' or q.misis = $2) order by (q.status = 'requested') desc, q.created_at desc limit 200`,
    [season, q],
  );
  return (
    <>
      <SearchBar action="/admin/tickets" q={q} hidden={{ tab: 'names' }} />
      <p className="small muted">Students request guest name changes from My E-Tickets. Each is decided case by case; approval reissues the ticket with a new QR code in the same zone.</p>
      {rows.length === 0 ? <Empty>No name change requests.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Requested</th><th>Graduate</th><th>Change</th><th>Reason</th><th>Status</th>{canDecide ? <th /> : null}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.created_at)}</td>
                  <td>{r.full_name}<div className="small mono">{r.misis}</div></td>
                  <td>{r.old_name} → <strong>{r.new_name}</strong></td>
                  <td>{r.reason}</td>
                  <td><span className={`pill ${r.status === 'approved' ? 'ok' : r.status === 'requested' ? 'warn' : ''}`}>{r.status}</span>{r.decided_by ? <div className="small">{r.decided_by}</div> : null}</td>
                  {canDecide ? (
                    <td>
                      {r.status === 'requested' ? (
                        <form action={decideNameAction} className="inline">
                          <Back to={back} />
                          <input type="hidden" name="id" value={r.id} />
                          <input name="note" placeholder="Note (optional)" style={{ width: 160 }} />
                          <Submit className="btn sm" name="decision" value="approve">Approve</Submit>
                          <Submit className="btn ghost sm" name="decision" value="reject">Reject</Submit>
                        </form>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
