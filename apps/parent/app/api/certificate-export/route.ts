import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** Whether a certificate PDF being made is ready, and its links (the "Opening the PDF" step polls it). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const id = sp.get('id') ?? '';
  if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ status: 'bad' }, { status: 400 });
  const path =
    sp.get('kind') === 'award'
      ? `/fees/mine/exports/${id}`
      : `/certificate-requests/mine/exports/${id}`;
  try {
    const s = await bff.api.fetch<{
      export: { status: string };
      download: { url: string; saveUrl?: string } | null;
    }>(path);
    return NextResponse.json(
      {
        status: s.export.status,
        url: s.download?.url ?? null,
        saveUrl: s.download?.saveUrl ?? null,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ status: 'error' }, { status: error.status });
    throw error;
  }
}
