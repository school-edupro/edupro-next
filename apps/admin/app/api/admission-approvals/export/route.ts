import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';
import { approvalsQuery } from '@/lib/admission-approvals';

/** The approvals list as filtered, to Excel or PDF (docs/design/51). */
export async function GET(req: NextRequest) {
  const q = approvalsQuery(Object.fromEntries(req.nextUrl.searchParams));
  q.set('format', req.nextUrl.searchParams.get('format') === 'pdf' ? 'pdf' : 'xlsx');
  const res = await apiFetchRaw(`/admissions/approvals/export?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'attachment',
    },
  });
}
