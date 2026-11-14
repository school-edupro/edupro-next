import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** My salary certificate of a year, or one of my increment letters, as PDFs; shown in the tab or saved (`?save=1`). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const kind = p.get('kind');
  const fy = p.get('fy') ?? '';
  const id = p.get('id') ?? '';
  const path =
    kind === 'salcert' && /^\d{4}-\d{2}$/.test(fy)
      ? `/payroll/me/salary-certificate?fy=${fy}`
      : kind === 'letter' && /^\d{1,18}$/.test(id)
        ? `/payroll/me/letters/${id}/pdf`
        : null;
  if (!path) return new NextResponse(null, { status: 400 });
  try {
    const f = await bff.api.fetch<{ filename: string; base64: string }>(path);
    const save = p.get('save') === '1';
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `${save ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
