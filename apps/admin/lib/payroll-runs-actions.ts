'use server';
/** Payroll runs (docs/design/86, phase B step 3): the forms, posted to /payroll/runs. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const okId = (id: string) => /^\d{1,18}$/.test(id);
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
  revalidatePath('/payroll/runs');
  redirect(
    `${path}${join(path)}ok=1&detail=${encodeURIComponent(detail)}&r=${Date.now().toString(36)}`,
  );
};
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
async function send<T = unknown>(path: string, method: string, body?: unknown): Promise<T> {
  return apiFetch<T>(path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function attempt<T>(here: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
}

export async function createRun(fd: FormData) {
  const here = '/payroll/runs';
  const runType = String(fd.get('runType') ?? 'REGULAR');
  const r = await attempt(here, () =>
    send<{ id: string; warnings: string[] }>('/payroll/runs', 'POST', {
      month: text(fd, 'month'),
      runType,
      ...(runType === 'SUPPLEMENTARY'
        ? { employeeIds: fd.getAll('employeeIds').map(String).filter(okId) }
        : {}),
      remark: text(fd, 'remark'),
    }),
  );
  done(
    `/payroll/runs/${r.id}`,
    `Created${r.warnings.length ? ` (${r.warnings.join('; ')})` : ''}. Look at the checks, then process it.`,
  );
}

/** One batch (the page calls it until done); the answer drives the progress bar. */
export async function processBatch(id: string) {
  if (!okId(id))
    return { error: 'Not a run', done: true, progress: 0, left: 0, processed: 0, failures: {} };
  try {
    const r = await send<{
      done: boolean;
      processed: number;
      left: number;
      progress: number;
      failures: Record<string, number>;
    }>(`/payroll/runs/${id}/process`, 'POST');
    if (r.done) revalidatePath(`/payroll/runs/${id}`);
    return { ...r, error: null };
  } catch (e) {
    if (e instanceof ApiError)
      return { error: detailOf(e), done: true, progress: 0, left: 0, processed: 0, failures: {} };
    throw e;
  }
}

/** approve, lock, or a stage change with a comment (reject, unapprove, reopen, drop failed) */
export async function runAction(
  id: string,
  action: 'approve' | 'lock' | 'reject' | 'unapprove' | 'reopen' | 'drop-failed' | 'remove',
  fd: FormData,
) {
  if (!okId(id)) return;
  const here = `/payroll/runs/${id}`;
  if (action === 'remove') {
    await attempt(here, () => send(`/payroll/runs/${id}`, 'DELETE'));
    done('/payroll/runs', 'The draft run is removed.');
  }
  const body =
    action === 'drop-failed'
      ? { reason: text(fd, 'comment') }
      : action === 'approve' || action === 'lock'
        ? undefined
        : { comment: text(fd, 'comment') };
  const r = await attempt(here, () =>
    send<{ message: string }>(`/payroll/runs/${id}/${action}`, 'POST', body),
  );
  done(here, r.message);
}

export async function recordAction(
  runId: string,
  recordId: string,
  action: 'hold' | 'release' | 'recovery',
  fd: FormData,
) {
  if (!okId(runId) || !okId(recordId)) return;
  const here = `/payroll/runs/${runId}/records/${recordId}`;
  const body =
    action === 'recovery'
      ? { emi: text(fd, 'emi')?.replace(/,/g, '') }
      : { reason: text(fd, 'reason') };
  const r = await attempt(here, () =>
    send<{ message: string }>(`/payroll/runs/${runId}/records/${recordId}/${action}`, 'POST', body),
  );
  done(action === 'recovery' ? `/payroll/runs/${runId}` : here, r.message);
}

/** "Send pending": e-mail the payslips not yet sent, each with its locked PDF (a checker). */
export async function sendPayslips(id: string) {
  if (!okId(id)) return;
  const here = `/payroll/runs/${id}`;
  const r = await attempt(here, () =>
    send<{ queued: number; noEmail: string[]; noPassword: string[] }>(
      `/payroll/runs/${id}/payslips/send`,
      'POST',
    ),
  );
  done(
    here,
    `${String(r.queued)} payslip(s) queued to e-mail.${r.noEmail.length ? ` ${String(r.noEmail.length)} have no e-mail address (${r.noEmail.slice(0, 5).join(', ')}).` : ''}${
      r.noPassword.length
        ? ` ${String(r.noPassword.length)} not sent: the password cannot be made (${r.noPassword.slice(0, 5).join(', ')}).`
        : ''
    }`,
  );
}
