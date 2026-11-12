import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api';

/** The month's attendance sheet for payroll: a row per employee on the roster, with what is there now. */
export async function GET(req: NextRequest) {
  const month = req.nextUrl.searchParams.get('month') ?? '';
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return new NextResponse(null, { status: 400 });
  try {
    const f = await apiFetch<{ filename: string; base64: string }>(
      `/payroll/inputs/attendance/format?month=${month}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
