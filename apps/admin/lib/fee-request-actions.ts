'use server';
/** Fee changes that wait for approval and the Excel uploads behind them (0101). */
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const fail = (path: string, error: unknown): never => {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail =
      (Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : '') ||
      (typeof error.problem.detail === 'string' ? error.problem.detail : '') ||
      error.problem.type;
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=1&detail=${encodeURIComponent(detail.slice(0, 300))}`,
    );
  }
  throw error;
};
const fileBase64 = async (
  fd: FormData,
  path: string,
): Promise<{ base64: string; name: string }> => {
  const f = fd.get('file');
  if (!(f instanceof File) || f.size === 0)
    redirect(`${path}&error=1&detail=${encodeURIComponent('Choose the Excel file first')}`);
  const file = f as File;
  return { base64: Buffer.from(await file.arrayBuffer()).toString('base64'), name: file.name };
};

export async function requestFeeChange(fd: FormData) {
  const kind = str(fd, 'kind');
  const path = '/fees/requests?tab=new';
  const body: Record<string, unknown> = { kind, reason: str(fd, 'reason') };
  if (kind === 'late_fee') {
    body.admissionNo = str(fd, 'admissionNo');
    body.periodId = str(fd, 'periodId');
    body.ledger = str(fd, 'ledger') || 'school';
    body.amount = Number(str(fd, 'amount') || '0');
  } else if (kind === 'transfer') {
    body.receiptNo = str(fd, 'receiptNo');
    body.toAdmissionNo = str(fd, 'toAdmissionNo');
  } else {
    body.receiptNo = str(fd, 'receiptNo');
    if (str(fd, 'newReceivedOn')) body.newReceivedOn = str(fd, 'newReceivedOn');
    if (str(fd, 'newClearedOn')) body.newClearedOn = str(fd, 'newClearedOn');
  }
  try {
    await apiFetch('/fees/requests', { method: 'POST', body: JSON.stringify(body) });
  } catch (error) {
    fail(path, error);
  }
  redirect('/fees/requests?tab=list&ok=1');
}

async function decide(url: string, outcome: 'approved' | 'rejected', note: string, back: string) {
  try {
    await apiFetch(url, {
      method: 'POST',
      body: JSON.stringify({ outcome, note: note || undefined }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=1`);
}

export async function approveFeeChange(fd: FormData) {
  return decide(
    `/fees/requests/${str(fd, 'id')}/decide`,
    'approved',
    str(fd, 'note'),
    '/fees/requests?tab=list',
  );
}
export async function rejectFeeChange(fd: FormData) {
  return decide(
    `/fees/requests/${str(fd, 'id')}/decide`,
    'rejected',
    str(fd, 'note'),
    '/fees/requests?tab=list',
  );
}
export async function approveFeeBatch(fd: FormData) {
  return decide(
    `/fees/requests/batches/${str(fd, 'batchId')}/decide`,
    'approved',
    '',
    '/fees/requests?tab=list',
  );
}
export async function rejectFeeBatch(fd: FormData) {
  return decide(
    `/fees/requests/batches/${str(fd, 'batchId')}/decide`,
    'rejected',
    '',
    '/fees/requests?tab=list',
  );
}

export async function uploadSettlementDates(fd: FormData) {
  const path = '/fees/requests?tab=settlement';
  const { base64 } = await fileBase64(fd, path);
  let out = {
    rows: 0,
    good: 0,
    bad: [] as Array<{ row: number; receiptNo: string; error: string }>,
  };
  try {
    out = await apiFetch('/fees/requests/settlement-upload', {
      method: 'POST',
      body: JSON.stringify({ fileBase64: base64, reason: str(fd, 'reason') }),
    });
  } catch (error) {
    fail(path, error);
  }
  // the first rows that were refused travel back in the address so the page can list them
  const bad = Buffer.from(JSON.stringify(out.bad.slice(0, 12))).toString('base64url');
  redirect(`${path}&rows=${out.rows}&good=${out.good}&badCount=${out.bad.length}&bad=${bad}`);
}

export async function uploadCollection(fd: FormData) {
  const path = '/fees/requests?tab=collection';
  const { base64, name } = await fileBase64(fd, path);
  let id = '';
  try {
    const r = await apiFetch<{ id: string }>('/fees/requests/collections', {
      method: 'POST',
      body: JSON.stringify({ fileBase64: base64, fileName: name }),
    });
    id = r.id;
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}&upload=${id}`);
}

export async function submitCollection(fd: FormData) {
  const id = str(fd, 'id');
  const path = `/fees/requests?tab=collection&upload=${id}`;
  try {
    await apiFetch(`/fees/requests/collections/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ action: 'submit', reason: str(fd, 'reason') }),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}&ok=1`);
}
export async function dropCollection(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await apiFetch(`/fees/requests/collections/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({ action: 'cancel' }),
    });
  } catch (error) {
    fail(`/fees/requests?tab=collection&upload=${id}`, error);
  }
  redirect('/fees/requests?tab=collection&ok=1');
}
export async function approveCollection(fd: FormData) {
  const id = str(fd, 'id');
  return decide(
    `/fees/requests/collections/${id}/decide`,
    'approved',
    str(fd, 'note'),
    `/fees/requests?tab=collection&upload=${id}`,
  );
}
export async function rejectCollection(fd: FormData) {
  const id = str(fd, 'id');
  return decide(
    `/fees/requests/collections/${id}/decide`,
    'rejected',
    str(fd, 'note'),
    `/fees/requests?tab=collection&upload=${id}`,
  );
}
