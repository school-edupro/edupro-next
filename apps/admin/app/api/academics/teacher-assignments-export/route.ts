import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** Teacher assignments with the filters on screen, as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const format = sp.get('format') === 'pdf' ? 'pdf' : 'xlsx';
  const q = new URLSearchParams({ format });
  for (const k of ['classSectionId', 'employeeId']) {
    const v = sp.get(k) ?? '';
    if (/^\d{1,18}$/.test(v)) q.set(k, v);
  }
  if (sp.get('includeEnded')) q.set('includeEnded', 'true');
  const res = await apiFetchRaw(`/academics/teacher-assignments/export?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition':
        res.headers.get('content-disposition') ??
        `attachment; filename="teacher-assignments.${format}"`,
    },
  });
}
