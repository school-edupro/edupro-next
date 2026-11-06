import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * A register's file (docs/design/68): Excel (saved) or PDF (shown in a new tab, or saved with ?save=1)
 * for a section (s123), a class ranked together (c123) or the first section (first); the query passes
 * the exam, the subject, every section (all=1) and the paper (paper, orientation, fit).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; format: string; place: string; view: string }> },
) {
  const { id, format, place, view } = await params;
  const m = /^([sc])(\d{1,18})$/.exec(place);
  if (
    !/^\d{1,18}$/.test(id) ||
    !['pdf', 'xlsx'].includes(format) ||
    !(m || place === 'first') ||
    !['marks', 'merit', 'division'].includes(view)
  )
    return new NextResponse(null, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ view, format });
  if (m) q.set(m[1] === 's' ? 'classSectionId' : 'classId', m[2]!);
  const exam = sp.get('exam');
  if (exam && /^[A-Z][A-Z0-9_]{0,11}$/.test(exam)) q.set('exam', exam);
  const subject = sp.get('subject');
  if (subject && /^[A-Za-z0-9_~-]{1,32}$/.test(subject)) q.set('subject', subject);
  if (sp.get('all') === '1') q.set('all', '1');
  const report = sp.get('report');
  if (
    report &&
    /^(summary|analysis|entry|missing|absent|toppers|teacher|risk|failing|compare)$/.test(report)
  )
    q.set('report', report);
  // toppers (docs/design/76): any N 1–100 or all, a % range, the lowest first
  const top = sp.get('top');
  if (top && (top === 'all' || (/^\d{1,3}$/.test(top) && +top >= 1 && +top <= 100)))
    q.set('top', top);
  for (const k of ['pctFrom', 'pctTo']) {
    const v = sp.get(k);
    if (v && /^\d{1,3}(\.\d{1,2})?$/.test(v) && +v <= 100) q.set(k, v);
  }
  if (sp.get('lowest') === '1') q.set('lowest', '1');
  // failing students (docs/design/77): the number of subjects failed, from – to
  for (const k of ['failFrom', 'failTo']) {
    const v = sp.get(k);
    if (v && /^\d{1,2}$/.test(v) && +v >= 1 && +v <= 10) q.set(k, v);
  }
  const margin = sp.get('margin');
  if (margin && ['5', '10'].includes(margin)) q.set('margin', margin);
  const paper = sp.get('paper');
  if (paper && ['A4', 'A3', 'Legal', 'Letter'].includes(paper)) q.set('paper', paper);
  const orientation = sp.get('orientation');
  if (orientation && ['portrait', 'landscape'].includes(orientation))
    q.set('orientation', orientation);
  const fit = sp.get('fit');
  if (fit === '0' || fit === '1') q.set('fit', fit);
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/schemes/${id}/register?${q.toString()}`,
    );
    const save = format === 'xlsx' || sp.get('save') === '1';
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${save ? 'attachment' : 'inline'}; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(error.problem, { status: error.status });
    throw error;
  }
}
