import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** Small JSON status the export watcher polls: `{ status, ready, error }`. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9]{1,18}$/.test(id))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  try {
    const s = await apiFetch<{
      export: { status: string; error?: string | null };
      download: { url: string } | null;
    }>(`/reports/exports/${id}`);
    return NextResponse.json(
      { status: s.export.status, ready: Boolean(s.download), error: s.export.error ?? null },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
