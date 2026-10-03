import { NextResponse } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The visitor's photo of one appointment (staff who may see appointments). */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  // the gate keeper may check visitors in without seeing the whole queue
  const gate = new URL(req.url).searchParams.get('gate') === '1';
  const res = await apiFetchRaw(`/appointments/${id}/${gate ? 'gate-photo' : 'photo'}`);
  if (!res.ok) return NextResponse.json({ type: 'not-found' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'private, max-age=300',
    },
  });
}
