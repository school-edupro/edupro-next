'use server';
/** Payroll's monthly inputs (docs/design/86, phase B step 1): the forms, posted to /payroll/inputs. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { ScheduleMonth, StaffOption } from './payroll-inputs';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const okMonth = (m: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m);
const detailOf = (e: ApiError) => {
  const errors = e.problem.errors as
    Record<string, string> | Array<{ message?: string }> | undefined;
  const first = Array.isArray(errors)
    ? errors.map((x) => x.message).find(Boolean)
    : errors
      ? Object.values(errors)[0]
      : undefined;
  return e.problem.detail ?? first ?? e.problem.type;
};
const join = (path: string) => (path.includes('?') ? '&' : '?');
const back = (path: string, e: ApiError): never =>
  redirect(
    `${path}${join(path)}error=${encodeURIComponent(e.problem.type ?? 'validation-failed')}&detail=${encodeURIComponent(detailOf(e).slice(0, 300))}`,
  );
const done = (path: string, detail: string): never => {
  revalidatePath('/payroll/inputs');
  redirect(
    `${path}${join(path)}ok=1&detail=${encodeURIComponent(detail)}&r=${Date.now().toString(36)}`,
  );
};
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const money = (fd: FormData, k: string) => text(fd, k)?.replace(/,/g, '') ?? null;
const tab = (month: string, t: string) => `/payroll/inputs?month=${month}&tab=${t}`;
async function send<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
/** run a call; an API refusal goes back to the page with its reason */
async function attempt<T>(here: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
}

// ---- attendance -----------------------------------------------------------------------------------------
export async function pullAttendance(month: string) {
  if (!okMonth(month)) return;
  const here = tab(month, 'attendance');
  const r = await attempt(here, () =>
    send<{
      pulled: number;
      finalisedKept: number;
      skipped: number;
      withWarnings: number;
      notes: string[];
    }>('/payroll/inputs/attendance/pull', 'POST', { month }),
  );
  done(
    here,
    `${String(r.pulled)} pulled from the attendance register${r.withWarnings ? `, ${String(r.withWarnings)} with something to look at` : ''}${r.finalisedKept ? `; ${String(r.finalisedKept)} finalised kept` : ''}. ${r.notes.join(' ')}`.trim(),
  );
}

export async function finaliseAttendance(month: string) {
  if (!okMonth(month)) return;
  const here = tab(month, 'attendance');
  const r = await attempt(here, () =>
    send<{ finalised: number; notes: string[] }>('/payroll/inputs/attendance/finalise', 'POST', {
      month,
    }),
  );
  done(
    here,
    `${String(r.finalised)} finalised: a run of this month reads them. ${r.notes.join(' ')}`.trim(),
  );
}

export async function unfinaliseAttendance(month: string, fd: FormData) {
  if (!okMonth(month)) return;
  const here = tab(month, 'attendance');
  const r = await attempt(here, () =>
    send<{ unfinalised: number }>('/payroll/inputs/attendance/unfinalise', 'POST', {
      month,
      reason: text(fd, 'reason'),
    }),
  );
  done(here, `${String(r.unfinalised)} open again.`);
}

/** "CODE lop [paid leave] [OT hours]" lines → the exceptions, by the month's roster */
export async function markPresent(month: string, fd: FormData) {
  if (!okMonth(month)) return;
  const here = tab(month, 'attendance');
  const staff = (await send<{ rows: StaffOption[] }>(`/payroll/inputs/staff?month=${month}`, 'GET'))
    .rows;
  const byCode = new Map(staff.map((s) => [s.code.toUpperCase(), s.id]));
  const exceptions: Array<{
    employeeId: string;
    lopDays: string | null;
    paidLeaveDays: string | null;
    otHours: string | null;
  }> = [];
  for (const line of String(fd.get('exceptions') ?? '').split('\n')) {
    const parts = line
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    if (!parts.length) continue;
    const id = byCode.get(parts[0]!.toUpperCase());
    if (!id)
      redirect(
        `${here}&error=validation-failed&detail=${encodeURIComponent(`${parts[0]!} is not on this month’s roster`)}`,
      );
    exceptions.push({
      employeeId: id!,
      lopDays: parts[1] ?? null,
      paidLeaveDays: parts[2] ?? null,
      otHours: parts[3] ?? null,
    });
  }
  const dryRun = fd.get('do') !== 'save';
  const r = await attempt(here, () =>
    send<{ presentWholeMonth: number; exceptions: number; finalisedKept: number; skipped: number }>(
      '/payroll/inputs/attendance/mark-present',
      'POST',
      { month, reason: text(fd, 'reason'), exceptions, dryRun },
    ),
  );
  done(
    here,
    `${dryRun ? 'Checked, nothing saved: it would mark' : 'Marked'} ${String(r.presentWholeMonth)} present for the whole month and ${String(r.exceptions)} as typed${r.finalisedKept ? `; ${String(r.finalisedKept)} finalised are kept` : ''}.`,
  );
}

