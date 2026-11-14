'use server';
/** Moving from the old payroll (docs/design/86, phase G): the go-live steps, posted to the payroll API. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const HERE = '/payroll/setup/golive';
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
  revalidatePath('/payroll/setup/golive');
  redirect(
    `${path}${join(path)}ok=1&detail=${encodeURIComponent(detail.slice(0, 300))}&r=${Date.now().toString(36)}`,
  );
};
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
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

export async function goLiveStep(
  step: 'start' | 'read' | 'prepare' | 'commit' | 'parallel-compare',
  fd: FormData,
) {
  void fd;
  const path =
    step === 'parallel-compare' ? '/payroll/golive/parity/parallel' : `/payroll/golive/${step}`;
  const r = await attempt(HERE, () =>
    post<{ batchId?: string; open?: number }>(path, step === 'start' ? {} : undefined),
  );
  if (step === 'parallel-compare' && r.batchId)
    done(`${HERE}/parity/${r.batchId}`, `Compared: ${String(r.open ?? 0)} difference(s) open.`);
  done(
    HERE,
    {
      start: 'Started: ask for the old payroll to be read.',
      read: 'Asked: the old payroll is read in the background (a minute or two). Refresh to see it.',
      prepare: 'Prepared: a second person commits it.',
      commit: 'Brought across.',
      'parallel-compare': 'Compared.',
    }[step],
  );
}

export async function setParallel(fd: FormData) {
  const first = text(fd, 'first');
  if (!first) return;
  const d = new Date(`${first}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  const second = d.toISOString().slice(0, 7);
  await attempt(HERE, () => post('/payroll/golive/parallel-months', { months: [first, second] }));
  done(HERE, `The parallel months are set: ${first} and ${second}.`);
}

export async function replay(fd: FormData) {
  const from = text(fd, 'from');
  const to = text(fd, 'to');
  if (!from || !to) return;
  const months: string[] = [];
  const d = new Date(`${from}-01T00:00:00Z`);
  while (d.toISOString().slice(0, 7) <= to && months.length < 24) {
    months.push(d.toISOString().slice(0, 7));
    d.setUTCMonth(d.getUTCMonth() + 1);
  }
  const r = await attempt(HERE, () =>
    post<{ batchId: string; open: number }>('/payroll/golive/parity/replay', { months }),
  );
  done(`${HERE}/parity/${r.batchId}`, `Replayed: ${String(r.open)} difference(s) open.`);
}

export async function explain(batchId: string, back: string, fd: FormData) {
  if (!/^\d{1,18}$/.test(batchId)) return;
  const here = back.startsWith(`${HERE}/parity/`) ? back : `${HERE}/parity/${batchId}`;
  const r = await attempt(here, () =>
    post<{ explained: number }>(`/payroll/golive/parity/${batchId}/explain`, {
      resultIds: fd
        .getAll('resultId')
        .map(String)
        .filter((x) => /^\d{1,18}$/.test(x)),
      code: text(fd, 'code'),
      defect: text(fd, 'defect'),
      note: text(fd, 'note'),
    }),
  );
  done(here, `${String(r.explained)} difference(s) explained.`);
}

export async function sign(batchId: string) {
  if (!/^\d{1,18}$/.test(batchId)) return;
  await attempt(`${HERE}/parity/${batchId}`, () => post(`/payroll/golive/parity/${batchId}/sign`));
  done(HERE, 'Signed: the principal countersigns it.');
}

export async function countersign(id: string) {
  if (!/^\d{1,18}$/.test(id)) return;
  await attempt(HERE, () => post(`/payroll/golive/signoffs/${id}/countersign`));
  done(HERE, 'Countersigned: the payroll admin can switch.');
}

export async function switchOver(fd: FormData) {
  const r = await attempt(HERE, () =>
    post<{ message: string }>('/payroll/golive/switch', { month: text(fd, 'month') }),
  );
  done(HERE, r.message);
}

export async function rollback(fd: FormData) {
  await attempt(HERE, () => post('/payroll/golive/rollback', { reason: text(fd, 'reason') }));
  done(HERE, 'Switched back: the old payroll pays again until the next switch.');
}
