import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The rows of an upload that need attention, as a sheet with what to fix (to correct and upload again). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/certificates/imports/${id}/errors`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename.replace(/"/g, '')}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.redirect(
        new URL(
          `/certificates/imports/${id}?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(error.problem.detail ?? '')}`,
          req.url,
        ),
        { status: 303 },
      );
    throw error;
  }
}
