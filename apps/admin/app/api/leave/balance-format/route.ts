import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';

/** The Excel to fill the opening leave balances (every active employee and leave type with a balance). */
export async function GET() {
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      '/leave/balances/format',
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
