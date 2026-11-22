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

const PATHS = {
  indicators: 'indicators',
  remarks: 'remark-items',
  health: 'health',
  register: 'register',
} as const;
const PAGES = {
  indicators: '/indicators',
  remarks: '/remarks',
  health: '/health',
  register: '/exam-register',
} as const;

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

/**
 * A filled marks sheet of a section's subject (docs/design/96 part 17): checked first, saved with `apply`
 * when no row is in error. Bound on the Marks page to the exam, the section and the subject.
 */
export async function uploadMarksSheet(
  examId: string,
  classSectionId: string,
  subjectId: string,
  file: string,
  apply: boolean,
): Promise<SheetOut> {
  if (![examId, classSectionId, subjectId].every((x) => /^\d{1,18}$/.test(x)))
    return { ok: false, error: 'Choose the exam, section and subject' };
  try {
    const data = await bff.api.fetch<SheetPreview>(`/exams/${examId}/marks/upload`, {
      method: 'POST',
      body: JSON.stringify({ classSectionId, subjectId, file, apply }),
    });
    if (data.applied) revalidatePath('/marks');
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
