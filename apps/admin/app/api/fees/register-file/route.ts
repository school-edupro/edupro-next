import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const PATHS: Record<string, string> = {
  refunds: '/payments/refunds/register/file',
  adjustments: '/fees/adjustments/register/file',
  changes: '/fees/profile-changes/register/file',
};
const KEYS = ['status', 'kind', 'mode', 'classId', 'from', 'to', 'q'];

/** A fee register (refunds, adjustments, fee profile changes) as filtered on the screen, as Excel or PDF. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const path = PATHS[sp.get('register') ?? ''];
  if (!path) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const qs = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const k of KEYS) {
    const v = sp.get(k);
    if (v) qs.set(k, v.slice(0, 80));
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `${path}?${qs.toString()}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
