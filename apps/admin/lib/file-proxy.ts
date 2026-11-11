import { NextResponse } from 'next/server';
import { apiFetch } from '@/lib/api';

/** An API file answer ({ filename, contentType, base64 }) passed on as a download. */
export async function fileFrom(path: string) {
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(path);
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
