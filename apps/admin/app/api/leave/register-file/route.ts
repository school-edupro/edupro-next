import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const ID = /^\d{1,18}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KEYS: Record<string, (v: string) => boolean> = {
  leaveTypeId: (v) => ID.test(v),
  employeeId: (v) => ID.test(v),
  department: (v) => v.length <= 100,
  from: (v) => DAY.test(v),
  to: (v) => DAY.test(v),
  source: (v) => /^(self|on_behalf|system)$/.test(v),
  bucket: (v) => /^(pending|l1|l2|approved|rejected|cancelled|withdrawn|lop)$/.test(v),
  q: (v) => v.length <= 80,
};

/** The leave register as filtered (every page), as Excel or PDF (docs/design/85). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const [k, ok] of Object.entries(KEYS)) {
    const v = (sp.get(k) ?? '').trim();
    if (v && ok(v)) q.set(k, v);
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/leave/register?${q.toString()}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    q.delete('format');
    q.set('error', error.problem.type);
    if (error.problem.detail) q.set('detail', String(error.problem.detail).slice(0, 200));
    return NextResponse.redirect(new URL(`/leave/register?${q.toString()}`, req.url), 303);
  }
}
