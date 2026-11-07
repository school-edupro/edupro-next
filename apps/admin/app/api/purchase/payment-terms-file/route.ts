import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const KEYS: Record<string, (v: string) => boolean> = {
  q: (v) => v.length <= 80,
  status: (v) => v === 'active' || v === 'inactive',
  kind: (v) => v === 'advance' || v === 'delivery' || v === 'invoice',
  over45: (v) => v === '1',
};

/** The payment terms as on screen (filters kept), as Excel or PDF; the file is saved. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const [k, ok] of Object.entries(KEYS)) {
    const v = (sp.get(k) ?? '').trim();
    if (v && ok(v)) q.set(k, v);
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/purchase/payment-terms/export?${q.toString()}`,
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
