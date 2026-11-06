import type { ExamProgress } from '@/lib/types';

export type NextKey =
  'setup' | 'entry' | 'indicators' | 'verification' | 'compute' | 'release' | 'released';

/** What to do next with an exam, and where (docs/design/66). */
export function nextStep(
  examId: string,
  p: ExamProgress,
): { key: NextKey; href: string; n: number } {
  const m = p.totals.marks;
  switch (p.stage) {
    case 'setup':
      return { key: 'setup', href: `/exams/${examId}/setup?step=subjects`, n: 0 };
    case 'entry':
      // marks done (or none to enter): a progress card's indicators are what is left
      return m.entered < m.takers
        ? { key: 'entry', href: `/exams/${examId}/status?show=open`, n: m.takers - m.entered }
        : { key: 'indicators', href: `/exams/${examId}/indicators`, n: 0 };
    case 'verification':
      return {
        key: 'verification',
        href: `/exams/${examId}/status?show=submitted`,
        n: m.slots - m.verified,
      };
    case 'results':
      return p.classes.every((k) => k.computedAt || k.students === 0)
        ? { key: 'release', href: '/exams/report-cards', n: 0 }
        : // Work out results is on the exam's Overview (6 Nov 2026)
          { key: 'compute', href: `/exams/${examId}#results`, n: 0 };
    default:
      return { key: 'released', href: '/exams/report-cards', n: 0 };
  }
}
