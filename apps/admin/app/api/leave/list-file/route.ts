import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api';

const KEEP = /^(month|department|q|employeeId|leaveTypeId|kind|status)$/;

/** The balances or the late-mark / missing-punch / correction lists as Excel or PDF (docs/design/85), filters kept. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const list = sp.get('list');
  const path =
    list === 'balances'
      ? '/leave/balances'
      : list === 'exceptions'
        ? '/staff-attendance/exceptions'
        : null;
  if (!path) return new NextResponse(null, { status: 404 });
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const [k, v] of sp) if (KEEP.test(k) && v) q.set(k, v.slice(0, 100));
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `${path}?${q.toString()}`,
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
