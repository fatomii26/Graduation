'use client';
import { useEffect, useMemo, useState } from 'react';
import Submit from './Submit';
import type { ZoneAvailability } from '@/lib/settings';

type Access = 'none' | 'wheelchair' | 'companion';
type Guest = { name: string; access: Access; assist: boolean };

const aed = (n: number) => `AED ${n.toLocaleString('en-US')}`;

export default function ZonePicker(props: {
  ceremonyId: number;
  zones: ZoneAvailability[];
  zoneSelection: boolean;
  maxGuests: number;
  fixedGuests?: number;
  includesGraduate: boolean;
  gradPrice: number;
  guestPrice: number;
  showPrice: boolean;
  holdMinutes: number;
  kind: 'main' | 'extra' | 'receipt';
  code?: string;
  receipt?: string;
  submitLabel: string;
  action: (fd: FormData) => void | Promise<void>;
}) {
  const fixed = props.fixedGuests !== undefined;
  const [count, setCount] = useState(fixed ? props.fixedGuests! : Math.min(1, props.maxGuests));
  const [guests, setGuests] = useState<Guest[]>([]);
  const [zones, setZones] = useState(props.zones);
  const [primary, setPrimary] = useState<number | null>(null);
  const [second, setSecond] = useState<number | null>(null);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    setGuests((g) => Array.from({ length: count }, (_, i) => g[i] ?? { name: '', access: 'none', assist: false }));
  }, [count]);

  // Live places-left counts (polling every 3 seconds)
  useEffect(() => {
    if (!props.zoneSelection) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch(`/api/zones?ceremony=${props.ceremonyId}`, { cache: 'no-store' });
        if (r.ok && alive) setZones((await r.json()) as ZoneAvailability[]);
      } catch {}
    };
    const t = setInterval(() => document.visibilityState === 'visible' && tick(), 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [props.ceremonyId, props.zoneSelection]);

  const wheel = guests.filter((g) => g.access === 'wheelchair').length;
  const comp = guests.filter((g) => g.access === 'companion').length;
  const p = zones.find((z) => z.id === primary) ?? null;
  const needSplit = !!p && count > 0 && p.left < count;
  const firstPart = needSplit ? p!.left : count;
  const rest = count - firstPart;
  const s = zones.find((z) => z.id === second) ?? null;

  // Guests needing a wheelchair space or a companion place go first, so they sit together in the first zone.
  const assignment = useMemo(() => {
    const order = guests.map((g, i) => ({ g, i })).sort((a, b) => (a.g.access === 'none' ? 1 : 0) - (b.g.access === 'none' ? 1 : 0));
    const zoneOf: (number | null)[] = Array(guests.length).fill(null);
    order.forEach(({ i }, k) => (zoneOf[i] = k < firstPart ? primary : second));
    return zoneOf;
  }, [guests, firstPart, primary, second]);

  const total = (props.includesGraduate ? props.gradPrice : 0) + count * props.guestPrice;

  function validate(): string {
    if (guests.some((g) => g.name.trim().length < 2)) return 'Enter the full name of every guest.';
    if (comp > wheel) return 'A companion place goes next to a wheelchair space: add the wheelchair guest first.';
    if (count > 0 && props.zoneSelection) {
      if (!p) return 'Choose a zone for your guests.';
      if (wheel > p.wheelchair_left) return `${p.name} has ${p.wheelchair_left} wheelchair space(s) left. Choose another zone.`;
      if (needSplit && !s) return 'Choose a zone for the remaining guests.';
      if (needSplit && s && s.left < rest) return `${s.name} does not have enough places for the remaining guests.`;
    }
    if (!fixed && count === 0 && !props.includesGraduate) return 'Choose at least one ticket.';
    return '';
  }

  const payload = JSON.stringify(
    guests.map((g, i) => ({ name: g.name.trim(), access: g.access, assist: g.assist, zone_id: props.zoneSelection ? assignment[i] : null })),
  );

  return (
    <form
      action={props.action}
      onSubmit={(e) => {
        const v = validate();
        setProblem(v);
        if (v) e.preventDefault();
      }}
      className="stack"
    >
      <input type="hidden" name="kind" value={props.kind === 'extra' ? 'extra' : 'main'} />
      {props.code ? <input type="hidden" name="code" value={props.code} /> : null}
      {props.receipt ? <input type="hidden" name="receipt" value={props.receipt} /> : null}
      <input type="hidden" name="guests" value={payload} />

      <section className="card">
        <h2>1. Tickets</h2>
        {props.includesGraduate ? (
          <p>
            <span className="pill gold">Graduate ticket</span> included{props.showPrice ? ` · ${aed(props.gradPrice)}` : ''}. Graduates are seated by the University on the day.
          </p>
        ) : null}
        {fixed ? (
          <p>Guest tickets paid for: <strong>{props.fixedGuests}</strong></p>
        ) : (
          <>
            <label className="f" htmlFor="count">Number of guest tickets</label>
            <select id="count" value={count} onChange={(e) => setCount(Number(e.target.value))} style={{ maxWidth: 220 }}>
              {Array.from({ length: props.maxGuests + 1 }, (_, n) => (
                <option key={n} value={n}>{n} guest{n === 1 ? '' : 's'}{props.showPrice && n ? ` (${aed(n * props.guestPrice)})` : ''}</option>
              ))}
            </select>
            <div className="hint">You can buy up to {props.maxGuests} more guest ticket(s). Children under 4 do not need a ticket.</div>
          </>
        )}
      </section>

      {count > 0 && (
        <section className="card">
          <h2>2. Guest names</h2>
          <p className="small muted">Each guest gets their own e-ticket with their name and QR code.</p>
          {guests.map((g, i) => (
            <div className="guest-row" key={i} style={{ marginBottom: 10 }}>
              <div>
                <label className="f" htmlFor={`g${i}`}>Guest {i + 1} full name</label>
                <input id={`g${i}`} value={g.name} maxLength={120} autoComplete="off"
                  onChange={(e) => setGuests((all) => all.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} />
              </div>
              <div>
                <label className="f" htmlFor={`a${i}`}>Seating need</label>
                <select id={`a${i}`} value={g.access}
                  onChange={(e) => setGuests((all) => all.map((x, k) => (k === i ? { ...x, access: e.target.value as Access } : x)))}>
                  <option value="none">Standard place</option>
                  <option value="wheelchair">Wheelchair space</option>
                  <option value="companion">Companion place</option>
                </select>
              </div>
              <label className="check" style={{ marginBottom: 10 }}>
                <input type="checkbox" checked={g.assist}
                  onChange={(e) => setGuests((all) => all.map((x, k) => (k === i ? { ...x, assist: e.target.checked } : x)))} />
                Needs assistance
              </label>
            </div>
          ))}
        </section>
      )}

      {count > 0 && props.zoneSelection && (
        <section className="card">
          <h2>3. Choose your guests&apos; zone</h2>
          <p className="small muted">
            First come, first served. Places left are updated every few seconds. Your places are held for {props.holdMinutes} minutes while you pay.
          </p>
          <div className="hall">
            <div className="stage">STAGE</div>
            <div className="gradblock">Graduates (front block) · seated by the University on the day</div>
            <div className="zones" role="group" aria-label="Zones">
              {zones.map((z) => (
                <button key={z.id} type="button" className="zone" aria-pressed={primary === z.id} disabled={z.left === 0}
                  onClick={() => { setPrimary(z.id); setSecond(null); setProblem(''); }}>
                  <div><span className="sw" style={{ background: z.color }} />{z.name}</div>
                  <div className="left">{z.left}</div>
                  <div className="small muted">places left · {z.door}</div>
                  {z.wheelchair_capacity > 0 ? <div className="small">♿︎ {z.wheelchair_left} wheelchair space(s) left</div> : null}
                </button>
              ))}
            </div>
          </div>
          {needSplit && (
            <div className="flash warn" role="alert" style={{ marginTop: 14 }}>
              <strong>{p!.name} has only {p!.left} place{p!.left === 1 ? '' : 's'} left, so your group cannot all sit together in one zone.</strong>{' '}
              {p!.left > 0 ? `${firstPart} guest${firstPart === 1 ? '' : 's'} will sit in ${p!.name}. ` : ''}
              Choose a zone for the other {rest} guest{rest === 1 ? '' : 's'}, or pick a zone with enough places for everyone.
              <div className="zones" style={{ marginTop: 10 }}>
                {zones.filter((z) => z.id !== primary).map((z) => (
                  <button key={z.id} type="button" className="zone" aria-pressed={second === z.id} disabled={z.left < rest} onClick={() => setSecond(z.id)}>
                    <div><span className="sw" style={{ background: z.color }} />{z.name}</div>
                    <div className="left">{z.left}</div>
                    <div className="small muted">places left · {z.door}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      <section className="card">
        {props.showPrice ? (
          <p style={{ fontSize: '1.2rem' }}>Total: <strong>{aed(total)}</strong></p>
        ) : (
          <p>Already paid. Your e-tickets are issued as soon as you confirm.</p>
        )}
        {problem ? <div className="flash err" role="alert">{problem}</div> : null}
        <Submit className="btn block">{props.submitLabel}</Submit>
      </section>
    </form>
  );
}
