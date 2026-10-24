import { NextResponse, type NextRequest } from 'next/server';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

/** The letter of an exit I may see (my own, or one waiting with me): opens, or saves with ?save=1. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 400 });
  try {
    const r = await bff.api.fetch<{ download: { url: string; saveUrl?: string } }>(
      `/people/exits/${id}/letter`,
    );
    const save = req.nextUrl.searchParams.get('save') === '1';
    return NextResponse.redirect(save ? (r.download.saveUrl ?? r.download.url) : r.download.url, {
      status: 303,
    });
  } catch (error) {
    if (error instanceof ApiError) return new NextResponse(null, { status: error.status });
    throw error;
  }
}
