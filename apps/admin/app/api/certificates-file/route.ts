import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const KEYS = ['type', 'status', 'copy', 'override', 'q', 'from', 'to', 'year'];

/** The certificate register as filtered on the screen, as Excel or PDF, made at once by the API. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  // the register (default), the TC book register, or a report (docs/design/87, phase E)
  const kind = sp.get('kind');
  const keys =
    kind === 'tc-book'
      ? ['book', 'status', 'from', 'to', 'q']
      : kind === 'report'
        ? ['from', 'to']
        : KEYS;
  for (const k of keys) {
    const v = sp.get(k);
    if (v) qs.set(k, v.slice(0, 80));
  }
  const report = sp.get('report') ?? '';
  if (kind === 'report' && ['types', 'months', 'issuers', 'overrides', 'requests'].includes(report))
    qs.set('kind', report);
  const path =
    kind === 'tc-book'
      ? '/certificates/tc-book/file'
      : kind === 'report'
        ? '/certificates/reports/file'
        : '/certificates/file';
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `${path}?${qs.toString()}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
