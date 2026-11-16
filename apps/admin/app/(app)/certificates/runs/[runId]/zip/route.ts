import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** Every batch PDF of a bulk run in one ZIP (a file each, named by its section or department). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/.test(runId))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/certificates/runs/${runId}/zip`,
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
          `/certificates/runs/${runId}?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(error.problem.detail ?? '')}`,
          req.url,
        ),
        { status: 303 },
      );
    throw error;
  }
}
