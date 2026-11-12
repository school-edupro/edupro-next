'use server';
/** Reporting managers (docs/design/30): one by one or ticked, a whole team moved, or from Excel. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { ReportingImportResult } from './reporting';

const PAGE = '/people/employees/reporting';
const ID = /^\d{1,18}$/;
const backOf = (fd: FormData) => {
  const b = String(fd.get('back') ?? '');
  return /^\/people\/employees\/reporting(\?[\w=&%.\-+]*)?$/.test(b) ? b : PAGE;
};
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
const go = (path: string, ok: boolean, words: string): never =>
  redirect(
    `${path}${path.includes('?') ? '&' : '?'}${ok ? 'ok=1' : 'error=validation-failed'}&detail=${encodeURIComponent(words.slice(0, 300))}`,
  );
const done = (r: { changed: number; unchanged: number; waiting: number; year: string | null }) =>
  [
    r.changed
      ? `Done: ${String(r.changed)} employee${r.changed === 1 ? '' : 's'} now report${r.changed === 1 ? 's' : ''} as set for ${r.year ?? 'this year'}`
      : 'Nothing changed',
    r.unchanged ? `${String(r.unchanged)} already so` : null,
    r.waiting
      ? `${String(r.waiting)} leave or correction${r.waiting === 1 ? '' : 's'} already waiting with the old manager stay${r.waiting === 1 ? 's' : ''} with them (the leave office can decide for the approvers)`
      : null,
  ]
    .filter(Boolean)
    .join('. ') + '.';

/**
 * Save from the list: a row's own Save (`one` = that employee, their row's manager) or the ticked
 * employees with the manager picked for them all ('none': nobody).
 */
export async function saveReporting(fd: FormData) {
  const path = backOf(fd);
  const one = String(fd.get('one') ?? '');
  let employeeIds: string[];
  let pick: string;
  if (ID.test(one)) {
    employeeIds = [one];
    pick = String(fd.get(`m_${one}`) ?? '');
  } else {
    employeeIds = fd
      .getAll('employeeIds')
      .map(String)
      .filter((x) => ID.test(x));
    pick = String(fd.get('managerId') ?? '');
    if (!employeeIds.length) go(path, false, 'Tick the employees first.');
    if (!pick) go(path, false, 'Pick who they report to (or Nobody).');
  }
  const managerId = ID.test(pick) ? pick : null;
  let r: { changed: number; unchanged: number; waiting: number; year: string | null };
  try {
    r = await apiFetch('/people/reporting/assign', {
      method: 'POST',
      body: JSON.stringify({ employeeIds, managerId }),
    });
  } catch (e) {
    if (e instanceof ApiError) go(path, false, detailOf(e));
    throw e;
  }
  revalidatePath(PAGE);
  go(path, true, done(r));
}

/** One manager's whole team to another manager ('none': nobody). */
export async function moveTeam(fd: FormData) {
  const path = backOf(fd);
  const from = String(fd.get('fromManagerId') ?? '');
  const to = String(fd.get('toManagerId') ?? '');
  if (!ID.test(from)) go(path, false, 'Pick whose team moves.');
  if (!to) go(path, false, 'Pick who they report to now (or Nobody).');
  let r: { changed: number; unchanged: number; waiting: number; year: string | null; team: number };
  try {
    r = await apiFetch('/people/reporting/move', {
      method: 'POST',
      body: JSON.stringify({ fromManagerId: from, toManagerId: ID.test(to) ? to : null }),
    });
  } catch (e) {
    if (e instanceof ApiError) go(path, false, detailOf(e));
    throw e;
  }
  revalidatePath(PAGE);
  go(path, true, done(r));
}

/** Reporting managers from Excel: checked (dryRun), then the good rows saved. */
export async function importReporting(
  file: string,
  dryRun: boolean,
): Promise<ReportingImportResult> {
  try {
    const r = await apiFetch<Omit<Extract<ReportingImportResult, { ok: true }>, 'ok'>>(
      '/people/reporting/import',
      { method: 'POST', body: JSON.stringify({ file, dryRun }) },
    );
    if (!dryRun) revalidatePath(PAGE);
    return { ok: true, ...r };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, error: detailOf(e) };
    throw e;
  }
}
