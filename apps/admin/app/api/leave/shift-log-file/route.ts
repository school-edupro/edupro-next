import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch } from '@/lib/api';

/** The shift posting change log as Excel or PDF, with the filters of the page. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  const text = (sp.get('q') ?? '').trim().slice(0, 80);
  if (text) q.set('q', text);
  const d = (sp.get('department') ?? '').trim().slice(0, 100);
  if (d) q.set('department', d);
  const e = sp.get('employeeId') ?? '';
  if (/^\d{1,18}$/.test(e)) q.set('employeeId', e);
  for (const k of ['from', 'to']) {
    const v = sp.get(k) ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) q.set(k, v);
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/staff-attendance/shift-calendar/log?${q.toString()}`,
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
