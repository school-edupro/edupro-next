import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';
import { type Checkout, type Intent, renderCheckout } from '@/lib/checkout';

/**
 * The accounts desk starts an online payment for a pupil on the parent's behalf (the parent pays by
 * card, UPI or net banking on the school's screen). The API creates the intent and returns what the
 * browser needs; the gateway returns to the parent view of the pupil.
 */
export async function POST(req: Request, { params }: { params: Promise<{ studentId: string }> }) {
  const { studentId } = await params;
  const fd = await req.formData();
  const back = new URL(`/fees/parent-view/${studentId}`, req.url);
  const amount = Number(fd.get('amount'));
  const fail = (detail: string) => {
    back.searchParams.set('error', '1');
    back.searchParams.set('detail', detail.slice(0, 200));
    return NextResponse.redirect(back, 303);
  };
  if (!/^\d{1,18}$/.test(studentId) || !Number.isFinite(amount) || amount <= 0)
    return fail('Choose what to pay');
  let out: { intent: Intent; form: Checkout };
  try {
    out = await apiFetch<{ intent: Intent; form: Checkout }>('/payments/intents/fee', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        amount,
        payerName: String(fd.get('payerName') ?? '').trim(),
        payerEmail: String(fd.get('payerEmail') ?? '').trim(),
        payerMobile: String(fd.get('payerMobile') ?? '').trim(),
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401)
        return NextResponse.redirect(new URL('/login?error=session-expired', req.url), 303);
      const errs = error.problem.errors as Array<{ path?: string; message?: string }> | undefined;
      return fail(
        (Array.isArray(errs)
          ? errs.map((e) => `${e.path ?? ''} ${e.message ?? ''}`).join('; ')
          : '') ||
          (typeof error.problem.detail === 'string' ? error.problem.detail : '') ||
          error.problem.type,
      );
    }
    throw error;
  }
  return renderCheckout(out.intent, out.form, {
    cancelHref: `/fees/parent-view/${studentId}`,
    mockStudent: studentId,
  });
}
