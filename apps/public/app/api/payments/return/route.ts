import { NextResponse } from 'next/server';
import { API } from '@/lib/api';

const PUBLIC_URL = process.env.PUBLIC_APP_URL ?? 'http://localhost:3003';

/**
 * PayU posts the signed result here (surl/furl). The fields go to the API, which verifies the signature and
 * applies the outcome exactly once; the browser then lands on the intent's return page (the status page).
 */
export async function POST(req: Request) {
  const fd = await req.formData();
  const body: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (typeof v === 'string') body[k] = v;
  let paid = '0';
  let target = new URL('/', PUBLIC_URL);
  try {
    const res = await fetch(`${API}/api/v1/payments/payu/return`, {
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
    if (out.returnUrl && out.returnUrl.startsWith(PUBLIC_URL)) target = new URL(out.returnUrl);
  } catch {
    paid = 'error';
  }
  target.searchParams.set('paid', paid);
  return NextResponse.redirect(target, 303);
}

export async function GET(req: Request) {
  // a browser that lands here with GET (some gateways redirect) goes home
  return NextResponse.redirect(new URL('/', req.url), 303);
}
