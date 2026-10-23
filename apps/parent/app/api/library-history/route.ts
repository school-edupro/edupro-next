import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/**
 * My library history as Excel or PDF (library round 4, part 3): the API checks the borrower is the
 * signed-in person or their child and makes the file of the rows as filtered.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const kind = sp.get('kind') ?? '';
  const id = sp.get('id') ?? '';
  if (!['student', 'employee'].includes(kind) || !/^\d{1,18}$/.test(id))
    return new NextResponse(null, { status: 400 });
  const q = new URLSearchParams();
  for (const k of ['from', 'to', 'status', 'q', 'format']) {
    const v = sp.get(k)?.trim();
    if (v) q.set(k, v.slice(0, 80));
  }
  try {
    const f = await bff.api.fetch<{ filename: string; contentType: string; base64: string }>(
      `/library/portal/borrowers/${kind}/${id}/history/export?${q.toString()}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
