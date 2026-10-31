import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** A class's subject counts by section (docs/design/67) as Excel (saved) or PDF (shown, or saved with ?save=1). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ classId: string; format: string }> },
) {
  const { classId, format } = await params;
  if (!/^\d{1,18}$/.test(classId) || !['pdf', 'xlsx'].includes(format))
    return new NextResponse(null, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/subject-choices/counts/file?classId=${classId}&format=${format}`,
    );
    const save = format === 'xlsx' || req.nextUrl.searchParams.get('save') === '1';
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
