import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/**
 * The child's, father's or mother's photo on the portal's own origin. The API checks the family link
 * and signs a short-lived link; the bytes pass through here (images only).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ student: string; party: string }> },
) {
  const { student, party } = await params;
  if (!/^\d{1,18}$/.test(student) || !['student', 'father', 'mother'].includes(party))
    return new NextResponse(null, { status: 400 });
  try {
    const r = await bff.api.fetch<{ file: { contentType: string }; download: { url: string } }>(
      `/engagement/mine/profile/${student}/photo/${party}`,
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
