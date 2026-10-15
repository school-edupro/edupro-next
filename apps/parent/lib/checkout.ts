import { NextResponse } from 'next/server';

/** Shared gateway pages of the parent app (fees since Sprint 13, consent-form fees since Sprint 19). */
export interface Intent {
  id: string;
  txnId: string;
  amount: string;
  provider: string;
}
export type Checkout =
  | {
      kind: 'form';
      provider: string;
      mode: 'mock' | 'test' | 'live';
      action: string;
      method: 'POST';
      fields: Record<string, string>;
    }
  | {
      /** Atom AIPAY: Atom's checkout script opened with the token from the AUTH call */
      kind: 'atom';
      provider: string;
      mode: 'test' | 'live';
      scriptUrl: string;
      atomTokenId: string;
      merchId: string;
      custEmail: string;
      custMobile: string;
      returnUrl: string;
      env: 'uat' | 'prod';
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

export const esc = (v: unknown) =>
  String(v ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );

export const page = (
  title: string,
  body: string,
  script = '',
) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;margin:0;padding:24px;background:#F5F7FA;color:#1F2933}main{max-width:480px;margin:40px auto;background:#fff;border-radius:10px;padding:24px;box-shadow:0 2px 12px rgba(0,38,93,.08)}h1{font-size:20px;margin:0 0 8px;color:#00265D}p{color:#52606D}button,.btn{display:inline-block;background:#00265D;color:#fff;border:0;border-radius:6px;padding:10px 16px;font-size:15px;cursor:pointer;text-decoration:none}.ghost{background:#E4E7EB;color:#1F2933}</style></head>
<body><main>${body}</main>${script}</body></html>`;

/** Renders the browser side of a checkout: Razorpay, the development mock or an auto-posted gateway form. */
export function renderCheckout(
  intent: Intent,
  checkout: Checkout,
  opts: { cancelHref: string; mockStudent?: string; mockBack?: string },
): Response {
  const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' };
  if (checkout.kind === 'atom') {
    // only Atom's own script address may be loaded (the API gives one of its two known addresses)
    const script =
      /^https:\/\/(pgtest|psa)\.atomtech\.in\/staticdata\/ots\/js\/atomcheckout\.js$/.test(
        checkout.scriptUrl,
      )
        ? checkout.scriptUrl
        : '';
    const options = {
      atomTokenId: checkout.atomTokenId,
      merchId: checkout.merchId,
      custEmail: checkout.custEmail,
      custMobile: checkout.custMobile,
      returnUrl: checkout.returnUrl,
    };
    return new Response(
      page(
        'Pay',
        `<h1>Paying ₹${esc(intent.amount)}</h1><p>Transaction <code>${esc(intent.txnId)}</code>. The Atom payment page opens now; if it does not, use the button.</p><p><button id="pay">Open payment page</button> <a class="btn ghost" href="${esc(opts.cancelHref)}">Cancel</a></p>`,
        `<script src="${esc(script)}"></script><script>var o=${JSON.stringify(options).replace(/</g, '\\u003c')};function go(){new AtomPaynetz(o,${JSON.stringify(checkout.env)})}document.getElementById('pay').onclick=go;go();</script>`,
      ),
      { headers },
    );
  }
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
        'Pay',
        `<h1>Paying ₹${esc(intent.amount)}</h1><p>Transaction <code>${esc(intent.txnId)}</code>. The Razorpay checkout opens now; if it does not, use the button.</p><p><button id="pay">Open checkout</button> <a class="btn ghost" href="${esc(opts.cancelHref)}">Cancel</a></p>`,
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
<form method="post" action="/api/pay" style="display:flex;gap:8px"><input type="hidden" name="txnid" value="${esc(intent.txnId)}"><input type="hidden" name="student" value="${esc(opts.mockStudent ?? '')}"><input type="hidden" name="back" value="${esc(opts.mockBack ?? '/fees')}"><button name="outcome" value="success">Pay (success)</button><button class="ghost" name="outcome" value="failure">Fail the payment</button></form>
<p><a href="${esc(opts.cancelHref)}">Cancel</a></p>`,
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

export const sessionExpired = (req: Request) =>
  NextResponse.redirect(new URL('/login?error=session-expired', req.url), 303);
