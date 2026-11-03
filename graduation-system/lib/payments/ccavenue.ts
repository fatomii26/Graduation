import 'server-only';
import crypto from 'node:crypto';
import { siteUrl } from '../config';
import { getSecret } from '../settings';

// CCAvenue adapter. All gateway-specific code lives in this file so the gateway can be changed.
// Standard CCAvenue (UAE) integration: the request is sent as `encRequest` (AES-128-CBC, key = MD5 of the working key,
// IV = bytes 0..15, hex encoded) with the access code; CCAvenue posts the result back as `encResp`, encrypted the same
// way, to redirect_url (success) or cancel_url. Only CCAvenue and this server know the working key, so a response that
// decrypts and parses is authentic. Confirm the exact field names with the Finance merchant account and CCAvenue's
// current integration document before go-live.

const IV = Buffer.from(Array.from({ length: 16 }, (_, i) => i));
const keyOf = (workingKey: string) => crypto.createHash('md5').update(workingKey).digest();

export function encrypt(plain: string, workingKey: string): string {
  const c = crypto.createCipheriv('aes-128-cbc', keyOf(workingKey), IV);
  return Buffer.concat([c.update(plain, 'utf8'), c.final()]).toString('hex');
}

export function decrypt(hex: string, workingKey: string): string {
  const d = crypto.createDecipheriv('aes-128-cbc', keyOf(workingKey), IV);
  return Buffer.concat([d.update(Buffer.from(hex, 'hex')), d.final()]).toString('utf8');
}

export const endpoint = () =>
  process.env.CCAVENUE_ENV === 'live'
    ? 'https://secure.ccavenue.ae/transaction/transaction.do?command=initiateTransaction'
    : 'https://test.ccavenue.ae/transaction/transaction.do?command=initiateTransaction';

export async function credentials() {
  const [merchantId, accessCode, workingKey] = await Promise.all([
    getSecret('CCAVENUE_MERCHANT_ID'),
    getSecret('CCAVENUE_ACCESS_CODE'),
    getSecret('CCAVENUE_WORKING_KEY'),
  ]);
  if (!merchantId || !accessCode || !workingKey) throw new Error('CCAvenue credentials are not set (Technical Settings or environment).');
  return { merchantId, accessCode, workingKey };
}

export type Checkout = { action: string; fields: Record<string, string> };

export async function checkoutForm(o: {
  id: string; ref: string; target: 'ticket' | 'merch'; amount: number; name: string; email: string; misis: string;
}): Promise<Checkout> {
  const { merchantId, accessCode, workingKey } = await credentials();
  const back = `${siteUrl()}/api/pay/ccavenue/response`;
  const params = new URLSearchParams({
    merchant_id: merchantId,
    order_id: o.ref,
    currency: 'AED',
    amount: o.amount.toFixed(2),
    redirect_url: back,
    cancel_url: back,
    language: 'EN',
    billing_name: o.name.slice(0, 60),
    billing_email: o.email,
    merchant_param1: o.target,
    merchant_param2: o.id,
    merchant_param3: o.misis,
  });
  return { action: endpoint(), fields: { encRequest: encrypt(params.toString(), workingKey), access_code: accessCode } };
}

export type GatewayResult = {
  target: 'ticket' | 'merch';
  orderId: string;
  ref: string;
  status: 'paid' | 'failed' | 'aborted' | 'invalid';
  amount: number | null;
  trackingId: string;
  payload: Record<string, string>;
};

export async function parseResponse(encResp: string): Promise<GatewayResult> {
  const { workingKey } = await credentials();
  const fields = Object.fromEntries(new URLSearchParams(decrypt(encResp, workingKey)));
  const s = String(fields.order_status ?? '').toLowerCase();
  // keep only what reconciliation needs; never store card data
  const payload: Record<string, string> = {};
  for (const k of ['order_id', 'tracking_id', 'bank_ref_no', 'order_status', 'failure_message', 'payment_mode', 'card_name', 'status_message', 'currency', 'amount', 'trans_date']) {
    if (fields[k]) payload[k] = String(fields[k]).slice(0, 200);
  }
  return {
    target: fields.merchant_param1 === 'merch' ? 'merch' : 'ticket',
    orderId: String(fields.merchant_param2 ?? ''),
    ref: String(fields.order_id ?? ''),
    status: s === 'success' ? 'paid' : s === 'aborted' ? 'aborted' : s === 'invalid' ? 'invalid' : 'failed',
    amount: fields.amount ? Number(fields.amount) : null,
    trackingId: String(fields.tracking_id ?? fields.order_id ?? ''),
    payload,
  };
}
