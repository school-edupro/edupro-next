import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The Excel format for a list of students (admission numbers) or employees (codes) a notice is for. */
export async function GET(req: NextRequest) {
  const kind = req.nextUrl.searchParams.get('kind') === 'employee' ? 'employee' : 'student';
  const res = await apiFetchRaw(`/academics/notices/audience-format.xlsx?kind=${kind}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="notice-${kind}s-format.xlsx"`,
    },
  });
}
