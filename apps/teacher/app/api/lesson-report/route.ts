import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** The lesson report with the filters on screen, as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx', wrap: '1' });
  for (const k of ['by', 'q', 'from', 'to', 'status', 'level', 'record', 'mine']) {
    const v = (sp.get(k) ?? '').slice(0, 80);
    if (v) q.set(k, v);
  }
  try {
    const r = await bff.api.fetch<{ filename: string; contentType: string; base64: string }>(
      `/academics/lessons?${q.toString()}`,
    );
    return new NextResponse(Buffer.from(r.base64, 'base64'), {
      headers: {
        'content-type': r.contentType,
        'content-disposition': `attachment; filename="${r.filename.replace(/[^\w.-]+/g, '_')}"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
