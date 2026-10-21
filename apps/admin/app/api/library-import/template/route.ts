import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The book upload template (docs/design/36-library.md, part 4), with the school's libraries listed. */
export async function GET() {
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      '/library/imports/template',
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
