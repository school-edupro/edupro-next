import type { ReportCardRelease } from './types';

/** A term release's readiness, class by class (docs/design/65; the workspace's Readiness and Cards). */
export interface ReleaseReadiness {
  release: ReportCardRelease;
  templates: Array<{ id: string; name: string; band: string }>;
  classes: Array<{
    classId: string;
    code: string;
    name: string;
    band: string;
    template: { id: string; name: string; from: 'class' | 'band' | 'default' } | null;
    termResult: {
      schemeId: string;
      name: string;
      computedAt: string | null;
      results: number;
    } | null;
    sections: Array<{
      id: string;
      code: string;
      students: number;
      made: number;
      withheld: number;
      held: number;
      unverified: number;
      remarksMissing: number;
      attendanceMissing: number;
    }>;
    exams: Array<{
      examId: string;
      code: string;
      name: string;
      unverified: number;
      papers: number;
      remarksMissing: number | null;
      attendanceMissing: number | null;
    }>;
  }>;
}

/** the badge tone of each status (the labels are messages rcRelease.status_*) */
export const RELEASE_TONE: Record<
  ReportCardRelease['status'],
  'neutral' | 'warning' | 'success' | 'danger'
> = {
  draft: 'neutral',
  submitted: 'warning',
  released: 'success',
  withdrawn: 'danger',
};

/** where each status sits on Draft → With the principal → Published */
export const STEP_OF: Record<ReportCardRelease['status'], number> = {
  draft: 0,
  submitted: 1,
  released: 2,
  withdrawn: 2,
};
export const STEPS = ['step_draft', 'step_principal', 'step_published'] as const;

/** what a class still needs before its cards go out */
export function issuesOf(k: ReleaseReadiness['classes'][number]) {
  const sum = (key: 'unverified' | 'remarksMissing' | 'attendanceMissing') =>
    k.sections.reduce((a, s) => a + s[key], 0);
  return {
    unverified: sum('unverified'),
    remarks: sum('remarksMissing'),
    attendance: sum('attendanceMissing'),
    noTemplate: !k.template,
    noTermResult: !k.termResult || !k.termResult.computedAt,
  };
}
