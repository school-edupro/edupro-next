import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The Topper Report as Excel (saved) or PDF (shown, or saved with `?save=1`). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ format: string }> }) {
  const { format } = await params;
  if (format !== 'pdf' && format !== 'xlsx') return new NextResponse(null, { status: 404 });
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({
    format,
    classLabel: sp.get('classLabel') === 'XII' ? 'XII' : 'X',
  });
  const pick = (key: string, ok: RegExp) => {
    const v = sp.get(key) ?? '';
    if (ok.test(v)) q.set(key, v);
  };
  pick('examYear', /^\d{4}$/);
  pick('compare', /^[0-4]$/);
  pick('method', /^(best5|first5|all)$/);
  pick('gender', /^(M|F)$/);
  pick('section', /^[\w -]{1,40}$/);
  pick('show', /^(overall|subjects|both)$/);
  pick('codes', /^\d{3}(,\d{3}){0,79}$/);
  pick('top', /^\d{1,2}$/);
  pick('low', /^\d{1,2}$/);
  pick('pctOp', /^(gte|lte)$/);
  pick('pct', /^\d{1,3}(\.\d{1,2})?$/);
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/board-results/reports/toppers/file?${q.toString()}`,
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
          `/exams/board-results?tab=reports&report=toppers&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(error.problem.detail ?? 'The file could not be made')}`,
          req.url,
        ),
        { status: 303 },
      );
    throw error;
  }
}
