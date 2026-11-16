import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * A certificate's View and Download (16 Nov 2026): straight to its PDF when it is kept; when it was cleared or never
 * made, it is made again and a short "opening" step turns into the PDF by itself — never an error page.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9]{1,18}$/.test(id))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  const save = req.nextUrl.searchParams.get('save') === '1';
  try {
    const r = await apiFetch<{ exportId: string; ready: boolean }>(`/certificates/${id}/pdf`, {
      method: 'POST',
    });
    const to = r.ready
      ? `/reports/exports/${r.exportId}/download${save ? '?save=1' : ''}`
      : `/certificates/${id}/opening?export=${r.exportId}${save ? '&save=1' : ''}`;
    return NextResponse.redirect(new URL(to, req.url), { status: 303 });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = error.problem.detail ?? 'The PDF could not be opened';
      return NextResponse.redirect(
        new URL(
          `/certificates/${id}?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail)}`,
          req.url,
        ),
        { status: 303 },
      );
    }
    throw error;
  }
}
