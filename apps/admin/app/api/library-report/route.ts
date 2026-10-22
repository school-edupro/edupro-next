import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^\d{1,18}$/;
/** each report: its API path and the filters it takes, with what each may be */
const KIND = (v: string) => v === 'student' || v === 'employee';
const REPORTS: Record<
  string,
  {
    /** the API path; a borrower's own report takes the kind and id from the query */
    path: string | ((sp: URLSearchParams) => string | null);
    keys: Record<string, (v: string) => boolean>;
  }
> = {
  fines: {
    path: '/library/fines/export',
    keys: {
      tab: (v) => ['outstanding', 'collected', 'waived'].includes(v),
      from: (v) => DAY.test(v),
      to: (v) => DAY.test(v),
      borrower: (v) => v === 'student' || v === 'employee',
      classId: (v) => ID.test(v),
      sectionId: (v) => ID.test(v),
      q: (v) => v.length <= 80,
    },
  },
  charges: {
    path: '/library/charges/export',
    keys: {
      status: (v) => ['due', 'paid', 'cancelled', 'all'].includes(v),
      from: (v) => DAY.test(v),
      to: (v) => DAY.test(v),
      borrower: (v) => v === 'student' || v === 'employee',
      q: (v) => v.length <= 80,
    },
  },
  circulation: {
    path: '/library/history/circulation/export',
    keys: {
      what: (v) => ['all', 'issued', 'returned', 'renewed', 'out', 'overdue'].includes(v),
      from: (v) => DAY.test(v),
      to: (v) => DAY.test(v),
      borrower: KIND,
      classId: (v) => ID.test(v),
      sectionId: (v) => ID.test(v),
      libraryId: (v) => ID.test(v),
      q: (v) => v.length <= 80,
    },
  },
  borrowers: {
    path: '/library/history/borrowers/export',
    keys: {
      kind: KIND,
      from: (v) => DAY.test(v),
      to: (v) => DAY.test(v),
      show: (v) => ['active', 'holding', 'overdue', 'all'].includes(v),
      classId: (v) => ID.test(v),
      sectionId: (v) => ID.test(v),
      q: (v) => v.length <= 80,
      sort: (v) => ['name', 'holding', 'borrowed'].includes(v),
    },
  },
  borrower: {
    path: (sp) => {
      const kind = sp.get('kind') ?? '';
      const id = sp.get('id') ?? '';
      return KIND(kind) && ID.test(id) ? `/library/history/borrowers/${kind}/${id}/export` : null;
    },
    keys: { from: (v) => DAY.test(v), to: (v) => DAY.test(v) },
  },
};

/**
 * A library report as on screen, as Excel or PDF (docs/design/36-library.md, "Library reports"):
 * `report` names it, the page's filters come along, `format` is xlsx or pdf; the file is saved.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const r = REPORTS[sp.get('report') ?? ''];
  const path = r ? (typeof r.path === 'string' ? r.path : r.path(sp)) : null;
  if (!r || !path) return new NextResponse('No such report', { status: 404 });
  const q = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const [k, ok] of Object.entries(r.keys)) {
    const v = (sp.get(k) ?? '').trim();
    if (v && ok(v)) q.set(k, v);
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `${path}?${q.toString()}`,
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
      return new NextResponse(`Not made: ${String(error.problem.detail ?? error.problem.type)}`, {
        status: error.status,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    throw error;
  }
}
