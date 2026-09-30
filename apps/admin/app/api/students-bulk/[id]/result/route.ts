import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** Outcome of every row of a student upload, as Excel. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  const res = await apiFetchRaw(`/people/profile/bulk/${id}/result`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="student-upload-${id}-result.xlsx"`,
    },
  });
}
