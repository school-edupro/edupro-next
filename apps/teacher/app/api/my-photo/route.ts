import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/**
 * My own photo on My profile (0188): the one on file, or with ?file= the one I uploaded for a change
 * that waits for approval. The API gives the signed address (no file right needed); the bytes pass
 * through here because its files cannot be embedded cross-origin.
 */
export async function GET(req: NextRequest) {
  const file = req.nextUrl.searchParams.get('file') ?? '';
  if (file && !/^\d{1,18}$/.test(file)) return new NextResponse(null, { status: 400 });
  try {
    const r = await bff.api.fetch<{ file: { contentType: string }; download: { url: string } }>(
      `/me/employee-profile/photo${file ? `?file=${file}` : ''}`,
    );
    if (!/^image\/(png|jpeg|webp)$/.test(r.file.contentType))
      return new NextResponse(null, { status: 415 });
    const res = await fetch(r.download.url, { cache: 'no-store' });
    if (!res.ok) return new NextResponse(null, { status: 502 });
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'content-type': r.file.contentType,
        'cache-control': 'private, max-age=60',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
