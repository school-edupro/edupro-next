import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

const KINDS = ['clinic', 'doctor', 'nurse', 'disease', 'medicine', 'stock'];

/** The Excel to fill and upload: the right headings and one example row. */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind') ?? '';
  if (!KINDS.includes(kind)) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const res = await apiFetchRaw(`/clinic/setup/sample.xlsx?kind=${kind}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ??
        `attachment; filename="clinic-${kind}-sample.xlsx"`,
    },
  });
}
