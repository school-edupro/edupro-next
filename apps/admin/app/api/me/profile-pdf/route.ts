import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** My profile as a PDF, made at once by the API (no workers): opens in the browser; `?save=1` downloads it. */
export async function GET(req: NextRequest) {
  try {
    const r = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      '/me/employee-profile/pdf',
    );
    const save = req.nextUrl.searchParams.get('save') === '1';
    return new NextResponse(Buffer.from(r.base64, 'base64'), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `${save ? 'attachment' : 'inline'}; filename="${r.filename.replace(/[^\w.-]+/g, '_')}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
