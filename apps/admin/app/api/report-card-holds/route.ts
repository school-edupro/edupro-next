import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const ID = /^\d{1,18}$/;

/**
 * A release's held cards as Excel or PDF, or the Excel to fill with admission numbers to hold
 * (docs/design/75): saved, never shown.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const releaseId = sp.get('releaseId') ?? '';
  if (!ID.test(releaseId)) return new NextResponse(null, { status: 404 });
  let path: string;
  if (sp.get('kind') === 'template')
    path = `/exams/report-cards/releases/${releaseId}/holds/template`;
  else {
    const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
    for (const k of ['classId', 'classSectionId']) {
      const v = sp.get(k) ?? '';
      if (ID.test(v)) q.set(k, v);
    }
    const words = (sp.get('q') ?? '').trim().slice(0, 60);
    if (words) q.set('q', words);
    path = `/exams/report-cards/releases/${releaseId}/holds/file?${q.toString()}`;
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(path);
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        // the PDF opens in the browser (View) unless saved; the Excel always saves
        'content-disposition': `${
          f.contentType === 'application/pdf' && sp.get('save') !== '1' ? 'inline' : 'attachment'
        }; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(error.problem, { status: error.status });
    throw error;
  }
}
