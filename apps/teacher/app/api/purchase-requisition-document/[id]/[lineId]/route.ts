import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** The document of an indent line a requisition came from, on the app's origin (docs/design/83). */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; lineId: string }> },
) {
  const { id, lineId } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(lineId))
    return new NextResponse(null, { status: 400 });
  try {
    const save = req.nextUrl.searchParams.get('save') === '1';
    const res = await bff.api.raw(
      `/purchase/requisitions/${id}/documents/${lineId}${save ? '?save=1' : ''}`,
    );
    if (!res.ok) return new NextResponse(null, { status: res.status });
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
        'content-disposition': res.headers.get('content-disposition') ?? 'inline',
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
