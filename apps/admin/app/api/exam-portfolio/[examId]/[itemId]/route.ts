import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** A portfolio photo of a child's progress card (docs/design/65): shown, or saved with ?save=1. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ examId: string; itemId: string }> },
) {
  const { examId, itemId } = await params;
  if (!/^\d{1,18}$/.test(examId) || !/^\d{1,18}$/.test(itemId))
    return new NextResponse(null, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/${examId}/portfolio/${itemId}/image`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `${req.nextUrl.searchParams.get('save') === '1' ? 'attachment' : 'inline'}; filename="${f.filename}"`,
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
