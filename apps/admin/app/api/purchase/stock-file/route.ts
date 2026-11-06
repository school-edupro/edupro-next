import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const ID = /^\d{1,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Stock in hand, or an item's stock register (?item=), as Excel or PDF (docs/design/84, part 6). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  const store = sp.get('storeId') ?? '';
  if (ID.test(store)) q.set('storeId', store);
  const item = sp.get('item') ?? '';
  let path = '/purchase/stock';
  if (item) {
    if (!ID.test(item)) return new NextResponse(null, { status: 400 });
    path = `/purchase/stock/items/${item}`;
    for (const k of ['from', 'to']) {
      const v = sp.get(k) ?? '';
      if (DAY.test(v)) q.set(k, v);
    }
  } else {
    const cat = sp.get('categoryId') ?? '';
    if (ID.test(cat)) q.set('categoryId', cat);
    if (sp.get('below') === '1') q.set('below', '1');
    const s = (sp.get('q') ?? '').slice(0, 80);
    if (s) q.set('q', s);
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `${path}?${q.toString()}`,
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
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