export async function saveAttendance(employeeId: string, month: string, fd: FormData) {
  if (!okId(employeeId) || !okMonth(month)) return;
  const here = `/payroll/inputs/attendance/${employeeId}?month=${month}`;
  await attempt(here, () =>
    send(`/payroll/inputs/attendance/${employeeId}`, 'PUT', {
      month,
      lopDays: text(fd, 'lopDays') ?? '0',
      paidLeaveDays: text(fd, 'paidLeaveDays'),
      presentDays: text(fd, 'presentDays'),
      otHours: text(fd, 'otHours'),
      reason: text(fd, 'reason'),
    }),
  );
  done(here, 'Saved by hand: the reason is kept with it.');
}

export async function importAttendance(
  month: string,
  file: string,
  reason: string,
  dryRun: boolean,
) {
  try {
    return {
      result: await send<{
        rows: Array<{ row: number; code: string; status: string; error: string | null }>;
        counts: { ok: number; error: number };
        saved: number;
      }>('/payroll/inputs/attendance/import', 'POST', { month, file, reason, dryRun }),
      error: null,
    };
  } catch (e) {
    if (e instanceof ApiError) return { result: null, error: detailOf(e) };
    throw e;
  }
}

// ---- salary hold and typed tax ---------------------------------------------------------------------------
export async function setHold(month: string, fd: FormData) {
  if (!okMonth(month)) return;
  const here = tab(month, 'hold');
  const r = await attempt(here, () =>
    send<{ message: string }>('/payroll/inputs/holds', 'POST', {
      month,
      employeeId: text(fd, 'employeeId'),
      mode: String(fd.get('mode') ?? 'HOLD'),
      reason: text(fd, 'reason'),
    }),
  );
  done(here, r.message);
}

export async function liftHold(month: string, id: string, fd: FormData) {
  if (!okMonth(month) || !okId(id)) return;
  const here = tab(month, 'hold');
  await attempt(here, () =>
    send(`/payroll/inputs/holds/${id}/lift`, 'POST', { reason: text(fd, 'reason') }),
  );
  done(here, 'Lifted.');
}

export async function setTds(month: string, fd: FormData) {
  if (!okMonth(month)) return;
  const here = tab(month, 'tax');
  await attempt(here, () =>
    send('/payroll/inputs/tds', 'PUT', {
      month,
      employeeId: text(fd, 'employeeId'),
      itAmount: money(fd, 'itAmount') ?? '0',
      cessAmount: money(fd, 'cessAmount') ?? '0',
      reason: text(fd, 'reason'),
    }),
  );
  done(here, 'Saved: this month’s tax is the amount typed, not the projection.');
}

export async function deleteTds(month: string, id: string) {
  if (!okMonth(month) || !okId(id)) return;
  const here = tab(month, 'tax');
  await attempt(here, () => send(`/payroll/inputs/tds/${id}`, 'DELETE'));
  done(here, 'Removed: the projection works out this month’s tax again.');
}

// ---- loans ------------------------------------------------------------------------------------------------
export async function previewLoan(terms: {
  principal: string;
  emi: string;
  rate: string;
  method: string;
  startMonth: string;
}) {
  try {
    return {
      result: await send<{
        months: ScheduleMonth[];
        count: number;
        totalInterest: string;
        lastMonth: string;
      }>('/payroll/inputs/loans/schedule', 'POST', terms),
      error: null,
    };
  } catch (e) {
    if (e instanceof ApiError) return { result: null, error: detailOf(e) };
    throw e;
  }
}

export async function addLoan(month: string, fd: FormData) {
  const here = tab(okMonth(month) ? month : '2026-01', 'loans');
  const r = await attempt(here, () =>
    send<{ id: string; months: number; lastMonth: string }>('/payroll/inputs/loans', 'POST', {
      employeeId: text(fd, 'employeeId'),
      loanType: text(fd, 'loanType'),
      principal: money(fd, 'principal'),
      emi: money(fd, 'emi'),
      rate: text(fd, 'rate') ?? '0',
      method: String(fd.get('method') ?? 'NONE'),
      startMonth: text(fd, 'startMonth'),
      remarks: text(fd, 'remarks'),
    }),
  );
  done(
    `/payroll/inputs/loans/${r.id}`,
    `Added: ${String(r.months)} instalment(s), the last in ${r.lastMonth}.`,
  );
}

