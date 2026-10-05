import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/**
 * A master's list as Excel or PDF, made on the spot and handed to the browser as a download from this
 * same site (no queue, no second address): the search and the status filter on screen are kept.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ master: string }> }) {
  const { master } = await params;
  if (!/^[a-z_]{2,40}$/.test(master))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  const sp = req.nextUrl.searchParams;
  const format = sp.get('format') === 'pdf' ? 'pdf' : 'xlsx';
  const q = new URLSearchParams({ format });
  const search = (sp.get('q') ?? '').trim().slice(0, 80);
  if (search) q.set('q', search);
  if (['active', 'inactive'].includes(sp.get('status') ?? '')) q.set('status', sp.get('status')!);
  const res = await apiFetchRaw(`/masters/${master}/export?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type':
        format === 'pdf'
          ? 'application/pdf'
          : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? `attachment; filename="${master}.${format}"`,
      'cache-control': 'no-store',
    },
  });
}
