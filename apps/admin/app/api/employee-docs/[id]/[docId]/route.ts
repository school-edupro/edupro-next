import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * One employment document of an employee, from the admin's own origin: shown in the browser (View) or
 * saved (`?save=1`, Download). The API checks the document belongs to the employee and the right to see it.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const { id, docId } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(docId))
    return new NextResponse(null, { status: 400 });
  try {
    const r = await apiFetch<{
      file: { contentType: string; fileName: string | null };
      download: { url: string };
    }>(`/people/staff/${id}/documents/${docId}/file`);
    const res = await fetch(r.download.url, { cache: 'no-store' });
    if (!res.ok) return new NextResponse(null, { status: 502 });
    const name = (r.file.fileName ?? `document-${docId}`).replace(/[^\w.\- ]+/g, '_');
    const save = req.nextUrl.searchParams.get('save') === '1';
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
