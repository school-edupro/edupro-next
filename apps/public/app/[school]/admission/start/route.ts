import { NextResponse, type NextRequest } from 'next/server';
import { PublicApiError } from '@/lib/api';
import { admissionFetch } from '@/lib/admission';

/**
 * After sign-in, the class the family picked on the front page: its form opens at once (the family's
 * draft for it, or a new one). Signed out it goes back to the sign-in with the class kept.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  const url = req.nextUrl;
  const cycleId = url.searchParams.get('cycle') ?? '';
  const classId = url.searchParams.get('class') ?? '';
  const enquiry = url.searchParams.get('enquiry') ?? '';
  const session = url.searchParams.get('session') ?? '';
  const base = `/${school.toLowerCase()}/admission`;
  if (!/^[a-z0-9-]{2,20}$/i.test(school) || !/^\d{1,18}$/.test(cycleId) || !/^\d{1,18}$/.test(classId))
    return NextResponse.redirect(new URL(base, req.url), 303);
  try {
    const out = await admissionFetch<{ id: string; resumed?: boolean }>('/me/applications', {
      method: 'POST',
      body: JSON.stringify({
        cycleId,
        classId,
        ...(/^[A-Za-z0-9_-]{16,64}$/.test(enquiry) ? { enquiry } : {}),
      }),
    });
    return NextResponse.redirect(
      new URL(`${base}/application/${out.id}${out.resumed ? '?resumed=1' : ''}`, req.url),
      303,
    );
  } catch (error) {
    if (error instanceof PublicApiError && error.status === 401)
      return NextResponse.redirect(
        new URL(
          `${base}?session=${encodeURIComponent(session)}&class=${classId}${/^[A-Za-z0-9_-]{16,64}$/.test(enquiry) ? `&enquiry=${enquiry}` : ''}#sign-in`,
          req.url,
        ),
        303,
      );
    const msg =
      error instanceof PublicApiError ? (error.problem.detail ?? error.problem.type) : 'Could not start';
    return NextResponse.redirect(
      new URL(`${base}/apply?error=${encodeURIComponent(String(msg).slice(0, 200))}`, req.url),
      303,
    );
  }
}
