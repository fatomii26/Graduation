'use client';
import { useEffect, useRef, useState } from 'react';
import TicketCard from './TicketCard';
import Submit from './Submit';
import { saveTicketImage, ticketFile } from './ticketImage';
import type { TicketView } from '@/lib/types';

type ServerAction = (fd: FormData) => void | Promise<void>;

async function copy(s: string) {
  try {
    await navigator.clipboard.writeText(s);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = s;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return { ref, onClose };
}

export default function TicketWallet(props: {
  tickets: TicketView[];
  hasPrivateEmail: boolean;
  nameChanges: boolean;
  pendingNameTickets: string[];
  emailAction: ServerAction;
  nameAction: ServerAction;
}) {
  const [share, setShare] = useState<TicketView | null>(null);
  const [mail, setMail] = useState<TicketView | null>(null);
  const [rename, setRename] = useState<TicketView | null>(null);
  const [note, setNote] = useState('');
  const [canNative, setCanNative] = useState(false);
  useEffect(() => setCanNative(typeof navigator !== 'undefined' && !!navigator.share), []);
  const s = useDialog(!!share, () => setShare(null));
  const m = useDialog(!!mail, () => setMail(null));
  const r = useDialog(!!rename, () => setRename(null));

  const text = (t: TicketView) => `${t.holder}: your ticket for ${t.ceremony}, ${t.when}.`;

  async function native(t: TicketView) {
    try {
      const f = await ticketFile(t);
      if (navigator.canShare?.({ files: [f] })) await navigator.share({ files: [f], title: 'Graduation e-ticket', text: `${text(t)}\n${t.url}` });
      else await navigator.share({ title: 'Graduation e-ticket', text: text(t), url: t.url });
    } catch {}
  }

  return (
    <>
      <div className="tickets">
        {props.tickets.map((t) => (
          <TicketCard
            key={t.id}
            t={t}
            banner={props.pendingNameTickets.includes(t.id) ? <p><span className="pill warn">Name change waiting for approval</span></p> : null}
            actions={
              <>
                <button className="btn sm" type="button" onClick={() => { setNote(''); setShare(t); }}>Share</button>
                <button className="btn secondary sm" type="button" onClick={() => setMail(t)}>Email</button>
                <button className="btn ghost sm" type="button" onClick={() => saveTicketImage(t)}>Save image</button>
                {t.kind === 'guest' && props.nameChanges && !props.pendingNameTickets.includes(t.id) ? (
                  <button className="btn ghost sm" type="button" onClick={() => setRename(t)}>Change name</button>
                ) : null}
              </>
            }
          />
        ))}
      </div>

      <dialog ref={s.ref} onClose={s.onClose} aria-labelledby="share-title">
        {share ? (
          <div className="dlg">
            <h2 id="share-title">Share {share.holder}&apos;s ticket</h2>
            <p className="small muted">Anyone with this link can view this one ticket. Only staff at the doors can admit it.</p>
            <div className="sheet-grid">
              {canNative ? <button className="sopt" type="button" onClick={() => native(share)}><i style={{ background: '#636366' }}>↑</i>Share…</button> : null}
              <a className="sopt" href={`https://wa.me/?text=${encodeURIComponent(`${text(share)}\n${share.url}`)}`} target="_blank" rel="noopener noreferrer"><i style={{ background: '#25d366' }}>W</i>WhatsApp</a>
              <a className="sopt" href={`sms:?&body=${encodeURIComponent(`${text(share)} ${share.url}`)}`}><i style={{ background: '#34c759' }}>SMS</i>Messages</a>
              <a className="sopt" href={`mailto:?subject=${encodeURIComponent('Your graduation e-ticket')}&body=${encodeURIComponent(`${text(share)}\n${share.url}`)}`}><i style={{ background: '#0a84ff' }}>@</i>Email app</a>
              <button className="sopt" type="button" onClick={async () => { await copy(share.url); setNote('Link copied.'); }}><i style={{ background: '#1f3a5f' }}>⧉</i>Copy link</button>
              <button className="sopt" type="button" onClick={() => saveTicketImage(share)}><i style={{ background: '#1f1a1c' }}>↓</i>Save image</button>
            </div>
            <p className="small" role="status" style={{ marginTop: 10 }}>{note}</p>
            <button className="btn ghost block" type="button" onClick={() => setShare(null)}>Done</button>
          </div>
        ) : null}
      </dialog>

      <dialog ref={m.ref} onClose={m.onClose} aria-labelledby="mail-title">
        {mail ? (
          <form className="dlg" action={props.emailAction}>
            <h2 id="mail-title">Email {mail.holder}&apos;s ticket</h2>
            <input type="hidden" name="ticket" value={mail.id} />
            <label className="check"><input type="radio" name="to" value="mdx" defaultChecked /> My MDX email</label>
            {props.hasPrivateEmail ? <label className="check"><input type="radio" name="to" value="private" /> My private email</label> : null}
            <label className="check"><input type="radio" name="to" value="other" /> Another address (for example, the guest)</label>
            <input name="address" type="email" placeholder="guest@example.com" maxLength={200} />
            <div className="row" style={{ marginTop: 14 }}>
              <Submit>Send</Submit>
              <button className="btn ghost" type="button" onClick={() => setMail(null)}>Cancel</button>
            </div>
          </form>
        ) : null}
      </dialog>

      <dialog ref={r.ref} onClose={r.onClose} aria-labelledby="name-title">
        {rename ? (
          <form className="dlg" action={props.nameAction}>
            <h2 id="name-title">Request a name change</h2>
            <p className="small muted">Marketing reviews each request. If approved, this ticket is replaced by a new one with a new QR code, in the same zone.</p>
            <input type="hidden" name="ticket" value={rename.id} />
            <label className="f" htmlFor="nn">Current name</label>
            <input id="nn" value={rename.holder} disabled />
            <label className="f" htmlFor="new_name">New full name</label>
            <input id="new_name" name="new_name" required minLength={2} maxLength={120} />
            <label className="f" htmlFor="reason">Reason</label>
            <input id="reason" name="reason" maxLength={300} placeholder="e.g. spelling, or a different guest" />
            <div className="row" style={{ marginTop: 14 }}>
              <Submit>Send request</Submit>
              <button className="btn ghost" type="button" onClick={() => setRename(null)}>Cancel</button>
            </div>
          </form>
        ) : null}
      </dialog>
    </>
  );
}
