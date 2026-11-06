import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** The issue slip of what a store issued to me or my department, on the app's own origin. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 400 });
  try {
    const save = req.nextUrl.searchParams.get('save') === '1';
    const res = await bff.api.raw(`/purchase/issues/${id}/pdf${save ? '?save=1' : ''}`);
    if (!res.ok) return new NextResponse(null, { status: res.status });
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'content-type': 'application/pdf',
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
