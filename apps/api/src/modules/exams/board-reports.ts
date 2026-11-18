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
import { marksRows, type MarksMethod } from './board-marks';

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

// ---- Range Wise Summary: the class's result (the school's old "Result Summary") ----

/** The aggregate ranges of the class's summary, highest first: [label, from, below]. */
export const OVERALL_RANGES: Array<[string, number, number]> = [
  ['90% – 100%', 90, Infinity],
  ['80% – 89.99%', 80, 90],
  ['70% – 79.99%', 70, 80],
  ['60% – 69.99%', 60, 70],
  ['50% – 59.99%', 50, 60],
  ['40% – 49.99%', 40, 50],
  ['33% – 39.99%', 33, 40],
  ['Below 33%', -Infinity, 33],
];

/**
 * Range Wise Summary: the class's students, appeared, absent, pass, fail and compartment (by the CBSE result),
 * distinction and the three divisions and the aggregate ranges (by each student's aggregate — the school's best five
 * or all subjects), the highest, lowest and average aggregate — a count and a share a year. One block, no heading.
 */
export function rangeOverall(
  years: Array<{ examYear: number; candidates: AnCandidate[] }>,
  subjects: AnSubject[],
  rules: BoardRules,
  opts: { gender: Gender; method: MarksMethod },
): RangeSummary {
  const ordered = [...years].sort((a, b) => a.examYear - b.examYear);
  const data = ordered.map((y) => {
    const cands = y.candidates.filter((c) => opts.gender === 'all' || c.sex === opts.gender);
    const rows = marksRows(cands, subjects, rules, opts.method);
    const appeared = rows.filter((r) => r.percent !== null);
    return { examYear: y.examYear, all: rows, appeared, pcts: appeared.map((r) => r.percent!) };
  });
  type Y = (typeof data)[number];
  const row = (
    key: string,
    label: string,
    count: (y: Y) => number | null,
    of: ((y: Y) => number) | null,
  ): RangeRow => ({
    key,
    label,
    values: Object.fromEntries(
      data.map((y) => {
        const n = count(y);
        const base = of ? of(y) : 0;
        return [
          String(y.examYear),
          { count: n, pct: of && n !== null && base > 0 ? round2((n * 100) / base) : null },
        ];
      }),
    ),
  });
  const ofAppeared = (y: Y) => y.appeared.length;
  const result = (y: Y, words: string[]) =>
    y.appeared.filter((r) => words.includes(r.result ?? '')).length;
  const between = (y: Y, from: number, below: number) =>
    y.pcts.filter((p) => p >= from && p < below).length;
  const mean = (xs: number[]) =>
    xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  return {
    years: ordered.map((y) => y.examYear),
    blocks: [
      {
        code: '',
        name: '',
        rows: [
          row('total', 'Total no. of students', (y) => y.all.length, null),
          row('appeared', 'No. of students appeared', (y) => y.appeared.length, null),
          row(
            'absent',
            'No. of students absent',
            (y) => y.all.length - y.appeared.length,
            (y) => y.all.length,
          ),
          row('pass', 'No. of students pass', (y) => result(y, ['PASS']), ofAppeared),
          row('fail', 'No. of students fail', (y) => result(y, ['FAIL', 'ER']), ofAppeared),
          row('comp', 'No. of students compartment', (y) => result(y, ['COMP']), ofAppeared),
          row(
            'distinction',
            'Distinction',
            (y) => between(y, rules.distinction, Infinity),
            ofAppeared,
          ),
          row(
            'first',
            '1st division',
            (y) => between(y, FIRST_DIVISION, rules.distinction),
            ofAppeared,
          ),
          row(
            'second',
            '2nd division',
            (y) => between(y, SECOND_DIVISION, FIRST_DIVISION),
            ofAppeared,
          ),
          row(
            'third',
            '3rd division',
            (y) => between(y, rules.passMarks, SECOND_DIVISION),
            ofAppeared,
          ),
          ...OVERALL_RANGES.map(([label, from, below], i) =>
            row(`r${String(i)}`, label, (y) => between(y, from, below), ofAppeared),
          ),
          row(
            'highest',
            'Highest aggregate (%)',
            (y) => (y.pcts.length ? Math.max(...y.pcts) : null),
            null,
          ),
          row(
            'lowest',
            'Lowest aggregate (%)',
            (y) => (y.pcts.length ? Math.min(...y.pcts) : null),
            null,
          ),
          row('average', 'Average aggregate (%)', (y) => mean(y.pcts), null),
        ],
      },
    ],
  };
}
