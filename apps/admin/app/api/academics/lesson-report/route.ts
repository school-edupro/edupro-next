import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The lesson report with the filters on screen, as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const k of ['by', 'q', 'from', 'to', 'status', 'level', 'record', 'mine']) {
    const v = (sp.get(k) ?? '').slice(0, 80);
    if (v) q.set(k, v);
  }
  const res = await apiFetchRaw(`/academics/lessons?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="lesson-report"',
    },
  });
}
