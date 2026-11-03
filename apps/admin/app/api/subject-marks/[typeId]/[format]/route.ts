import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** An exam type's subject marks as Excel (saved) or PDF (shown) (docs/design/70). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ typeId: string; format: string }> },
) {
  const { typeId, format } = await params;
  if (!/^\d{1,18}$/.test(typeId) || !['pdf', 'xlsx'].includes(format))
    return new NextResponse(null, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/subject-marks/file?typeId=${typeId}&format=${format}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${format === 'xlsx' ? 'attachment' : 'inline'}; filename="${f.filename}"`,
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
