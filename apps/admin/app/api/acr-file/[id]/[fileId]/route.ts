import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** Types a browser can show by itself; these open in the tab, anything else downloads. */
const INLINE = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/;

/**
 * A file on the employee's record shown on their ACR (20 Oct 2026): a document, the photo or the
 * signature. The API gives it only to those who may see the ACR. Shown in the browser (View) or saved
 * (`?save=1`).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(fileId))
    return new NextResponse(null, { status: 400 });
  try {
    const r = await apiFetch<{
      file: { contentType: string; fileName?: string | null };
      download: { url: string; saveUrl?: string };
    }>(`/people/acr/reports/${id}/files/${fileId}`);
    const save = req.nextUrl.searchParams.get('save') === '1';
    if (save && r.download.saveUrl)
      return NextResponse.redirect(r.download.saveUrl, { status: 303 });
    if (!INLINE.test(r.file.contentType))
      return NextResponse.redirect(r.download.url, { status: 303 });
    const res = await fetch(r.download.url, { cache: 'no-store' });
    if (!res.ok) return new NextResponse(null, { status: 502 });
    const name = (r.file.fileName ?? `file-${fileId}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
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
