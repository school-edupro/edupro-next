import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** A card design's picture (docs/design/73), shown in the designer. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; slot: string }> },
) {
  const { id, slot } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^[a-z0-9_]{2,20}$/.test(slot))
    return new NextResponse(null, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/exams/report-cards/templates/${id}/art/${slot}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `inline; filename="${f.filename}"`,
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
