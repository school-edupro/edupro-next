import { NextResponse } from 'next/server';
import { env } from '@/lib/env';

/**
 * Development gateway for a payment the accounts desk opened on a parent's behalf: settles the intent
 * on the API as a signed success or failure, then returns to the staff's parent view of the pupil.
 */
export async function POST(req: Request) {
  const fd = await req.formData();
  const txnid = String(fd.get('txnid') ?? '');
  const student = String(fd.get('student') ?? '');
  const outcome = String(fd.get('outcome') ?? 'success') === 'failure' ? 'failure' : 'success';
  const target = new URL(
    /^\d{1,18}$/.test(student) ? `/fees/parent-view/${student}` : '/fees/cashier',
    req.url,
  );
  let paid = '0';
  if (/^[A-Za-z0-9]{6,40}$/.test(txnid)) {
    const res = await fetch(`${env.apiBaseUrl}/api/v1/payments/payu/mock`, {
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
