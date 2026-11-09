import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch, apiFetchRaw } from '@/lib/api';

/**
 * A store's opening stock statement (docs/design/84, "As built — opening stock corrections", 9 Nov
 * 2026): ?store=…, the PDF (opens, or saves with ?save=1) or ?format=xlsx as Excel.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const store = sp.get('store') ?? '';
  if (!/^\d{1,18}$/.test(store)) return new NextResponse(null, { status: 400 });
  if (sp.get('format') === 'xlsx') {
    try {
      const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
        `/purchase/stores/${store}/opening-statement?format=xlsx`,
      );
      return new NextResponse(Buffer.from(f.base64, 'base64'), {
        headers: {
          'content-type': f.contentType,
          'content-disposition': `attachment; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (error) {
      if (error instanceof ApiError)
        return NextResponse.json({ type: error.problem.type }, { status: error.status });
      throw error;
    }
  }
  const save = sp.get('save') === '1';
  const res = await apiFetchRaw(
    `/purchase/stores/${store}/opening-statement${save ? '?save=1' : ''}`,
  );
  if (!res.ok) return new NextResponse(null, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': res.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
