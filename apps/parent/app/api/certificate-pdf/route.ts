import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

interface Status {
  export: { id: string; status: string };
  download: { url: string; saveUrl?: string } | null;
}

/**
 * A certificate's View / Download in the app (16 Nov 2026): straight to the PDF when it is there; otherwise it is
 * made and a short "Opening the PDF" step turns into it. `kind=award`: an achievement certificate of the earlier
 * module (its own PDF route).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id') ?? '';
  const award = sp.get('kind') === 'award';
  const save = sp.get('save') === '1';
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 400 });
  const fail = (detail: string) =>
    NextResponse.redirect(
      new URL(
        `/certificates?error=pdf&detail=${encodeURIComponent(detail.slice(0, 160))}`,
        req.url,
      ),
      { status: 303 },
    );
  try {
    const made = award
      ? {
          ...(await bff.api.fetch<{ exportId: string }>(`/engagement/mine/certificates/${id}/pdf`, {
            method: 'POST',
          })),
          ready: false,
        }
      : await bff.api.fetch<{ exportId: string; ready: boolean }>(
          `/certificate-requests/mine/certificates/${id}/pdf`,
          { method: 'POST' },
        );
    if (made.ready) {
      const s = await bff.api.fetch<Status>(`/certificate-requests/mine/exports/${made.exportId}`);
      const to = save ? (s.download?.saveUrl ?? s.download?.url) : s.download?.url;
      if (to) return NextResponse.redirect(to, { status: 303 });
    }
    return NextResponse.redirect(
      new URL(
        `/certificates/opening?export=${made.exportId}&kind=${award ? 'award' : 'register'}${save ? '&save=1' : ''}`,
        req.url,
      ),
      { status: 303 },
    );
  } catch (error) {
    if (error instanceof ApiError)
      return fail(
        typeof error.problem.detail === 'string'
          ? error.problem.detail
          : 'The PDF could not be opened',
      );
    throw error;
  }
}
