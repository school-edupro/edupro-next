import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;
const REPORT = /^[a-z_]{3,30}$/;
const KEYS: Record<string, (v: string) => boolean> = {
  from: (v) => DAY.test(v),
  to: (v) => DAY.test(v),
  departmentId: (v) => ID.test(v),
  vendorId: (v) => ID.test(v),
  itemId: (v) => ID.test(v),
  status: (v) => /^[a-z_]{2,20}$/.test(v),
};

/** A purchase report as on screen, as Excel or PDF (docs/design/83, part 5); the file is saved. */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const report = sp.get('report') ?? '';
  if (!REPORT.test(report)) return new NextResponse('No such report', { status: 404 });
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const [k, ok] of Object.entries(KEYS)) {
    const v = (sp.get(k) ?? '').trim();
    if (v && ok(v)) q.set(k, v);
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/purchase/reports/${report}?${q.toString()}`,
    );
    return new NextResponse(Buffer.from(f.base64, 'base64'), {
      headers: {
        'content-type': f.contentType,
        'content-disposition': `attachment; filename="${f.filename}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ApiError)
      return NextResponse.json({ type: error.problem.type }, { status: error.status });
    throw error;
  }
}
