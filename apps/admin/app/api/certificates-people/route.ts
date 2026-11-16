import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/**
 * The issue page's people list (16 Nov 2026): students for a student certificate, employees for a staff one, by what
 * is typed (empty: the first ones, those the certificate's rule wants first).
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const kind = sp.get('kind') === 'employee' ? 'employees' : 'students';
  const q = (sp.get('q') ?? '').trim().slice(0, 80);
  const type = sp.get('type') ?? '';
  const qs = new URLSearchParams({ q });
  if (/^[A-Z][A-Z0-9_]{1,19}$/.test(type)) qs.set('type', type);
  try {
    const r = await apiFetch<{ rows: unknown[] }>(`/certificates/${kind}?${qs.toString()}`);
    return NextResponse.json(r, { headers: { 'cache-control': 'no-store' } });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type, rows: [] }, { status: error.status });
    throw error;
  }
}
