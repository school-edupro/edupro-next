import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** My own activity log between two dates, as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const k of ['from', 'to']) {
    const v = sp.get(k) ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) q.set(k, v);
  }
  const res = await apiFetchRaw(`/staff/activity/mine/report?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="my-activity-log"',
    },
  });
}
