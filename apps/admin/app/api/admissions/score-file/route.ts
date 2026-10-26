import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

const ID = /^\d{1,18}$/;
const TABLES = new Set(['qualification', 'locality', 'alumni_school']);

/**
 * Files of docs/design/48 through the admin's own origin: a score table as Excel (`table=…`, `rows=1`
 * for its rows, else the empty format) or the score report of a class (`report=xlsx|pdf`).
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  let path: string;
  const table = q.get('table');
  const report = q.get('report');
  if (table && TABLES.has(table)) {
    path =
      q.get('format') === 'pdf'
        ? `/admissions/score-tables/${table}/sheet.pdf`
        : `/admissions/score-tables/${table}/sheet.xlsx${q.get('rows') === '1' ? '?rows=1' : ''}`;
  } else if (
    (report === 'xlsx' || report === 'pdf') &&
    ID.test(q.get('cycleId') ?? '') &&
    ID.test(q.get('classId') ?? '')
  ) {
    const p = new URLSearchParams({ cycleId: q.get('cycleId')!, classId: q.get('classId')! });
    const cat = q.get('categoryId');
    if (cat && ID.test(cat)) p.set('categoryId', cat);
    const st = q.get('status');
    if (st && /^[a-z_]{3,20}$/.test(st)) p.set('status', st);
    if (q.get('check') === '1') p.set('check', '1');
    path = `/admissions/score-report.${report}?${p.toString()}`;
  } else return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const res = await apiFetchRaw(path);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'attachment',
    },
  });
}
