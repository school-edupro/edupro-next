import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

const ID = /^\d{1,18}$/;

/** A document of a registration waiting for the approver (docs/design/50), through the admin's origin. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; fileId: string }> },
) {
  const { id, fileId } = await params;
  if (!ID.test(id) || !ID.test(fileId))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const download = req.nextUrl.searchParams.get('download') === '1';
  const res = await apiFetchRaw(
    `/admissions/approvals/${id}/files/${fileId}${download ? '?download=1' : ''}`,
  );
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'private, no-store',
    },
  });
}
