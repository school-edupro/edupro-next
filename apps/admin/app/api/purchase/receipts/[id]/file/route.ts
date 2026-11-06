import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The vendor's challan / invoice kept with a receipt (docs/design/84, part 7): a PDF or a photo. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 400 });
  const save = req.nextUrl.searchParams.get('save') === '1';
  const res = await apiFetchRaw(`/purchase/receipts/${id}/file${save ? '?save=1' : ''}`);
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
