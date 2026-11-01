import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * Report-card preview as a page (the designer's iframe and the "Preview" links): sample data of a band,
 * or a real pupil of a release with the design of the pupil's class. The HTML comes from the API under
 * the caller's session.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const templateId = q.get('templateId');
  const releaseId = q.get('releaseId');
  const studentId = q.get('studentId');
  const band = q.get('band');
  try {
    // a real pupil of a release: the design of the pupil's class, as the PDF prints it (1 Nov 2026)
    if (!templateId && releaseId && studentId) {
      if (!/^\d{1,18}$/.test(releaseId) || !/^\d{1,18}$/.test(studentId))
        return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
      const out = await apiFetch<{ html: string }>(
        `/exams/report-cards/releases/${releaseId}/students/${studentId}/preview`,
      );
      return new NextResponse(out.html, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    const id = templateId;
    if (!id || !/^\d+$/.test(id))
      return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
    const body: Record<string, string> = {};
    if (releaseId && studentId && /^\d+$/.test(releaseId) && /^\d+$/.test(studentId)) {
      body.releaseId = releaseId;
      body.studentId = studentId;
    } else if (band) body.band = band;
    const out = await apiFetch<{ html: string }>(`/exams/report-cards/templates/${id}/preview`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
    return new NextResponse(out.html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(error.problem, { status: error.status });
    throw error;
  }
}
