// Small server-rendered building blocks shared by the public site and the back office.
import Link from 'next/link';
import type { ReactNode } from 'react';

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export async function readParams(sp: SearchParams) {
  const p = await sp;
  return (k: string) => {
    const v = p[k];
    return (Array.isArray(v) ? v[0] : v ?? '').slice(0, 300);
  };
}

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  return (
    <>
      {msg ? <div className="flash ok" role="status">{msg}</div> : null}
      {err ? <div className="flash err" role="alert">{err}</div> : null}
    </>
  );
}

export const Back = ({ to }: { to: string }) => <input type="hidden" name="_back" value={to} />;

export function Tabs({ base, tabs, current, keep = {} }: { base: string; tabs: [string, string][]; current: string; keep?: Record<string, string> }) {
  return (
    <nav className="tabs" aria-label="Sections">
      {tabs.map(([k, label]) => {
        const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(keep).filter(([, v]) => v)), tab: k });
        return (
          <Link key={k} href={`${base}?${q}`} aria-current={current === k ? 'page' : undefined}>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SearchBar({ action, q, label = 'Search MISIS', placeholder = 'MISIS, e.g. M00123456', hidden = {} }: {
  action: string; q: string; label?: string; placeholder?: string; hidden?: Record<string, string>;
}) {
  return (
    <form className="searchbar" action={action} method="get" role="search">
      <label htmlFor="q">{label}</label>
      {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
      <input id="q" name="q" defaultValue={q} placeholder={placeholder} autoComplete="off" />
      <button className="btn sm">Show</button>
      {q ? <Link className="btn ghost sm" href={`${action}?${new URLSearchParams(Object.fromEntries(Object.entries(hidden).filter(([, v]) => v)))}`}>Clear</Link> : null}
    </form>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <div className="l">{label}</div>
      <div className="v">{value}</div>
      {sub ? <div className="small muted">{sub}</div> : null}
    </div>
  );
}

export function Bar({ capacity, sold, held = 0, inside }: { capacity: number; sold: number; held?: number; inside?: number }) {
  const pct = (n: number) => `${capacity ? Math.min(100, (n / capacity) * 100) : 0}%`;
  return (
    <div className="bar" role="img" aria-label={`${sold} sold${held ? `, ${held} held` : ''} of ${capacity}`}>
      {inside !== undefined ? <span className="in" style={{ width: pct(inside) }} /> : null}
      <span className="sold" style={{ width: pct(inside !== undefined ? Math.max(0, sold - inside) : sold) }} />
      {held ? <span className="held" style={{ width: pct(held) }} /> : null}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="muted center" style={{ padding: 18 }}>{children}</p>;
}

export function YesNo({ v, yes = 'Yes', no = 'No', bad = false }: { v: boolean; yes?: string; no?: string; bad?: boolean }) {
  return <span className={`pill ${v ? (bad ? 'bad' : 'ok') : ''}`}>{v ? yes : no}</span>;
}
