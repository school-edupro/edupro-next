import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The merit list of a class (PDF, docs/design/40): shown in the browser, or saved with `?save=1`. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; classId: string }> },
) {
  const { id, classId } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(classId))
    return new NextResponse(null, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/admissions/cycles/${id}/selection/${classId}/merit-list`,
    );
    const save = req.nextUrl.searchParams.get('save') === '1';
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
