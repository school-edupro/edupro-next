import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** A Purchase Requisition printed, with its comparative statement, as a PDF (docs/design/83). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 400 });
  const save = req.nextUrl.searchParams.get('save') === '1';
  const res = await apiFetchRaw(`/purchase/requisitions/${id}/pdf${save ? '?save=1' : ''}`);
  if (!res.ok) return new NextResponse(null, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': res.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
