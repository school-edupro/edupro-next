'use server';
/**
 * Pay changes and leavers (docs/design/86, phase E): revisions, the yearly increments, settlements and transfers,
 * posted to the payroll API. Each action returns to the page it came from with what happened.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

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
  revalidatePath('/payroll');
  redirect(
    `${path}${join(path)}ok=1&detail=${encodeURIComponent(detail.slice(0, 300))}&r=${Date.now().toString(36)}`,
  );
};
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const amount = (fd: FormData, k: string) => text(fd, k)?.replace(/,/g, '') ?? null;
async function attempt<T>(here: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
}
const post = <T>(path: string, body?: unknown) =>
  apiFetch<T>(path, {
    method: 'POST',
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

// ---- revisions ------------------------------------------------------------------------------------------------
export async function draftRevision(fd: FormData) {
  const here = '/payroll/people?tab=revisions';
  const kind = text(fd, 'kind') === 'FORMULA' ? 'FORMULA' : 'RATE';
  const r = await attempt(here, () =>
    post<{ id: string }>('/payroll/revisions', {
      kind,
      ...(kind === 'RATE'
        ? { rateCode: text(fd, 'rateCode'), newValue: text(fd, 'newValue') }
        : { headCode: text(fd, 'headCode'), formula: text(fd, 'formula') }),
      effectiveFrom: `${String(text(fd, 'month') ?? '')}-01`,
      notifiedOn: text(fd, 'notifiedOn'),
      reason: text(fd, 'reason'),
    }),
  );
  done(
    `/payroll/people/revisions/${r.id}`,
    'Drafted: see what it pays, then a checker who did not draft it applies it.',
  );
}

export async function revisionStep(id: string, step: 'apply' | 'cancel') {
  if (!okId(id)) return;
  const here = `/payroll/people/revisions/${id}`;
  const r = await attempt(here, () =>
    post<{ message?: string }>(`/payroll/revisions/${id}/${step}`),
  );
  done(here, step === 'apply' ? (r.message ?? 'Applied.') : 'Cancelled.');
}

export async function proposeIncrements(month: string, fd: FormData) {
  if (!okMonth(month)) return;
  const here = `/payroll/people?tab=increments&month=${month}`;
  const employeeIds = fd.getAll('employeeId').map(String).filter(okId);
  if (!employeeIds.length)
    redirect(
      `${here}&error=validation-failed&detail=${encodeURIComponent('Tick the staff to increment.')}`,
    );
  const r = await attempt(here, () =>
    post<{ id: string; count: number }>('/payroll/increments', {
      month,
      employeeIds,
      reason: text(fd, 'reason') ?? 'Yearly increment',
    }),
  );
  done(
    `/payroll/people/revisions/${r.id}`,
    `${String(r.count)} increment(s) proposed: another checker applies them, and each gets a numbered letter.`,
  );
}

// ---- settlements ----------------------------------------------------------------------------------------------
export async function computeSettlement(id: string, fd: FormData) {
  if (!okId(id)) return;
  const here = `/payroll/people/settlements/${id}`;
  const forfeit = amount(fd, 'forfeit');
  const r = await attempt(here, () =>
    post<{ message: string }>(`/payroll/settlements/${id}/compute`, {
      fixedTerm: fd.get('fixedTerm') === 'on',
      encashDays: text(fd, 'encashDays'),
      encashReason: text(fd, 'encashReason'),
      otherPayable: amount(fd, 'otherPayable'),
      otherRecovery: amount(fd, 'otherRecovery'),
      ...(forfeit && Number(forfeit) > 0
        ? { forfeit, forfeitReason: text(fd, 'forfeitReason') }
        : {}),
    }),
  );
  done(here, r.message);
}

export async function settlementStep(
  id: string,
  step: 'approve' | 'stage' | 'run' | 'cancel' | 'collected',
  fd?: FormData,
) {
  if (!okId(id)) return;
  const here = `/payroll/people/settlements/${id}`;
  const body =
    step === 'cancel'
      ? { reason: fd ? text(fd, 'reason') : null }
      : step === 'collected'
        ? { reference: fd ? text(fd, 'reference') : null }
        : undefined;
  const r = await attempt(here, () =>
    post<{ message?: string; runId?: string }>(`/payroll/settlements/${id}/${step}`, body),
  );
  if (step === 'run' && r.runId)
    done(
      `/payroll/runs/${r.runId}`,
      'The full-and-final run is made: process it, then a checker approves and locks it.',
    );
  done(
    here,
    r.message ??
      {
        approve: 'Approved.',
        stage: 'Sent to be paid.',
        run: 'Run made.',
        cancel: 'Cancelled.',
        collected: 'Recorded as collected.',
      }[step],
  );
}

// ---- transfers ------------------------------------------------------------------------------------------------
export async function bringTransfer(id: string) {
  if (!okId(id)) return;
  const here = `/payroll/people/transfers/${id}`;
  const r = await attempt(here, () => post<{ message: string }>(`/payroll/transfers/${id}/bring`));
  done(here, r.message);
}
