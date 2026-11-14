import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** My tax certificate (once released) or my declaration form, as PDFs; shown in the tab or saved (`?save=1`). */
export async function GET(req: NextRequest) {
  const fy = req.nextUrl.searchParams.get('fy') ?? '';
  const kind = req.nextUrl.searchParams.get('kind');
  if (!/^\d{4}-\d{2}$/.test(fy) || (kind !== 'cert' && kind !== 'decl'))
    return new NextResponse(null, { status: 400 });
  try {
    const f = await bff.api.fetch<{ filename: string; base64: string }>(
      kind === 'cert'
        ? `/payroll/me/tax/certificate?fy=${fy}`
        : `/payroll/me/tax/declaration-form?fy=${fy}`,
    );
    const save = req.nextUrl.searchParams.get('save') === '1';
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
