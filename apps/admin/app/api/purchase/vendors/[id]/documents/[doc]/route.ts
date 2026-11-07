import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/**
 * A document kept with a vendor (GST certificate, PAN card, cancelled cheque …): it opens in the
 * browser (a PDF or a photo), ?save=1 saves a copy. Anyone who sees the vendor may open it.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; doc: string }> },
) {
  const { id, doc } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(doc))
    return new NextResponse(null, { status: 400 });
  const save = req.nextUrl.searchParams.get('save') === '1';
  const res = await apiFetchRaw(
    `/purchase/vendors/${id}/documents/${doc}/file${save ? '?save=1' : ''}`,
  );
  if (!res.ok) return new NextResponse(null, { status: res.status });
  const type = res.headers.get('content-type') ?? 'application/octet-stream';
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': /^(application\/pdf|image\/(png|jpeg|webp))$/.test(type)
        ? type
        : 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
