'use server';
/** Board results (docs/design/88): upload CBSE's result file, ask the AI again, save, switch a layout off or on. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import type { BoardImport } from './board-results';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const back = (path: string, error: unknown): never => {
  if (error instanceof ApiError) {
    const detail = error.problem.detail ?? error.problem.type;
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 300))}`,
    );
  }
  throw error;
};
const done = (path: string, said: string): never =>
  redirect(`${path}${path.includes('?') ? '&' : '?'}ok=1&detail=${encodeURIComponent(said)}`);

/** The .TXT uploaded with its class and year: read and checked; its page opens (nothing saved yet). */
export async function uploadGazette(fd: FormData) {
  const here = '/exams/board-results?tab=upload';
  const file = fd.get('file');
  let id = '';
  try {
    if (!(file instanceof File) || file.size === 0)
      throw new ApiError(400, {
        type: 'validation-failed',
        detail: "Choose CBSE's result file (.TXT).",
      });
    if (file.size > 900_000)
      throw new ApiError(400, {
        type: 'validation-failed',
        detail: 'The file is larger than the 900 KB a result file can be.',
      });
    const year = str(fd, 'academicYearId');
    const r = await apiFetch<BoardImport>('/exams/board-results/gazette', {
      method: 'POST',
      body: JSON.stringify({
        classLabel: str(fd, 'classLabel'),
        ...(okId(year) ? { academicYearId: year } : {}),
        fileName: file.name.slice(0, 200),
        // a CBSE file is plain ASCII; latin1 keeps any odd byte instead of failing
        text: new TextDecoder('latin1').decode(await file.arrayBuffer()),
      }),
    });
    id = r.id;
  } catch (error) {
    back(here, error);
  }
  revalidatePath('/exams/board-results');
  redirect(`/exams/board-results/imports/${id}`);
}

/** Save an upload that passed its checks (an earlier saved file of the same class and year is replaced). */
export async function saveBoardImport(fd: FormData) {
  const id = str(fd, 'id');
  const here = `/exams/board-results/imports/${id}`;
  if (!okId(id)) redirect('/exams/board-results');
  try {
    const r = await apiFetch<BoardImport>(`/exams/board-results/imports/${id}/commit`, {
      method: 'POST',
    });
    revalidatePath('/exams/board-results');
    done(
      here,
      `Saved: ${String(r.figures.candidates ?? r.totalRows)} candidates of Class ${r.classLabel} (${String(r.examYear ?? '')}).`,
    );
  } catch (error) {
    back(here, error);
  }
}

/** Ask the AI again for the layout, told which checks failed. */
export async function relearnBoardImport(fd: FormData) {
  const id = str(fd, 'id');
  const here = `/exams/board-results/imports/${id}`;
  if (!okId(id)) redirect('/exams/board-results');
  try {
    const r = await apiFetch<BoardImport>(`/exams/board-results/imports/${id}/relearn`, {
      method: 'POST',
    });
    done(
      here,
      r.status === 'validated'
        ? 'The AI read the layout again: every check passes now.'
        : 'The AI read the layout again, but some checks still fail.',
    );
  } catch (error) {
    back(here, error);
  }
}

/** A learned layout switched off (the next such file is learned again) or back on. */
export async function setBoardLayout(fd: FormData) {
  const id = str(fd, 'id');
  const here = '/exams/board-results?tab=setup';
  if (!okId(id)) redirect(here);
  const active = str(fd, 'active') === 'true';
  try {
    await apiFetch(`/exams/board-results/layouts/${id}/active`, {
      method: 'POST',
      body: JSON.stringify({ active }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath('/exams/board-results');
  done(
    here,
    active
      ? 'The layout is in use again.'
      : 'The layout is switched off: the next such file is learned again.',
  );
}
