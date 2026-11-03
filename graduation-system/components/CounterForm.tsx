import type { StudentSummary } from '@/lib/admin-queries';
import type { SeasonSettings } from '@/lib/settings';
import { aed } from '@/lib/format';
import Submit from './Submit';
import { Back } from './ui';

/** Over-the-counter payment (Finance Office or Graduation Day): Finance records what was actually purchased. */
export default function CounterForm({
  s, settings, source, back, action,
}: { s: StudentSummary; settings: SeasonSettings; source: 'counter' | 'graduation_day'; back: string; action: (fd: FormData) => void | Promise<void> }) {
  const canGuests = Math.max(0, s.allowance - s.committed);
  const gradNeeded = !s.grad_arranged;
  if (s.eligibility && !['sales_closed', 'season_closed'].includes(s.eligibility)) return null;
  if (!gradNeeded && canGuests === 0) return <div className="flash info">This student already has every ticket they are allowed.</div>;
  return (
    <form action={action} className="card flat">
      <Back to={back} />
      <input type="hidden" name="misis" value={s.misis} />
      <input type="hidden" name="source" value={source} />
      <h3>Record a payment</h3>
      <label className="check">
        <input type="checkbox" name="graduate" defaultChecked={gradNeeded} disabled={!gradNeeded} />
        Graduate ticket · {aed(settings.graduate_price_aed)} {gradNeeded ? '(required first)' : '(already arranged)'}
      </label>
      {gradNeeded ? <input type="hidden" name="graduate" value="on" /> : null}
      <div className="grid">
        <div>
          <label className="f" htmlFor="guests">Guest tickets · {aed(settings.guest_price_aed)} each</label>
          <select id="guests" name="guests" defaultValue="0">
            {Array.from({ length: canGuests + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div>
          <label className="f" htmlFor="method">Method</label>
          <select id="method" name="method" defaultValue="Card at Desk">
            <option>Card at Desk</option>
            <option>Cash</option>
            <option>QR Online Payment</option>
            <option>Bank Transfer</option>
          </select>
        </div>
        <div>
          <label className="f" htmlFor="amount">Amount received (AED)</label>
          <input id="amount" name="amount" inputMode="decimal" placeholder="checked against the price" />
          <div className="hint">Leave empty to use the price. A different amount is refused.</div>
        </div>
        <div>
          <label className="f" htmlFor="payer_name">Paid by (if not the student)</label>
          <input id="payer_name" name="payer_name" maxLength={120} />
        </div>
      </div>
      <div style={{ marginTop: 12 }}>
        <Submit confirm="Record this payment and email a receipt number to the student?">Record payment and create receipt</Submit>
      </div>
    </form>
  );
}
