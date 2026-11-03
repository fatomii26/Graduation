import type { StudentSummary } from '@/lib/admin-queries';
import { errorText } from '@/lib/errors';

/** The search result panel shown on most back-office pages for one MISIS */
export default function StudentCard({ s, children }: { s: StudentSummary; children?: React.ReactNode }) {
  return (
    <section className="card" style={{ marginBottom: 16 }}>
      <div className="row between">
        <div>
          <h2 style={{ marginBottom: 2 }}>{s.full_name}</h2>
          <div className="small muted">
            MISIS <strong>{s.misis}</strong> · {s.programme || 'No programme'} · {s.email}
            {s.private_email ? ` · ${s.private_email}` : ''}
            {s.mobile ? ` · ${s.mobile}` : ''}
          </div>
        </div>
        <div className="row">
          <span className={`pill ${s.confirmed_graduate ? 'ok' : 'warn'}`}>{s.confirmed_graduate ? 'Confirmed graduate' : 'Potential graduate'}</span>
          {s.financial_hold ? <span className="pill bad">Financial hold</span> : <span className="pill ok">No hold</span>}
          <span className="pill info">{s.ceremony_name ?? 'Not allocated'}</span>
        </div>
      </div>
      <div className="row small" style={{ marginTop: 10 }}>
        <span>Graduate ticket: <strong>{s.grad_ticket ? 'issued' : s.grad_arranged ? 'paid / on the way' : 'none'}</strong></span>
        <span>Guest tickets: <strong>{s.guest_tickets}</strong></span>
        <span>Guest limit: <strong>{s.allowance}</strong> ({s.committed} used or on the way)</span>
        {s.hold_reason ? <span>Hold: <strong>{s.hold_reason}</strong></span> : null}
      </div>
      {s.eligibility ? <div className="flash warn" style={{ marginTop: 10, marginBottom: 0 }}>Cannot buy: {errorText(s.eligibility)}</div> : null}
      {children ? <div style={{ marginTop: 12 }}>{children}</div> : null}
    </section>
  );
}
