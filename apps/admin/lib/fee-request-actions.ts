'use server';
/** Fee changes that wait for approval and the Excel uploads behind them (0101). */
import { decisionOf } from './decision';
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

/** The waiver grid of the ledger: the ticked fee lines go as one request for approval. */
export async function requestFeeWaivers(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const path = `/fees/ledger/${studentId}?tab=waive`;
  let lines: unknown = [];
  try {
    lines = JSON.parse(str(fd, 'lines') || '[]');
  } catch {
    lines = [];
  }
  try {
    await apiFetch('/fees/adjustments/waivers', {
      method: 'POST',
      body: JSON.stringify({ studentId, reason: str(fd, 'reason'), lines }),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}&ok=1`);
}

/** A late fee or a bounce charge that was already paid, adjusted in fee after approval. */
export async function requestPaidChargeToFee(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const path = `/fees/ledger/${studentId}?tab=latefee`;
  const kind = str(fd, 'kind') === 'bounce_to_fee' ? 'bounce_to_fee' : 'late_fee_to_fee';
  try {
    await apiFetch('/fees/requests', {
      method: 'POST',
      body: JSON.stringify({
        kind,
        receiptNo: kind === 'late_fee_to_fee' ? str(fd, 'receiptNo') : undefined,
        demandId: kind === 'bounce_to_fee' ? str(fd, 'demandId') : undefined,
        amount: Number(str(fd, 'amount')),
        reason: str(fd, 'reason'),
      }),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}&ok=1`);
}

/** A refund of one receipt, head by head: sent for approval, or kept as a draft to print first. */
async function headRefund(fd: FormData, draft: boolean) {
  const paymentId = str(fd, 'paymentId');
  const path = `/fees/refund/${paymentId}?x=1`;
  let lines: unknown = [];
  try {
    lines = JSON.parse(str(fd, 'lines') || '[]');
  } catch {
    lines = [];
  }
  let id = '';
  try {
    const r = await apiFetch<{ id: string }>(`/payments/receipts/${paymentId}/refunds`, {
      method: 'POST',
      body: JSON.stringify({
        lines,
        draft,
        feeAction: str(fd, 'feeAction') === 'cancel' ? 'cancel' : 'due',
        mode: str(fd, 'mode') || 'bank',
        reference: str(fd, 'reference') || undefined,
        reason: str(fd, 'reason'),
      }),
    });
    id = r.id;
  } catch (error) {
    fail(path, error);
  }
  // a draft opens as the provisional refund bill, ready to print
  redirect(draft ? `/fees/refund-voucher/${id}?ok=1` : '/fees/refunds?ok=1');
}
/** One refund for a pupil over many receipts: fee lines by head and month, late fee and advance. */
async function pupilRefund(fd: FormData, draft: boolean) {
  const studentId = str(fd, 'studentId');
  const path = `/fees/refund-pupil/${studentId}?x=1`;
  let raw: Array<{ part?: string; demandId?: string; amount?: number }> = [];
  try {
    raw = JSON.parse(str(fd, 'lines') || '[]') as typeof raw;
  } catch {
    raw = [];
  }
  const sum = (part: string) =>
    raw.filter((l) => l.part === part).reduce((a, l) => a + Number(l.amount ?? 0), 0);
  let id = '';
  try {
    const r = await apiFetch<{ id: string }>(`/payments/refunds/student/${studentId}`, {
      method: 'POST',
      body: JSON.stringify({
        lines: raw
          .filter((l) => l.part === 'fee' && l.demandId)
          .map((l) => ({ demandId: l.demandId, amount: Number(l.amount ?? 0) })),
        lateFee: sum('late_fee'),
        advance: sum('advance'),
        draft,
        feeAction: str(fd, 'feeAction') === 'cancel' ? 'cancel' : 'due',
        mode: str(fd, 'mode') || 'bank',
        reference: str(fd, 'reference') || undefined,
        reason: str(fd, 'reason'),
      }),
    });
    id = r.id;
  } catch (error) {
    fail(path, error);
  }
  redirect(draft ? `/fees/refund-voucher/${id}?ok=1` : '/fees/refunds?ok=1');
}
export async function requestPupilRefund(fd: FormData) {
  return pupilRefund(fd, false);
}
export async function savePupilRefundDraft(fd: FormData) {
  return pupilRefund(fd, true);
}

export async function requestHeadRefund(fd: FormData) {
  return headRefund(fd, false);
}
export async function saveHeadRefundDraft(fd: FormData) {
  return headRefund(fd, true);
}

/** A draft refund is sent for approval, or dropped. */
export async function sendRefundDraft(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await apiFetch(`/payments/refunds/${id}/send`, { method: 'POST' });
  } catch (error) {
    fail(`/fees/refund-voucher/${id}?x=1`, error);
  }
  redirect(`/fees/refund-voucher/${id}?ok=1`);
}
export async function discardRefundDraft(fd: FormData) {
  const id = str(fd, 'id');
  try {
    await apiFetch(`/payments/refunds/${id}/discard`, { method: 'POST' });
  } catch (error) {
    fail(`/fees/refund-voucher/${id}?x=1`, error);
  }
  redirect('/fees/refunds?ok=1');
}

