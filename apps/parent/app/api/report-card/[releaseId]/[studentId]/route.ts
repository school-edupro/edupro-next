import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';

/**
 * My child's report card as a page, at once (1 Nov 2026): the API checks the card is published for the
 * child's class, not held and not withheld for fees, and prints it with the design the PDF uses. The
 * browser prints or saves it (a Print / Save as PDF button; ?print=1 opens the print dialog at once, for
 * when the PDF service is slow); a refusal goes back to the results page with the reason.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ releaseId: string; studentId: string }> },
) {
  const { releaseId, studentId } = await params;
  if (!/^\d{1,18}$/.test(releaseId) || !/^\d{1,18}$/.test(studentId))
    return new NextResponse(null, { status: 404 });
  try {
    const out = await bff.api.fetch<{ html: string }>(
      `/exams/mine/report-cards/${releaseId}/${studentId}/view`,
    );
    const lang = await currentLang();
    const label = t(lang, 'Print / Save as PDF').replace(/"/g, '');
    const auto = req.nextUrl.searchParams.get('print') === '1' ? '1' : '0';
    const html = out.html.replace(
      '</body>',
      `<script src="/rc-print.js" data-label="${label}" data-auto="${auto}"></script></body>`,
    );
    return new NextResponse(html, {
      headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      const back = new URL('/results', req.nextUrl);
      back.searchParams.set('error', error.problem.type);
      if (detail) back.searchParams.set('detail', detail.slice(0, 160));
      return NextResponse.redirect(back, 303);
    }
    throw error;
  }
}
