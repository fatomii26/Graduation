import PaymentWait from '@/components/PaymentWait';
import { readParams, type SearchParams } from '@/components/ui';

export default async function PayReturn({ searchParams }: { searchParams: SearchParams }) {
  const get = await readParams(searchParams);
  const order = get('order');
  const kind = get('kind') === 'merch' ? 'merch' : 'ticket';
  return (
    <div className="narrow">
      <h1>Payment</h1>
      {/^[0-9a-f-]{36}$/i.test(order) ? (
        <PaymentWait order={order} kind={kind} failed={get('failed') === '1'} />
      ) : (
        <div className="flash err">Order not found.</div>
      )}
    </div>
  );
}
