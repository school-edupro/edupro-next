import { NextResponse, type NextRequest } from 'next/server';
import { apiFetch, apiFetchRaw } from '@/lib/api';

const KINDS = ['issues', 'returns', 'transfers', 'counts', 'condemnations'] as const;

/**
 * A store's document as a PDF (docs/design/84, part 8): the issue slip, the return note, the transfer
 * note, the count sheet or statement — opens, or saves with ?save=1. `?sheet=1` on a count gives the
 * blind count sheet as Excel.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const { kind, id } = await params;
  if (!(KINDS as readonly string[]).includes(kind) || !/^\d{1,18}$/.test(id))
    return new NextResponse(null, { status: 400 });
  const excel =
    kind === 'counts' && req.nextUrl.searchParams.get('sheet') === '1'
      ? 'sheet'
      : kind === 'counts' && req.nextUrl.searchParams.get('format') === 'xlsx'
        ? 'statement'
        : null;
  if (excel) {
    try {
      const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
        `/purchase/counts/${id}/${excel}`,
      );
      return new NextResponse(Buffer.from(f.base64, 'base64'), {
        headers: {
          'content-type': f.contentType,
          'content-disposition': `attachment; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
          'cache-control': 'private, no-store',
          'x-content-type-options': 'nosniff',
        },
      });
    } catch {
      return new NextResponse(null, { status: 404 });
    }
  }
  const save = req.nextUrl.searchParams.get('save') === '1';
  const res = await apiFetchRaw(`/purchase/${kind}/${id}/pdf${save ? '?save=1' : ''}`);
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
