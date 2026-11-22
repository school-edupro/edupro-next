import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * A grade register's file (docs/design/69): Excel (saved) or PDF (shown in a new tab) of the view on
 * screen — the section, the layout, the report and the filter — or of every section (all=1).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  const { id, format } = await params;
  if (!/^\d{1,18}$/.test(id) || !['pdf', 'xlsx'].includes(format))
    return new NextResponse(null, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format });
  const take = (key: string, ok: RegExp) => {
    const v = sp.get(key);
    if (v && ok.test(v)) q.set(key, v);
  };
  take('classSectionId', /^\d{1,18}$/);
  take('layout', /^(class|student)$/);
  take('report', /^(sheet|summary|analysis|analysis-all)$/);
  take('areas', /^[^\n]{1,4000}$/);
  take('items', /^\d{1,18}(,\d{1,18}){0,999}$/);
  take('all', /^1$/);
  take('paper', /^(A4|A3|Legal|Letter)$/);
  take('orientation', /^(portrait|landscape)$/);
  take('fit', /^[01]$/);
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/grade-registers/${id}/run?${q.toString()}`,
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
