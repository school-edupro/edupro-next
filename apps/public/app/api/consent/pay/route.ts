import { NextResponse } from 'next/server';
import { PublicApiError } from '@/lib/api';
import { type Checkout, type Intent, renderCheckout } from '@/lib/checkout';
import { consentFetch, SCHOOL_RE, TOKEN_RE } from '@/lib/consent';

/** A family pays its pupil's consent form fee online from the form's link. */
export async function POST(req: Request) {
  const fd = await req.formData();
  const school = String(fd.get('school') ?? '');
  const token = String(fd.get('token') ?? '');
  const rid = String(fd.get('rid') ?? '');
  if (!SCHOOL_RE.test(school) || !TOKEN_RE.test(token) || !/^\d{1,18}$/.test(rid))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const back = `/${school.toLowerCase()}/consent/${token}`;
  try {
    const out = await consentFetch<{ intent: Intent; checkout: Checkout }>(
      school,
      token,
      `/responses/${rid}/pay`,
      { method: 'POST' },
    );
    return renderCheckout(out.intent, out.checkout, { cancelHref: back, mockBack: back });
  } catch (error) {
    if (error instanceof PublicApiError) {
      const to = new URL(back, req.url);
      to.searchParams.set('error', (error.problem.detail ?? error.problem.type).slice(0, 160));
      return NextResponse.redirect(to, 303);
    }
    throw error;
  }
}
