import { sql } from '@/lib/db';
import { currentPublicSeason, getSeasonSettings } from '@/lib/settings';
import { aed, fmtDate } from '@/lib/format';
import Submit from '@/components/Submit';
import MerchPic from '@/components/MerchPic';
import { Flash, readParams, type SearchParams } from '@/components/ui';
import { merchOrderAction } from '../actions';

type MerchItem = { id: number; name: string; description: string; price_aed: number; image: string };

export default async function Shop({ searchParams }: { searchParams: SearchParams }) {
  const get = await readParams(searchParams);
  const season = await currentPublicSeason();
  const settings = season ? await getSeasonSettings(season.id) : null;
  const items = season
    ? await sql<MerchItem>('select id, name, description, price_aed, image from merch_items where season_id = $1 and active and not removed order by sort, name', [season.id])
    : [];
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dubai' });
  const open = !!settings?.merch_enabled && (!settings.shop_close_date || today <= settings.shop_close_date) && items.length > 0;

  return (
    <div className="wrap">
      <h1>Graduation merchandise</h1>
      <p className="muted">
        Anyone can order with a graduate&apos;s MISIS. Collect your items at the graduation desk after payment.
        {settings?.shop_close_date ? ` Online orders close on ${fmtDate(settings.shop_close_date)}.` : ''}
      </p>
      <Flash msg={get('msg')} err={get('err')} />
      {!open ? (
        <div className="card center">The merchandise shop is closed.</div>
      ) : (
        <form action={merchOrderAction} className="stack">
          <div className="merch-grid">
            {items.map((it) => (
              <div className="card" key={it.id}>
                <MerchPic image={it.image} name={it.name} />
                <h3 style={{ marginTop: 10 }}>{it.name}</h3>
                <p className="small muted">{it.description}</p>
                <div className="row between">
                  <strong>{aed(it.price_aed)}</strong>
                  <label className="inline small">
                    Qty
                    <select name={`qty_${it.id}`} defaultValue="0" aria-label={`Quantity of ${it.name}`}>
                      {Array.from({ length: 11 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </label>
                </div>
              </div>
            ))}
          </div>
          <div className="card">
            <div className="grid">
              <div>
                <label className="f" htmlFor="misis">Graduate&apos;s MISIS</label>
                <input id="misis" name="misis" required placeholder="e.g. M00123456" />
              </div>
              <div>
                <label className="f" htmlFor="buyer_name">Your name</label>
                <input id="buyer_name" name="buyer_name" required maxLength={120} />
              </div>
              <div>
                <label className="f" htmlFor="buyer_email">Your email (for the receipt)</label>
                <input id="buyer_email" name="buyer_email" type="email" required maxLength={200} />
              </div>
            </div>
            <div style={{ marginTop: 14 }}><Submit>Continue to payment</Submit></div>
          </div>
        </form>
      )}
    </div>
  );
}