export async function loanStatus(id: string, fd: FormData) {
  if (!okId(id)) return;
  const here = `/payroll/inputs/loans/${id}`;
  const r = await attempt(here, () =>
    send<{ message: string }>(`/payroll/inputs/loans/${id}/status`, 'POST', {
      status: String(fd.get('status') ?? 'HOLD'),
      reason: text(fd, 'reason'),
    }),
  );
  done(here, r.message);
}

// ---- one-off items and fee recovery ------------------------------------------------------------------------
export async function addAdhoc(month: string, fd: FormData) {
  if (!okMonth(month)) return;
  const here = tab(month, 'adhoc');
  const r = await attempt(here, () =>
    send<{ message: string }>('/payroll/inputs/adhoc', 'POST', {
      month,
      employeeId: text(fd, 'employeeId'),
      payHeadId: text(fd, 'payHeadId'),
      amount: money(fd, 'amount'),
      remarks: text(fd, 'remarks'),
    }),
  );
  done(here, r.message);
}

export async function deleteAdhoc(month: string, id: string) {
  if (!okMonth(month) || !okId(id)) return;
  const here = tab(month, 'adhoc');
  await attempt(here, () => send(`/payroll/inputs/adhoc/${id}`, 'DELETE'));
  done(here, 'Removed.');
}

export async function linkWard(month: string, employeeId: string, studentId: string) {
  if (!okId(employeeId) || !okId(studentId)) return;
  const here = `/payroll/inputs/fee-recovery?month=${month}&employee=${employeeId}`;
  await attempt(here, () => send('/payroll/inputs/wards', 'POST', { employeeId, studentId }));
  done(here, 'Linked: their fee dues can now be deducted from salary.');
}

export async function unlinkWard(month: string, employeeId: string, id: string) {
  if (!okId(employeeId) || !okId(id)) return;
  const here = `/payroll/inputs/fee-recovery?month=${month}&employee=${employeeId}`;
  await attempt(here, () => send(`/payroll/inputs/wards/${id}`, 'DELETE'));
  done(here, 'Unlinked.');
}

export async function stageFeeRecovery(month: string, employeeId: string, fd: FormData) {
  if (!okMonth(month) || !okId(employeeId)) return;
  const here = `/payroll/inputs/fee-recovery?month=${month}&employee=${employeeId}`;
  const items = fd
    .getAll('due')
    .map(String)
    .map((v) => {
      const [studentId, dueOn] = v.split('|');
      return { studentId: studentId ?? '', dueOn: dueOn ?? '' };
    })
    .filter((x) => okId(x.studentId) && /^\d{4}-\d{2}-\d{2}$/.test(x.dueOn));
  if (!items.length)
    redirect(
      `${here}&error=validation-failed&detail=${encodeURIComponent('Tick the dues to deduct')}`,
    );
  const r = await attempt(here, () =>
    send<{ message: string }>('/payroll/inputs/fee-recovery', 'POST', {
      month,
      employeeId,
      payHeadId: text(fd, 'payHeadId'),
      items,
    }),
  );
  done(here, r.message);
}

// ---- recurring deductions and payees --------------------------------------------------------------------------
export async function savePayee(month: string, id: string | null, fd: FormData) {
  if (id !== null && !okId(id)) return;
  const here = `${tab(month, 'recurring')}&view=payees`;
  await attempt(here, () =>
    send(id ? `/payroll/inputs/payees/${id}` : '/payroll/inputs/payees', id ? 'PUT' : 'POST', {
      name: text(fd, 'name'),
      partyType: String(fd.get('partyType') ?? 'OTHER'),
      payeeAccount: text(fd, 'payeeAccount'),
      remarks: text(fd, 'remarks'),
      active: fd.get('active') !== 'off',
    }),
  );
  done(here, 'The payee is saved.');
}

export async function addRecurring(month: string, fd: FormData) {
  const here = tab(month, 'recurring');
  await attempt(here, () =>
    send('/payroll/inputs/recurring', 'POST', {
      employeeId: text(fd, 'employeeId'),
      payHeadId: text(fd, 'payHeadId'),
      payeeId: text(fd, 'payeeId'),
      amount: money(fd, 'amount'),
      referenceNo: text(fd, 'referenceNo'),
      startMonth: text(fd, 'startMonth'),
      endMonth: text(fd, 'endMonth'),
      remarks: text(fd, 'remarks'),
    }),
  );
  done(here, 'Added: it is deducted every month from its start.');
}

