import { NextResponse } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { type Checkout, type Intent, renderCheckout, sessionExpired } from '@/lib/checkout';

/** Sprint 19: a guardian pays the fee attached to a consent-form response (the intent already exists). */
export async function POST(req: Request) {
  const fd = await req.formData();
  const intentId = String(fd.get('intentId') ?? '');
  const back = new URL('/consents', req.url);
  if (!/^\d+$/.test(intentId)) {
    back.searchParams.set('error', 'validation-failed');
    return NextResponse.redirect(back, 303);
  }
  let out: { intent: Intent; checkout: Checkout };
  try {
    out = await bff.api.fetch<{ intent: Intent; checkout: Checkout }>(
      `/payments/intents/mine/${intentId}/checkout`,
      { method: 'POST' },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) return sessionExpired(req);
      back.searchParams.set('error', error.problem.type);
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      if (detail) back.searchParams.set('detail', detail.slice(0, 160));
      return NextResponse.redirect(back, 303);
    }
    throw error;
  }
  return renderCheckout(out.intent, out.checkout, {
    cancelHref: '/consents',
    mockBack: '/consents',
  });
}
