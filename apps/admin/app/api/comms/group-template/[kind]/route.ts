import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** Streams the Excel template for uploading group members (or a compose list) from the API. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!['student', 'employee', 'student_teacher', 'external', 'mixed'].includes(kind))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  const res = await apiFetchRaw(`/comms/groups/template/${kind}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="members-${kind}.xlsx"`,
    },
  });
}
