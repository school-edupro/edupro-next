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
    /** published to the class's families, or revoked; null: never published */
    publish: {
      status: 'released' | 'withdrawn';
      releasedAt: string | null;
      withdrawnAt: string | null;
      reason: string | null;
      notified: number;
    } | null;
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

/** the legacy ranges of the Cards line: positions in roll order, taken in each section */
export const CARD_RANGES = ['first10', '11-20', '21-30', '31-40', 'above40', '1-2', 'all'] as const;
export const CARD_STATUSES = ['active', 'inactive', 'all'] as const;

/**
 * The lines of the Cards tab: one per card design (legacy "Class 6-8"), with the classes that print it in
 * their order; the classes without a design share a line of their own.
 */
export function cardLines(classes: ReleaseReadiness['classes']) {
  const lines: Array<{
    key: string;
    design: string | null;
    classes: ReleaseReadiness['classes'];
  }> = [];
  for (const k of classes) {
    const key = k.template?.id ?? 'none';
    const line = lines.find((x) => x.key === key);
    if (line) line.classes.push(k);
    else lines.push({ key, design: k.template?.name ?? null, classes: [k] });
  }
  return lines.map((x) => {
    const first = x.classes[0]!.code;
    const last = x.classes[x.classes.length - 1]!.code;
    return { ...x, label: first === last ? first : `${first}–${last}` };
  });
}
