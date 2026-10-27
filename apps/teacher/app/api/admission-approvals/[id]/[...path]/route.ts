import { NextResponse, type NextRequest } from 'next/server';
import { bff } from '@/lib/bff';

const ID = /^\d{1,18}$/;

/**
 * A registration's files for its approver (docs/design/50, 51), through the staff app's origin:
 * `files/<id>` (a document), `form` (the registration form PDF), `receipts/<id>` (a receipt PDF).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> },
) {
  const { id, path } = await params;
  if (!ID.test(id)) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const [kind, ref] = path;
  const api =
    kind === 'files' && ref && ID.test(ref)
      ? `/admissions/approvals/${id}/files/${ref}`
      : kind === 'form' && !ref
        ? `/admissions/approvals/${id}/form.pdf`
        : kind === 'receipts' && ref && ID.test(ref)
          ? `/admissions/approvals/${id}/receipts/${ref}/pdf`
          : null;
  if (!api) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const download = req.nextUrl.searchParams.get('download') === '1';
  const res = await bff.api.raw(`${api}${download ? '?download=1' : ''}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
