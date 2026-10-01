import { NextResponse } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { type Checkout, type Intent, renderCheckout } from '@/lib/checkout';

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
  return renderCheckout(intent, checkout, {
    cancelHref: '/fees',
    mockStudent: studentId,
    mockBack: '/fees',
  });
}
