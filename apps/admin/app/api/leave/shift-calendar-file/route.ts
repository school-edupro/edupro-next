import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api';

/** The shift calendar of a month as Excel or PDF, with the filters of the page. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  const month = sp.get('month') ?? '';
  if (/^\d{4}-\d{2}$/.test(month)) q.set('month', month);
  const text = (sp.get('q') ?? '').trim().slice(0, 80);
  if (text) q.set('q', text);
  const d = (sp.get('department') ?? '').trim().slice(0, 100);
  if (d) q.set('department', d);
  const s = sp.get('shiftId') ?? '';
  if (/^\d{1,18}$/.test(s)) q.set('shiftId', s);
  if (sp.get('unposted') === '1') q.set('unposted', '1');
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/staff-attendance/shift-calendar?${q.toString()}`,
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
