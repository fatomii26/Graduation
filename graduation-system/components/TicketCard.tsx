import type { ReactNode } from 'react';
import type { TicketView } from '@/lib/types';

export default function TicketCard({ t, actions, banner }: { t: TicketView; actions?: ReactNode; banner?: ReactNode }) {
  return (
    <article className={`ticket ${t.kind === 'graduate' ? 'grad' : ''} ${t.status === 'void' ? 'void' : ''}`} aria-label={`${t.label} ticket for ${t.holder}`}>
      <div className="top">
        <span>MDX Dubai · Graduation</span>
        <span>{t.label}</span>
      </div>
      <div className="band" style={{ background: t.zoneColor }} />
      <div className="body">
        {banner}
        <div className="holder">{t.holder}</div>
        <div className="small muted">{t.kind === 'guest' ? `Guest of ${t.graduateName}` : `${t.programme} · MISIS ${t.misis}`}</div>
        <dl>
          <dt>Ceremony</dt><dd>{t.ceremony}</dd>
          <dt>When</dt><dd>{t.when}{t.doorsOpen ? ` · doors open ${t.doorsOpen}` : ''}</dd>
          <dt>Venue</dt><dd>{t.venue}</dd>
          <dt>{t.kind === 'guest' ? 'Zone' : 'Seating'}</dt><dd>{t.zone}</dd>
          <dt>Door</dt><dd>{t.kind === 'guest' ? `Door 1, then ${t.door}` : t.door}</dd>
        </dl>
        {t.needsAssistance ? <p className="small"><span className="pill info">♿︎ Assistance requested</span></p> : null}
        <p className="small muted" style={{ margin: 0 }}>{t.doorText}</p>
      </div>
      <div className="qr" dangerouslySetInnerHTML={{ __html: t.qrSvg }} aria-label="QR code" role="img" />
      <div className="small muted center" style={{ marginTop: -6, marginBottom: 10 }}>Ref {t.id.slice(0, 8).toUpperCase()}</div>
      {actions ? <div className="acts">{actions}</div> : null}
    </article>
  );
}
