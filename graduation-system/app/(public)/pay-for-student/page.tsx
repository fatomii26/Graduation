import { fn, one } from '@/lib/db';
import { clientIp } from '@/lib/auth/session';
import { currentPublicSeason, getSeasonSettings } from '@/lib/settings';
import { errorText } from '@/lib/errors';
import { aed, normMisis } from '@/lib/format';
import Submit from '@/components/Submit';
import { Flash, readParams, type SearchParams } from '@/components/ui';
import { thirdPartyAction } from '../actions';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).map((p) => `${p[0]}.`).join(' ');

export default async function PayForStudent({ searchParams }: { searchParams: SearchParams }) {
  const get = await readParams(searchParams);
  const misis = normMisis(get('misis'));
  const season = await currentPublicSeason();
  const settings = season ? await getSeasonSettings(season.id) : null;

  let found: { initials: string; why: string | null; gradNeeded: boolean; canBuy: number } | null = null;
  let lookupError = '';
  if (season && misis) {
    if (!(await fn<boolean>('rate_limit_hit', [`lookup:${await clientIp()}`, 30, 3600]))) lookupError = errorText('rate_limited');
    else {
      const g = await one<{ full_name: string; why: string | null; arranged: boolean; allowance: number; committed: number }>(
        `select full_name, eligibility($1, misis) as why, graduate_ticket_arranged($1, misis) as arranged,
                coalesce(guest_allowance($1, misis), 0) as allowance, guests_committed($1, misis) as committed
           from graduates where season_id = $1 and misis = $2`,
        [season.id, misis],
      );
      if (!g) lookupError = errorText('not_on_master_list');
      else found = { initials: initials(g.full_name), why: g.why, gradNeeded: !g.arranged, canBuy: Math.max(0, g.allowance - g.committed) };
    }
  }

  return (
    <div className="narrow">
      <h1>Pay for a student</h1>
      <p className="muted">
        For parents, guardians and sponsors. You pay online; the student is told by email and then chooses the zone and guest names.
        You receive a receipt. You will not see seats or tickets unless the student shares them.
      </p>
      <Flash msg={get('msg')} err={get('err') || lookupError} />
      <div className="card">
        <form method="get" action="/pay-for-student" className="inline">
          <label className="f" htmlFor="misis" style={{ margin: 0 }}>Student&apos;s MISIS</label>
          <input id="misis" name="misis" defaultValue={misis} placeholder="e.g. M00123456" required />
          <button className="btn secondary">Find student</button>
        </form>
      </div>

      {found && settings ? (
        found.why ? (
          <div className="flash err" style={{ marginTop: 16 }}>{errorText(found.why)}</div>
        ) : !found.gradNeeded && found.canBuy === 0 ? (
          <div className="flash info" style={{ marginTop: 16 }}>This student already has all the tickets they are allowed.</div>
        ) : (
          <form action={thirdPartyAction} className="card" style={{ marginTop: 16 }}>
            <input type="hidden" name="misis" value={misis} />
            <p>Student: <strong>{found.initials}</strong> (MISIS {misis})</p>
            <label className="check">
              <input type="checkbox" name="graduate" defaultChecked={found.gradNeeded} disabled />
              Graduate ticket ({aed(settings.graduate_price_aed)}) {found.gradNeeded ? '' : '· already arranged'}
            </label>
            {found.gradNeeded ? <input type="hidden" name="graduate" value="on" /> : null}
            <label className="f" htmlFor="guests">Guest tickets ({aed(settings.guest_price_aed)} each)</label>
            <select id="guests" name="guests" defaultValue={String(Math.min(found.canBuy, 2))}>
              {Array.from({ length: found.canBuy + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
            </select>
            <label className="f" htmlFor="payer_name">Your full name</label>
            <input id="payer_name" name="payer_name" required maxLength={120} />
            <label className="f" htmlFor="payer_email">Your email (for the receipt)</label>
            <input id="payer_email" name="payer_email" type="email" required maxLength={200} />
            <label className="f" htmlFor="relation">You are the student&apos;s</label>
            <select id="relation" name="relation" defaultValue="Parent">
              {['Parent', 'Guardian', 'Sponsor', 'Other'].map((r) => <option key={r}>{r}</option>)}
            </select>
            <div style={{ marginTop: 14 }}><Submit className="btn block">Continue to payment</Submit></div>
          </form>
        )
      ) : null}
    </div>
  );
}
