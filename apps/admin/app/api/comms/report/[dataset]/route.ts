import { NextResponse, type NextRequest } from 'next/server';
import { apiFetchRaw } from '@/lib/api';

const DATASETS = ['comms_monthly_usage', 'comms_delivery_log', 'comms_failures'];
const KEYS = ['from', 'to', 'month', 'channel', 'status', 'bucket', 'q', 'requestId'];

/**
 * A communication report as Excel, made by the API at once (no export queue): the delivery report
 * behind any count on the dashboard or statement, the statement itself, failures.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ dataset: string }> }) {
  const { dataset } = await params;
  if (!DATASETS.includes(dataset))
    return NextResponse.json({ type: 'validation-failed' }, { status: 400 });
  const q = new URLSearchParams();
  for (const k of KEYS) {
    const v = req.nextUrl.searchParams.get(k)?.trim();
    if (v) q.set(k, v.slice(0, 120));
  }
  const res = await apiFetchRaw(`/comms/reports/${dataset}/xlsx?${q.toString()}`);
  if (!res.ok) return NextResponse.json({ type: 'request-error' }, { status: res.status });
  return new NextResponse(await res.arrayBuffer(), {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition':
        res.headers.get('content-disposition') ?? `attachment; filename="${dataset}.xlsx"`,
    },
  });
}
