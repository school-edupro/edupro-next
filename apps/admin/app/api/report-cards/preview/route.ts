import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * Report-card preview as a page (the designer's iframe and the "Preview" links): sample data of a band,
 * or a real pupil of a release. The HTML comes from the API's preview route under the caller's session.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const templateId = q.get('templateId');
  const releaseId = q.get('releaseId');
  const studentId = q.get('studentId');
  const band = q.get('band');
  try {
    let id = templateId;
    if (!id && releaseId && studentId) {
      // the release's own template for the pupil's band, else the band's first active template
      const rel = await apiFetch<{ templates: Record<string, string> }>(
        `/exams/report-cards/releases/${releaseId}`,
      );
      const list = await apiFetch<{ data: Array<{ id: string; band: string; status: string }> }>(
        '/exams/report-cards/templates',
      );
      id =
        Object.values(rel.templates)[0] ?? list.data.find((t) => t.status === 'active')?.id ?? null;
    }
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
