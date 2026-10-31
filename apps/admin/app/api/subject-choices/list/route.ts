import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * A section's or a class's students with their subjects (docs/design/67): Excel (saved) or PDF (shown,
 * or saved with ?save=1), landscape or upright.
 */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const classId = p.get('classId') ?? '';
  const sectionId = p.get('classSectionId') ?? '';
  const format = p.get('format') ?? 'pdf';
  const id = /^\d{1,18}$/;
  if ((!id.test(classId) && !id.test(sectionId)) || !['pdf', 'xlsx'].includes(format))
    return new NextResponse(null, { status: 404 });
  const query = new URLSearchParams({
    ...(id.test(sectionId) ? { classSectionId: sectionId } : { classId }),
    format,
    portrait: p.get('portrait') === 'true' ? 'true' : 'false',
  });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/subject-choices/list-file?${query.toString()}`,
    );
    const save = format === 'xlsx' || p.get('save') === '1';
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
