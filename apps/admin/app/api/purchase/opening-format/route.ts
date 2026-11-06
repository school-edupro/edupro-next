import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The Excel format of a store's opening stock (docs/design/84, part 6). */
export async function GET(req: NextRequest) {
  const store = req.nextUrl.searchParams.get('store') ?? '';
  if (!/^\d{1,18}$/.test(store)) return new NextResponse(null, { status: 400 });
  try {
    const t = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/purchase/stores/${store}/opening-template`,
    );
    return new NextResponse(Buffer.from(t.base64, 'base64'), {
      headers: {
        'content-type': t.contentType,
        'content-disposition': `attachment; filename="${t.filename}"`,
        'cache-control': 'no-store',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
