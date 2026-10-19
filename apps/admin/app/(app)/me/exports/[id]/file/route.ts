import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * One of my own exports (the profile PDF) resolved through `me/exports/:id`, which needs no report
 * permission: the browser is redirected to the signed URL; `?save=1` downloads a copy.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9]{1,18}$/.test(id))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  try {
    const status = await apiFetch<{
      export: { status: string };
      download: { url: string; saveUrl?: string } | null;
    }>(`/me/exports/${id}`);
    if (!status.download)
      return NextResponse.redirect(
        new URL(
          `/me/profile?export=${id}&error=export.not_ready&detail=${encodeURIComponent(`The file is ${status.export.status}`)}`,
          req.url,
        ),
        { status: 303 },
      );
    const save = req.nextUrl.searchParams.get('save') === '1';
    return NextResponse.redirect(
      save ? (status.download.saveUrl ?? status.download.url) : status.download.url,
      { status: 303 },
    );
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.redirect(
        new URL(`/me/profile?error=${encodeURIComponent(error.problem.type)}`, req.url),
        { status: 303 },
      );
    throw error;
  }
}
