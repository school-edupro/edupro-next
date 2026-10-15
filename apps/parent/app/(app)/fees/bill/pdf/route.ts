import { NextResponse } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** The fee bill of one of the family's children for the whole session, as a PDF made at once. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const student = url.searchParams.get('student') ?? '';
  const l = url.searchParams.get('ledger');
  const ledger = l === 'school' || l === 'hostel' ? l : 'all';
  if (!/^\d{1,18}$/.test(student)) return NextResponse.redirect(new URL('/fees', req.url), 303);
  try {
    const f = await bff.api.fetch<{ filename: string; contentType: string; base64: string }>(
      `/fees/mine/bill/file?studentId=${student}&ledger=${ledger}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const to =
        error.status === 401
          ? '/login?error=session-expired'
          : `/fees?student=${student}&tab=bill&error=not-found`;
      return NextResponse.redirect(new URL(to, req.url), 303);
    }
    throw error;
  }
}
