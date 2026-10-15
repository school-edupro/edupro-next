import { NextResponse } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** A hostel photo: a visitor on a pupil's list (visitor) or one taken at the gate (visit). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ kind: string; id: string }> },
) {
  const { kind, id } = await params;
  if (!/^\d{1,18}$/.test(id) || !['visitor', 'visit'].includes(kind))
    return new NextResponse(null, { status: 404 });
  const res = await apiFetchRaw(
    `/hostel/${kind === 'visit' ? 'visits' : 'visitors'}/${id}/photo`,
  ).catch(() => null);
  if (!res?.ok) return new NextResponse(null, { status: 404 });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'private, max-age=300',
    },
  });
}
