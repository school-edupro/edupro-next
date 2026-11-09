import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api';

/** The Excel to fill attendance days or punches (docs/design/85, phase C). */
export async function GET(req: NextRequest) {
  const what = req.nextUrl.searchParams.get('what') === 'punches' ? 'punches' : 'days';
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/staff-attendance/sheets/${what}/format`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
