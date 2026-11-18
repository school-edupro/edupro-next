import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The Range Wise Summary as Excel (saved) or PDF (shown, or saved with `?save=1`). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ format: string }> }) {
  const { format } = await params;
  if (format !== 'pdf' && format !== 'xlsx') return new NextResponse(null, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({
    format,
    classLabel: sp.get('classLabel') === 'XII' ? 'XII' : 'X',
  });
  const year = sp.get('examYear') ?? '';
  if (/^\d{4}$/.test(year)) q.set('examYear', year);
  const compare = sp.get('compare') ?? '';
  if (/^[0-4]$/.test(compare)) q.set('compare', compare);
  const gender = sp.get('gender') ?? '';
  if (gender === 'M' || gender === 'F') q.set('gender', gender);
  const method = sp.get('method') ?? '';
  if (method === 'all' || method === 'first5') q.set('method', method);
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/board-results/reports/range-overall/file?${q.toString()}`,
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
      return NextResponse.redirect(
        new URL(
          `/exams/board-results?tab=reports&report=overall&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(error.problem.detail ?? 'The file could not be made')}`,
          req.url,
        ),
        { status: 303 },
      );
    throw error;
  }
}
