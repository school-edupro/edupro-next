'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** Uploads the files of a form through the file service; returns their ids. */
async function uploadFiles(fd: FormData, key = 'files'): Promise<string[]> {
  const fileIds: string[] = [];
  for (const entry of fd.getAll(key)) {
    if (!(entry instanceof File) || entry.size === 0) continue;
    const reg = await bff.api.fetch<{
      file: { id: string };
      upload: { url: string; method: string; headers?: Record<string, string> };
    }>('/platform/files', {
      method: 'POST',
      body: JSON.stringify({
        fileName: entry.name.slice(0, 200),
        contentType: entry.type,
        sizeBytes: entry.size,
        classification: 'internal',
      }),
    });
    const target = reg.upload.url.startsWith('http')
      ? reg.upload.url
      : `${process.env.API_BASE_URL ?? 'http://localhost:4000'}${reg.upload.url}`;
    const headers: Record<string, string> = { 'content-type': entry.type };
    for (const [k, v] of Object.entries(reg.upload.headers ?? {})) headers[k] = v;
    const put = await fetch(target, {
      method: reg.upload.method || 'PUT',
      headers,
      body: Buffer.from(await entry.arrayBuffer()),
    });
    if (!put.ok) throw new ApiError(put.status, { type: 'file.upload_failed' });
    fileIds.push(reg.file.id);
  }
  return fileIds;
}

/** Uploads attachments through the file service, then posts the daily work (S7-07). */
export async function postDailyWork(fd: FormData) {
  try {
    const fileIds = await uploadFiles(fd);
    await bff.api.fetch('/academics/daily-work', {
      method: 'POST',
      body: JSON.stringify({
        classSectionId: str(fd, 'classSectionId'),
        subjectId: str(fd, 'subjectId') || undefined,
        kind: str(fd, 'kind') || 'homework',
        title: str(fd, 'title'),
        body: str(fd, 'body'),
        dueOn: str(fd, 'dueOn') || undefined,
        publishAt: str(fd, 'publishAt') || undefined,
        ackRequired: fd.get('ackRequired') !== null,
        fileIds,
      }),
    });
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `/daily-work?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 120))}`,
      );
    }
    throw error;
  }
  redirect('/daily-work?ok=1');
}

/** The day's sheet: every filled box of every subject, for the ticked classes, in one save. */
export async function saveSheet(fd: FormData) {
  const view = str(fd, 'view') || 'sheet';
  const sections = fd.getAll('sections').map(String).filter(Boolean);
  const here = `/daily-work?view=${view}&date=${str(fd, 'date')}${sections.map((s) => `&s=${s}`).join('')}`;
  let done: { created: number; updated: number };
  try {
    const rows = [];
    for (const subjectId of fd.getAll('subject').map(String)) {
      const row = {
        subjectId,
        homework: str(fd, `hw:${subjectId}`),
        classwork: str(fd, `cw:${subjectId}`),
        assignment: str(fd, `as:${subjectId}`),
        dueOn: str(fd, `due:${subjectId}`) || undefined,
        homeworkFileIds: await uploadFiles(fd, `hwf:${subjectId}`),
        classworkFileIds: await uploadFiles(fd, `cwf:${subjectId}`),
        assignmentFileIds: await uploadFiles(fd, `asf:${subjectId}`),
      };
      rows.push(row);
    }
    done = await bff.api.fetch<{ created: number; updated: number }>(
      '/academics/daily-work/sheet',
      {
        method: 'POST',
        body: JSON.stringify({
          date: str(fd, 'date'),
          classSectionIds: sections,
          mode: str(fd, 'mode') || 'daily',
          publishAt: str(fd, 'publishAt') || undefined,
          ackRequired: fd.get('ackRequired') !== null,
          rows,
        }),
      },
    );
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `${here}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
      );
    }
    throw error;
  }
  redirect(`${here}&ok=${String(done.created)}-${String(done.updated)}`);
}

const back = (path: string, error: unknown): never => {
  if (error instanceof ApiError) {
    const errs = error.problem.errors as Array<{ message?: string }> | undefined;
    const detail =
      (Array.isArray(errs)
        ? errs
            .map((e) => e.message)
            .filter(Boolean)
            .join('; ')
        : '') || (typeof error.problem.detail === 'string' ? error.problem.detail : '');
    redirect(
      `${path}?error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 200))}`,
    );
  }
  throw error;
};

/** A session plan, the curriculum or a date sheet for the classes the teacher holds. */
export async function postDocument(fd: FormData) {
  try {
    const fileIds = await uploadFiles(fd);
    await bff.api.fetch('/academics/documents', {
      method: 'POST',
      body: JSON.stringify({
        kind: str(fd, 'kind'),
        title: str(fd, 'title'),
        remark: str(fd, 'remark') || undefined,
        classSectionIds: fd.getAll('classSectionIds').map(String).filter(Boolean),
        subjectId: str(fd, 'subjectId') || undefined,
        fileIds,
        publishAt: str(fd, 'publishAt') || undefined,
        ackRequired: fd.get('ackRequired') !== null,
      }),
    });
  } catch (error) {
    back('/documents', error);
  }
  redirect('/documents?ok=1');
}

export async function removeDocument(fd: FormData) {
  try {
    await bff.api.fetch(`/academics/documents/${str(fd, 'id')}`, { method: 'DELETE' });
  } catch (error) {
    back('/documents', error);
  }
  redirect('/documents?ok=removed');
}

/** An employee acknowledges an office order. */
export async function ackOrder(fd: FormData) {
  try {
    await bff.api.fetch('/academics/acks', {
      method: 'POST',
      body: JSON.stringify({ type: 'notice', id: str(fd, 'id') }),
    });
  } catch (error) {
    back('/office-orders', error);
  }
  redirect('/office-orders?ok=1');
}
