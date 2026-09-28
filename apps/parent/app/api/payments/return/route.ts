import { NextResponse } from 'next/server';

const API = process.env.INTERNAL_API_BASE_URL ?? 'http://localhost:4000';
const APP_URL = process.env.PARENT_APP_URL ?? 'http://localhost:3001';
const PROVIDERS = new Set(['payu', 'razorpay', 'ccavenue']);

/**
 * Sprint 13: the gateway posts its result here (PayU surl/furl, Razorpay callback_url, CCAvenue redirect
 * and cancel URL). The fields go to the API, which verifies the signature and applies the outcome exactly
 * once; the browser then lands on the fees page with ?paid=.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const provider = PROVIDERS.has(url.searchParams.get('provider') ?? '')
    ? url.searchParams.get('provider')!
    : 'payu';
  const body: Record<string, string> = {};
  const type = req.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    Object.assign(body, (await req.json().catch(() => ({}))) as Record<string, string>);
  } else {
    const fd = await req.formData();
    for (const [k, v] of fd.entries()) if (typeof v === 'string') body[k] = v;
  }
  let paid = '0';
  let target = new URL('/fees', APP_URL);
  try {
    const res = await fetch(`${API}/api/v1/payments/${provider}/return`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    const out = (await res.json().catch(() => ({}))) as {
      outcome?: string;
      status?: string | null;
      returnUrl?: string | null;
    };
    if (
      res.ok &&
      (out.status === 'succeeded' || (out.outcome === 'duplicate' && out.status === 'succeeded'))
    )
      paid = '1';
    else if (res.ok) paid = out.outcome ?? 'failed';
    if (out.returnUrl && out.returnUrl.startsWith(APP_URL)) target = new URL(out.returnUrl);
  } catch {
    paid = 'error';
  }
  target.searchParams.set('paid', paid);
  return NextResponse.redirect(target, 303);
}

export async function GET(req: Request) {
  return NextResponse.redirect(new URL('/fees', req.url), 303);
}
