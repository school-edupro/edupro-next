import { NextResponse, type NextRequest } from 'next/server';
import { API } from '@/lib/api';

/** The school's logo for its public pages; the address carries the file id, so it may be kept a day. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ school: string }> }) {
  const { school } = await params;
  if (!/^[a-z0-9_-]{2,40}$/i.test(school)) return new NextResponse(null, { status: 404 });
  const res = await fetch(`${API}/api/v1/public/schools/${encodeURIComponent(school)}/logo`, {
    headers: { Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return new NextResponse(null, { status: 404 });
  const f = (await res.json()) as { contentType: string; base64: string };
  return new NextResponse(Buffer.from(f.base64, 'base64'), {
    headers: {
      'content-type': f.contentType,
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
    },
  });
}