/** A refund of the advance carried from last year, sent for approval. */
export async function requestAdvanceRefund(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const path = `/fees/ledger/${studentId}?tab=receipts`;
  try {
    await apiFetch('/payments/refunds/opening-advance', {
      method: 'POST',
      body: JSON.stringify({
        studentId,
        amount: Number(str(fd, 'amount')),
        mode: str(fd, 'mode') || 'bank',
        reference: str(fd, 'reference') || undefined,
        reason: str(fd, 'reason'),
      }),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect('/fees/refunds?ok=1');
}

// ---- opening balances from Excel (0121) -----------------------------------------------------------
export async function uploadOpeningBalances(fd: FormData) {
  const ledger = str(fd, 'ledger') === 'hostel' ? 'hostel' : 'school';
  const path = `/fees/opening-balances?ledger=${ledger}`;
  const { base64, name } = await fileBase64(fd, path);
  let id = '';
  try {
    const r = await apiFetch<{ id: string }>('/fees/opening/uploads', {
      method: 'POST',
      body: JSON.stringify({ fileBase64: base64, fileName: name, ledger }),
    });
    id = r.id;
  } catch (error) {
    fail(path, error);
  }
  redirect(`/fees/opening-balances?ledger=${ledger}&upload=${id}`);
}

export async function submitOpeningBalances(fd: FormData) {
  const id = str(fd, 'id');
  const path = `/fees/opening-balances?upload=${id}`;
  try {
    await apiFetch(`/fees/opening/uploads/${id}/submit`, {
      method: 'POST',
      body: JSON.stringify({
        action: decisionOf(fd, 'action', ['submit', 'cancel'] as const, path),
        reason: str(fd, 'reason') || undefined,
      }),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}&ok=1`);
}

export async function decideOpeningBalances(fd: FormData) {
  const id = str(fd, 'id');
  return decide(
    `/fees/opening/uploads/${id}/decide`,
    decisionOf(
      fd,
      'outcome',
      ['approved', 'rejected'] as const,
      `/fees/opening-balances?upload=${id}`,
    ),
    str(fd, 'note'),
    `/fees/opening-balances?upload=${id}`,
  );
}

/** A paid refund that cancelled its fee by mistake: the fee is asked again. */
export async function makeRefundFeeDue(fd: FormData) {
  const id = str(fd, 'id');
  const path = '/fees/refunds?x=1';
  try {
    await apiFetch(`/payments/refunds/${id}/fee-due`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') }),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect('/fees/refunds?ok=1');
}

/** The accounts office sends the refund of a completed withdrawal for approval (a waiting one is replaced). */
export async function resettleWithdrawalFees(fd: FormData) {
  const path = `/fees/fnf/${str(fd, 'studentId')}?x=1`;
  try {
    await apiFetch(`/people/withdrawals/${str(fd, 'id')}/fee-settlement`, { method: 'POST' });
  } catch (error) {
    fail(path, error);
  }
  redirect(`/fees/fnf/${str(fd, 'studentId')}?ok=1`);
}

/** The refund of a withdrawal kept as a draft: the provisional refund bill opens, ready to print. */
export async function draftWithdrawalRefund(fd: FormData) {
  const path = `/fees/fnf/${str(fd, 'studentId')}?x=1`;
  let id = '';
  try {
    const r = await apiFetch<{ draftId: string }>(
      `/people/withdrawals/${str(fd, 'id')}/fee-settlement?draft=true`,
      { method: 'POST' },
    );
    id = r.draftId;
  } catch (error) {
    fail(path, error);
  }
  redirect(`/fees/refund-voucher/${id}?ok=1`);
}

/** An approved waiver is asked to be taken back; it goes for approval and the fee is due again after. */
export async function requestWaiverUndo(fd: FormData) {
  const path = `/fees/ledger/${str(fd, 'studentId')}?tab=waive`;
  try {
    await apiFetch(`/fees/adjustments/${str(fd, 'id')}/undo-waiver`, {
      method: 'POST',
      body: JSON.stringify({ reason: str(fd, 'reason') }),
    });
  } catch (error) {
    fail(path, error);
  }
  redirect(`${path}&ok=1`);
}

// ---- Reports centre: which columns a report shows ---------------------------------------------------
/** The address of the report to go back to: only a path inside the Reports centre is accepted. */
const reportBackTo = (fd: FormData) => {
  const b = str(fd, 'back');
  return b.startsWith('/fees/reports?') ? b : '/fees/reports';
};
async function saveColumns(fd: FormData, scope: 'user' | 'school') {
  const back = reportBackTo(fd);
  let hidden: unknown = [];
  try {
    hidden = JSON.parse(str(fd, 'hidden') || '[]');
  } catch {
    hidden = [];
  }
  try {
    await apiFetch(`/fees/mis/${str(fd, 'report')}/columns`, {
      method: 'PUT',
      body: JSON.stringify({ hidden, scope }),
    });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=1`);
}
export async function saveReportColumnsMine(fd: FormData) {
  return saveColumns(fd, 'user');
}
export async function saveReportColumnsSchool(fd: FormData) {
  return saveColumns(fd, 'school');
}
export async function resetReportColumns(fd: FormData) {
  const back = reportBackTo(fd);
  try {
    await apiFetch(`/fees/mis/${str(fd, 'report')}/columns`, { method: 'DELETE' });
  } catch (error) {
    fail(back, error);
  }
  redirect(`${back}&ok=1`);
}

// ---- Reports centre: from the defaulters list to the reminder screen --------------------------------
/** Opens the reminder screen for the ticked pupils, or for everyone the filters list. Nothing is sent. */
async function openReminder(fd: FormData, all: boolean) {
  const q = new URLSearchParams();
  for (const k of ['asOf', 'classId', 'discountId', 'minBalance', 'ledger'])
    if (str(fd, k)) q.set(k, str(fd, k));
  if (!all) {
    const ids = fd
      .getAll('studentId')
      .map(String)
      .filter((x) => /^\d{1,18}$/.test(x));
    if (ids.length === 0) {
      const back = new URLSearchParams(q);
      back.set('report', 'defaulters');
      redirect(
        `/fees/reports?${back.toString()}&error=1&detail=${encodeURIComponent('Tick at least one pupil, or use the button for the whole list')}`,
      );
    }
    q.set('ids', ids.slice(0, 500).join(','));
  }
  redirect(`/fees/reminders/new?${q.toString()}`);
}
export async function openReminderForTicked(fd: FormData) {
  return openReminder(fd, false);
}
export async function openReminderForAll(fd: FormData) {
  return openReminder(fd, true);
}

/** The same from the misc fee dues report: the ticked rows are a pupil's fee lines. */
async function openMiscReminder(fd: FormData, all: boolean) {
  const q = new URLSearchParams({ misc: '1' });
  for (const k of ['miscFeeId', 'classId']) if (str(fd, k)) q.set(k, str(fd, k));
  // a reminder goes to those who still have to pay, whatever the list shows
  q.set('pay', ['unpaid', 'part'].includes(str(fd, 'pay')) ? str(fd, 'pay') : 'due');
  if (!all) {
    const ids = fd
      .getAll('lineId')
      .map(String)
      .filter((x) => /^\d{1,18}$/.test(x));
    if (ids.length === 0) {
      const back = new URLSearchParams({ report: 'misc_dues' });
      for (const k of ['miscFeeId', 'classId', 'pay']) if (str(fd, k)) back.set(k, str(fd, k));
      redirect(
        `/fees/reports?${back.toString()}&error=1&detail=${encodeURIComponent('Tick at least one row, or use the button for the whole list')}`,
      );
    }
    q.set('ids', ids.slice(0, 500).join(','));
  }
  redirect(`/fees/reminders/new?${q.toString()}`);
}
export async function openMiscReminderForTicked(fd: FormData) {
  return openMiscReminder(fd, false);
}
export async function openMiscReminderForAll(fd: FormData) {
  return openMiscReminder(fd, true);
}
