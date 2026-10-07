import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The activity log reports (submission, time by category, an employee, a day), as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const report = sp.get('report') ?? '';
  const q = new URLSearchParams({
    format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx',
    report: ['category', 'employee', 'day'].includes(report) ? report : 'compliance',
  });
  for (const k of ['from', 'to', 'date']) {
    const v = sp.get(k) ?? '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) q.set(k, v);
  }
  const emp = sp.get('employeeId') ?? '';
  if (/^\d{1,18}$/.test(emp)) q.set('employeeId', emp);
  const dept = (sp.get('department') ?? '').slice(0, 120);
  if (dept) q.set('department', dept);
  const res = await apiFetchRaw(`/staff/activity/report?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="activity-log"',
    },
  });
}
