import { NextResponse, type NextRequest } from 'next/server';
import { getMe } from '@/lib/api';

/**
 * Place search for the map picker (a stoppage's latitude and longitude). The place name typed is looked
 * up on OpenStreetMap's Nominatim from the server, so the browser talks to this site only. Signed-in
 * staff only; a handful of results.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 120);
  if (q.length < 3) return NextResponse.json({ data: [] });
  try {
    await getMe();
  } catch {
    return NextResponse.json({ type: 'unauthenticated' }, { status: 401 });
  }
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${new URLSearchParams({ q, format: 'jsonv2', limit: '6', countrycodes: 'in' }).toString()}`,
      {
        headers: {
          'user-agent': 'EduProNext/1.0 (school ERP; stoppage picker)',
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(8000),
        cache: 'no-store',
      },
    );
    if (!res.ok)
      return NextResponse.json({ data: [], error: 'The place search is not answering.' });
    const rows = (await res.json()) as Array<{ display_name?: string; lat?: string; lon?: string }>;
    return NextResponse.json({
      data: rows
        .filter((r) => r.display_name && r.lat && r.lon)
        .map((r) => ({ name: r.display_name!, lat: Number(r.lat), lng: Number(r.lon) })),
    });
  } catch {
    return NextResponse.json({ data: [], error: 'The place search could not be reached.' });
  }
}
