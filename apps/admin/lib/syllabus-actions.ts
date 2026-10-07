'use server';
/** The syllabus master (0094): chapters and topics of a class and subject, and the Excel upload. */
import { redirect } from 'next/navigation';
import { ApiError, apiFetch } from './api';

const str = (fd: FormData, k: string) => String(fd.get(k) ?? '').trim();
const here = (fd: FormData) =>
  `/academics/syllabus?classId=${str(fd, 'classId')}&subjectId=${str(fd, 'subjectId')}`;
const back = (path: string, error: unknown): never => {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail =
      (Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : '') ||
      (typeof error.problem.detail === 'string' ? error.problem.detail : '') ||
      error.problem.type;
    redirect(
      `${path}${path.includes('?') ? '&' : '?'}error=1&detail=${encodeURIComponent(detail.slice(0, 300))}`,
    );
  }
  throw error;
};

export async function saveChapter(fd: FormData) {
  const path = here(fd);
  try {
    await apiFetch('/academics/syllabus/chapters', {
      method: 'POST',
      body: JSON.stringify({
        id: str(fd, 'id') || undefined,
        classId: str(fd, 'classId'),
        subjectId: str(fd, 'subjectId'),
        number: str(fd, 'number'),
        name: str(fd, 'name'),
        term: str(fd, 'term') || undefined,
        plannedMonth: str(fd, 'plannedMonth') || undefined,
      }),
    });
  } catch (error) {
    back(path, error);
  }
  redirect(`${path}&ok=1`);
}

export async function saveTopic(fd: FormData) {
  const path = here(fd);
  try {
    await apiFetch('/academics/syllabus/topics', {
      method: 'POST',
      body: JSON.stringify({
        id: str(fd, 'id') || undefined,
        chapterId: str(fd, 'chapterId'),
        number: str(fd, 'number'),
        name: str(fd, 'name'),
        plannedPeriods: str(fd, 'plannedPeriods') || '1',
      }),
    });
  } catch (error) {
    back(path, error);
  }
  redirect(`${path}&ok=1`);
}

export async function removeSyllabusRow(fd: FormData) {
  const path = here(fd);
  const kind = str(fd, 'kind') === 'chapter' ? 'chapters' : 'topics';
  try {
    await apiFetch(`/academics/syllabus/${kind}/${str(fd, 'id')}`, { method: 'DELETE' });
  } catch (error) {
    back(path, error);
  }
  redirect(`${path}&ok=1`);
}

export async function importSyllabus(fd: FormData) {
  const file = fd.get('file');
  let done = { chapters: 0, topics: 0, problems: [] as Array<{ row: number; message: string }> };
  try {
    if (!(file instanceof File) || file.size === 0)
      throw new ApiError(400, { type: 'validation-failed', detail: 'Choose the Excel file.' });
    done = await apiFetch('/academics/syllabus/import', {
      method: 'POST',
      body: JSON.stringify({
        fileBase64: Buffer.from(await file.arrayBuffer()).toString('base64'),
      }),
    });
  } catch (error) {
    back('/academics/syllabus', error);
  }
  const problems = done.problems
    .slice(0, 8)
    .map((p) => `row ${String(p.row)}: ${p.message}`)
    .join('; ');
  redirect(
    `/academics/syllabus?ok=1&imported=${String(done.chapters)}-${String(done.topics)}-${String(done.problems.length)}${problems ? `&detail=${encodeURIComponent(problems.slice(0, 400))}` : ''}`,
  );
}
