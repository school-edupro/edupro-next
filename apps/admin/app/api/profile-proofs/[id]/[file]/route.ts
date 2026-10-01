import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** Types a browser can show by itself; these open in the tab, anything else downloads. */
const INLINE = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/;

/**
 * Opens a proof document attached to a profile change request (for its approvers and reviewers).
 * PDFs and images are shown in the browser from the admin's own origin; other files download.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(file))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  try {
    const r = await apiFetch<{
      file: { contentType: string; fileName?: string | null };
      download: { url: string };
    }>(`/engagement/profile-approvals/${id}/proofs/${file}`);
    if (!INLINE.test(r.file.contentType))
      return NextResponse.redirect(r.download.url, { status: 303 });
    const res = await fetch(r.download.url, { cache: 'no-store' });
    if (!res.ok) return new NextResponse(null, { status: 502 });
    const name = (r.file.fileName ?? `proof-${file}`).replace(/[^\w.\- ]+/g, '_').slice(0, 120);
    return new NextResponse(await res.arrayBuffer(), {
      headers: {
        'content-type': r.file.contentType,
        'content-disposition': `inline; filename="${name}"`,
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
