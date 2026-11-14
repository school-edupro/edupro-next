'use server';
/** Payroll reports (docs/design/86, phase F): column presets and the year's bonus, posted to the payroll API. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

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
  revalidatePath('/payroll/reports');
  redirect(
    `${path}${join(path)}ok=1&detail=${encodeURIComponent(detail.slice(0, 300))}&r=${Date.now().toString(36)}`,
  );
};
const text = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? null : v;
};
const safeBack = (fd: FormData) => {
  const b = String(fd.get('back') ?? '/payroll/reports');
  return b.startsWith('/payroll/reports') ? b : '/payroll/reports';
};
async function attempt<T>(here: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ApiError) back(here, e);
    throw e;
  }
}
const post = <T>(path: string, method: string, body?: unknown) =>
  apiFetch<T>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

export async function savePreset(fd: FormData) {
  const here = safeBack(fd);
  const columns = fd
    .getAll('column')
    .map(String)
    .filter((c) => /^[a-z0-9_:A-Z]{1,40}$/.test(c));
  await attempt(here, () =>
    post('/payroll/reports/presets', 'POST', {
      report: 'register',
      name: text(fd, 'name'),
      columns,
      shared: fd.get('shared') === 'on',
    }),
  );
  done(here, 'Preset saved.');
}

export async function deletePreset(id: string, fd: FormData) {
  if (!/^\d{1,18}$/.test(id)) return;
  const here = safeBack(fd);
  await attempt(here, () => post(`/payroll/reports/presets/${id}/delete`, 'POST'));
  done(here, 'Preset removed.');
}

export async function saveBonusRule(fy: string, fd: FormData) {
  if (!/^\d{4}-\d{2}$/.test(fy)) return;
  const here = `/payroll/reports?key=bonus&fy=${fy}`;
  const kind = (text(fd, 'kind') ?? 'PERCENT') as 'PERCENT' | 'FIXED' | 'STATUTORY';
  const pct = text(fd, 'ratePct');
  await attempt(here, () =>
    post(`/payroll/bonus/${fy}`, 'PUT', {
      kind,
      rate: kind === 'FIXED' || !pct ? null : String(Math.round(Number(pct) * 100) / 10000),
      amount: kind === 'FIXED' ? text(fd, 'amount')?.replace(/,/g, '') : null,
      prorate: fd.get('prorate') === 'on',
      minMonths: Number(text(fd, 'minMonths') ?? 0),
      minDays: text(fd, 'minDays') ?? '0',
      maxWage: text(fd, 'maxWage')?.replace(/,/g, '') ?? null,
      wageCap: text(fd, 'wageCap')?.replace(/,/g, '') ?? null,
      note: text(fd, 'note'),
    }),
  );
  done(here, 'The year’s bonus rule is saved.');
}

export async function postBonus(fy: string, dryRun: boolean, fd: FormData) {
  if (!/^\d{4}-\d{2}$/.test(fy)) return;
  const here = `/payroll/reports?key=bonus&fy=${fy}`;
  const r = await attempt(here, () =>
    post<{ message: string }>(`/payroll/bonus/${fy}/post`, 'POST', {
      month: text(fd, 'month'),
      dryRun,
    }),
  );
  done(here, r.message);
}
