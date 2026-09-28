import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

const APP_URL = process.env.ADMIN_APP_URL ?? 'http://localhost:3000';
const PROVIDERS = new Set(['payu', 'razorpay', 'ccavenue']);

/**
 * Sprint 13: gateways post their result here for intents the accounts desk created (return URL on the
 * admin app). The fields go to the API, which verifies the signature and applies the outcome once; the
 * browser then lands on the payments page.
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
  let target = new URL('/fees/payments', APP_URL);
  try {
    const res = await fetch(`${env.apiBaseUrl}/api/v1/payments/${provider}/return`, {
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
    if (res.ok && out.status === 'succeeded') paid = '1';
    else if (res.ok) paid = out.outcome ?? 'failed';
    if (out.returnUrl && out.returnUrl.startsWith(APP_URL)) target = new URL(out.returnUrl);
  } catch {
    paid = 'error';
  }
  target.searchParams.set('paid', paid);
  return NextResponse.redirect(target, 303);
}

export async function GET(req: Request) {
  return NextResponse.redirect(new URL('/fees/payments', req.url), 303);
}
