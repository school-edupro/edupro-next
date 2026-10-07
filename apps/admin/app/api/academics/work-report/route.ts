import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** Homework, classwork and assignments posted between two dates, as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const format = sp.get('format') === 'pdf' ? 'pdf' : 'xlsx';
  const q = new URLSearchParams({ format });
  for (const k of ['from', 'to']) {
    const v = sp.get(k) ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) q.set(k, v);
  }
  const section = sp.get('classSectionId') ?? '';
  if (/^\d{1,18}$/.test(section)) q.set('classSectionId', section);
  const kind = sp.get('kind') ?? '';
  if (kind === 'daily' || kind === 'assignment') q.set('kind', kind);
  const res = await apiFetchRaw(`/academics/daily-work/report?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        res.headers.get('content-disposition') ?? `attachment; filename="daily-work.${format}"`,
    },
  });
}
