import { NextResponse } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

/** Excel and PDF of the fee set-up grids: class fee structure, discount by head, class calendar. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const kind = q.get('kind');
  const format = q.get('format') === 'pdf' ? 'pdf' : 'xlsx';
  const id = (k: string) => (/^\d{1,18}$/.test(q.get(k) ?? '') ? q.get(k)! : '');
  let path = '';
  if (kind === 'structure' && id('classId')) {
    const group = /^[a-z_]{1,30}$/.test(q.get('feeGroup') ?? '') ? q.get('feeGroup')! : 'general';
    const type = ['all', 'new', 'old'].includes(q.get('studentType') ?? '')
      ? q.get('studentType')!
      : 'all';
    path = `/fees/grids/structure/file?classId=${id('classId')}&feeGroup=${group}&studentType=${type}&format=${format}`;
  } else if (kind === 'discount' && id('id'))
    path = `/fees/grids/discount/${id('id')}/file?format=${format}`;
  else if (kind === 'calendar' && id('classId'))
    path = `/fees/grids/calendar/file?classId=${id('classId')}&format=${format}`;
  if (!path) return NextResponse.json({ type: 'not-found' }, { status: 404 });
  const res = await apiFetchRaw(path);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
      'content-disposition': res.headers.get('content-disposition') ?? 'attachment',
    },
  });
}
