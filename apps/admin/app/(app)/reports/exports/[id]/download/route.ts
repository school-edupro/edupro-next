import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** Resolves a ready export to its signed download URL through the API, then redirects the browser to it. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9]{1,18}$/.test(id))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  try {
    const status = await apiFetch<{ export: { status: string }; download: { url: string } | null }>(
      `/reports/exports/${id}`,
    );
    if (!status.download) {
      return NextResponse.redirect(
        new URL(
          `/reports/exports?error=export.not_ready&detail=${encodeURIComponent(`Export is ${status.export.status}`)}`,
          _req.url,
        ),
        { status: 303 },
      );
    }
    return NextResponse.redirect(status.download.url, { status: 303 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.redirect(
        new URL(`/reports/exports?error=${encodeURIComponent(error.problem.type)}`, _req.url),
        { status: 303 },
      );
    }
    throw error;
  }
}
