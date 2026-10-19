import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** Types a browser can show by itself; these open in the tab, anything else downloads. */
const INLINE = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/;

/**
 * One of my own files on My profile (0187/0188): a document on my record, my photo, or an upload of mine
 * waiting for approval. Shown in the browser (View) or saved (`?save=1`); the API checks it is mine.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 400 });
  try {
    const r = await apiFetch<{
      file: { contentType: string; fileName?: string | null };
      download: { url: string; saveUrl?: string };
    }>(`/me/employee-profile/files/${id}`);
    const save = req.nextUrl.searchParams.get('save') === '1';
    if (save && r.download.saveUrl)
      return NextResponse.redirect(r.download.saveUrl, { status: 303 });
    if (!INLINE.test(r.file.contentType))
      return NextResponse.redirect(r.download.url, { status: 303 });
    const res = await fetch(r.download.url, { cache: 'no-store' });
    if (!res.ok) return new NextResponse(null, { status: 502 });
    const name = (r.file.fileName ?? `file-${id}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'content-type': r.file.contentType,
        'content-disposition': `${save ? 'attachment' : 'inline'}; filename="${name}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
