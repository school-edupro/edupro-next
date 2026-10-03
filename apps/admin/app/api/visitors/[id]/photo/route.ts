import { NextResponse } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The photo of one visitor (the gate and the front desk). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const res = await apiFetchRaw(`/visitors/${id}/photo`);
  if (!res.ok) return NextResponse.json({ type: 'not-found' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'private, max-age=300',
    },
  });
}
