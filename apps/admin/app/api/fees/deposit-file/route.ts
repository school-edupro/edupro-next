import { NextResponse } from 'next/server';
import { ApiError, apiFetch } from '@/lib/api';

const KEYS = ['from', 'to', 'ledger', 'bankAccountId', 'drawee'];

/** The cheques and drafts in hand as filtered on the screen, as Excel or PDF, made at once. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const qs = new URLSearchParams({ format: sp.get('format') === 'pdf' ? 'pdf' : 'xlsx' });
  for (const k of KEYS) {
    const v = sp.get(k);
    if (v) qs.set(k, v.slice(0, 40));
  }
  try {
    const f = await apiFetch<{ filename: string; contentType: string; base64: string }>(
      `/fees/deposit-slips/pending/file?${qs.toString()}`,
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
