import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** An exam's mark register of a section as Excel (saved) or PDF (shown, or saved with ?save=1). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; section: string; format: string }> },
) {
  const { id, section, format } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(section) || !['pdf', 'xlsx'].includes(format))
    return new NextResponse(null, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/${id}/register-sheet?classSectionId=${section}&format=${format}`,
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
