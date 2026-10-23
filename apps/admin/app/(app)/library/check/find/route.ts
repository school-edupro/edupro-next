import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * Library staff: a copy found by its accession no. or barcode (old numbers too) opens its page; a title,
 * author or ISBN opens the Books list searched for it.
 */
export async function GET(req: NextRequest) {
  const q = (req.nextUrl.searchParams.get('q') ?? '').trim().slice(0, 120);
  const to = (path: string) => NextResponse.redirect(new URL(path, req.url), { status: 303 });
  if (!q) return to('/library');
  try {
    const r = await apiFetch<{ kind: string; copyId?: string }>(
      `/library/check?q=${encodeURIComponent(q)}`,
    );
    if (r.kind === 'copy' && r.copyId) return to(`/library/check/${r.copyId}`);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
  }
  return to(`/library?q=${encodeURIComponent(q)}`);
}
