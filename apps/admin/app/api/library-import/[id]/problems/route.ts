import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The rows of an upload that were not imported, and why (part 4), to correct and upload again. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 404 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/library/imports/${id}/problems`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
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
