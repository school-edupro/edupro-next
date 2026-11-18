import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The Results tab's list (the filters' rows) as Excel (saved) or PDF (shown, or saved with `?save=1`). */
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
  const section = (sp.get('section') ?? '').trim();
  if (section && section.length <= 40) q.set('section', section);
  if (sp.get('method') === 'all') q.set('method', 'all');
  const result = sp.get('result') ?? '';
  if (/^[A-Z]{1,8}$/.test(result)) q.set('result', result);
  const band = sp.get('band') ?? '';
  if (['90', '75', '60', '45', 'below45'].includes(band)) q.set('band', band);
  const sort = sp.get('sort') ?? '';
  if (['rank', 'roll', 'name', 'section'].includes(sort)) q.set('sort', sort);
  const search = (sp.get('q') ?? '').trim().slice(0, 60);
  if (search) q.set('q', search);
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/board-results/marks/file?${q.toString()}`,
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
          `/exams/board-results?tab=results&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(error.problem.detail ?? 'The file could not be made')}`,
          req.url,
        ),
        { status: 303 },
      );
    throw error;
  }
}
