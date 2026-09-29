import { NextResponse } from 'next/server';

const API = process.env.INTERNAL_API_BASE_URL ?? 'http://localhost:4000';

/** Development gateway: settles the family's intent on the API as a signed success or failure. */
export async function POST(req: Request) {
  const fd = await req.formData();
  const txnid = String(fd.get('txnid') ?? '');
  const student = String(fd.get('student') ?? '');
  const outcome = String(fd.get('outcome') ?? 'success') === 'failure' ? 'failure' : 'success';
  const backRaw = String(fd.get('back') ?? '/fees');
  const target = new URL(/^\/[a-z-]*$/.test(backRaw) ? backRaw : '/fees', req.url);
  if (/^\d+$/.test(student)) target.searchParams.set('student', student);
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
