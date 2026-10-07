import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** The class documents of the teacher's classes, with the filters on screen, as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const k of ['from', 'to']) {
    const v = sp.get(k) ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) q.set(k, v);
  }
  const section = sp.get('classSectionId') ?? '';
  if (/^\d{1,18}$/.test(section)) q.set('classSectionId', section);
  const kind = sp.get('kind') ?? '';
  if (/^[a-z_]{3,20}$/.test(kind)) q.set('kind', kind);
  q.set('wrap', '1');
  try {
    const r = await bff.api.fetch<{ filename: string; contentType: string; base64: string }>(
      `/academics/documents/report?${q.toString()}`,
    );
    return new NextResponse(Buffer.from(r.base64, 'base64'), {
      headers: {
        'content-type': r.contentType,
        'content-disposition': `attachment; filename="${r.filename.replace(/[^\\w.-]+/g, '_')}"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
