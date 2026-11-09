import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const KEEP = /^(day|from|to|month|fromMonth|toMonth|department|employeeId|typeId|status)$/;

/** A leave & attendance report given to me, as Excel or PDF (docs/design/85, phase D). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const report = sp.get('report') ?? '';
  if (!/^[a-z_]{3,40}$/.test(report)) return new NextResponse(null, { status: 404 });
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const [k, v] of sp) if (KEEP.test(k) && v) q.set(k, v.slice(0, 100));
  try {
    const r = await bff.api.fetch<{ filename: string; contentType: string; base64: string }>(
      `/leave-reports/reports/${report}?${q.toString()}`,
    );
    return new NextResponse(Buffer.from(r.base64, 'base64'), {
      headers: {
        'content-type': r.contentType,
        'content-disposition': `attachment; filename="${r.filename.replace(/[^\w.-]+/g, '_')}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
