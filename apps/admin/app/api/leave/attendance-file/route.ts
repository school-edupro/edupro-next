import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api';

/** The payroll attendance feed of a month (Excel; docs/design/85, phase C). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: 'xlsx' });
  const m = sp.get('month') ?? '';
  if (/^\d{4}-\d{2}$/.test(m)) q.set('month', m);
  const d = (sp.get('department') ?? '').slice(0, 100);
  if (d) q.set('department', d);
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/staff-attendance/register?${q.toString()}`,
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
