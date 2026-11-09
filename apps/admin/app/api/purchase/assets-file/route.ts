import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const ID = /^\d{1,18}$/;
const FILTERS: Record<string, (v: string) => boolean> = {
  status: (v) => /^[a-z_]{2,20}$/.test(v),
  itemId: (v) => ID.test(v),
  categoryId: (v) => ID.test(v),
  departmentId: (v) => ID.test(v),
  storeId: (v) => ID.test(v),
  custodianId: (v) => ID.test(v),
  q: (v) => v.length <= 80,
  expiring: (v) => v === '1',
};

/**
 * The asset master as filtered on the Assets page (every page): Excel with every field and the totals by
 * category, or PDF (docs/design/84, "As built — the asset master and the import format"). A file too
 * long goes back to the page with the reason.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  // the page's default is what is on the books; "all" is no status
  const status = sp.get('status') ?? 'held';
  for (const [k, ok] of Object.entries(FILTERS)) {
    const v = (k === 'status' ? status : (sp.get(k) ?? '')).trim();
    if (v && v !== 'all' && ok(v)) q.set(k, v);
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/purchase/assets/export?${q.toString()}`,
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
    const back = new URLSearchParams();
    for (const k of Object.keys(FILTERS)) {
      const v = sp.get(k);
      if (v && FILTERS[k]!(v)) back.set(k, v);
    }
    if (sp.get('status') === 'all') back.set('status', 'all');
    back.set('error', error.problem.type);
    if (error.problem.detail) back.set('detail', String(error.problem.detail).slice(0, 200));
    return NextResponse.redirect(new URL(`/purchase/assets?${back.toString()}`, req.url), 303);
  }
}
