import { sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { getSeasonSettings } from '@/lib/settings';
import { ceremonyOptions, releaseHolds, studentSummary } from '@/lib/admin-queries';
import { aed, fmtDateTime, normMisis, ticketsText } from '@/lib/format';
import StudentCard from '@/components/StudentCard';
import CounterForm from '@/components/CounterForm';
import AutoRefresh from '@/components/AutoRefresh';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, readParams, SearchBar, Tabs, type SearchParams } from '@/components/ui';
import {
  attentionToReceiptAction, counterPaymentAction, emailStudentsAction, manualPaidAction, resendReceiptAction, resolveAttentionAction, voidReceiptAction,
} from './actions';

export default async function FinanceEntry({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('finance_entry');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const tab = get('tab') || 'counter';
  const q = normMisis(get('q'));
  const back = `/admin/finance?${new URLSearchParams({ tab, q })}`;
  const money = staff.can('view_revenue');
  await releaseHolds();
  const settings = (await getSeasonSettings(S))!;
  const student = q ? await studentSummary(S, q) : null;
  const filterMisis = q || '';

  const tabs: [string, string][] = [
    ['counter', 'Over the Counter'], ['online', 'Online Payments Live'], ['receipts', 'Receipts and Seats'],
    ['others', 'Paid by Someone Else'], ['email', 'Email Students'], ['updated', 'Students With Tickets Updated'], ['attention', 'Needs Attention'],
  ];

  return (
    <>
      <h1>Finance Entry</h1>
      <p className="page-sub">Counter payments create a receipt number that the student redeems on the public page to choose the zone and get the e-tickets.</p>
      <Flash msg={get('msg')} err={get('err')} />
      <Tabs base="/admin/finance" tabs={tabs} current={tab} keep={{ q }} />
      {tab !== 'email' ? <SearchBar action="/admin/finance" q={q} hidden={{ tab }} /> : null}
      {q && !student ? <div className="flash err">MISIS {q} is not on the Master List for {staff.season.name}.</div> : null}

      {tab === 'counter' ? (
        <>
          {student ? (
            <StudentCard s={student}>
              <CounterForm s={student} settings={settings} source="counter" back={back} action={counterPaymentAction} />
            </StudentCard>
          ) : (
            <Empty>Search a MISIS to record an over-the-counter payment.</Empty>
          )}
          <ReceiptsTable season={S} source={['counter']} misis={filterMisis} money={money} back={back} limit={25} title="Latest counter payments" />
        </>
      ) : null}

      {tab === 'online' ? <OnlineLive season={S} misis={filterMisis} money={money} back={back} /> : null}
      {tab === 'receipts' ? <ReceiptsTable season={S} source={['counter', 'graduation_day', 'third_party', 'attention']} misis={filterMisis} money={money} back={back} limit={300} title="All receipts" actions /> : null}
      {tab === 'others' ? <ThirdParty season={S} misis={filterMisis} money={money} /> : null}
      {tab === 'email' ? <EmailStudents season={S} back={back} /> : null}
      {tab === 'updated' ? <Updated season={S} misis={filterMisis} money={money} /> : null}
      {tab === 'attention' ? <Attention season={S} back={back} money={money} /> : null}
    </>
  );
}

async function ReceiptsTable({ season, source, misis, money, back, limit, title, actions }: {
  season: string; source: string[]; misis: string; money: boolean; back: string; limit: number; title: string; actions?: boolean;
}) {
  const rows = await sql<{
    receipt_number: string; misis: string; full_name: string; source: string; includes_graduate: boolean; guest_count: number; amount_aed: number;
    method: string; entered_by: string; created_at: Date; status: string; used_at: Date | null; payer_name: string | null;
  }>(
    `select r.receipt_number, r.misis, g.full_name, r.source, r.includes_graduate, r.guest_count, r.amount_aed, r.method, r.entered_by,
            r.created_at, r.status, r.used_at, r.payer_name
       from receipts r join graduates g on g.season_id = r.season_id and g.misis = r.misis
      where r.season_id = $1 and r.source = any($2) and ($3 = '' or r.misis = $3)
      order by r.created_at desc limit $4`,
    [season, source, misis, limit],
  );
  const waiting = rows.filter((r) => r.status === 'unused').length;
  return (
    <section style={{ marginTop: 16 }}>
      <h2>{title} {waiting ? <span className="pill warn">{waiting} waiting for zone choice</span> : null}</h2>
      {rows.length === 0 ? <Empty>No receipts.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Date</th><th>Receipt</th><th>MISIS</th><th>Name</th><th>For</th>{money ? <th className="num">Amount</th> : null}<th>Method</th><th>Entered by</th><th>Status</th>{actions ? <th /> : null}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.receipt_number} className={r.status === 'void' ? 'dim' : ''}>
                  <td>{fmtDateTime(r.created_at)}</td>
                  <td className="mono">{r.receipt_number}</td>
                  <td className="mono">{r.misis}</td>
                  <td>{r.full_name}{r.payer_name ? <div className="small muted">paid by {r.payer_name}</div> : null}</td>
                  <td>{ticketsText(r.includes_graduate, r.guest_count)}<div className="small muted">{r.source.replace('_', ' ')}</div></td>
                  {money ? <td className="num">{aed(r.amount_aed)}</td> : null}
                  <td>{r.method}</td>
                  <td className="small">{r.entered_by}</td>
                  <td><span className={`pill ${r.status === 'used' ? 'ok' : r.status === 'unused' ? 'warn' : ''}`}>{r.status === 'used' ? `redeemed ${fmtDateTime(r.used_at)}` : r.status}</span></td>
                  {actions ? (
                    <td>
                      {r.status === 'unused' ? (
                        <div className="stack" style={{ minWidth: 180 }}>
                          <form action={resendReceiptAction}><Back to={back} /><input type="hidden" name="receipt" value={r.receipt_number} /><Submit className="btn ghost sm">Email again</Submit></form>
                          <details>
                            <summary className="small">Void</summary>
                            <form action={voidReceiptAction}>
                              <Back to={back} />
                              <input type="hidden" name="receipt" value={r.receipt_number} />
                              <input name="reason" placeholder="Reason (refund, mistake)" required minLength={3} />
                              <Submit className="btn danger sm" confirm="Void this receipt? It can no longer be redeemed.">Void receipt</Submit>
                            </form>
                          </details>
                        </div>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function OnlineLive({ season, misis, money, back }: { season: string; misis: string; money: boolean; back: string }) {
  const pays = await sql<{ at: Date; misis: string | null; channel: string; method: string; amount_aed: number; reference: string | null; ref: string | null; kind: string | null }>(
    `select p.at, p.misis, p.channel, p.method, p.amount_aed, p.reference, coalesce(o.ref, m.ref) as ref, o.kind
       from payments p left join orders o on o.id = p.order_id left join merch_orders m on m.id = p.merch_order_id
      where p.season_id = $1 and p.channel in ('online', 'third_party', 'merch_online') and ($2 = '' or p.misis = $2)
      order by p.at desc limit 100`,
    [season, misis],
  );
  const pending = await sql<{ id: string; ref: string; misis: string; kind: string; amount_aed: number; expires_at: Date; status: string }>(
    `select id::text, ref, misis, kind, amount_aed, expires_at, status from orders
      where season_id = $1 and channel in ('online', 'third_party') and ($2 = '' or misis = $2)
        and (status = 'pending_payment' or (status = 'expired' and updated_at > now() - interval '2 days'))
      order by created_at desc limit 50`,
    [season, misis],
  );
  return (
    <>
      <div className="row between"><h2>Online payments</h2><AutoRefresh seconds={3} /></div>
      {pays.length === 0 ? <Empty>No online payments yet.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Time</th><th>Order</th><th>MISIS</th><th>Type</th>{money ? <th className="num">Amount</th> : null}<th>Gateway ref</th></tr></thead>
            <tbody>
              {pays.map((p, i) => (
                <tr key={i}>
                  <td>{fmtDateTime(p.at)}</td>
                  <td className="mono">{p.ref}</td>
                  <td className="mono">{p.misis}</td>
                  <td>{p.channel === 'merch_online' ? 'Merchandise' : p.kind === 'third_party' ? 'Paid by someone else' : p.kind === 'extra' ? 'Extra tickets' : 'Tickets'}</td>
                  {money ? <td className="num">{aed(p.amount_aed)}</td> : null}
                  <td className="mono small">{p.reference} · {p.method}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2 style={{ marginTop: 20 }}>Unpaid and recently expired online orders</h2>
      <p className="small muted">If CCAvenue shows a payment that did not reach the system, record it here with the CCAvenue reference. The same amount and zone checks apply.</p>
      {pending.length === 0 ? <Empty>None.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Order</th><th>MISIS</th><th>Type</th>{money ? <th className="num">Amount</th> : null}<th>Status</th><th>Record payment</th></tr></thead>
            <tbody>
              {pending.map((o) => (
                <tr key={o.id}>
                  <td className="mono">{o.ref}</td>
                  <td className="mono">{o.misis}</td>
                  <td>{o.kind.replace('_', ' ')}</td>
                  {money ? <td className="num">{aed(o.amount_aed)}</td> : null}
                  <td>{o.status === 'pending_payment' ? `held until ${fmtDateTime(o.expires_at)}` : 'expired'}</td>
                  <td>
                    <form action={manualPaidAction} className="inline">
                      <Back to={back} />
                      <input type="hidden" name="order" value={o.id} />
                      <input name="reference" placeholder="CCAvenue reference" required style={{ width: 170 }} />
                      <Submit className="btn sm" confirm="Record this payment as received?">Record</Submit>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function ThirdParty({ season, misis, money }: { season: string; misis: string; money: boolean }) {
  const rows = await sql<{ ref: string; misis: string; full_name: string; payer_name: string; payer_email: string; payer_relation: string | null; status: string; amount_aed: number; includes_graduate: boolean; guest_count: number; receipt_number: string | null; receipt_status: string | null; created_at: Date }>(
    `select o.ref, o.misis, g.full_name, o.payer_name, o.payer_email, o.payer_relation, o.status, o.amount_aed, o.includes_graduate, o.guest_count,
            o.receipt_number, r.status as receipt_status, o.created_at
       from orders o join graduates g on g.season_id = o.season_id and g.misis = o.misis left join receipts r on r.receipt_number = o.receipt_number
      where o.season_id = $1 and o.kind = 'third_party' and ($2 = '' or o.misis = $2) order by o.created_at desc limit 300`,
    [season, misis],
  );
  return rows.length === 0 ? <Empty>No payments by parents, guardians or sponsors yet.</Empty> : (
    <div className="table-wrap">
      <table className="t">
        <thead><tr><th>Date</th><th>Order</th><th>Student</th><th>Paid by</th><th>For</th>{money ? <th className="num">Amount</th> : null}<th>Status</th><th>Receipt</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.ref}>
              <td>{fmtDateTime(r.created_at)}</td>
              <td className="mono">{r.ref}</td>
              <td>{r.full_name}<div className="small mono">{r.misis}</div></td>
              <td>{r.payer_name}<div className="small muted">{r.payer_relation} · {r.payer_email}</div></td>
              <td>{ticketsText(r.includes_graduate, r.guest_count)}</td>
              {money ? <td className="num">{aed(r.amount_aed)}</td> : null}
              <td><span className={`pill ${r.status === 'paid' ? 'ok' : r.status === 'pending_payment' ? 'warn' : ''}`}>{r.status.replace('_', ' ')}</span></td>
              <td className="mono">{r.receipt_number ?? '—'}{r.receipt_status ? <div className="small">{r.receipt_status === 'used' ? 'zone chosen' : r.receipt_status}</div> : null}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

async function EmailStudents({ season, back }: { season: string; back: string }) {
  const ceremonies = await ceremonyOptions(season);
  return (
    <form action={emailStudentsAction} className="card">
      <Back to={back} />
      <h2>Email students</h2>
      <p className="small muted">Placeholders: {'{name} {misis} {ceremony} {tickets} {team}'}. Emails go through the outbox and are retried if sending fails.</p>
      <div className="grid">
        <div>
          <label className="f" htmlFor="audience">Send to</label>
          <select id="audience" name="audience" defaultValue="one">
            <option value="one">One student (MISIS)</option>
            <option value="ceremony">Everyone in a ceremony</option>
            <option value="no_tickets">Eligible students with no tickets yet</option>
            <option value="hold">Students with a financial hold</option>
            <option value="all">Everyone on the Master List</option>
          </select>
        </div>
        <div><label className="f" htmlFor="misis">MISIS (for one student)</label><input id="misis" name="misis" /></div>
        <div>
          <label className="f" htmlFor="ceremony">Ceremony</label>
          <select id="ceremony" name="ceremony">{ceremonies.map((c) => <option key={c.id} value={c.number}>{c.name}</option>)}</select>
        </div>
      </div>
      <label className="f" htmlFor="subject">Subject</label>
      <input id="subject" name="subject" required maxLength={200} />
      <label className="f" htmlFor="body">Message</label>
      <textarea id="body" name="body" required defaultValue={'Dear {name},\n\n\n\n{team}'} />
      <div style={{ marginTop: 12 }}><Submit confirm="Send this email to the chosen students?">Send</Submit></div>
    </form>
  );
}

async function Updated({ season, misis, money }: { season: string; misis: string; money: boolean }) {
  const rows = await sql<{ at: Date; misis: string; full_name: string; ceremony: string | null; type: string; added: string; amount: number; ref: string; entered_by: string; now_held: number }>(
    `select x.at, x.misis, g.full_name, c.name as ceremony, x.type, x.added, x.amount, x.ref, x.entered_by,
            (select count(*) from tickets t where t.season_id = g.season_id and t.misis = g.misis and t.status = 'valid')::int as now_held
       from (
         select r.created_at as at, r.misis, case r.source when 'graduation_day' then 'Graduation Day' when 'third_party' then 'Paid by someone else' when 'attention' then 'Converted' else 'Over the counter' end as type,
                (case when r.includes_graduate then '1 graduate' else '' end || case when r.guest_count > 0 then case when r.includes_graduate then ' + ' else '' end || r.guest_count || ' guest(s)' else '' end) as added,
                r.amount_aed as amount, r.receipt_number as ref, r.entered_by
           from receipts r where r.season_id = $1
         union all
         select o.paid_at, o.misis, case o.kind when 'extra' then 'Extra tickets (online)' else 'Online' end,
                (case when o.includes_graduate then '1 graduate' else '' end || case when o.guest_count > 0 then case when o.includes_graduate then ' + ' else '' end || o.guest_count || ' guest(s)' else '' end),
                o.amount_aed, o.ref, o.created_by
           from orders o where o.season_id = $1 and o.status = 'paid' and o.channel in ('online', 'free') and o.kind <> 'third_party'
       ) x
       join graduates g on g.season_id = $1 and g.misis = x.misis left join ceremonies c on c.id = g.ceremony_id
      where ($2 = '' or x.misis = $2) order by x.at desc limit 500`,
    [season, misis],
  );
  return (
    <>
      <div className="row between">
        <h2>Students With Tickets Updated</h2>
        <a className="btn ghost sm" href="/api/export?type=ticket_updates">Download CSV</a>
      </div>
      {rows.length === 0 ? <Empty>Nothing yet.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Date</th><th>MISIS</th><th>Name</th><th>Ceremony</th><th>Type</th><th>Tickets added</th>{money ? <th className="num">Amount</th> : null}<th>Order / receipt</th><th>Entered by</th><th className="num">Now held</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{fmtDateTime(r.at)}</td><td className="mono">{r.misis}</td><td>{r.full_name}</td><td>{r.ceremony ?? '—'}</td><td>{r.type}</td><td>{r.added}</td>
                  {money ? <td className="num">{aed(r.amount)}</td> : null}
                  <td className="mono">{r.ref}</td><td className="small">{r.entered_by}</td><td className="num">{r.now_held}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

async function Attention({ season, back, money }: { season: string; back: string; money: boolean }) {
  const rows = await sql<{ id: string; ref: string; misis: string; full_name: string; status: string; amount_aed: number; needs_attention: string; updated_at: Date; paid: number }>(
    `select o.id::text, o.ref, o.misis, g.full_name, o.status, o.amount_aed, o.needs_attention, o.updated_at,
            coalesce((select sum(amount_aed) from payments p where p.order_id = o.id), 0) as paid
       from orders o join graduates g on g.season_id = o.season_id and g.misis = o.misis
      where o.season_id = $1 and o.needs_attention is not null and o.attention_resolved_at is null order by o.updated_at desc`,
    [season],
  );
  const merch = await sql<{ id: string; ref: string; misis: string; buyer_name: string; needs_attention: string }>(
    `select id::text, ref, misis, buyer_name, needs_attention from merch_orders where season_id = $1 and needs_attention is not null`, [season]);
  return (
    <>
      <h2>Needs Attention</h2>
      <p className="small muted">Payments that could not issue tickets automatically: wrong amount, paid after the hold with the zone now full, paid for a cancelled or replaced order.</p>
      {rows.length + merch.length === 0 ? <Empty>Nothing needs attention.</Empty> : null}
      {rows.map((r) => (
        <div className="card flat" key={r.id} style={{ marginBottom: 10 }}>
          <div className="row between">
            <strong>{r.ref} · {r.full_name} ({r.misis})</strong>
            <span className="small muted">{fmtDateTime(r.updated_at)} · status {r.status}{money ? ` · order ${aed(r.amount_aed)}, received ${aed(r.paid)}` : ''}</span>
          </div>
          <p style={{ margin: '8px 0' }}>{r.needs_attention}</p>
          <div className="row">
            {!/^Amount mismatch/.test(r.needs_attention) ? (
              <form action={attentionToReceiptAction}><Back to={back} /><input type="hidden" name="order" value={r.id} /><Submit className="btn sm" confirm="Give the student a receipt for what is still owed?">Convert to receipt</Submit></form>
            ) : null}
            <form action={resolveAttentionAction} className="inline">
              <Back to={back} />
              <input type="hidden" name="order" value={r.id} />
              <input name="note" placeholder="How it was resolved (e.g. refunded in CCAvenue)" required minLength={3} style={{ width: 320 }} />
              <Submit className="btn ghost sm">Mark resolved</Submit>
            </form>
          </div>
        </div>
      ))}
      {merch.map((m) => (
        <div className="card flat" key={m.id} style={{ marginBottom: 10 }}>
          <strong>Merchandise {m.ref} · {m.buyer_name} ({m.misis})</strong>
          <p style={{ margin: '8px 0' }}>{m.needs_attention}</p>
          <form action={resolveAttentionAction} className="inline">
            <Back to={back} />
            <input type="hidden" name="order" value={m.id} />
            <input name="note" placeholder="How it was resolved" required minLength={3} style={{ width: 320 }} />
            <Submit className="btn ghost sm">Mark resolved</Submit>
          </form>
        </div>
      ))}
    </>
  );
}
