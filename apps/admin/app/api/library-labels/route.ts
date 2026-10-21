import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * Barcode and spine labels as a PDF (docs/design/36-library.md, part 5): the labels form posts its
 * choice (as JSON in one field); the PDF opens in the browser, or is saved with `save=1`.
 */
export async function POST(req: NextRequest) {
  // only this app's own pages may post here
  const origin = req.headers.get('origin');
  if (origin && origin !== req.nextUrl.origin) return new NextResponse(null, { status: 403 });
  const fd = await req.formData();
  const raw = fd.get('body');
  let body: Record<string, unknown>;
  try {
    if (typeof raw !== 'string' || raw.length > 200_000) throw new Error('no body');
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return new NextResponse('Not printed: the form did not come through.', { status: 400 });
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      '/library/labels',
      { method: 'POST', body: JSON.stringify({ ...body, dry: false }) },
    );
    const save = fd.get('save') === '1';
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${save ? 'attachment' : 'inline'}; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return new NextResponse(
        `Not printed: ${String(error.problem.detail ?? error.problem.type)}`,
        {
          status: error.status,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        },
      );
    throw error;
  }
}
