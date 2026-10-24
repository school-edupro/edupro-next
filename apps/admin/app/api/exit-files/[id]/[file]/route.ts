import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

const FILES: Record<string, string> = {
  fnf: 'fnf.pdf',
  acceptance: 'letters/acceptance.pdf',
  relieving: 'letters/relieving.pdf',
  experience: 'letters/experience.pdf',
};

/** An exit's papers: the full and final statement and the letters; opens, or saves with ?save=1. */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; file: string }> },
) {
  const { id, file } = await params;
  if (!/^\d{1,18}$/.test(id) || !FILES[file]) return new NextResponse(null, { status: 400 });
  const save = req.nextUrl.searchParams.get('save') === '1';
  const res = await apiFetchRaw(`/people/exits/${id}/${FILES[file]}${save ? '?save=1' : ''}`);
  if (!res.ok) return new NextResponse(null, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/pdf',
      'content-disposition': res.headers.get('content-disposition') ?? 'inline',
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
