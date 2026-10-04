import { NextResponse } from 'next/server';
import { ApiError, apiFetch, apiFetchRaw } from '@/lib/api';

const RECORD = ['student', 'father', 'mother', 'guardian'];

/**
 * A photo for one gate pass: the live photo of the collector, or a photo on the pupil's record (the API
 * checks who may see it and signs a short-lived link; the bytes pass through here, images only).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string; party: string }> },
) {
  const { id, party } = await params;
  if (!/^\d{1,18}$/.test(id) || ![...RECORD, 'collector'].includes(party))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  if (party === 'collector') {
    const res = await apiFetchRaw(`/gate-passes/${id}/photo/collector`);
    if (!res.ok) return NextResponse.json({ type: 'not-found' }, { status: res.status });
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'content-type': res.headers.get('content-type') ?? 'image/jpeg',
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  }
  try {
    const r = await apiFetch<{ file: { contentType: string }; download: { url: string } }>(
      `/gate-passes/${id}/photo/${party}`,
    );
    if (!/^image\/(png|jpeg|webp)$/.test(r.file.contentType))
      return new NextResponse(null, { status: 415 });
    const res = await fetch(r.download.url, { cache: 'no-store' });
    if (!res.ok) return new NextResponse(null, { status: 502 });
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'content-type': r.file.contentType,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
