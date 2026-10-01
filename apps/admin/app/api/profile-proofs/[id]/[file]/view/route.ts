import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * Shows a photo attached to a profile change request (the current or the new one) from the admin's
 * own origin. Access is checked through the request, as for proofs; images only, bytes passed through.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(file))
    return new NextResponse(null, { status: 400 });
  try {
    const r = await apiFetch<{ file: { contentType: string }; download: { url: string } }>(
      `/engagement/profile-approvals/${id}/proofs/${file}`,
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
