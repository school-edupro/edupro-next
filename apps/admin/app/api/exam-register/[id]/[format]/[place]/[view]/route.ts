import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** A scheme's register as Excel (saved) or PDF (shown, or saved with ?save=1); docs/design/65. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; format: string; place: string; view: string }> },
) {
  const { id, format, place, view } = await params;
  const m = /^([sc])(\d{1,18})$/.exec(place);
  if (
    !/^\d{1,18}$/.test(id) ||
    !['pdf', 'xlsx'].includes(format) ||
    !m ||
    !['marks', 'merit'].includes(view)
  )
    return new NextResponse(null, { status: 404 });
  const where = m[1] === 's' ? `classSectionId=${m[2]!}` : `classId=${m[2]!}`;
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/schemes/${id}/register?${where}&view=${view}&format=${format}`,
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
