'use server';
/** Board results (docs/design/88): upload CBSE's result file, ask the AI again, save, switch a layout off or on. */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';
import { YEAR_SUBJECT_FIELDS, type BoardImport } from './board-results';

const okId = (id: string) => /^\d{1,18}$/.test(id);
const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const back = (path: string, error: unknown): never => {
  if (error instanceof ApiError) {
    // a form check's first message ("A+ starts at 90, so A must end at 89 …") when there is no detail
    const first = (error.problem.errors as Array<{ message?: string }> | undefined)?.[0]?.message;
    const detail = error.problem.detail ?? first ?? error.problem.type;
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
    // "y:2022": an earlier examination with no academic year in EduPro (phase E)
    const earlier = /^y:(\d{4})$/.exec(year);
    const r = await apiFetch<BoardImport>('/exams/board-results/gazette', {
      method: 'POST',
      body: JSON.stringify({
        classLabel: str(fd, 'classLabel'),
        ...(okId(year) ? { academicYearId: year } : {}),
        ...(earlier ? { examYear: Number(earlier[1]) } : {}),
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
    teacherRows?: number;
    teachersSkipped?: { noTeacher: number; noSection: number; badCode: number };
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
  const o = out!;
  const sk = o.teachersSkipped ?? { noTeacher: 0, noSection: 0, badCode: 0 };
  const why = [
    sk.noTeacher ? `${String(sk.noTeacher)} with no teacher name` : '',
    sk.noSection ? `${String(sk.noSection)} with no section` : '',
    sk.badCode ? `${String(sk.badCode)} without a 3-digit subject code` : '',
  ]
    .filter(Boolean)
    .join(', ');
  const students = `${String(o.updated)} candidates updated, ${String(o.linked)} linked by admission number${o.unknownRolls.length ? `; ${String(o.unknownRolls.length)} roll numbers not in the result file` : ''}`;
  // a Teachers sheet with rows but no teacher named: say so plainly (the teacher list is kept as it was)
  if ((o.teacherRows ?? 0) > 0 && o.teachers === 0)
    redirect(
      `${here}?error=board.teachers_not_saved&detail=${encodeURIComponent(
        `${students}. The Teachers sheet has ${String(o.teacherRows)} rows but none was saved (${why}): write each section's subject teacher in the Teacher column (pick from the Staff tab) and upload again. The teacher list is unchanged.`,
      )}`,
    );
  done(
    here,
    `Details sheet: ${students}; ${String(o.teachers)} teacher rows saved (${String(o.teachersMatched)} matched to staff)${why ? `, ${why} left out` : ''}.`,
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

/**
 * A class's analysis rules: the best five built from its parts, the distinction and pass marks, how grades are
 * counted and the grade scale (the filled rows; the API sorts them and checks 0–100 is covered).
 */
export async function saveBoardRules(fd: FormData) {
  const cls = str(fd, 'classLabel') === 'XII' ? 'XII' : 'X';
  const here = `/exams/board-results?tab=setup&rules=${cls}`;
  const grades = fd.getAll('grade').map((v) => String(v).trim());
  const froms = fd.getAll('from').map((v) => String(v).trim());
  const tos = fd.getAll('to').map((v) => String(v).trim());
  // an empty row is no grade (that is how one is removed); a half-filled row is sent back
  const rows = grades
    .map((grade, i) => ({ row: i + 1, grade, from: froms[i] ?? '', to: tos[i] ?? '' }))
    .filter((r) => r.grade || r.from || r.to);
  const half = rows.find((r) => !r.grade || r.from === '' || r.to === '');
  if (half)
    redirect(
      `${here}&error=validation-failed&detail=${encodeURIComponent(`Grade row ${String(half.row)}: give the grade, its "from" and its "to" marks, or clear the row.`)}`,
    );
  const scale = rows.map((r) => ({ grade: r.grade, from: Number(r.from), to: Number(r.to) }));
  try {
    await apiFetch('/exams/board-results/rules', {
      method: 'PUT',
      body: JSON.stringify({
        classLabel: cls,
        bestFive: {
          include: str(fd, 'include'),
          rest: str(fd, 'rest'),
          optional: str(fd, 'optional'),
          optionalKinds: fd.getAll('optionalKinds').map(String),
        },
        distinction: Number(str(fd, 'distinction')),
        passMarks: Number(str(fd, 'passMarks')),
        grades: str(fd, 'grades'),
        scale,
      }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath('/exams/board-results');
  done(
    here,
    `Class ${cls}'s analysis rules are saved; the annexures and reports count with them from now.`,
  );
}

/** A child's board result shown on the parent app, or no longer (docs/design/88, phase D). */
export async function setBoardParents(fd: FormData) {
  const here = '/exams/board-results?tab=setup';
  const on = str(fd, 'on') === 'true';
  try {
    await apiFetch('/exams/board-results/parents', { method: 'PUT', body: JSON.stringify({ on }) });
  } catch (error) {
    back(here, error);
  }
  revalidatePath('/exams/board-results');
  done(
    here,
    on
      ? "Families now see their child's board result on the parent app."
      : 'The board result is no longer shown on the parent app.',
  );
}

// ---- phase E: earlier years' figures typed in -----------------------------------------------------------------------

const num = (fd: FormData, k: string) => {
  const v = str(fd, k);
  return v === '' ? null : Number(v);
};

/**
 * An earlier year's figures (its result file lost): the headline, and each subject as a line — the code, then
 * appeared, highest, A grades, compartments, failures, distinctions, average, PI (commas or tabs; pasted from the
 * old workbook; a figure left out is blank).
 */
export async function saveBoardYearFigures(fd: FormData) {
  const cls = str(fd, 'classLabel') === 'XII' ? 'XII' : 'X';
  const here = `/exams/board-results?tab=setup&figures=${cls}#figures`;
  const subjects: Array<Record<string, string | number | null>> = [];
  const lines = str(fd, 'subjects').split(/\r?\n/);
  for (const [i, raw] of lines.entries()) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\s*[\t,;]\s*/);
    const code = (parts[0] ?? '').replace(/\D/g, '').padStart(3, '0');
    const figures = parts.slice(1).map((x) => (x.trim() === '' ? null : Number(x.trim())));
    if (
      !/^\d{3}$/.test(code) ||
      figures[0] == null ||
      figures.some((x) => x !== null && !Number.isFinite(x))
    )
      back(
        here,
        new ApiError(400, {
          type: 'validation-failed',
          detail: `Subject line ${String(i + 1)}: write the 3-digit code, then the numbers (appeared first), separated by commas or tabs.`,
        }),
      );
    const row: Record<string, string | number | null> = { code };
    YEAR_SUBJECT_FIELDS.forEach((k, j) => (row[k] = figures[j] ?? null));
    subjects.push(row);
  }
  try {
    await apiFetch('/exams/board-results/year-figures', {
      method: 'PUT',
      body: JSON.stringify({
        classLabel: cls,
        examYear: num(fd, 'examYear'),
        registered: num(fd, 'registered'),
        appeared: num(fd, 'appeared'),
        passed: num(fd, 'passed'),
        compartments: num(fd, 'compartments'),
        failures: num(fd, 'failures'),
        n90: num(fd, 'n90'),
        n75: num(fd, 'n75'),
        aggregate: num(fd, 'aggregate'),
        pi: num(fd, 'pi'),
        subjects,
        note: str(fd, 'note') || null,
      }),
    });
  } catch (error) {
    back(here, error);
  }
  revalidatePath('/exams/board-results');
  done(
    here,
    `The Class ${cls} ${str(fd, 'examYear')} figures are saved: the five-year rows and the trend use them.`,
  );
}

export async function removeBoardYearFigures(fd: FormData) {
  const id = str(fd, 'id');
  const cls = str(fd, 'classLabel') === 'XII' ? 'XII' : 'X';
  const here = `/exams/board-results?tab=setup&figures=${cls}#figures`;
  if (!okId(id)) redirect(here);
  try {
    await apiFetch(`/exams/board-results/year-figures/${id}`, { method: 'DELETE' });
  } catch (error) {
    back(here, error);
  }
  revalidatePath('/exams/board-results');
  done(here, "The year's typed figures are removed.");
}
