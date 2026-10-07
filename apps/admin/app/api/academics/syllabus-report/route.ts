import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** Syllabus coverage, topic-wise status or the week's missing lesson plans, as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const report = sp.get('report') ?? '';
  const q = new URLSearchParams({
    format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx',
    report: report === 'topics' || report === 'missing' ? report : 'coverage',
  });
  for (const k of ['classId', 'subjectId', 'employeeId', 'classSectionId']) {
    const v = sp.get(k) ?? '';
    if (/^\d{1,18}$/.test(v)) q.set(k, v);
  }
  const week = sp.get('week') ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(week)) q.set('week', week);
  const res = await apiFetchRaw(`/academics/syllabus/report?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="syllabus"',
    },
  });
}
