import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * Shows an image stored in the file service (a student's photo) from the admin's own origin. The API
 * forbids cross-origin embedding of its files, so the bytes are passed through here, images only.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 400 });
  try {
    const r = await apiFetch<{ file: { contentType: string }; download: { url: string } }>(
      `/platform/files/${id}/download-url`,
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
