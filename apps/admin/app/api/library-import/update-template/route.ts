import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * The books update template (docs/design/36-library.md, "Library round 3", part 2): the copies of the
 * library, shelf and material type chosen, filled with what they have now, in the columns ticked.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams();
  const fields = sp.getAll('field').filter((k) => /^[a-z_]{2,30}$/.test(k));
  if (fields.length) q.set('fields', fields.join(','));
  for (const k of ['libraryId', 'shelfId', 'materialTypeId']) {
    const v = sp.get(k) ?? '';
    if (/^\d{1,18}$/.test(v)) q.set(k, v);
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/library/books/update/template${q.size ? `?${q.toString()}` : ''}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return new NextResponse(`Not made: ${String(error.problem.detail ?? error.problem.type)}`, {
        status: error.status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    throw error;
  }
}
