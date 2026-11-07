import { NextResponse } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** The indent item sheet to fill (items as a drop-down), saved (docs/design/83). */
export async function GET() {
  try {
    const f = await bff.api.fetch<{ filename: string; contentType: string; base64: string }>(
      '/purchase/indent-sheet',
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
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
