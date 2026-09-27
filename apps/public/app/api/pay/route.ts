import { NextResponse } from 'next/server';
import { API } from '@/lib/api';

/**
 * Development gateway (PAYU_MODE=mock): settles the intent on the API as a signed success and returns to
 * the status page. In test or live mode the status page posts straight to PayU instead of this route.
 */
export async function POST(req: Request) {
  const fd = await req.formData();
  const txnid = String(fd.get('txnid') ?? '');
  const school = String(fd.get('school') ?? '').toLowerCase();
  const lang = String(fd.get('lang') ?? 'en') === 'hi' ? 'hi' : 'en';
  const outcome = String(fd.get('outcome') ?? 'success') === 'failure' ? 'failure' : 'success';
  const target = new URL(`/${/^[a-z0-9-]{1,40}$/.test(school) ? school : ''}/status`, req.url);
  target.searchParams.set('lang', lang);
  let paid = '0';
  if (/^[A-Za-z0-9]{6,40}$/.test(txnid)) {
    const res = await fetch(`${API}/api/v1/payments/payu/mock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ txnid, outcome }),
      cache: 'no-store',
    });
    const body = (await res.json().catch(() => ({}))) as { status?: string; outcome?: string };
    if (res.ok && body.status === 'succeeded') paid = '1';
    else if (res.ok) paid = body.outcome ?? 'failed';
  }
  target.searchParams.set('paid', paid);
  return NextResponse.redirect(target, 303);
}
