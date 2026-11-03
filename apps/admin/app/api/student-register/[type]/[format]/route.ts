import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * A Remark, Attendance or Height & Weight register's file (docs/design/69): Excel (saved) or PDF (shown
 * in a new tab) for the class, the section (or all), the exams and the paper asked.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ type: string; format: string }> },
) {
  const { type, format } = await params;
  if (!['remark', 'attendance', 'health'].includes(type) || !['pdf', 'xlsx'].includes(format))
    return new NextResponse(null, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format });
  const take = (key: string, ok: RegExp) => {
    const v = sp.get(key);
    if (v && ok.test(v)) q.set(key, v);
  };
  take('classId', /^\d{1,18}$/);
  take('section', /^(all|\d{1,18})$/);
  take('exams', /^\d{1,18}(,\d{1,18}){0,29}$/);
  take('cutoff', /^\d{1,3}$/);
  take('bmi', /^[01]$/);
  take('paper', /^(A4|A3|Legal|Letter)$/);
  take('orientation', /^(portrait|landscape)$/);
  take('fit', /^[01]$/);
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/registers/${type}?${q.toString()}`,
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
