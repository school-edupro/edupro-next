import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** Opens a proof document attached to a profile change request (for its approvers and reviewers). */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(file))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  try {
    const r = await apiFetch<{ download: { url: string } }>(
      `/engagement/profile-approvals/${id}/proofs/${file}`,
    );
    return NextResponse.redirect(r.download.url, { status: 303 });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
