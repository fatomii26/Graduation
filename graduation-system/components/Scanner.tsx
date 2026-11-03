'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

type Option = { id: number; name: string; doors: string[] };
type Result = {
  ok: boolean;
  result?: string;
  error?: string;
  holder_name?: string;
  kind?: string;
  zone?: string;
  zone_color?: string;
  door?: string;
  ceremony?: string;
  access?: string;
  needs_assistance?: boolean;
  used_at?: string;
  used_where?: string;
  missed_door1?: boolean;
};

const KEY = 'grad-scanner-checkpoint';
const time = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { timeZone: 'Asia/Dubai', hour: '2-digit', minute: '2-digit' }) : '');

export default function Scanner({ options, staff }: { options: Option[]; staff: string }) {
  const [cer, setCer] = useState<number>(options[0]?.id ?? 0);
  const [point, setPoint] = useState<string>('door1'); // 'door1' | 'graduate' | 'door2:<door>'
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { cer?: number; point?: string } | null;
      if (v?.cer && options.some((o) => o.id === v.cer)) setCer(v.cer);
      if (v?.point) setPoint(v.point);
    } catch {}
  }, [options]);
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ cer, point }));
    } catch {}
  }, [cer, point]);

  const opt = options.find((o) => o.id === cer) ?? options[0];
  const cfg = useRef({ cer, point });
  cfg.current = { cer, point };
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const last = useRef<{ text: string; at: number }>({ text: '', at: 0 });
  const [running, setRunning] = useState(false);
  const [camError, setCamError] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [manual, setManual] = useState('');
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  const submit = useCallback(async (text: string) => {
    const { cer: c, point: p } = cfg.current;
    const checkpoint = p.startsWith('door2:') ? 'door2' : p;
    const door = p.startsWith('door2:') ? p.slice(6) : null;
    setBusy(true);
    try {
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: text, ceremony: c, checkpoint, door }),
      });
      const r = (await res.json()) as Result;
      setResult(r);
      if (r.result === 'admit') setCount((n) => n + 1);
      try {
        navigator.vibrate?.(r.ok ? 80 : [80, 60, 80]);
      } catch {}
    } catch {
      setResult({ ok: false, result: 'network' });
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
        const v = video.current!;
        v.srcObject = stream;
        await v.play();
        canvas.current ??= document.createElement('canvas');
        const tick = () => {
          if (stopped) return;
          if (v.readyState === v.HAVE_ENOUGH_DATA) {
            const c = canvas.current!;
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            const ctx = c.getContext('2d', { willReadFrequently: true })!;
            ctx.drawImage(v, 0, 0, c.width, c.height);
            const img = ctx.getImageData(0, 0, c.width, c.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
            if (code?.data) {
              const t = Date.now();
              if (code.data !== last.current.text || t - last.current.at > 4000) {
                last.current = { text: code.data, at: t };
                submit(code.data);
              }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setCamError('Camera unavailable. Allow camera access, or paste the ticket link below.');
        setRunning(false);
      }
    })();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [running, submit]);

  const r = result?.result;
  const tone = !result ? '' : result.ok ? 'ok' : r === 'already_used' ? 'warn' : 'bad';
  const headline = !result ? ''
    : r === 'admit' ? 'Admit'
    : r === 'already_used' ? 'Already used'
    : r === 'wrong_ceremony' ? 'Wrong ceremony'
    : r === 'void' || r === 'replaced' ? 'Void or replaced'
    : r === 'not_found' ? 'Not found'
    : r === 'wrong_door' ? 'Wrong door'
    : r === 'wrong_entrance' ? 'Guest ticket: use Door 1'
    : r === 'bad_checkpoint' ? 'Choose the ceremony and checkpoint'
    : r === 'forbidden' ? 'Not allowed'
    : r === 'network' ? 'No connection: try again'
    : 'Not a valid ticket';
  const detail = !result ? ''
    : r === 'already_used' ? `Used at ${time(result.used_at)} at ${result.used_where}`
    : r === 'wrong_ceremony' ? `This ticket is for ${result.ceremony}`
    : r === 'wrong_door' ? `Send the guest to ${result.door}`
    : r === 'replaced' ? 'A new ticket was issued. Ask for the new QR code.'
    : r === 'admit' && result.missed_door1 ? 'Note: not scanned at Door 1'
    : '';

  return (
    <div className="stack" style={{ maxWidth: 620 }}>
      <section className="card">
        <div className="small muted" style={{ marginBottom: 8 }}>Ceremony</div>
        <div className="cp" role="group" aria-label="Ceremony">
          {options.map((o) => <button key={o.id} type="button" aria-pressed={o.id === cer} onClick={() => setCer(o.id)}>{o.name}</button>)}
        </div>
        <div className="small muted" style={{ margin: '14px 0 8px' }}>Checkpoint</div>
        <div className="cp" role="group" aria-label="Checkpoint">
          <button type="button" aria-pressed={point === 'door1'} onClick={() => setPoint('door1')}>Door 1 · venue entrance</button>
          <button type="button" aria-pressed={point === 'graduate'} onClick={() => setPoint('graduate')}>Graduate entrance</button>
          {opt?.doors.map((d) => (
            <button key={d} type="button" aria-pressed={point === `door2:${d}`} onClick={() => setPoint(`door2:${d}`)}>{d}</button>
          ))}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          {point === 'door1' ? 'Each guest ticket works once here. Graduate tickets always work.'
            : point === 'graduate' ? 'Graduate tickets only. Guests are sent to Door 1.'
            : `Hall door for ${point.slice(6)}: each guest ticket for this zone works once.`} · Signed in as {staff}
        </p>
      </section>
      <div className="scanbox"><video ref={video} playsInline muted aria-label="Camera preview" /></div>
      <div className="row" style={{ justifyContent: 'center' }}>
        <button className="btn" type="button" onClick={() => setRunning((x) => !x)}>{running ? 'Stop camera' : 'Start camera'}</button>
        <span className="pill ok">{count} admitted on this device</span>
        {busy ? <span className="small muted">Checking…</span> : null}
      </div>
      {camError ? <div className="flash err">{camError}</div> : null}
      {result ? (
        <div className={`result ${tone}`} role="alert">
          <div className="big">{headline}</div>
          {result.holder_name ? <div style={{ fontSize: '1.3rem', marginTop: 6 }}>{result.holder_name}</div> : null}
          {result.kind ? <div>{result.kind === 'graduate' ? 'Graduate' : `Guest · ${result.zone ?? ''} · ${result.door ?? ''}`}</div> : null}
          {result.access && result.access !== 'none' ? <div>♿︎ {result.access === 'wheelchair' ? 'Wheelchair space' : 'Companion place'}</div> : null}
          {result.needs_assistance ? <div>Assistance requested</div> : null}
          {detail ? <div style={{ marginTop: 6 }}>{detail}</div> : null}
        </div>
      ) : null}
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (manual.trim()) submit(manual.trim());
          setManual('');
        }}
      >
        <label className="f" htmlFor="manual" style={{ marginTop: 0 }}>No camera? Paste or type the ticket link or code</label>
        <input id="manual" value={manual} onChange={(e) => setManual(e.target.value)} autoComplete="off" />
        <button className="btn secondary" style={{ marginTop: 10 }}>Check ticket</button>
      </form>
      <p className="small muted">Scanning needs internet: every scan is checked by the server so a guest can enter each door only once.</p>
    </div>
  );
}
