import { fn } from '@/lib/db';
import { requireStaff } from '@/lib/auth/staff';
import { getCeremonies } from '@/lib/settings';
import { fmtTime, SCAN_RESULT as RESULT_LABEL } from '@/lib/format';
import AutoRefresh from '@/components/AutoRefresh';
import { Bar, Empty, Kpi, readParams, type SearchParams } from '@/components/ui';

type Live = {
  graduates_total: number; graduates_in: number; guests_total: number; guests_door1: number; guests_in: number; refused: number;
  zones: { id: number; code: string; name: string; door: string; color: string; capacity: number; sold: number; inside: number }[];
  latest: { at: string; checkpoint: string; door: string | null; result: string; holder_name: string | null; kind: string | null; staff: string; manual: boolean }[];
};

export default async function LiveSeating({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff('live_seating');
  const get = await readParams(searchParams);
  const ceremonies = await getCeremonies(staff.season.id);
  const c = ceremonies.find((x) => String(x.id) === get('c')) ?? ceremonies[0];
  if (!c) return <Empty>No ceremonies in this season.</Empty>;
  const live = await fn<Live>('live_stats', [c.id]);
  const cp = (x: string, d: string | null) => (x === 'door1' ? 'Door 1' : x === 'graduate' ? 'Graduate entrance' : d ?? 'Door 2');

  return (
    <>
      <div className="row between">
        <h1>Live Seating</h1>
        <AutoRefresh seconds={3} />
      </div>
      <form method="get" className="inline" style={{ marginBottom: 14 }}>
        <select name="c" defaultValue={String(c.id)} aria-label="Ceremony">
          {ceremonies.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
        </select>
        <button className="btn ghost sm">Show</button>
      </form>
      <div className="grid four">
        <Kpi label="Graduates arrived" value={`${live.graduates_in} / ${live.graduates_total}`} />
        <Kpi label="Guests in the hall (Door 2)" value={`${live.guests_in} / ${live.guests_total}`} />
        <Kpi label="Guests through Door 1" value={live.guests_door1} />
        <Kpi label="Guests still to arrive" value={live.guests_total - live.guests_in} sub={`${live.refused} refused scans`} />
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <div className="hall">
          <div className="stage">STAGE</div>
          <div className="gradblock">Graduates in: {live.graduates_in} of {live.graduates_total}</div>
          <div className="zones">
            {live.zones.map((z) => (
              <div className="zone" key={z.id} style={{ cursor: 'default', borderColor: z.inside ? z.color : undefined }}>
                <div><span className="sw" style={{ background: z.color }} />{z.name} · {z.door}</div>
                <div className="left">{z.inside}<span className="small muted"> / {z.sold}</span></div>
                <div className="small muted">guests in the hall / tickets</div>
                <Bar capacity={Math.max(z.sold, 1)} sold={z.sold} inside={z.inside} />
              </div>
            ))}
          </div>
        </div>
      </section>
      <h2 style={{ marginTop: 18 }}>Latest scans</h2>
      {live.latest.length === 0 ? <Empty>No scans yet.</Empty> : (
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Time</th><th>Checkpoint</th><th>Name</th><th>Result</th><th>By</th></tr></thead>
            <tbody>
              {live.latest.map((s, i) => (
                <tr key={i}>
                  <td>{fmtTime(s.at)}</td><td>{cp(s.checkpoint, s.door)}</td><td>{s.holder_name ?? '—'} {s.kind ? <span className="small muted">({s.kind})</span> : null}</td>
                  <td><span className={`pill ${s.result === 'admit' ? 'ok' : s.result === 'already_used' ? 'warn' : 'bad'}`}>{RESULT_LABEL[s.result] ?? s.result}{s.manual ? ' · manual' : ''}</span></td>
                  <td className="small">{s.staff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
