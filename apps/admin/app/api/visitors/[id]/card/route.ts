import { NextResponse } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** The visitor card as a PDF (ID-card size). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const res = await apiFetchRaw(`/visitors/${id}/card.pdf`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition':
        res.headers.get('content-disposition') ?? 'attachment; filename="visitor-card.pdf"',
    },
  });
}
