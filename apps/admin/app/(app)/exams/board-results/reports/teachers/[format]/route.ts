import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The teacher wise result analysis as Excel (saved) or PDF (shown, or saved with `?save=1`). */
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
  const gender = sp.get('gender') ?? '';
  if (gender === 'M' || gender === 'F') q.set('gender', gender);
  const code = sp.get('code') ?? '';
  if (/^\d{3}$/.test(code)) q.set('code', code);
  const teacher = sp.get('teacher') ?? '';
  if (/^(\d{1,18}|none|n:[^\n]{1,120})$/.test(teacher)) q.set('teacher', teacher);
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/board-results/reports/teacher-analysis/file?${q.toString()}`,
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
          `/exams/board-results?tab=reports&report=teachers&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(error.problem.detail ?? 'The file could not be made')}`,
          req.url,
        ),
        { status: 303 },
      );
    throw error;
  }
}
