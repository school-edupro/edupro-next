import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/**
 * One of my payslips (docs/design/86, phase B), locked with my password: shown in the tab (View) or saved
 * (`?save=1`). The API checks the payslip is mine and its run is locked.
 */
export async function GET(req: NextRequest) {
  const record = req.nextUrl.searchParams.get('record') ?? '';
  if (!/^\d{1,18}$/.test(record)) return new NextResponse(null, { status: 400 });
  try {
    const f = await bff.api.fetch<{ filename: string; base64: string }>(
      `/payroll/me/payslips/${record}`,
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
