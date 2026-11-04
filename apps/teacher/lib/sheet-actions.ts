'use server';
import { revalidatePath } from 'next/cache';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';

export interface SheetPreview {
  columns?: string[];
  rows: Array<{ row: number; admissionNo: string; name: string | null; error: string | null }>;
  ready: number;
  errors: number;
  applied: boolean;
}
export type SheetOut = { ok: true; data: SheetPreview } | { ok: false; error: string };

const PATHS = { indicators: 'indicators', remarks: 'remark-items', health: 'health' } as const;
const PAGES = { indicators: '/indicators', remarks: '/remarks', health: '/health' } as const;

/**
 * A filled section sheet (docs/design/71): every row is checked first (`apply` false) and saved only
 * with `apply` and no row in error. Bound on the page to the kind, the exam and the section.
 */
export async function uploadSheet(
  kind: keyof typeof PATHS,
  examId: string,
  classSectionId: string,
  file: string,
  apply: boolean,
): Promise<SheetOut> {
  if (!(kind in PATHS) || !/^\d{1,18}$/.test(examId) || !/^\d{1,18}$/.test(classSectionId))
    return { ok: false, error: 'Choose the exam and section' };
  try {
    const data = await bff.api.fetch<SheetPreview>(`/exams/${examId}/${PATHS[kind]}/upload`, {
      method: 'POST',
      body: JSON.stringify({ classSectionId, file, apply }),
    });
    if (data.applied) revalidatePath(PAGES[kind]);
    return { ok: true, data };
  } catch (e) {
    if (e instanceof ApiError)
      return {
        ok: false,
        error: typeof e.problem.detail === 'string' ? e.problem.detail : e.problem.type,
      };
    throw e;
  }
}
