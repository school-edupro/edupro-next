import { NextResponse } from 'next/server';
import { PublicApiError } from '@/lib/api';
import { admissionFetch } from '@/lib/admission';
import { renderCheckout, type Checkout, type Intent } from '@/lib/checkout';

/** The registration fee paid online from the admission portal. */
export async function POST(req: Request) {
  const fd = await req.formData();
  const school = String(fd.get('school') ?? '').toLowerCase();
  const id = String(fd.get('id') ?? '');
  if (!/^[a-z0-9-]{2,20}$/.test(school) || !/^\d{1,18}$/.test(id))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const back = `/${school}/admission/application/${id}`;
  try {
    const gw = String(fd.get('gatewayId') ?? '');
    const out = await admissionFetch<{ intent: Intent; checkout: Checkout }>(
      `/me/applications/${id}/pay?school=${school}`,
      {
        method: 'POST',
        body: JSON.stringify(/^\d{1,18}$/.test(gw) ? { gatewayId: gw } : {}),
      },
    );
    return renderCheckout(out.intent, out.checkout, { cancelHref: back, mockBack: back });
  } catch (error) {
    if (error instanceof PublicApiError) {
      const to = new URL(back, req.url);
      to.searchParams.set(
        'error',
        error.problem.type === 'payment.live_on_local'
          ? 'Online payment is not available on this test computer. Please pay at the school office.'
          : (error.problem.detail ?? error.problem.type).slice(0, 160),
      );
      return NextResponse.redirect(to, 303);
    }
    throw error;
  }
}
