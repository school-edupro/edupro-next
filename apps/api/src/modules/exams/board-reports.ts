import {
  entriesBySubject,
  GRADES,
  round2,
  subjectStats,
  yearLabel,
  type AnCandidate,
  type AnSubject,
  type BoardRules,
} from './board-analysis';

/**
 * The Reports tab's ready-made reports (docs/design/88). The first, as the school's old "Range Wise Subject
 * Summary": for each subject, a block of 21 figures — students, appeared, absent, pass, fail, compartment,
 * distinction, the three divisions, the eight grades, the highest, lowest and average marks — for the chosen year
 * and the years compared, each a count and a share of those who appeared.
 */
export type Gender = 'all' | 'M' | 'F';

export interface RangeCell {
  count: number | null;
  /** a share of those who appeared, where the old report shows one */
  pct: number | null;
}

export interface RangeRow {
  key: string;
  label: string;
  /** examYear → the cell */
  values: Record<string, RangeCell>;
}

export interface RangeBlock {
  code: string;
  name: string;
  rows: RangeRow[];
}

export interface RangeSummary {
  years: number[];
  blocks: RangeBlock[];
}

/** Divisions as the old report counts them: exclusive, so they add up to those who appeared. */
export const FIRST_DIVISION = 60;
export const SECOND_DIVISION = 45;

/** The grade rows' labels: with their mark ranges when the grades are counted from the marks. */
const gradeLabel = (g: (typeof GRADES)[number], rules: BoardRules) => {
  if (rules.grades === 'printed') return `${g === 'E' ? 'E1' : g} grade (as printed)`;
  const ranges: Record<string, string> = {
    A1: '91-100%',
    A2: '81-90%',
    B1: '71-80%',
    B2: '61-70%',
    C1: '51-60%',
    C2: '41-50%',
    D: `${String(rules.passMarks)}-40%`,
    E: `0-${String(rules.passMarks - 1)}%`,
  };
  return `${g === 'E' ? 'E1' : g} grade (${ranges[g]!})`;
};

export function rangeSubjectSummary(
  years: Array<{ examYear: number; candidates: AnCandidate[] }>,
  subjects: AnSubject[],
  rules: BoardRules,
  opts: { gender: Gender; code?: string | undefined },
): RangeSummary {
  const ordered = [...years].sort((a, b) => a.examYear - b.examYear);
  const kind = new Map(subjects.map((s) => [s.code, s.kind]));
  const nameOf = (code: string) => subjects.find((s) => s.code === code)?.name ?? `Subject ${code}`;
  // each year's entries by subject, for the gender asked
  const byYear = ordered.map((y) => ({
    examYear: y.examYear,
    by: entriesBySubject(
      y.candidates.filter((c) => opts.gender === 'all' || c.sex === opts.gender),
    ),
  }));
  const codes = [...new Set(byYear.flatMap((y) => [...y.by.keys()]))]
    .filter((c) => kind.get(c) !== 'internal')
    .filter((c) => !opts.code || c === opts.code)
    .filter((c) => byYear.some((y) => (y.by.get(c) ?? []).some((e) => e.m.marks !== null)))
    .sort((a, b) => nameOf(a).localeCompare(nameOf(b)) || a.localeCompare(b));

  const blocks = codes.map((code) => {
    const stats = byYear.map((y) => {
      const es = y.by.get(code) ?? [];
      return { examYear: y.examYear, s: es.length ? subjectStats(es, rules) : null };
    });
    const row = (
      key: string,
      label: string,
      f: (s: NonNullable<(typeof stats)[number]['s']>) => number | null,
      share: boolean,
    ): RangeRow => ({
      key,
      label,
      values: Object.fromEntries(
        stats.map(({ examYear, s }) => {
          if (!s) return [String(examYear), { count: null, pct: null }];
          const count = f(s);
          return [
            String(examYear),
            {
              count,
              pct:
                share && count !== null && s.appeared > 0
                  ? round2((count * 100) / s.appeared)
                  : null,
            },
          ];
        }),
      ),
    });
    const marks = (s: NonNullable<(typeof stats)[number]['s']>) => s.app.map((e) => e.m.marks);
    const between = (s: NonNullable<(typeof stats)[number]['s']>, from: number, below: number) =>
      marks(s).filter((m) => m >= from && m < below).length;
    return {
      code,
      name: nameOf(code),
      rows: [
        row('total', 'Total no. of students', (s) => s.total, false),
        row('appeared', 'No. of students appeared', (s) => s.appeared, false),
        row('absent', 'No. of students absent', (s) => s.absent, false),
        row('pass', 'No. of students pass', (s) => s.pass, true),
        row('fail', 'No. of students fail', (s) => s.fail, true),
        row('comp', 'No. of students compartment', (s) => s.comp, true),
        row('distinction', 'Distinction', (s) => s.distinctions, true),
        row('first', '1st division', (s) => between(s, FIRST_DIVISION, rules.distinction), true),
        row('second', '2nd division', (s) => between(s, SECOND_DIVISION, FIRST_DIVISION), true),
        row('third', '3rd division', (s) => between(s, rules.passMarks, SECOND_DIVISION), true),
        ...GRADES.map((g) => row(`g${g}`, gradeLabel(g, rules), (s) => s.grades[g], true)),
        row('highest', 'Highest marks', (s) => s.highest, false),
        row('lowest', 'Lowest marks', (s) => s.lowest, false),
        row('average', 'Average marks', (s) => s.average, false),
      ],
    };
  });
  return { years: ordered.map((y) => y.examYear), blocks };
}

/** "2025-26" for a column heading. */
export const rangeYearLabel = (y: number) => yearLabel(y);
