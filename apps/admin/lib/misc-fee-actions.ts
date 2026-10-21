'use server';
/** Misc fees announced to pupils: announce, change, decide, collect at the counter, take a receipt back. */
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const detailOf = (error: ApiError) => {
  const errs = (error.problem.errors as Array<{ message?: string }> | undefined) ?? [];
  return (
    errs
      .map((e) => e.message)
      .filter(Boolean)
      .join('; ') ||
    (typeof error.problem.detail === 'string' ? error.problem.detail : '') ||
    error.problem.type
  );
};
const fail = (path: string, error: unknown): never => {
  if (error instanceof ApiError)
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=1&detail=${encodeURIComponent(detailOf(error).slice(0, 300))}`,
    );
  throw error;
};
const ok = (path: string, note: string) =>
  redirect(`${path}${path.includes('?') ? '&' : '?'}ok=1&detail=${encodeURIComponent(note)}`);

export type MiscResult<T> = { ok: true; data: T } | { ok: false; error: string };
async function call<T>(fn: () => Promise<T>): Promise<MiscResult<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    if (error instanceof ApiError) return { ok: false, error: detailOf(error) };
    throw error;
  }
}

export interface MiscSheetRow {
  admissionNo: string;
  amount?: number;
  lastDate?: string;
}
export interface MiscAnnouncePayload {
  headId: string;
  title: string;
  amount: number;
  lastDate: string;
  remark?: string;
  mandatory: boolean;
  seats?: number;
  classIds: string[];
  sectionIds: string[];
  studentIds: string[];
  rows: MiscSheetRow[];
}

/** Pupils by name or admission number, for the name-wise list of the announcement. */
export async function miscFindPupils(q: string) {
  return call(() =>
    apiFetch<{
      data: Array<{ id: string; name: string; admissionNo: string; section: string | null }>;
    }>(`/fees/cashier/search?q=${encodeURIComponent(q.slice(0, 60))}`).then((r) => r.data),
  );
}
export async function miscReadSheet(contentBase64: string) {
  return call(() =>
    apiFetch<{ rows: MiscSheetRow[]; errors: string[] }>('/fees/misc-fees/sheet', {
      method: 'POST',
      body: JSON.stringify({ contentBase64 }),
    }),
  );
}
export async function miscAnnounce(p: MiscAnnouncePayload) {
  return call(() =>
    apiFetch<{ id: string; status: string; pupils: number }>('/fees/misc-fees', {
      method: 'POST',
      body: JSON.stringify(p),
    }),
  );
}
/** More pupils on an announced fee (the same picker as the announcement). */
export async function miscAddPupils(
  feeId: string,
  audience: Pick<MiscAnnouncePayload, 'classIds' | 'sectionIds' | 'studentIds' | 'rows'>,
  reason: string,
) {
  return call(() =>
    apiFetch<{ id: string }>(`/fees/misc-fees/${feeId}/changes`, {
      method: 'POST',
      body: JSON.stringify({ kind: 'add_pupils', audience, reason }),
    }),
  );
}

/** Extend the last date, change one pupil, or close the fee: each goes for approval. */
export async function miscChange(fd: FormData) {
  const feeId = str(fd, 'feeId');
  const path = `/fees/misc-fees/${feeId}`;
  const kind = str(fd, 'kind');
  const amount = str(fd, 'amount');
  const body =
    kind === 'extend'
      ? { kind, lastDate: str(fd, 'lastDate'), reason: str(fd, 'reason') }
      : kind === 'close'
        ? { kind, reason: str(fd, 'reason') }
        : {
            kind: 'pupil_change',
            lineId: str(fd, 'lineId'),
            ...(amount !== '' ? { amount: Number(amount) } : {}),
            ...(str(fd, 'lastDate') ? { lastDate: str(fd, 'lastDate') } : {}),
            reason: str(fd, 'reason'),
          };
  let waiting = false;
  try {
    const r = await apiFetch<{ workflowInstanceId: string | null }>(
      `/fees/misc-fees/${feeId}/changes`,
      { method: 'POST', body: JSON.stringify(body) },
    );
    waiting = Boolean(r.workflowInstanceId);
  } catch (error) {
    fail(path, error);
  }
  ok(
    path,
    waiting
      ? 'Sent for approval: it takes effect when the last level approves'
      : 'Request saved: approve it under Requests below',
  );
}

async function decide(fd: FormData, outcome: 'approved' | 'rejected') {
  const path = str(fd, 'back') || '/fees/misc-fees?tab=requests';
  try {
    await apiFetch(`/fees/misc-fees/requests/${str(fd, 'requestId')}/decide`, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: str(fd, 'note') || undefined }),
    });
  } catch (error) {
    fail(path, error);
  }
  ok(path, outcome === 'approved' ? 'Approved' : 'Rejected');
}
export async function miscApprove(fd: FormData) {
  return decide(fd, 'approved');
}
export async function miscReject(fd: FormData) {
  return decide(fd, 'rejected');
}

/** Misc fees of a pupil received at the counter: a receipt for each fee paid. */
/** The counter page of the payer: a pupil, or a staff member (0216). */
const counterOf = (fd: FormData) =>
  str(fd, 'employeeId')
    ? `/fees/misc-fees/collect?employeeId=${str(fd, 'employeeId')}`
    : `/fees/misc-fees/collect?studentId=${str(fd, 'studentId')}`;

export async function miscCollect(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const employeeId = str(fd, 'employeeId');
  const path = counterOf(fd);
  const lines = fd
    .getAll('lineIds')
    .map(String)
    .map((lineId) => ({ lineId, amount: Number(str(fd, `amount:${lineId}`)) }))
    .filter((l) => l.amount > 0);
  if (lines.length === 0)
    redirect(`${path}&error=1&detail=${encodeURIComponent('Enter the amount received on a fee')}`);
  let made: Array<{ id: string; receiptNo: string }> = [];
  try {
    const r = await apiFetch<{ receipts: Array<{ id: string; receiptNo: string }> }>(
      '/fees/misc-fees/collect',
      {
        method: 'POST',
        body: JSON.stringify({
          ...(employeeId ? { employeeId } : { studentId }),
          lines,
          mode: str(fd, 'mode'),
          receivedOn: str(fd, 'receivedOn') || undefined,
          reference: str(fd, 'reference') || undefined,
          instrumentNo: str(fd, 'instrumentNo') || undefined,
          instrumentDate: str(fd, 'instrumentDate') || undefined,
          bankName: str(fd, 'bankName') || undefined,
          remarks: str(fd, 'remarks') || undefined,
        }),
      },
    );
    made = r.receipts;
  } catch (error) {
    fail(path, error);
  }
  // one fee paid: straight to its receipt; several: the list, each with its print link
  if (made.length === 1) redirect(`/fees/misc-fees/receipt/${made[0]!.id}?posted=1`);
  ok(
    path,
    `Receipts ${made.map((x) => x.receiptNo).join(', ')} made: print each from the list below`,
  );
}

/** Cancel, bounce or refund a misc receipt: a request that goes for approval. */
export async function miscReceiptRequest(fd: FormData) {
  const path = counterOf(fd);
  const kind = str(fd, 'kind');
  let waiting = false;
  try {
    const r = await apiFetch<{ workflowInstanceId: string | null }>(
      `/fees/misc-fees/receipts/${str(fd, 'receiptId')}/request`,
      {
        method: 'POST',
        body: JSON.stringify({
          kind,
          reason: str(fd, 'reason'),
          ...(kind === 'receipt_refund'
            ? {
                amount: Number(str(fd, 'amount')),
                mode: str(fd, 'refundMode') || 'cash',
                reference: str(fd, 'reference') || undefined,
              }
            : {}),
          ...(kind === 'receipt_bounce' && str(fd, 'charge') !== ''
            ? { charge: Number(str(fd, 'charge')) }
            : {}),
        }),
      },
    );
    waiting = Boolean(r.workflowInstanceId);
  } catch (error) {
    fail(path, error);
  }
  ok(
    path,
    waiting
      ? 'Sent for approval: the receipt changes when the last level approves'
      : 'Request saved: approve it under Misc fees → Requests',
  );
}
