'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();
const where = (fd: FormData) =>
  `/indicators?exam=${str(fd, 'examId')}&section=${str(fd, 'classSectionId')}&area=${encodeURIComponent(str(fd, 'area'))}&student=${str(fd, 'studentId') || str(fd, 'child')}`;

async function send(fd: FormData, path: string, method: string, body?: unknown) {
  const back = where(fd);
  try {
    await bff.api.fetch(`/exams/${str(fd, 'examId')}/${path}`, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `${back}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 120))}`,
      );
    }
    throw error;
  }
  redirect(`${back}&ok=1`);
}

/** One area of the section (docs/design/65 part 5): a level or a note per child and item. */
export async function saveLevels(fd: FormData) {
  const items = fd.getAll('item').map(String);
  const rows: Array<{
    studentId: string;
    indicatorId: string;
    grade: string | null;
    note: string | null;
  }> = [];
  for (const studentId of fd.getAll('studentId').map(String))
    for (const indicatorId of items) {
      const k = `${studentId}-${indicatorId}`;
      if (!fd.has(`l-${k}`) && !fd.has(`n-${k}`)) continue;
      rows.push({
        studentId,
        indicatorId,
        grade: str(fd, `l-${k}`) || null,
        note: str(fd, `n-${k}`) || null,
      });
    }
  await send(fd, 'indicators', 'PUT', { classSectionId: str(fd, 'classSectionId'), rows });
}

export async function saveWords(fd: FormData) {
  const studentId = str(fd, 'studentId');
  const rows = (['self', 'parent', 'teacher'] as const)
    .filter((k) => fd.has(k))
    .map((kind) => ({ studentId, kind, text: str(fd, kind) || null }));
  await send(fd, 'hpc-feedback', 'PUT', { classSectionId: str(fd, 'classSectionId'), rows });
}

export async function removePhoto(fd: FormData) {
  await send(fd, `portfolio/${str(fd, 'itemId')}`, 'DELETE');
}

export async function addPhoto(input: {
  examId: string;
  classSectionId: string;
  studentId: string;
  caption: string;
  indicatorId: string | null;
  contentType: 'image/png' | 'image/jpeg';
  base64: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await bff.api.fetch(`/exams/${input.examId}/portfolio`, {
      method: 'POST',
      body: JSON.stringify({
        classSectionId: input.classSectionId,
        studentId: input.studentId,
        caption: input.caption || undefined,
        indicatorId: input.indicatorId,
        image: { contentType: input.contentType, base64: input.base64 },
      }),
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof ApiError)
      return {
        ok: false,
        error:
          typeof error.problem.detail === 'string' && error.problem.detail
            ? error.problem.detail
            : error.problem.type,
      };
    throw error;
  }
}
