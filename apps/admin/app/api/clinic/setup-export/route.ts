import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

const KEYS = 'kind,q,status'.split(',');

/** The list on screen (with its filters) as Excel or PDF. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const pdf = sp.get('format') === 'pdf';
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const v = (sp.get(k) ?? '').trim();
    if (v && v.length <= 80 && /^[\w .:/+-]+$/.test(v)) q.set(k, v);
  }
  const res = await apiFetchRaw(`/clinic/setup/export.${pdf ? 'pdf' : 'xlsx'}?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': pdf
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ??
        `attachment; filename="clinic-setup.${pdf ? 'pdf' : 'xlsx'}"`,
    },
  });
}
