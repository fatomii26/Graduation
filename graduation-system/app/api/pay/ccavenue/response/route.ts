import { NextResponse } from 'next/server';
import { siteUrl } from '@/lib/config';
import { parseResponse } from '@/lib/payments/ccavenue';
import { recordGatewayResult } from '@/lib/payments';
import { logError } from '@/lib/audit';

// CCAvenue posts the encrypted result here (redirect_url and cancel_url) through the student's browser.
// The response is encrypted with the working key only CCAvenue and this server know, so it is authentic.
// Recording is idempotent (event key), so a repeated post or a notification for the same payment is harmless.
export async function POST(req: Request) {
  let target = 'ticket';
  let orderId = '';
  try {
    const form = await req.formData();
    const enc = String(form.get('encResp') ?? '');
    if (!/^[0-9a-fA-F]+$/.test(enc)) throw new Error('Missing encResp');
    const r = await parseResponse(enc);
    target = r.target;
    orderId = r.orderId;
    const res = await recordGatewayResult({
      eventKey: `ccavenue:${r.trackingId}:${r.status}`,
      gateway: 'ccavenue',
      target: r.target,
      orderId: r.orderId,
      status: r.status,
      amount: r.amount,
      gatewayRef: r.trackingId,
      payload: r.payload,
      actor: 'ccavenue',
    });
    const failed = r.status !== 'paid' || !res.ok;
    return NextResponse.redirect(`${siteUrl()}/pay/return?order=${r.orderId}&kind=${r.target}${failed ? '&failed=1' : ''}`, 303);
  } catch (e) {
    await logError('ccavenue:response', e, '/api/pay/ccavenue/response');
    const q = orderId ? `order=${orderId}&kind=${target}&failed=1` : 'failed=1';
    return NextResponse.redirect(`${siteUrl()}/pay/return?${q}`, 303);
  }
}
