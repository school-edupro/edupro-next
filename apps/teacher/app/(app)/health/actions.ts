'use server';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

const str = (fd: FormData, key: string): string => String(fd.get(key) ?? '').trim();

/**
 * The section's height and weight for the exam (docs/design/71): only the pupils whose values changed
 * are sent; an emptied value clears it. One record per pupil per exam.
 */
export async function saveHeightWeight(fd: FormData) {
  const examId = str(fd, 'examId');
  const classSectionId = str(fd, 'classSectionId');
  const back = `/health?exam=${examId}&section=${classSectionId}`;
  const num = (v: string) => (v === '' ? null : Number(v));
  const rows = fd
    .getAll('studentId')
    .map(String)
    .flatMap((id) => {
      const h = str(fd, `h-${id}`);
      const w = str(fd, `w-${id}`);
      const b = str(fd, `b-${id}`);
      const row: {
        studentId: string;
        heightCm?: number | null;
        weightKg?: number | null;
        bloodGroup?: string | null;
      } = {
        studentId: id,
      };
      if (h !== str(fd, `oh-${id}`) && Number(h) !== Number(str(fd, `oh-${id}`) || NaN))
        row.heightCm = num(h);
      if (w !== str(fd, `ow-${id}`) && Number(w) !== Number(str(fd, `ow-${id}`) || NaN))
        row.weightKg = num(w);
      if (b !== str(fd, `ob-${id}`)) row.bloodGroup = b || null;
      return Object.keys(row).length > 1 ? [row] : [];
    });
  if (!rows.length) redirect(`${back}&ok=1&detail=${encodeURIComponent('nothing changed')}`);
  let n = 0;
  try {
    const r = await bff.api.fetch<{ recorded: number }>(`/exams/${examId}/health`, {
      method: 'PUT',
      body: JSON.stringify({ classSectionId, rows }),
    });
    n = r.recorded;
  } catch (error) {
    if (error instanceof ApiError) {
      const detail = typeof error.problem.detail === 'string' ? error.problem.detail : '';
      redirect(
        `${back}&error=${encodeURIComponent(error.problem.type)}&detail=${encodeURIComponent(detail.slice(0, 120))}`,
      );
    }
    throw error;
  }
  redirect(`${back}&ok=1&detail=${encodeURIComponent(`${String(n)} saved`)}`);
}
