import { NextResponse } from 'next/server';
import { bff } from '@/lib/bff';

/** The photo of a visitor on the family's list. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 404 });
  const res = await bff.api.raw(`/hostel/mine/visitors/${id}/photo`).catch(() => null);
  if (!res?.ok) return new NextResponse(null, { status: 404 });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'private, max-age=300',
    },
  });
}
