import { NextResponse } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

interface Intent {
  id: string;
  txnId: string;
  amount: string;
  provider: string;
}
type Checkout =
  | {
      kind: 'form';
      provider: string;
      mode: 'mock' | 'test' | 'live';
      action: string;
      method: 'POST';
      fields: Record<string, string>;
    }
  | {
      kind: 'razorpay';
      keyId: string;
      orderId: string;
      amount: number;
      currency: string;
      name: string;
      description: string;
      prefill: { name: string; email: string; contact: string };
      notes: Record<string, string>;
      callbackUrl: string;
    };

const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

const page = (
  title: string,
  body: string,
  script = '',
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#F5F7FA;color:#1F2933}main{max-width:480px;margin:40px auto;background:#fff;border-radius:10px;padding:24px;box-shadow:0 2px 12px rgba(0,38,93,.08)}h1{font-size:20px;margin:0 0 8px;color:#00265D}p{color:#52606D}button,.btn{display:inline-block;background:#00265D;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:15px;cursor:pointer;text-decoration:none}.ghost{background:#E4E7EB;color:#1F2933}</style></head>
<body><main>${body}</main>${script}</body></html>`;

/**
 * Sprint 13: the family starts an online payment. The API creates the intent (amount checked against the
 * ledger) and returns what the browser needs: an auto-posted gateway form, the Razorpay checkout, or the
 * development mock with a success and a failure button. The gateway returns to /api/payments/return.
 */
export async function POST(req: Request) {
  const fd = await req.formData();
  const studentId = String(fd.get('studentId') ?? '');
  const amount = Number(fd.get('amount'));
  const back = new URL(`/fees?student=${encodeURIComponent(studentId)}`, req.url);
  if (!/^\d+$/.test(studentId) || !Number.isFinite(amount) || amount <= 0) {
    back.searchParams.set('error', 'validation-failed');
    return NextResponse.redirect(back, 303);
  }
  let out: { intent: Intent; checkout: Checkout };
  try {
    out = await bff.api.fetch<{ intent: Intent; checkout: Checkout }>('/payments/intents/mine', {
      method: 'POST',
      body: JSON.stringify({ studentId, amount }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401)
        return NextResponse.redirect(new URL('/login?error=session-expired', req.url), 303);
      back.searchParams.set('error', error.problem.type);
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      if (detail) back.searchParams.set('detail', detail.slice(0, 160));
      return NextResponse.redirect(back, 303);
    }
    throw error;
  }
  const { intent, checkout } = out;
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (checkout.kind === 'razorpay') {
    const options = {
      key: checkout.keyId,
      amount: checkout.amount,
      currency: checkout.currency,
      order_id: checkout.orderId,
      name: checkout.name,
      description: checkout.description,
      prefill: checkout.prefill,
      notes: checkout.notes,
      callback_url: checkout.callbackUrl,
      redirect: true,
      theme: { color: '#00265D' },
    };
    return new Response(
      page(
        'Pay fees',
        `<h1>Paying ₹${esc(intent.amount)}</h1><p>Transaction <code>${esc(intent.txnId)}</code>. The Razorpay checkout opens now; if it does not, use the button.</p><p><button id="pay">Open checkout</button> <a class="btn ghost" href="/fees">Cancel</a></p>`,
        `<script src="https://checkout.razorpay.com/v1/checkout.js"></script><script>var o=${JSON.stringify(options)};var r=new Razorpay(o);document.getElementById('pay').onclick=function(){r.open()};r.open();</script>`,
      ),
      { headers },
    );
  }
  if (checkout.mode === 'mock') {
    return new Response(
      page(
        'Development gateway',
        `<h1>Development gateway</h1><p>₹${esc(intent.amount)} for transaction <code>${esc(intent.txnId)}</code>. No money moves here; choose how the gateway should answer.</p>
<form method="post" action="/api/pay" style="display:flex;gap:8px"><input type="hidden" name="txnid" value="${esc(intent.txnId)}"><input type="hidden" name="student" value="${esc(studentId)}"><button name="outcome" value="success">Pay (success)</button><button class="ghost" name="outcome" value="failure">Fail the payment</button></form>
<p><a href="/fees">Cancel</a></p>`,
      ),
      { headers },
    );
  }
  const fields = Object.entries(checkout.fields)
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('');
  return new Response(
    page(
      'Redirecting to the payment gateway',
      `<h1>Redirecting to ${esc(checkout.provider)}</h1><p>₹${esc(intent.amount)} · transaction <code>${esc(intent.txnId)}</code>. If nothing happens, press the button.</p><form id="gw" method="post" action="${esc(checkout.action)}">${fields}<button type="submit">Continue to the gateway</button></form>`,
      `<script>document.getElementById('gw').submit()</script>`,
    ),
    { headers },
  );
}
