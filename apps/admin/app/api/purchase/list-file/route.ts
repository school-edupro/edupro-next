import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const DOCS = new Set(['indents', 'requisitions', 'orders']);
const ID = (v: string) => /^\d{1,18}$/.test(v);
const DAY = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
const KEYS: Record<string, (v: string) => boolean> = {
  view: (v) => /^(all|mine|waiting|sign)$/.test(v),
  status: (v) => /^[a-z_]{2,20}$/.test(v),
  route: (v) => /^[a-z_]{2,20}$/.test(v),
  emergency: (v) => v === '1' || v === '0',
  departmentId: ID,
  vendorId: ID,
  from: DAY,
  to: DAY,
  q: (v) => v.length <= 80,
  indent: (v) => v.length <= 40,
};

/** A purchase list as filtered on screen (every page), as Excel or PDF; the file is saved (docs/design/83). */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const doc = sp.get('doc') ?? '';
  if (!DOCS.has(doc)) return new NextResponse(null, { status: 400 });
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const [k, ok] of Object.entries(KEYS)) {
    const v = (sp.get(k) ?? '').trim();
    if (v && ok(v)) q.set(k, v);
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/purchase/${doc}/export?${q.toString()}`,
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
      return NextResponse.json(
        { type: error.problem.type, detail: error.problem.detail },
        { status: error.status },
      );
    throw error;
  }
}
