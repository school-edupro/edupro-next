import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** Streams a master's Excel upload template from the API to the browser (same session, same school). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ master: string }> }) {
  const { master } = await params;
  if (!/^[a-z_]{2,40}$/.test(master))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  const res = await apiFetchRaw(`/masters/${master}/template`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  const bytes = await res.arrayBuffer();
  return new NextResponse(bytes, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${master}-template.xlsx"`,
    },
  });
}
