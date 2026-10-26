import { NextResponse, type NextRequest } from 'next/server';
import { bff } from '@/lib/bff';

const ID = /^\d{1,18}$/;

/** A document of a registration waiting for me (docs/design/50), through the staff app's origin. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  if (!ID.test(id) || !ID.test(fileId)) return new NextResponse(null, { status: 400 });
  const download = req.nextUrl.searchParams.get('download') === '1';
  const res = await bff.api.raw(
    `/admissions/approvals/${id}/files/${fileId}${download ? '?download=1' : ''}`,
  );
  if (!res.ok) return new NextResponse(null, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
