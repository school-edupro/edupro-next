'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/** Uploads attachments through the file service, then posts the daily work (S7-07). */
export async function postDailyWork(fd: FormData) {
  try {
    const fileIds: string[] = [];
    for (const entry of fd.getAll('files')) {
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
    await bff.api.fetch('/academics/daily-work', {
      method: 'POST',
      body: JSON.stringify({
        classSectionId: str(fd, 'classSectionId'),
        subjectId: str(fd, 'subjectId') || undefined,
        kind: str(fd, 'kind') || 'homework',
        title: str(fd, 'title'),
        body: str(fd, 'body'),
        dueOn: str(fd, 'dueOn') || undefined,
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
