import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * Opens a stored file (a student document, a photo) through a short-lived signed URL. The API checks
 * the school and audits sensitive downloads; the browser never sees a permanent link.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  try {
    const r = await apiFetch<{ download: { url: string } }>(`/platform/files/${id}/download-url`);
    return NextResponse.redirect(r.download.url, { status: 303 });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
