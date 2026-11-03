import Link from 'next/link';
import { redirect } from 'next/navigation';
import { firstAllowedPath } from '@/lib/menu';
import { fn, one, sql } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { getCeremonies, getSeasonSettings, type ZoneAvailability } from '@/lib/settings';
import { aed, fmtDateTime } from '@/lib/format';
import AutoRefresh from '@/components/AutoRefresh';
import { Bar, Flash, Kpi, readParams, type SearchParams } from '@/components/ui';

type Live = { graduates_total: number; graduates_in: number; guests_total: number; guests_in: number; guests_door1: number };

export default async function Dashboard({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff();
  if (!staff.can('view_dashboard')) redirect(firstAllowedPath(staff.perms) ?? '/staff/login?err=no_access');
  const get = await readParams(searchParams);
  const S = staff.season.id;
  const [ceremonies, settings] = await Promise.all([getCeremonies(S), getSeasonSettings(S)]);
  const counts = await one<{
    graduates: number; allocated: number; paid_orders: number; pending: number; attention: number; receipts: number;
    transfers: number; names: number; extras: number; grad_tickets: number; guest_tickets: number;
  }>(
    `select (select count(*) from graduates where season_id = $1) as graduates,
            (select count(*) from graduates where season_id = $1 and ceremony_id is not null) as allocated,
            (select count(*) from orders where season_id = $1 and status = 'paid' and kind <> 'third_party') as paid_orders,
            (select count(*) from orders where season_id = $1 and status = 'pending_payment' and expires_at > now()) as pending,
            (select count(*) from orders where season_id = $1 and needs_attention is not null and attention_resolved_at is null) as attention,
            (select count(*) from receipts where season_id = $1 and status = 'unused') as receipts,
            (select count(*) from transfers where season_id = $1 and status = 'requested') as transfers,
            (select count(*) from name_change_requests where season_id = $1 and status = 'requested') as names,
            (select count(*) from extra_ticket_requests where season_id = $1 and status = 'requested') as extras,
            (select count(*) from tickets where season_id = $1 and kind = 'graduate' and status = 'valid') as grad_tickets,
            (select count(*) from tickets where season_id = $1 and kind = 'guest' and status = 'valid') as guest_tickets`,
    [S],
  );
  const per = await Promise.all(
    ceremonies.map(async (c) => ({
      c,
      zones: await fn<ZoneAvailability[]>('zone_availability', [c.id]),
      live: await fn<Live>('live_stats', [c.id]),
      sold: await sql<{ zone_id: number; n: number }>(
        `select zone_id, count(*)::int as n from tickets where ceremony_id = $1 and kind = 'guest' and status = 'valid' group by zone_id`, [c.id]),
      allocated: (await one<{ n: number }>('select count(*)::int as n from graduates where ceremony_id = $1', [c.id]))?.n ?? 0,
    })),
  );
  const revenue = staff.can('view_revenue')
    ? await sql<{ channel: string; total: number; n: number }>(
        `select channel, sum(amount_aed) as total, count(*)::int as n from payments where season_id = $1 group by channel order by channel`, [S])
    : [];
  const totalRevenue = revenue.reduce((a, r) => a + r.total, 0);

  return (
    <>
      <div className="row between">
        <div>
          <h1>Dashboard</h1>
          <p className="page-sub">{staff.season.name} · {settings?.venue_name} · {settings?.sales_open ? 'online sales open' : 'online sales closed'}</p>
        </div>
        <AutoRefresh seconds={10} />
      </div>
      <Flash msg={get('msg')} err={get('err')} />
      <div className="grid four">
        <Kpi label="Graduates on Master List" value={counts?.graduates ?? 0} sub={`${counts?.allocated ?? 0} allocated to a ceremony`} />
        <Kpi label="Graduate tickets" value={counts?.grad_tickets ?? 0} />
        <Kpi label="Guest tickets" value={counts?.guest_tickets ?? 0} />
        <Kpi label="Unpaid bookings holding places" value={counts?.pending ?? 0} />
        {staff.can('finance_entry') ? <Kpi label="Needs Attention" value={<Link href="/admin/finance?tab=attention">{counts?.attention ?? 0}</Link>} /> : null}
        <Kpi label="Receipts waiting to be redeemed" value={counts?.receipts ?? 0} />
        {staff.can('transfer_approve', 'tickets_seating') ? <Kpi label="Transfers / name changes waiting" value={<Link href="/admin/tickets?tab=transfers">{(counts?.transfers ?? 0) + (counts?.names ?? 0)}</Link>} /> : null}
        {staff.can('extra_tickets', 'extra_tickets_approve') ? <Kpi label="Extra ticket requests" value={<Link href="/admin/extra-tickets">{counts?.extras ?? 0}</Link>} /> : null}
      </div>

      {staff.can('view_revenue') ? (
        <section className="card" style={{ marginTop: 16 }}>
          <h2>Revenue · {aed(totalRevenue)}</h2>
          <div className="grid four">
            {revenue.map((r) => <Kpi key={r.channel} label={r.channel.replace('_', ' ')} value={aed(r.total)} sub={`${r.n} payment(s)`} />)}
          </div>
        </section>
      ) : null}

      {per.map(({ c, zones, live, sold, allocated }) => {
        const capacity = zones.reduce((a, z) => a + z.capacity, 0);
        const taken = zones.reduce((a, z) => a + z.taken, 0);
        return (
          <section className="card" key={c.id} style={{ marginTop: 16 }}>
            <div className="row between">
              <h2 style={{ margin: 0 }}>{c.name}</h2>
              <span className="small muted">{c.starts_at ? fmtDateTime(c.starts_at) : 'Date to be set'}</span>
            </div>
            <div className="grid four" style={{ margin: '12px 0' }}>
              <Kpi label="Graduates allocated" value={allocated} sub={`${live.graduates_total} graduate tickets · block of ${settings?.graduate_capacity ?? 0}`} />
              <Kpi label="Guest places" value={`${taken} / ${capacity}`} sub={`${capacity - taken} left`} />
              <Kpi label="Arrived · graduates" value={live.graduates_in} />
              <Kpi label="In the hall · guests" value={`${live.guests_in}`} sub={`${live.guests_door1} through Door 1`} />
            </div>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Zone</th><th>Door</th><th className="num">Capacity</th><th className="num">Sold</th><th className="num">Held</th><th className="num">Left</th><th style={{ width: '35%' }}>Use</th></tr></thead>
                <tbody>
                  {zones.map((z) => {
                    const s = sold.find((x) => x.zone_id === z.id)?.n ?? 0;
                    return (
                      <tr key={z.id}>
                        <td><span className="pill" style={{ background: z.color, color: '#fff' }}>{z.code}</span> {z.name}</td>
                        <td>{z.door}</td>
                        <td className="num">{z.capacity}</td>
                        <td className="num">{s}</td>
                        <td className="num">{Math.max(0, z.taken - s)}</td>
                        <td className="num">{z.left}</td>
                        <td><Bar capacity={z.capacity} sold={s} held={Math.max(0, z.taken - s)} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </>
  );
}
