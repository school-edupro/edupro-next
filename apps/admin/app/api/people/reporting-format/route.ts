import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';

/** The Excel of every active employee with their reporting manager's code now, to change and upload. */
export async function GET() {
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      '/people/reporting/format',
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return new NextResponse(null, { status: 404 });
  }
}
