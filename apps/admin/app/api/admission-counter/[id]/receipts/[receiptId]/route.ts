import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

const ID = /^\d{1,18}$/;

/** A registration's receipt for the fee counter (docs/design/52); `?save=1` downloads it. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; receiptId: string }> },
) {
  const { id, receiptId } = await params;
  if (!ID.test(id) || !ID.test(receiptId))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const save = req.nextUrl.searchParams.get('save') === '1';
  const res = await apiFetchRaw(
    `/fees/admission-counter/${id}/receipts/${receiptId}/pdf${save ? '?download=1' : ''}`,
  );
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/pdf',
      'content-disposition': res.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
