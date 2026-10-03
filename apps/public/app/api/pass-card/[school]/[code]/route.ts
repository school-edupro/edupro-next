import { NextResponse } from 'next/server';
import { API } from '@/lib/api';

/** The card behind a pass link as a PDF (no photo or ID proof on this copy). */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ school: string; code: string }> },
) {
  const { school, code } = await params;
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(school) || !/^[A-Za-z0-9]{8,16}$/.test(code))
    return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const res = await fetch(`${API}/api/v1/public/appointments/${school}/pass/${code}/card.pdf`, {
    cache: 'no-store',
  });
  if (!res.ok) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="visitor-card.pdf"',
    },
  });
}
