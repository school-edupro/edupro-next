import { NextResponse } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { type Checkout, type Intent, renderCheckout } from '@/lib/checkout';

/**
 * A misc fee (a trip, an activity) paid online in full (0142): the API checks the fee is the child's and
 * still open, adds the gateway's convenience charge, and returns the gateway's form. The receipt (MF) is
 * written when the gateway confirms.
 */
export async function POST(req: Request) {
  const fd = await req.formData();
  const lineId = String(fd.get('lineId') ?? '');
  const studentId = String(fd.get('studentId') ?? '');
  const gw = String(fd.get('gatewayId') ?? '');
  // a consent form's fee comes back to the consent forms (docs/design/28-consent-forms.md)
  const consents = String(fd.get('back') ?? '') === 'consents';
  const back = new URL(
    `/${consents ? 'consents' : 'fees'}?student=${encodeURIComponent(studentId)}`,
    req.url,
  );
  if (!/^\d{1,18}$/.test(lineId)) {
    back.searchParams.set('error', 'validation-failed');
    return NextResponse.redirect(back, 303);
  }
  let out: { intent: Intent; checkout: Checkout };
  try {
    out = await bff.api.fetch<{ intent: Intent; checkout: Checkout }>(
      '/payments/intents/mine/misc',
      {
        method: 'POST',
        body: JSON.stringify({
          lineId,
          ...(/^\d{1,18}$/.test(gw) ? { gatewayId: gw } : {}),
          ...(consents ? { returnTo: 'consents' } : {}),
        }),
      },
    );
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
  return renderCheckout(out.intent, out.checkout, {
    cancelHref: consents ? '/consents' : '/fees',
    mockStudent: studentId,
    mockBack: consents ? '/consents' : '/fees',
  });
}
