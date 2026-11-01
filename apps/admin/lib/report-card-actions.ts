'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

/**
 * The report-card release workspace (docs/design/65): make a release, its set-up, the PDFs, holds and
 * the steps to the families; each returns to the tab it came from with what happened.
 */
const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const okId = (id: string) => /^\d{1,18}$/.test(id);

function back(path: string, status: 'ok' | string, detail?: string): never {
  const url = new URL(path, 'http://edupro.local');
  for (const k of ['ok', 'error', 'detail']) url.searchParams.delete(k);
  url.searchParams.set(status === 'ok' ? 'ok' : 'error', status === 'ok' ? '1' : status);
  if (detail) url.searchParams.set('detail', detail.slice(0, 200));
  revalidatePath(url.pathname);
  redirect(`${url.pathname}${url.search}`);
}
const detailOf = (e: ApiError) => {
  if (typeof e.problem.detail === 'string' && e.problem.detail) return e.problem.detail;
  const errs = e.problem.errors as Array<{ path?: string; message?: string }> | undefined;
  return Array.isArray(errs)
    ? errs.map((x) => [x.path, x.message].filter(Boolean).join(': ')).join('; ')
    : undefined;
};
async function run(path: string, fn: () => Promise<unknown>, done?: string): Promise<never> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof ApiError) back(path, error.problem.type, detailOf(error));
    throw error;
  }
  back(path, 'ok', done);
}
/** the workspace tab to come back to (only this app's own release pages) */
const backTo = (fd: FormData, id: string) => {
  const b = str(fd, 'back');
  return b.startsWith(`/exams/report-cards/${id}`) ? b : `/exams/report-cards/${id}`;
};

export async function createRelease(fd: FormData) {
  let made: { id: string } | undefined;
  try {
    made = await apiFetch<{ id: string }>('/exams/report-cards/releases', {
      method: 'POST',
      body: JSON.stringify({
        termCode: str(fd, 'termCode').toUpperCase(),
        name: str(fd, 'name'),
        examIds: fd.getAll('examIds').map(String).filter(okId),
        templates: {},
        hideDefaulters: fd.get('hideDefaulters') === 'on',
        defaulterMin: Number(str(fd, 'defaulterMin') || 0),
      }),
    });
  } catch (error) {
    if (error instanceof ApiError)
      back('/exams/report-cards?new=1', error.problem.type, detailOf(error));
    throw error;
  }
  back(
    `/exams/report-cards/${made!.id}?tab=setup`,
    'ok',
    'Release made: check the template of each class, then the readiness',
  );
}

export async function saveReleaseSetup(fd: FormData) {
  const id = str(fd, 'id');
  if (!okId(id)) back('/exams/report-cards', 'validation-failed', 'Unknown release');
  const templates: Record<string, string> = {};
  for (const [k, v] of fd.entries())
    if (
      /^tpl:(pre_primary|primary|middle|secondary|senior|class_\d{1,18})$/.test(k) &&
      okId(String(v))
    )
      templates[k.slice(4)] = String(v);
  return run(
    backTo(fd, id),
    () =>
      apiFetch(`/exams/report-cards/releases/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: str(fd, 'name'),
          examIds: fd.getAll('examIds').map(String).filter(okId),
          templates,
          hideDefaulters: fd.get('hideDefaulters') === 'on',
          defaulterMin: Number(str(fd, 'defaulterMin') || 0),
        }),
      }),
    'Set-up saved',
  );
}

export async function setReleaseStatus(fd: FormData) {
  const id = str(fd, 'id');
  const status = str(fd, 'status');
  if (!okId(id) || !['draft', 'submitted', 'released', 'withdrawn'].includes(status))
    back('/exams/report-cards', 'validation-failed', 'Unknown step');
  const reason = str(fd, 'reason');
  return run(
    backTo(fd, id),
    () =>
      apiFetch(`/exams/report-cards/releases/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      }),
    {
      submitted: 'Sent to the principal',
      released: 'Published: families are told and see the cards in the app',
      withdrawn: 'Withdrawn from the families',
      draft: 'Back to a draft',
    }[status],
  );
}

export async function holdCard(fd: FormData) {
  const id = str(fd, 'id');
  const held = str(fd, 'held') === 'yes';
  const reason = str(fd, 'reason');
  return run(
    backTo(fd, id),
    () =>
      apiFetch(`/exams/report-cards/releases/${id}/holds`, {
        method: 'PUT',
        body: JSON.stringify({
          studentId: str(fd, 'studentId'),
          held,
          ...(reason ? { reason } : {}),
        }),
      }),
    held ? 'Card held back' : 'Card shown again',
  );
}

/** the PDFs of one or more sections (a whole class: each of its sections) */
export async function renderSections(fd: FormData) {
  const id = str(fd, 'id');
  const sections = fd.getAll('sectionId').map(String).filter(okId);
  return run(
    backTo(fd, id),
    async () => {
      for (const s of sections)
        await apiFetch(`/exams/report-cards/releases/${id}/render`, {
          method: 'POST',
          body: JSON.stringify({ classSectionId: s }),
        });
    },
    `${String(sections.length)} section PDF${sections.length === 1 ? '' : 's'} being made: they appear when ready`,
  );
}

export async function renderCard(fd: FormData) {
  const id = str(fd, 'id');
  return run(
    backTo(fd, id),
    () =>
      apiFetch(`/exams/report-cards/releases/${id}/students/${str(fd, 'studentId')}/render`, {
        method: 'POST',
      }),
    'The card is being made',
  );
}
