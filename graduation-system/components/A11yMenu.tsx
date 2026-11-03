'use client';
import { useEffect, useRef, useState } from 'react';

const OPTIONS = [
  { key: 'a-large', title: 'Larger text', desc: 'Makes all text and buttons bigger.' },
  { key: 'a-contrast', title: 'Increase contrast', desc: 'Darker text and stronger lines.' },
  { key: 'a-reduce', title: 'Reduce motion', desc: 'Turns off animations.' },
];

export default function A11yMenu({ className = 'link' }: { className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [on, setOn] = useState<Record<string, boolean>>({});

  useEffect(() => {
    try {
      setOn(JSON.parse(localStorage.getItem('a11y') || '{}') as Record<string, boolean>);
    } catch {}
  }, []);

  useEffect(() => {
    OPTIONS.forEach((o) => document.documentElement.classList.toggle(o.key, !!on[o.key]));
    try {
      localStorage.setItem('a11y', JSON.stringify(on));
    } catch {}
  }, [on]);

  return (
    <>
      <button className={className} type="button" aria-haspopup="dialog" onClick={() => ref.current?.showModal()}>
        <span aria-hidden="true">♿︎</span> Accessibility
      </button>
      <dialog ref={ref} aria-labelledby="a11y-title">
        <div className="dlg">
          <h2 id="a11y-title">Accessibility</h2>
          <p className="muted small">Works with screen readers and the keyboard (Tab, Enter, Space).</p>
          {OPTIONS.map((o) => (
            <div className="setrow" key={o.key}>
              <div>
                <strong>{o.title}</strong>
                <div className="small muted">{o.desc}</div>
              </div>
              <input
                type="checkbox"
                role="switch"
                aria-label={o.title}
                checked={!!on[o.key]}
                onChange={(e) => setOn((p) => ({ ...p, [o.key]: e.target.checked }))}
              />
            </div>
          ))}
          <p className="small" style={{ marginTop: 14 }}>
            People of Determination can book a wheelchair space with a companion place next to it when choosing a zone.
          </p>
          <button className="btn block" type="button" onClick={() => ref.current?.close()} style={{ marginTop: 12 }}>
            Done
          </button>
        </div>
      </dialog>
    </>
  );
}
