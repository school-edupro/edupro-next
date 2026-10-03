import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { API, COOKIE } from '@/lib/api';

/** The signed-in visitor's own photo of one appointment (the token stays in the HttpOnly cookie). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ school: string; id: string }> },
) {
  const { school, id } = await params;
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{1,40}$/.test(school) || !/^\d{1,18}$/.test(id))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const res = await fetch(`${API}/api/v1/public/appointments/${school}/mine/${id}/photo`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: 'no-store',
  });
  if (!res.ok) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'image/jpeg',
      'cache-control': 'private, max-age=300',
    },
  });
}