export async function recurringStatus(month: string, id: string, fd: FormData) {
  if (!okId(id)) return;
  const here = tab(month, 'recurring');
  await attempt(here, () =>
    send(`/payroll/inputs/recurring/${id}/status`, 'POST', {
      status: String(fd.get('status') ?? 'HOLD'),
      endMonth: text(fd, 'endMonth'),
      reason: text(fd, 'reason'),
    }),
  );
  done(here, 'Saved.');
}

// ---- claims -------------------------------------------------------------------------------------------------
export async function addClaim(month: string, fd: FormData) {
  const here = tab(month, 'claims');
  await attempt(here, () =>
    send('/payroll/inputs/claims', 'POST', {
      employeeId: text(fd, 'employeeId'),
      payHeadId: text(fd, 'payHeadId'),
      amountClaimed: money(fd, 'amountClaimed'),
      billDate: text(fd, 'billDate'),
      description: text(fd, 'description'),
    }),
  );
  done(here, 'Entered: a payroll checker who did not enter it decides it.');
}

export async function decideClaim(month: string, id: string, fd: FormData) {
  if (!okId(id)) return;
  const here = tab(month, 'claims');
  const decision = String(fd.get('decision') ?? 'APPROVED');
  const r = await attempt(here, () =>
    send<{ message: string }>(`/payroll/inputs/claims/${id}/decide`, 'POST', {
      decision,
      amountApproved: decision === 'APPROVED' ? money(fd, 'amountApproved') : null,
      payMonth: decision === 'APPROVED' ? text(fd, 'payMonth') : null,
      remark: text(fd, 'remark'),
    }),
  );
  done(here, r.message);
}

// ---- overtime -----------------------------------------------------------------------------------------------
export async function saveOvertime(month: string, fd: FormData) {
  if (!okMonth(month)) return;
  const here = tab(month, 'overtime');
  const r = await attempt(here, () =>
    send<{ amount: string; derived: string }>('/payroll/inputs/overtime', 'PUT', {
      month,
      employeeId: text(fd, 'employeeId'),
      basis: String(fd.get('basis') ?? 'HOUR'),
      qty: text(fd, 'qty'),
      amount: money(fd, 'amount'),
      reason: text(fd, 'reason'),
    }),
  );
  done(here, `Saved: ₹${r.amount} with this month’s salary.`);
}

export async function deleteOvertime(month: string, id: string) {
  if (!okMonth(month) || !okId(id)) return;
  const here = tab(month, 'overtime');
  await attempt(here, () => send(`/payroll/inputs/overtime/${id}`, 'DELETE'));
  done(here, 'Removed.');
}

// ---- loss-of-pay reversal ---------------------------------------------------------------------------------
export async function previewLop(employeeId: string, sourceMonth: string, days: string) {
  try {
    return {
      result: await send<{
        perDay: { pf: string; other: string };
        amountPf: string;
        amountOther: string;
        total: string;
        lopDays: string;
        monthDays: string;
      }>('/payroll/lop-reversals/preview', 'POST', { employeeId, sourceMonth, days }),
      error: null,
    };
  } catch (e) {
    if (e instanceof ApiError) return { result: null, error: detailOf(e) };
    throw e;
  }
}

export async function addLop(month: string, fd: FormData) {
  const here = tab(month, 'lop');
  const r = await attempt(here, () =>
    send<{ total: string }>('/payroll/lop-reversals', 'POST', {
      employeeId: text(fd, 'employeeId'),
      sourceMonth: text(fd, 'sourceMonth'),
      days: text(fd, 'days'),
      reason: text(fd, 'reason'),
    }),
  );
  done(
    here,
    `Staged: ₹${r.total}. A checker who did not stage it approves it; it is then paid as arrears.`,
  );
}

export async function lopAction(
  month: string,
  id: string,
  action: 'approve' | 'cancel',
  fd: FormData,
) {
  if (!okId(id)) return;
  const here = tab(month, 'lop');
  const r = await attempt(here, () =>
    send<{ message?: string }>(
      `/payroll/lop-reversals/${id}/${action}`,
      'POST',
      action === 'cancel' ? { reason: text(fd, 'reason') } : undefined,
    ),
  );
  done(here, r.message ?? 'Cancelled.');
}
