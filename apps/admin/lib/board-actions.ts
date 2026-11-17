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

// ---- phase B: students, details, CBSE subjects, teachers ------------------------------------------------------------

/** A candidate linked to a student, marked not ours, or unlinked (the Review students page). */
export async function pickBoardStudent(fd: FormData) {
  const importId = str(fd, 'importId');
  const id = str(fd, 'candidateId');
  const here = `/exams/board-results/imports/${importId}/review`;
  if (!okId(importId) || !okId(id)) redirect('/exams/board-results');
  const how = str(fd, 'how');
  const studentId = str(fd, 'studentId');
  if (how === 'link' && !okId(studentId))
    redirect(`${here}?error=validation-failed&detail=${encodeURIComponent('Choose the student.')}`);
  try {
    await apiFetch(`/exams/board-results/candidates/${id}/student`, {
      method: 'POST',
      body: JSON.stringify(
        how === 'link'
          ? { studentId }
          : how === 'not-ours'
            ? { notOurs: true }
            : { studentId: null },
      ),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath(here);
  done(
    here,
    how === 'link'
      ? 'Linked: the details and the board roll number follow.'
      : how === 'not-ours'
        ? 'Marked as not our student.'
        : 'Unlinked.',
  );
}

/** Every found candidate's details taken again from the student records. */
export async function refreshBoardDetails(fd: FormData) {
  const id = str(fd, 'id');
  const here = `/exams/board-results/imports/${id}`;
  if (!okId(id)) redirect('/exams/board-results');
  let n = 0;
  try {
    n = (
      await apiFetch<{ refreshed: number }>(`/exams/board-results/imports/${id}/refresh`, {
        method: 'POST',
      })
    ).refreshed;
  } catch (error) {
    back(here, error);
  }
  done(here, `The details of ${String(n)} candidates taken again from the records.`);
}

/** The school's old details sheet (two sheets) uploaded as an override. */
export async function uploadDetailsSheet(fd: FormData) {
  const id = str(fd, 'id');
  const here = `/exams/board-results/imports/${id}`;
  if (!okId(id)) redirect('/exams/board-results');
  const file = fd.get('file');
  let out: {
    updated: number;
    linked: number;
    unknownRolls: string[];
    teachers: number;
    teachersMatched: number;
  } | null = null;
  try {
    if (!(file instanceof File) || file.size === 0)
      throw new ApiError(400, {
        type: 'validation-failed',
        detail: 'Choose the details sheet (.xlsx).',
      });
    if (file.size > 700_000)
      throw new ApiError(400, {
        type: 'validation-failed',
        detail: 'The sheet is larger than 700 KB.',
      });
    out = await apiFetch(`/exams/board-results/imports/${id}/details-sheet`, {
      method: 'POST',
      body: JSON.stringify({
        fileName: file.name.slice(0, 200),
        fileBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
      }),
    });
  } catch (error) {
    back(here, error);
  }
  done(
    here,
    `Details sheet: ${String(out!.updated)} candidates updated, ${String(out!.linked)} linked by admission number, ${String(out!.teachers)} teacher rows (${String(out!.teachersMatched)} matched to employees)${out!.unknownRolls.length ? `; ${String(out!.unknownRolls.length)} roll numbers not in the file` : ''}.`,
  );
}

/** A CBSE subject code named, its kind, the school subject it is. */
export async function saveBoardSubject(fd: FormData) {
  const id = str(fd, 'id');
  const cls = str(fd, 'classLabel') === 'XII' ? 'XII' : 'X';
  const here = `/exams/board-results?tab=setup&subjects=${cls}`;
  const subjectId = str(fd, 'subjectId');
  const body = {
    name: str(fd, 'name'),
    kind: str(fd, 'kind'),
    subjectId: okId(subjectId) ? subjectId : null,
  };
  try {
    if (id && okId(id))
      await apiFetch(`/exams/board-results/subjects/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    else
      await apiFetch('/exams/board-results/subjects', {
        method: 'POST',
        body: JSON.stringify({ ...body, classLabel: cls, code: str(fd, 'code') }),
      });
  } catch (error) {
    back(here, error);
  }
  revalidatePath('/exams/board-results');
  done(here, `Saved: ${body.name}.`);
}

/** A section's subject taught by another teacher (the whole section, or the roll numbers listed). */
export async function addBoardTeacher(fd: FormData) {
  const cls = str(fd, 'classLabel') === 'XII' ? 'XII' : 'X';
  const year = str(fd, 'examYear');
  const here = `/exams/board-results?tab=teachers&classLabel=${cls}&examYear=${year}`;
  const employeeId = str(fd, 'employeeId');
  try {
    await apiFetch('/exams/board-results/teachers', {
      method: 'POST',
      body: JSON.stringify({
        classLabel: cls,
        examYear: Number(year),
        section: str(fd, 'section'),
        code: str(fd, 'code'),
        ...(okId(employeeId) ? { employeeId } : { teacherName: str(fd, 'teacherName') || null }),
        rolls: str(fd, 'rolls')
          .split(/[\s,;]+/)
          .filter((x) => /^\d{6,10}$/.test(x)),
      }),
    });
  } catch (error) {
    back(here, error);
  }
  done(here, 'Teacher set.');
}

export async function removeBoardTeacher(fd: FormData) {
  const cls = str(fd, 'classLabel') === 'XII' ? 'XII' : 'X';
  const here = `/exams/board-results?tab=teachers&classLabel=${cls}&examYear=${str(fd, 'examYear')}`;
  const id = str(fd, 'id');
  if (!okId(id)) redirect(here);
  try {
    await apiFetch(`/exams/board-results/teachers/${id}`, { method: 'DELETE' });
  } catch (error) {
    back(here, error);
  }
  done(here, 'Removed: the year’s teacher assignment applies again.');
}

// ---- phase C: the annexures' rules -----------------------------------------------------------------------------------

/** The rules the annexures count with: the best five, the distinction and pass marks, grades from marks or printed. */
export async function saveBoardRules(fd: FormData) {
  const here = '/exams/board-results?tab=setup';
  try {
    await apiFetch('/exams/board-results/rules', {
      method: 'PUT',
      body: JSON.stringify({
        bestFive: str(fd, 'bestFive'),
        distinction: Number(str(fd, 'distinction')),
        passMarks: Number(str(fd, 'passMarks')),
        grades: str(fd, 'grades'),
      }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath('/exams/board-results');
  done(here, 'The analysis rules are saved; the annexures count with them from now.');
}
