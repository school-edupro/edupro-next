import { NextResponse, type NextRequest } from 'next/server';
import { PublicApiError } from '@/lib/api';
import { careersFetch } from '@/lib/careers';

const INLINE = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/;

/** One of my own documents on the careers page, shown in the browser (the API checks it is mine). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 400 });
  try {
    const r = await careersFetch<{
      file: { contentType: string };
      download: { url: string };
    }>(`/me/files/${id}`);
    if (!INLINE.test(r.file.contentType))
      return NextResponse.redirect(r.download.url, { status: 303 });
    const res = await fetch(r.download.url, { cache: 'no-store' });
    if (!res.ok) return new NextResponse(null, { status: 502 });
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'content-type': r.file.contentType,
        'content-disposition': `inline; filename="document-${id}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof PublicApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
