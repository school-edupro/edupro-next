import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** A sheet of QR labels for the ticked assets (?ids=1&ids=2, or ?ids=1,2). */
export async function GET(req: NextRequest) {
  const ids = req.nextUrl.searchParams
    .getAll('ids')
    .flatMap((x) => x.split(','))
    .filter((x) => /^\d{1,18}$/.test(x))
    .slice(0, 600);
  if (!ids.length) return new NextResponse('Tick the assets to label', { status: 400 });
  const res = await apiFetchRaw(`/purchase/asset-labels?ids=${ids.join(',')}`);
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
