import { sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { aed, fmtDateTime, normMisis } from '@/lib/format';
import MerchPic from '@/components/MerchPic';
import Submit from '@/components/Submit';
import { Back, Empty, Flash, Kpi, readParams, SearchBar, Tabs, type SearchParams } from '@/components/ui';
import { collectAction, counterMerchAction } from './actions';

export default async function Merchandise({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('merchandise');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const tab = get('tab') || 'orders';
  const q = normMisis(get('q'));
  const back = `/admin/merchandise?${new URLSearchParams({ tab, q })}`;
  const money = staff.can('view_revenue');
  const tabs: [string, string][] = [['orders', 'Orders'], ['otc', 'OTC Payment'], ['items', 'Items Sold']];

  return (
    <>
      <h1>Merchandise</h1>
      <p className="page-sub">Online and counter orders. Mark an order as collected when the items are handed over; this is only possible after payment.</p>
      <Flash msg={get('msg')} err={get('err')} />
      <Tabs base="/admin/merchandise" tabs={tabs} current={tab} keep={{ q }} />
      {tab === 'orders' ? <Orders season={S} q={q} back={back} money={money} /> : null}
      {tab === 'otc' ? <Otc season={S} back={back} /> : null}
      {tab === 'items' ? <Items season={S} money={money} /> : null}
    </>
  );
}

async function Orders({ season, q, back, money }: { season: string; q: string; back: string; money: boolean }) {
  const rows = await sql<{ id: string; ref: string; misis: string; buyer_name: string; buyer_email: string | null; channel: string; status: string; amount_aed: number; collected: boolean; collected_by: string | null; collected_at: Date | null; created_at: Date; lines: string }>(
    `select m.id::text, m.ref, m.misis, m.buyer_name, m.buyer_email, m.channel, m.status, m.amount_aed, m.collected, m.collected_by, m.collected_at, m.created_at,
            (select string_agg(l.quantity || ' × ' || l.item_name, ', ') from merch_order_lines l where l.order_id = m.id) as lines
       from merch_orders m where m.season_id = $1 and ($2 = '' or m.misis = $2) and m.status in ('paid', 'pending_payment')
      order by m.created_at desc limit 300`,
    [season, q],
  );
  return (
    <>
      <SearchBar action="/admin/merchandise" q={q} hidden={{ tab: 'orders' }} />
      {rows.length === 0 ? <Empty>No orders.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Date</th><th>Order</th><th>MISIS</th><th>Buyer</th><th>Items</th>{money ? <th className="num">Amount</th> : null}<th>Payment</th><th>Collected</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{fmtDateTime(r.created_at)}</td><td className="mono">{r.ref}</td><td className="mono">{r.misis}</td>
                  <td>{r.buyer_name}{r.buyer_email ? <div className="small muted">{r.buyer_email}</div> : null}</td>
                  <td>{r.lines}</td>
                  {money ? <td className="num">{aed(r.amount_aed)}</td> : null}
                  <td><span className={`pill ${r.status === 'paid' ? 'ok' : 'warn'}`}>{r.status === 'paid' ? `paid · ${r.channel}` : 'awaiting payment'}</span></td>
                  <td>
                    {r.collected ? <span className="small">✓ {fmtDateTime(r.collected_at)}<br />{r.collected_by}</span>
                      : r.status === 'paid' ? (
                        <form action={collectAction}><Back to={back} /><input type="hidden" name="order" value={r.id} /><Submit className="btn sm">Mark collected</Submit></form>
                      ) : <span className="muted small">after payment</span>}
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

async function Otc({ season, back }: { season: string; back: string }) {
  const items = await sql<{ id: number; name: string; price_aed: number; image: string }>(
    'select id, name, price_aed, image from merch_items where season_id = $1 and active and not removed order by sort, name', [season]);
  if (!items.length) return <Empty>No merchandise items. A super admin adds them in Admin Access → Merchandise Items.</Empty>;
  return (
    <form action={counterMerchAction} className="stack">
      <Back to={back} />
      <div className="merch-grid">
        {items.map((it) => (
          <div className="card" key={it.id}>
            <MerchPic image={it.image} name={it.name} />
            <div className="row between" style={{ marginTop: 8 }}>
              <strong>{it.name} · {aed(it.price_aed)}</strong>
              <select name={`qty_${it.id}`} defaultValue="0" aria-label={`Quantity of ${it.name}`} style={{ width: 80 }}>
                {Array.from({ length: 11 }, (_, n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="grid four">
          <div><label className="f">Graduate&apos;s MISIS</label><input name="misis" required /></div>
          <div><label className="f">Buyer name</label><input name="buyer_name" required /></div>
          <div><label className="f">Buyer email (optional)</label><input name="buyer_email" type="email" /></div>
          <div>
            <label className="f">Method</label>
            <select name="method" defaultValue="Card at Desk"><option>Card at Desk</option><option>Cash</option><option>QR Online Payment</option></select>
          </div>
        </div>
        <div style={{ marginTop: 12 }}><Submit confirm="Record this counter sale as paid?">Record counter sale</Submit></div>
      </div>
    </form>
  );
}

async function Items({ season, money }: { season: string; money: boolean }) {
  const rows = await sql<{ name: string; price_aed: number; qty: number; total: number; collected: number }>(
    `select l.item_name as name, max(l.unit_price) as price_aed, sum(l.quantity)::int as qty, sum(l.quantity * l.unit_price) as total,
            sum(case when m.collected then l.quantity else 0 end)::int as collected
       from merch_order_lines l join merch_orders m on m.id = l.order_id
      where m.season_id = $1 and m.status = 'paid' group by l.item_name order by qty desc`,
    [season],
  );
  const total = rows.reduce((a, r) => a + r.total, 0);
  return (
    <>
      <div className="grid four" style={{ marginBottom: 16 }}>
        <Kpi label="Items sold" value={rows.reduce((a, r) => a + r.qty, 0)} />
        {money ? <Kpi label="Merchandise revenue" value={aed(total)} /> : null}
      </div>
      {rows.length === 0 ? <Empty>No sales yet.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Item</th><th className="num">Price</th><th className="num">Sold</th><th className="num">Collected</th>{money ? <th className="num">Total</th> : null}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}><td>{r.name}</td><td className="num">{aed(r.price_aed)}</td><td className="num">{r.qty}</td><td className="num">{r.collected}</td>{money ? <td className="num">{aed(r.total)}</td> : null}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
