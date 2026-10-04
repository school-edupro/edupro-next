import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** A child's published health check-up card, as a PDF on the portal's own origin. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 400 });
  try {
    const r = await bff.api.fetch<{ filename: string; base64: string }>(`/clinic/mine/cards/${id}`);
    return new NextResponse(Buffer.from(r.base64, 'base64'), {
      headers: {
        'content-type': 'application/pdf',
        'content-disposition': `attachment; filename="${r.filename.replace(/[^\w.-]+/g, '_')}"`,
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
