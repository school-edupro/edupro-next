import { NextResponse } from 'next/server';
import { bff } from '@/lib/bff';

/** The hostel clearance certificate of the child's completed hostel withdrawal (PDF). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 404 });
  const f = await bff.api
    .fetch<{ filename: string; contentType: string; base64: string }>(
      `/hostel/mine/withdrawals/${id}/certificate`,
    )
    .catch(() => null);
  if (!f) return new NextResponse(null, { status: 404 });
  return new NextResponse(Buffer.from(f.base64, 'base64'), {
    headers: {
      'content-type': f.contentType,
      'content-disposition': `inline; filename="${f.filename}"`,
    },
  });
}
