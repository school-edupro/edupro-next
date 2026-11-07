import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

/** The next automatic key of a master: the item code the Add form fills in from the category picked. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ master: string }> }) {
  const { master } = await params;
  if (!/^[a-z_]{2,40}$/.test(master))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  const qs = new URLSearchParams();
  for (const [k, v] of req.nextUrl.searchParams)
    if (/^[a-z_]{1,40}$/.test(k)) qs.set(k, v.slice(0, 200));
  try {
    const r = await apiFetch<{ value: string | null }>(
      `/masters/${master}/next-key?${qs.toString()}`,
    );
    return NextResponse.json(r, { headers: { 'cache-control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json(error.problem, { status: error.status });
    throw error;
  }
}
