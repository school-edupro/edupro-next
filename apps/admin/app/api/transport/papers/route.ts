import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The fleet papers with the filters on screen, as Excel. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams();
  const state = sp.get('state') ?? '';
  if (['expired', 'soon', 'valid', 'missing', 'all'].includes(state)) q.set('state', state);
  const kind = sp.get('kind') ?? '';
  if (['insurance', 'fitness', 'permit', 'puc', 'licence'].includes(kind)) q.set('kind', kind);
  const search = (sp.get('q') ?? '').trim().slice(0, 80);
  if (search) q.set('q', search);
  const res = await apiFetchRaw(`/transport/desk/papers/export.xlsx?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="fleet-papers.xlsx"',
    },
  });
}
