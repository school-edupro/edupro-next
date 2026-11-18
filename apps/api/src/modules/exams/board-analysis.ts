import type { BoardSubjectKind } from './board-subjects';

/**
 * CBSE board result analysis (docs/design/88, phase C): the school's ten annexures computed from one saved result
 * file — its candidates, their marks and the details EduPro keeps (section, sex, EWS, category …). Pure: the service
 * loads, this counts. Every annexure is a list of plain tables (columns + rows), so the screen, the Excel workbook and
 * the PDF print the same figures.
 */

/** How the best five are chosen: the best language and the best four others (default), English and the best four, any five. */
export type BestFiveRule = 'language-plus-four' | 'english-plus-four' | 'any-five';

export interface BoardRules {
  bestFive: BestFiveRule;
  /** Marks from which a subject counts as a distinction. */
  distinction: number;
  /** Marks below which a subject counts as a failure. */
  passMarks: number;
  /**
   * Grades counted from the marks (A1 91–100, A2 81–90 … D 33–40, E below 33 — the school's workbook) or as CBSE
   * printed them (D1 and D2 counted as D).
   */
  grades: 'marks' | 'printed';
}

export const DEFAULT_BOARD_RULES: BoardRules = {
  bestFive: 'language-plus-four',
  distinction: 75,
  passMarks: 33,
  grades: 'marks',
};

export interface AnMark {
  code: string;
  marks: number | null;
  grade: string | null;
}

export interface AnCandidate {
  roll: string;
  name: string | null;
  sex: string | null;
  result: string | null;
  compartment: string[];
  section: string | null;
  stream: string | null;
  category: string | null;
  ews: boolean | null;
  cwsn: boolean | null;
  boarder: boolean | null;
  staffWard: boolean | null;
  marks: AnMark[];
  /** The office lists' columns (phase D): the student it is, and a contact. */
  admissionNo?: string | null;
  contact?: string | null;
  /** the linked student (the Results tab links the name) */
  studentId?: string | null;
}

export interface AnSubject {
  code: string;
  name: string;
  kind: BoardSubjectKind;
}

/** One earlier year's headline figures (from its saved file, or typed in — phase E). */
export interface AnYear {
  examYear: number;
  appeared: number;
  pct90: number | null;
  pct75: number | null;
  aggregate: number | null;
  /** The trend's columns (phase D) — none for a year typed in without its file. */
  passPct?: number | null;
  pi?: number | null;
  subjects?: Record<string, { pi: number | null; average: number | null }>;
}

export interface AnInput {
  classLabel: 'X' | 'XII';
  examYear: number;
  rules: BoardRules;
  candidates: AnCandidate[];
  /** The school's CBSE subject list in its order (languages first). */
  subjects: AnSubject[];
  /** The teacher of a section's subject for one candidate (a section may be split by roll number). */
  teacher: (section: string, code: string, roll: string) => string | null;
  /** Earlier years, any order; the five latest are shown. */
  history: AnYear[];
  /** The year before's figures per subject code (Annexure 5), when that year is saved. */
  lastYear: Map<string, SubjectFigures> | null;
}

export type Cell = string | number | null;

export interface AnColumn {
  key: string;
  label: string;
  /** A heading over this and the next columns of the same group ("Failures" over No. and %). */
  group?: string;
  num?: boolean;
  /** Share of the width in the PDF (default 1, text 2). */
  width?: number;
}

export interface AnTable {
  key: string;
  title: string;
  columns: AnColumn[];
  rows: Array<Record<string, Cell>>;
  /** Rows (by position) in bold: the all-sections line. */
  strong?: number[];
  /** Printed in the workbook as one block a row (label, value) — the school's Annexure 4. */
  blocks?: boolean;
  note?: string;
}

export interface Annexure {
  no: number;
  title: string;
  tables: AnTable[];
}

export interface Headline {
  registered: number;
  appeared: number;
  absent: number;
  failures: number;
  compartments: number;
  passed: number;
  passPct: number | null;
  aggregate: number | null;
  n90: number;
  n75: number;
  pct90: number | null;
  pct75: number | null;
  highest: number | null;
  lowest: number | null;
}

export interface SubjectFigures {
  code: string;
  appeared: number;
  highest: number | null;
  aGrades: number;
  compartments: number;
  failures: number;
  distinctions: number;
  average: number | null;
  pi: number | null;
}

export interface BoardAnalysis {
  classLabel: 'X' | 'XII';
  examYear: number;
  rules: BoardRules;
  headline: Headline;
  annexures: Annexure[];
}

// ---- small helpers ----

export const round2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100;
const pct = (n: number, of: number): number | null => (of > 0 ? round2((n * 100) / of) : null);
const mean = (xs: number[]): number | null =>
  xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);
const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
const isBoy = (c: AnCandidate) => c.sex === 'M';
const isGirl = (c: AnCandidate) => c.sex === 'F';
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const n = (key: string, label: string, group?: string): AnColumn => ({
  key,
  label,
  num: true,
  ...(group ? { group } : {}),
});
const t = (key: string, label: string, width = 2): AnColumn => ({ key, label, width });

/** The year as the school writes it: 2026 → "2025-26". */
export const yearLabel = (y: number) => `${y - 1}-${String(y).slice(2)}`;

/** Marked subjects only (absent and graded-only subjects have no marks). */
const marked = (c: AnCandidate) =>
  c.marks.filter((m): m is AnMark & { marks: number } => m.marks !== null);

export const appeared = (c: AnCandidate) => c.marks.some((m) => m.marks !== null);

const FAIL_WORDS = new Set(['FAIL', 'ER']);

/**
 * The best five of a candidate under the rule: the subjects and their total. Fewer than five marked subjects
 * count what there is (the share is still of 500).
 */
export function bestFive(
  c: AnCandidate,
  kindOf: (code: string) => BoardSubjectKind | undefined,
  rule: BestFiveRule,
  nameOf: (code: string) => string = () => '',
): { total: number; percent: number; codes: string[] } {
  const ms = marked(c).filter((m) => kindOf(m.code) !== 'internal');
  const byMarks = (a: { marks: number }, b: { marks: number }) => b.marks - a.marks;
  let pick: Array<{ code: string; marks: number }>;
  const anchor =
    rule === 'any-five'
      ? undefined
      : rule === 'english-plus-four'
        ? ms.find((m) => /english/i.test(nameOf(m.code)) || m.code === '184' || m.code === '301')
        : [...ms].filter((m) => kindOf(m.code) === 'language').sort(byMarks)[0];
  if (anchor)
    pick = [
      anchor,
      ...ms
        .filter((m) => m !== anchor)
        .sort(byMarks)
        .slice(0, 4),
    ];
  else pick = [...ms].sort(byMarks).slice(0, 5);
  const total = sum(pick.map((m) => m.marks));
  return { total, percent: round2(total / 5), codes: pick.map((m) => m.code) };
}

/** A candidate's place in a subject: a compartment in it, a failure (below the pass marks), or a pass. */
const outcome = (c: AnCandidate, code: string, marks: number, rules: BoardRules) =>
  c.compartment.includes(code) ? 'comp' : marks < rules.passMarks ? 'fail' : 'pass';

// ---- the overall row (Annexures 2 and 3) ----

const OVERALL_BANDS: Array<[string, number]> = [
  ['>=90%', 90],
  ['75-89.9%', 75],
  ['60-74.9%', 60],
  ['45-59.9%', 45],
  ['<45%', -1],
];

interface Scored {
  c: AnCandidate;
  total: number;
  percent: number;
}

function overallColumns(first: AnColumn): AnColumn[] {
  return [
    first,
    n('enrolled', 'Enrolled'),
    n('absent', 'Absent'),
    n('appeared', 'Appeared'),
    n('failNo', 'No.', 'Failures'),
    n('failPct', '%', 'Failures'),
    n('compNo', 'No.', 'Compartments'),
    n('compPct', '%', 'Compartments'),
    n('passNo', 'No.', 'Passed'),
    n('passPct', '%', 'Passed'),
    n('boysNo', 'No.', 'Boys passed'),
    n('boysPct', '%', 'Boys passed'),
    n('girlsNo', 'No.', 'Girls passed'),
    n('girlsPct', '%', 'Girls passed'),
    n('avg', 'Overall', 'Average aggregate %'),
    n('avgBoys', 'Boys', 'Average aggregate %'),
    n('avgGirls', 'Girls', 'Average aggregate %'),
    n('highest', 'Highest %'),
    n('lowest', 'Lowest %'),
    ...OVERALL_BANDS.flatMap(([label], i) => [
      n(`b${i}No`, 'No.', label),
      n(`b${i}Pct`, '%', label),
    ]),
  ];
}

function overallRow(cands: AnCandidate[], score: Map<AnCandidate, Scored>): Record<string, Cell> {
  const app = cands.filter(appeared);
  const s = app.map((c) => score.get(c)!);
  const fail = app.filter((c) => FAIL_WORDS.has(c.result ?? '')).length;
  const comp = app.filter((c) => c.result === 'COMP').length;
  const pass = app.filter((c) => c.result === 'PASS');
  const boys = app.filter(isBoy);
  const girls = app.filter(isGirl);
  const row: Record<string, Cell> = {
    enrolled: cands.length,
    absent: cands.length - app.length,
    appeared: app.length,
    failNo: fail,
    failPct: pct(fail, app.length),
    compNo: comp,
    compPct: pct(comp, app.length),
    passNo: pass.length,
    passPct: pct(pass.length, app.length),
    boysNo: pass.filter(isBoy).length,
    boysPct: pct(pass.filter(isBoy).length, boys.length),
    girlsNo: pass.filter(isGirl).length,
    girlsPct: pct(pass.filter(isGirl).length, girls.length),
    avg: mean(s.map((x) => x.percent)),
    avgBoys: mean(boys.map((c) => score.get(c)!.percent)),
    avgGirls: mean(girls.map((c) => score.get(c)!.percent)),
    highest: max(s.map((x) => x.percent)),
    lowest: min(s.map((x) => x.percent)),
  };
  OVERALL_BANDS.forEach(([, from], i) => {
    const upTo = i === 0 ? Infinity : OVERALL_BANDS[i - 1]![1];
    const k = s.filter((x) => x.percent >= from && x.percent < upTo).length;
    row[`b${i}No`] = k;
    row[`b${i}Pct`] = pct(k, app.length);
  });
  return row;
}

// ---- subjects ----

/** Integer mark bands, highest first: [label, from, to]. */
type Band = [string, number, number];
const SUBJECT_BANDS: Band[] = [
  ['91-100', 91, 100],
  ['81-90', 81, 90],
  ['71-80', 71, 80],
  ['61-70', 61, 70],
  ['51-60', 51, 60],
  ['41-50', 41, 50],
  ['33-40', 33, 40],
];
const SECTION_BANDS: Band[] = [
  ['>=90%', 90, 100],
  ['80-89%', 80, 89],
  ['70-79%', 70, 79],
  ['60-69%', 60, 69],
  ['50-59%', 50, 59],
  ['40-49%', 40, 49],
  ['30-39%', 30, 39],
  ['<30%', 0, 29],
];
const ACR_BANDS: Band[] = [
  ['0-20', 0, 20],
  ['21-32', 21, 32],
  ['33-40', 33, 40],
  ['41-50', 41, 50],
  ['51-60', 51, 60],
  ['61-70', 61, 70],
  ['71-80', 71, 80],
  ['81-90', 81, 90],
  ['91-100', 91, 100],
];
/** Marks can carry a half from grace; a band takes its whole number. */
const inBand = (m: number, b: Band) => Math.floor(m) >= b[1] && Math.floor(m) <= b[2];

const GRADES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'E'] as const;
type Grade = (typeof GRADES)[number];
/** The grade of a mark on the school's scale: A1 91–100, A2 81–90 … C2 41–50, D from the pass marks, E below. */
function gradeOf(m: AnMark & { marks: number }, rules: BoardRules): Grade | null {
  if (rules.grades === 'printed') {
    const g = (m.grade ?? '').toUpperCase();
    if (/^D\d?$/.test(g)) return 'D';
    if (/^E\d?$/.test(g)) return 'E';
    return (GRADES as readonly string[]).includes(g) ? (g as Grade) : null;
  }
  const x = Math.floor(m.marks);
  if (x >= 91) return 'A1';
  if (x >= 81) return 'A2';
  if (x >= 71) return 'B1';
  if (x >= 61) return 'B2';
  if (x >= 51) return 'C1';
  if (x >= 41) return 'C2';
  return x >= rules.passMarks ? 'D' : 'E';
}

interface Entry {
  c: AnCandidate;
  m: AnMark;
}

/** The figures of one subject over some candidates. */
function subjectStats(entries: Entry[], rules: BoardRules) {
  const app = entries.filter((e) => e.m.marks !== null) as Array<{
    c: AnCandidate;
    m: AnMark & { marks: number };
  }>;
  const marks = app.map((e) => e.m.marks);
  const out = app.map((e) => outcome(e.c, e.m.code, e.m.marks, rules));
  const grade = (g: Grade) => app.filter((e) => gradeOf(e.m, rules) === g).length;
  const boys = app.filter((e) => isBoy(e.c));
  const girls = app.filter((e) => isGirl(e.c));
  const passOf = (xs: typeof app) =>
    xs.filter((e) => outcome(e.c, e.m.code, e.m.marks, rules) === 'pass').length;
  return {
    total: entries.length,
    app,
    appeared: app.length,
    absent: entries.length - app.length,
    boys,
    girls,
    fail: out.filter((o) => o === 'fail').length,
    comp: out.filter((o) => o === 'comp').length,
    pass: out.filter((o) => o === 'pass').length,
    boysPass: passOf(boys),
    girlsPass: passOf(girls),
    highest: max(marks),
    lowest: min(marks),
    average: mean(marks),
    totalMarks: sum(marks),
    hundreds: marks.filter((m) => m >= 100).length,
    distinctions: marks.filter((m) => m >= rules.distinction).length,
    grades: Object.fromEntries(GRADES.map((g) => [g, grade(g)])) as Record<Grade, number>,
    aGrades: grade('A1') + grade('A2'),
    band: (b: Band, of = app) => of.filter((e) => inBand(e.m.marks, b)).length,
  };
}

/** Figures per subject a later year compares with (Annexure 5). */
export function subjectFigures(
  candidates: AnCandidate[],
  rules: BoardRules,
): Map<string, SubjectFigures> {
  const by = entriesBySubject(candidates);
  return new Map(
    [...by].map(([code, es]) => {
      const s = subjectStats(es, rules);
      return [
        code,
        {
          code,
          appeared: s.appeared,
          highest: s.highest,
          aGrades: s.aGrades,
          compartments: s.comp,
          failures: s.fail,
          distinctions: s.distinctions,
          average: s.average,
          pi: piOf(es),
        },
      ];
    }),
  );
}

// ---- the Performance Index (phase D) ----

const PI_WEIGHT: Record<string, number> = {
  A1: 8,
  A2: 7,
  B1: 6,
  B2: 5,
  C1: 4,
  C2: 3,
  D1: 2,
  D2: 1,
  D: 2,
  E: 0,
  E1: 0,
  E2: 0,
};
/** A grade's weight: CBSE's printed grade, else one from the marks (A1 91+ … D 33+, E below). */
function piWeight(m: AnMark & { marks: number }): number {
  const w = PI_WEIGHT[(m.grade ?? '').toUpperCase()];
  if (w !== undefined) return w;
  const x = Math.floor(m.marks);
  return x >= 91
    ? 8
    : x >= 81
      ? 7
      : x >= 71
        ? 6
        : x >= 61
          ? 5
          : x >= 51
            ? 4
            : x >= 41
              ? 3
              : x >= 33
                ? 2
                : 0;
}
/**
 * The Performance Index as Kendriya Vidyalayas count it: Σ(students at a grade × its weight, A1 8 … D2 1, E 0)
 * × 100 ÷ (students × 8), over those with marks.
 */
export function piOf(entries: Array<{ m: AnMark }>): number | null {
  const marked = entries.filter((e): e is { m: AnMark & { marks: number } } => e.m.marks !== null);
  if (!marked.length) return null;
  return round2((sum(marked.map((e) => piWeight(e.m))) * 100) / (marked.length * 8));
}

/** One year's figures for the trend (phase D): the headline with pass % and PI, and each subject's PI and average. */
export function yearFigures(
  examYear: number,
  candidates: AnCandidate[],
  subjects: AnSubject[],
  rules: BoardRules,
): AnYear {
  const h = headlineOf(candidates, subjects, rules);
  const by = entriesBySubject(candidates);
  const kind = new Map(subjects.map((x) => [x.code, x.kind]));
  const all = [...by].filter(([code]) => kind.get(code) !== 'internal').flatMap(([, es]) => es);
  return {
    examYear,
    appeared: h.appeared,
    pct90: h.pct90,
    pct75: h.pct75,
    aggregate: h.aggregate,
    passPct: h.passPct,
    pi: piOf(all),
    subjects: Object.fromEntries(
      [...by]
        .filter(([code]) => kind.get(code) !== 'internal')
        .map(([code, es]) => [
          code,
          {
            pi: piOf(es),
            average: mean(es.filter((e) => e.m.marks !== null).map((e) => e.m.marks!)),
          },
        ]),
    ),
  };
}

/** Each subject's entries — of the candidates who sat the examination (one absent throughout is in no subject). */
function entriesBySubject(candidates: AnCandidate[]) {
  const by = new Map<string, Entry[]>();
  for (const c of candidates.filter(appeared))
    for (const m of c.marks) {
      const l = by.get(m.code) ?? [];
      l.push({ c, m });
      by.set(m.code, l);
    }
  return by;
}

/** One year's headline (and the figures an earlier year shows in Annexure 1). */
export function headlineOf(
  candidates: AnCandidate[],
  subjects: AnSubject[],
  rules: BoardRules,
): Headline {
  const kind = new Map(subjects.map((s) => [s.code, s.kind]));
  const name = new Map(subjects.map((s) => [s.code, s.name]));
  const app = candidates.filter(appeared);
  const s = app.map(
    (c) =>
      bestFive(
        c,
        (k) => kind.get(k),
        rules.bestFive,
        (k) => name.get(k) ?? '',
      ).percent,
  );
  const n90 = s.filter((p) => p >= 90).length;
  const n75 = s.filter((p) => p >= 75).length;
  const passed = app.filter((c) => c.result === 'PASS').length;
  return {
    registered: candidates.length,
    appeared: app.length,
    absent: candidates.length - app.length,
    failures: app.filter((c) => FAIL_WORDS.has(c.result ?? '')).length,
    compartments: app.filter((c) => c.result === 'COMP').length,
    passed,
    passPct: pct(passed, app.length),
    aggregate: mean(s),
    n90,
    n75,
    pct90: pct(n90, app.length),
    pct75: pct(n75, app.length),
    highest: max(s),
    lowest: min(s),
  };
}

const GROUPS: Array<[string, (c: AnCandidate) => boolean]> = [
  ['EWS', (c) => c.ews === true],
  ['Non-EWS', (c) => c.ews !== true],
  ['Boarders', (c) => c.boarder === true],
  ['Day scholars', (c) => c.boarder !== true],
  ['Staff wards', (c) => c.staffWard === true],
  ['SC', (c) => categoryOf(c) === 'SC'],
  ['ST', (c) => categoryOf(c) === 'ST'],
  ['OBC', (c) => categoryOf(c) === 'OBC'],
  ['General', (c) => categoryOf(c) === 'GEN'],
  ['CWSN', (c) => c.cwsn === true],
];

/** SC, ST, OBC or GEN (anything else, blank included, is general). */
export function categoryOf(c: AnCandidate): 'SC' | 'ST' | 'OBC' | 'GEN' {
  const w = (c.category ?? '').toUpperCase().replace(/[^A-Z]/g, '');
  if (w.startsWith('OBC')) return 'OBC';
  if (w.startsWith('SC')) return 'SC';
  if (w.startsWith('ST')) return 'ST';
  return 'GEN';
}

/** Everything the screen, the workbook and the PDF show for one class and year. */
export function analyse(input: AnInput): BoardAnalysis {
  const { rules } = input;
  const kind = new Map(input.subjects.map((s) => [s.code, s.kind]));
  const nameOf = (code: string) =>
    input.subjects.find((s) => s.code === code)?.name ?? `Subject ${code}`;
  const order = new Map(input.subjects.map((s, i) => [s.code, i]));
  const all = input.candidates;
  const app = all.filter(appeared);
  const score = new Map<AnCandidate, Scored>(
    app.map((c) => {
      const b = bestFive(c, (k) => kind.get(k), rules.bestFive, nameOf);
      return [c, { c, total: b.total, percent: b.percent }];
    }),
  );
  const ranked = [...score.values()].sort(
    (a, b) => b.total - a.total || a.c.roll.localeCompare(b.c.roll),
  );
  const head = headlineOf(all, input.subjects, rules);
  const bySubject = entriesBySubject(all);
  // subjects with marks, in the school's order (graded-only subjects — XII's internal ones — left out)
  const codes = [...bySubject.keys()]
    .filter((c) => kind.get(c) !== 'internal')
    .filter((c) => bySubject.get(c)!.some((e) => e.m.marks !== null))
    .sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));
  const stats = new Map(codes.map((c) => [c, subjectStats(bySubject.get(c)!, rules)]));
  const subjCell = (code: string) => ({ code, subject: nameOf(code) });
  const sectionOf = (c: AnCandidate) => c.section ?? '—';
  const teacherOf = (c: AnCandidate, code: string) =>
    input.teacher(sectionOf(c), code, c.roll) ?? '—';
  const yr = yearLabel(input.examYear);

  // Annexure 1 — school summary
  const years = [
    ...input.history
      .filter((h) => h.examYear < input.examYear)
      .sort((a, b) => a.examYear - b.examYear)
      .slice(-4),
    {
      examYear: input.examYear,
      appeared: head.appeared,
      pct90: head.pct90,
      pct75: head.pct75,
      aggregate: head.aggregate,
    },
  ];
  const yearCols = years.map((y) => n(`y${y.examYear}`, yearLabel(y.examYear)));
  const yearRow = (label: string, f: (y: AnYear) => Cell) =>
    Object.fromEntries([['label', label], ...years.map((y) => [`y${y.examYear}`, f(y)])]) as Record<
      string,
      Cell
    >;
  const topN = input.classLabel === 'XII' ? 20 : 10;
  const a1: Annexure = {
    no: 1,
    title: 'School summary',
    tables: [
      {
        key: 'years',
        title: 'Five years',
        columns: [t('label', 'Figure', 3), ...yearCols],
        rows: [
          yearRow('No. of children appeared', (y) => y.appeared),
          yearRow('90% & above (%)', (y) => y.pct90),
          yearRow('75% & above (%)', (y) => y.pct75),
          yearRow('School aggregate (%)', (y) => y.aggregate),
        ],
      },
      {
        key: 'summary',
        title: `Result ${yr}`,
        columns: [t('label', 'Figure', 3), n('value', yr)],
        rows: (
          [
            ['Total no. of students registered', head.registered],
            ['Total no. of students appeared', head.appeared],
            ['No. of students absent', head.absent],
            ['No. of failures', head.failures],
            ['No. of compartments', head.compartments],
            ['No. of students qualified', head.passed],
            ['No. of students scoring 90% and above', head.n90],
            ['No. of students scoring 75% and above', head.n75],
          ] as Array<[string, number]>
        ).map(([label, value]) => ({ label, value })),
      },
      {
        key: 'toppers',
        title: input.classLabel === 'XII' ? 'First twenty positions' : 'Top 10 scorers',
        columns: [
          n('rank', 'Position'),
          t('roll', 'Board roll no'),
          t('name', 'Name', 3),
          t('section', 'Section', 1),
          n('total', 'Total (best 5)'),
          n('pct', '%'),
        ],
        rows: ranked.slice(0, topN).map((s, i) => ({
          rank: i + 1,
          roll: s.c.roll,
          name: s.c.name,
          section: s.c.section,
          total: s.total,
          pct: s.percent,
        })),
      },
      {
        key: 'full',
        title: 'Full scores in the following subjects',
        columns: [t('subject', 'Subject'), t('roll', 'Board roll no'), t('name', 'Name', 3)],
        rows: codes.flatMap((code) =>
          stats
            .get(code)!
            .app.filter((e) => e.m.marks >= 100)
            .sort((a, b) => a.c.roll.localeCompare(b.c.roll))
            .map((e) => ({ subject: nameOf(code), roll: e.c.roll, name: e.c.name })),
        ),
      },
      {
        key: 'distinctions',
        title: 'Subject-wise distinctions and aggregate',
        columns: [
          t('subject', 'Subject', 3),
          n('appeared', 'Total no. of students'),
          n('dist', 'No. of distinctions'),
          n('distPct', 'Distinction (%)'),
          n('avg', 'Subject average (%)'),
        ],
        rows: codes.map((code) => {
          const s = stats.get(code)!;
          return {
            subject: nameOf(code),
            appeared: s.appeared,
            dist: s.distinctions,
            distPct: pct(s.distinctions, s.appeared),
            avg: s.average,
          };
        }),
      },
      {
        key: 'highest',
        title: 'Highest score subject-wise',
        columns: [t('subject', 'Subject', 2), n('highest', 'Highest'), t('who', 'Students', 6)],
        rows: codes.map((code) => {
          const s = stats.get(code)!;
          return {
            subject: nameOf(code),
            highest: s.highest,
            who: s.app
              .filter((e) => e.m.marks === s.highest)
              .sort((a, b) => a.c.roll.localeCompare(b.c.roll))
              .map((e) => `${e.c.name ?? e.c.roll} (${e.c.roll})`)
              .join(', '),
          };
        }),
      },
      {
        key: 'grades',
        title: 'Subject-wise board grade performance',
        columns: [
          t('subject', 'Subject', 3),
          n('appeared', 'Total no. of students'),
          n('a', 'A1+A2'),
          n('aPct', '%'),
        ],
        rows: codes.map((code) => {
          const s = stats.get(code)!;
          return {
            subject: nameOf(code),
            appeared: s.appeared,
            a: s.aGrades,
            aPct: pct(s.aGrades, s.appeared),
          };
        }),
      },
    ],
  };

  // Annexure 2 — overall result and the subject table
  const subjectCols: AnColumn[] = [
    n('sno', 'S.No'),
    t('subject', 'Subject', 3),
    n('appeared', 'Appeared'),
    n('boys', 'Boys appeared'),
    n('girls', 'Girls appeared'),
    n('failNo', 'No.', 'Failures'),
    n('failPct', '%', 'Failures'),
    n('compNo', 'No.', 'Compartments'),
    n('compPct', '%', 'Compartments'),
    n('passNo', 'No.', 'Passed'),
    n('passPct', '%', 'Passed'),
    n('boysNo', 'No.', 'Boys passed'),
    n('boysPct', '%', 'Boys passed'),
    n('girlsNo', 'No.', 'Girls passed'),
    n('girlsPct', '%', 'Girls passed'),
    n('avg', 'Overall', 'Average %'),
    n('avgBoys', 'Boys', 'Average %'),
    n('avgGirls', 'Girls', 'Average %'),
    n('hundreds', 'No. of 100'),
    ...SUBJECT_BANDS.flatMap(([label], i) => [
      n(`b${i}B`, 'Boys', label),
      n(`b${i}G`, 'Girls', label),
    ]),
  ];
  const a2: Annexure = {
    no: 2,
    title: 'Overall result',
    tables: [
      {
        key: 'overall',
        title: 'Overall result',
        columns: overallColumns(t('label', 'School')),
        rows: [{ label: 'School', ...overallRow(all, score) }],
        note: `The result analysis is based on the aggregate of ${RULE_WORDS[rules.bestFive]}. Passed: excluding failures and compartments.`,
      },
      {
        key: 'subjects',
        title: 'Subject-wise result',
        columns: subjectCols,
        rows: codes.map((code, i) => {
          const s = stats.get(code)!;
          const row: Record<string, Cell> = {
            sno: i + 1,
            subject: nameOf(code),
            appeared: s.appeared,
            boys: s.boys.length,
            girls: s.girls.length,
            failNo: s.fail,
            failPct: pct(s.fail, s.appeared),
            compNo: s.comp,
            compPct: pct(s.comp, s.appeared),
            passNo: s.pass,
            passPct: pct(s.pass, s.appeared),
            boysNo: s.boysPass,
            boysPct: pct(s.boysPass, s.boys.length),
            girlsNo: s.girlsPass,
            girlsPct: pct(s.girlsPass, s.girls.length),
            avg: s.average,
            avgBoys: mean(s.boys.map((e) => e.m.marks)),
            avgGirls: mean(s.girls.map((e) => e.m.marks)),
            hundreds: s.hundreds,
          };
          SUBJECT_BANDS.forEach((b, k) => {
            row[`b${k}B`] = s.band(b, s.boys);
            row[`b${k}G`] = s.band(b, s.girls);
          });
          return row;
        }),
      },
    ],
  };

  // Annexure 3 — the overall table by group
  const a3: Annexure = {
    no: 3,
    title: 'Result by category',
    tables: [
      {
        key: 'groups',
        title: 'Overall result by group',
        columns: overallColumns(t('label', 'Group')),
        rows: GROUPS.map(([label, f]) => ({ label, ...overallRow(all.filter(f), score) })),
        note: 'EWS, CWSN, category, boarders and staff wards from the students’ records (or the details sheet).',
      },
    ],
  };

  // Annexure 4 — subject-wise summary
  const a4: Annexure = {
    no: 4,
    title: 'Subject-wise summary',
    tables: [
      {
        key: 'summary',
        title: 'Subject-wise summary',
        blocks: true,
        columns: [
          t('subject', 'Subject code & name', 3),
          n('total', 'Total no. of students'),
          n('appeared', 'No. of students appeared'),
          n('absent', 'No. of students absent'),
          n('pass', 'No. of students pass'),
          n('fail', 'No. of students fail'),
          n('max', 'Maximum marks'),
          n('min', 'Minimum marks'),
          n('avg', 'Average marks'),
          n('sum', 'Total marks'),
          n('dist', 'Distinction'),
          ...GRADES.map((g) => n(`g${g}`, `Total no. of ${g}`)),
          n('graded', 'Total no. of division'),
        ],
        rows: codes.map((code) => {
          const s = stats.get(code)!;
          return {
            subject: `${code}-${nameOf(code)}`,
            total: s.total,
            appeared: s.appeared,
            absent: s.absent,
            pass: s.pass,
            fail: s.fail + s.comp,
            max: s.highest,
            min: s.lowest,
            avg: s.average,
            sum: s.totalMarks,
            dist: s.distinctions,
            ...Object.fromEntries(GRADES.map((g) => [`g${g}`, s.grades[g]])),
            graded: sum(GRADES.filter((g) => g !== 'E').map((g) => s.grades[g])),
          };
        }),
      },
    ],
  };

  // Annexure 5 — this year against last year
  const last = input.lastYear;
  const prev = String(input.examYear - 1);
  const now = String(input.examYear);
  const a5: Annexure = {
    no: 5,
    title: `${now} against ${prev}`,
    tables: [
      {
        key: 'compare',
        title: `Subject-wise ${now} against ${prev}`,
        columns: [
          t('subject', 'Subject', 3),
          n('appL', prev, 'Appeared'),
          n('appN', now, 'Appeared'),
          n('hiL', prev, 'Highest'),
          n('hiN', now, 'Highest'),
          n('aL', prev, 'A grades'),
          n('aN', now, 'A grades'),
          n('aDiff', '% diff'),
          n('compL', prev, 'Compartments'),
          n('compN', now, 'Compartments'),
          n('compLP', `${prev} %`, 'Compartments'),
          n('compNP', `${now} %`, 'Compartments'),
          n('failL', prev, 'Failures'),
          n('failN', now, 'Failures'),
          n('failLP', `${prev} %`, 'Failures'),
          n('failNP', `${now} %`, 'Failures'),
          n('distL', prev, 'Distinctions'),
          n('distN', now, 'Distinctions'),
          n('distDiff', '% diff'),
          n('avgL', prev, 'Average marks'),
          n('avgN', now, 'Average marks'),
          n('avgDiff', 'Diff'),
        ],
        rows: codes.map((code) => {
          const s = stats.get(code)!;
          const l = last?.get(code) ?? null;
          const share = (k: number, of: number) => (of > 0 ? (k * 100) / of : null);
          const diff = (a: number | null, b: number | null) =>
            a === null || b === null ? null : round2(b - a);
          return {
            subject: nameOf(code),
            appL: l?.appeared ?? null,
            appN: s.appeared,
            hiL: l?.highest ?? null,
            hiN: s.highest,
            aL: l?.aGrades ?? null,
            aN: s.aGrades,
            aDiff: l ? diff(share(l.aGrades, l.appeared), share(s.aGrades, s.appeared)) : null,
            compL: l?.compartments ?? null,
            compN: s.comp,
            compLP: l ? pct(l.compartments, l.appeared) : null,
            compNP: pct(s.comp, s.appeared),
            failL: l?.failures ?? null,
            failN: s.fail,
            failLP: l ? pct(l.failures, l.appeared) : null,
            failNP: pct(s.fail, s.appeared),
            distL: l?.distinctions ?? null,
            distN: s.distinctions,
            distDiff: l
              ? diff(share(l.distinctions, l.appeared), share(s.distinctions, s.appeared))
              : null,
            avgL: l?.average ?? null,
            avgN: s.average,
            avgDiff: l ? diff(l.average, s.average) : null,
          };
        }),
        note: last
          ? '% diff: the change in the share of students who appeared, in percentage points.'
          : `${prev} is not saved yet: upload its result file (or type its figures) to compare.`,
      },
    ],
  };

  // Annexure 6 and 9 — best five toppers and subject performance
  const perfRows = codes.map((code) => {
    const s = stats.get(code)!;
    return {
      subject: nameOf(code),
      appeared: s.appeared,
      avg: s.average,
      a: s.aGrades,
      aPct: pct(s.aGrades, s.appeared),
      highest: s.highest,
      hundreds: s.hundreds,
      dist: s.distinctions,
      distPct: pct(s.distinctions, s.appeared),
    };
  });
  const perfCols = (withAvg: boolean): AnColumn[] => [
    t('subject', 'Subject', 3),
    n('appeared', 'Appeared'),
    ...(withAvg ? [n('avg', 'Subject avg')] : []),
    n('a', 'A grades'),
    n('aPct', '(%)'),
    n('highest', 'Highest marks'),
    n('hundreds', 'No. of 100s'),
    n('dist', 'Total distinction'),
    n('distPct', '(%)'),
  ];
  const a6: Annexure = {
    no: 6,
    title: 'Best five toppers',
    tables: [
      {
        key: 'toppers',
        title: '5 subjects (best 5)',
        columns: [
          n('rank', 'Rank'),
          t('roll', 'Roll no'),
          t('name', 'Name', 3),
          t('section', 'Section', 1),
          n('total', 'Total marks'),
          n('pct', '%'),
        ],
        rows: ranked.slice(0, 10).map((s, i) => ({
          rank: i + 1,
          roll: s.c.roll,
          name: s.c.name,
          section: s.c.section,
          total: s.total,
          pct: s.percent,
        })),
      },
      { key: 'subjects', title: 'Subject performance', columns: perfCols(false), rows: perfRows },
    ],
  };

  // Annexures 7 and 8 — sections with their teachers
  const bandCols: AnColumn[] = [
    n('total', 'Total no.'),
    n('appeared', 'Appeared'),
    n('pass', 'Pass'),
    ...SECTION_BANDS.map(([label], i) => n(`b${i}`, label)),
    n('highest', 'Highest'),
    n('lowest', 'Lowest'),
    n('avg', 'Average'),
  ];
  const bandRow = (es: Entry[]): Record<string, Cell> => {
    const s = subjectStats(es, rules);
    const row: Record<string, Cell> = {
      total: s.total,
      appeared: s.appeared,
      pass: s.pass,
      highest: s.highest,
      lowest: s.lowest,
      avg: s.average,
    };
    SECTION_BANDS.forEach((b, i) => (row[`b${i}`] = s.band(b)));
    return row;
  };
  /** A subject's entries by section and teacher, sections in order. */
  const split = (es: Entry[]) => {
    const g = new Map<string, { section: string; teacher: string; es: Entry[] }>();
    for (const e of es) {
      const section = sectionOf(e.c);
      const teacher = teacherOf(e.c, e.m.code);
      const k = `${section}\u0000${teacher}`;
      const x = g.get(k) ?? { section, teacher, es: [] };
      x.es.push(e);
      g.set(k, x);
    }
    return [...g.values()].sort(
      (a, b) =>
        a.section.localeCompare(b.section, 'en', { numeric: true }) ||
        a.teacher.localeCompare(b.teacher),
    );
  };
  const sections = [...new Set(all.map(sectionOf))].sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true }),
  );
  const a7: Annexure = {
    no: 7,
    title: 'Section-wise analysis',
    tables: sections.map((sec) => ({
      key: `sec-${sec}`,
      title: `Section ${sec}`,
      columns: [
        t('code', 'Code', 1),
        t('subject', 'Subject', 3),
        t('teacher', 'Teacher', 3),
        ...bandCols,
      ],
      rows: codes.flatMap((code) =>
        split(bySubject.get(code)!.filter((e) => sectionOf(e.c) === sec)).map((g) => ({
          ...subjCell(code),
          teacher: g.teacher,
          ...bandRow(g.es),
        })),
      ),
    })),
  };
  const a8: Annexure = {
    no: 8,
    title: 'Subject-wise analysis',
    tables: codes.map((code) => {
      const groups = split(bySubject.get(code)!);
      return {
        key: `sub-${code}`,
        title: `${code} ${nameOf(code)}`,
        columns: [t('section', 'Section', 1), t('teacher', 'Teacher', 3), ...bandCols],
        rows: [
          ...groups.map((g) => ({ section: g.section, teacher: g.teacher, ...bandRow(g.es) })),
          { section: 'All', teacher: '', ...bandRow(bySubject.get(code)!) },
        ],
        strong: [groups.length],
      };
    }),
  };

  const a9: Annexure = {
    no: 9,
    title: 'Subject performance',
    tables: [
      {
        key: 'performance',
        title: 'Subject-wise analysis (performance-wise)',
        columns: perfCols(true),
        rows: perfRows,
      },
    ],
  };

  // Annexure 10 — ACR bands by subject and by teacher
  const acrCols: AnColumn[] = [
    ...ACR_BANDS.map(([label], i) => n(`b${i}`, label)),
    n('total', 'Total'),
  ];
  const acr = (es: Entry[]): Record<string, Cell> => {
    const s = subjectStats(es, rules);
    const row: Record<string, Cell> = { total: s.appeared };
    ACR_BANDS.forEach((b, i) => (row[`b${i}`] = s.band(b)));
    return row;
  };
  /** Each teacher's entries of a subject (over the sections they taught), teachers in name order. */
  function byTeacherGroups() {
    return codes
      .flatMap((code) => {
        const g = new Map<string, { sections: Set<string>; es: Entry[] }>();
        for (const e of bySubject.get(code)!) {
          const who = teacherOf(e.c, code);
          const x = g.get(who) ?? { sections: new Set<string>(), es: [] };
          x.sections.add(sectionOf(e.c));
          x.es.push(e);
          g.set(who, x);
        }
        return [...g].map(([teacher, x]) => ({
          teacher,
          code,
          sections: [...x.sections]
            .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
            .join(', '),
          es: x.es,
        }));
      })
      .sort((a, b) => a.teacher.localeCompare(b.teacher));
  }
  const byTeacher = byTeacherGroups().map((x) => ({
    teacher: x.teacher,
    ...subjCell(x.code),
    sections: x.sections,
    ...acr(x.es),
  }));
  const a10: Annexure = {
    no: 10,
    title: 'ACR report subject-wise',
    tables: [
      {
        key: 'subjects',
        title: `ACR report subject-wise for Class ${input.classLabel}`,
        columns: [t('code', 'Code', 1), t('subject', 'Subject', 3), ...acrCols],
        rows: codes.map((code) => ({ ...subjCell(code), ...acr(bySubject.get(code)!) })),
      },
      {
        key: 'teachers',
        title: 'By teacher',
        columns: [
          t('teacher', 'Teacher', 3),
          t('code', 'Code', 1),
          t('subject', 'Subject', 3),
          t('sections', 'Sections', 2),
          ...acrCols,
        ],
        rows: byTeacher,
      },
    ],
  };

  // ---- phase D: the extras ----

  // 11 — the Performance Index by subject, section and teacher
  const printed = (es: Entry[], g: string) =>
    es.filter(
      (e) => e.m.marks !== null && (e.m.grade ?? '').toUpperCase().replace(/^E\d$/, 'E') === g,
    ).length;
  const marksOf = (es: Entry[]) => es.filter((e) => e.m.marks !== null).map((e) => e.m.marks!);
  const allEntries = codes.flatMap((code) => bySubject.get(code)!);
  const a11: Annexure = {
    no: 11,
    title: 'Performance Index',
    tables: [
      {
        key: 'subjects',
        title: 'By subject',
        columns: [
          t('code', 'Code', 1),
          t('subject', 'Subject', 3),
          n('appeared', 'Appeared'),
          ...PRINTED_GRADES.map((g) => n(`g${g}`, g, 'Grades as printed')),
          n('pi', 'PI'),
        ],
        rows: [
          ...codes.map((code) => {
            const es = bySubject.get(code)!;
            return {
              ...subjCell(code),
              appeared: marksOf(es).length,
              ...Object.fromEntries(PRINTED_GRADES.map((g) => [`g${g}`, printed(es, g)])),
              pi: piOf(es),
            };
          }),
          {
            code: '',
            subject: 'All subjects',
            appeared: marksOf(allEntries).length,
            ...Object.fromEntries(PRINTED_GRADES.map((g) => [`g${g}`, printed(allEntries, g)])),
            pi: piOf(allEntries),
          },
        ],
        strong: [codes.length],
        note: 'PI = Σ(students at a grade × its weight: A1 8, A2 7 … D2 1, E 0) × 100 ÷ (students × 8), from the grades CBSE printed.',
      },
      {
        key: 'sections',
        title: 'By section',
        columns: [
          t('code', 'Code', 1),
          t('subject', 'Subject', 3),
          t('section', 'Section', 1),
          t('teacher', 'Teacher', 3),
          n('appeared', 'Appeared'),
          n('avg', 'Average'),
          n('pi', 'PI'),
        ],
        rows: codes.flatMap((code) =>
          split(bySubject.get(code)!).map((g) => ({
            ...subjCell(code),
            section: g.section,
            teacher: g.teacher,
            appeared: marksOf(g.es).length,
            avg: mean(marksOf(g.es)),
            pi: piOf(g.es),
          })),
        ),
      },
      {
        key: 'teachers',
        title: 'By teacher',
        columns: [
          t('teacher', 'Teacher', 3),
          t('code', 'Code', 1),
          t('subject', 'Subject', 3),
          t('sections', 'Sections', 2),
          n('appeared', 'Appeared'),
          n('avg', 'Average'),
          n('pi', 'PI'),
        ],
        rows: byTeacherGroups().map((x) => ({
          teacher: x.teacher,
          ...subjCell(x.code),
          sections: x.sections,
          appeared: marksOf(x.es).length,
          avg: mean(marksOf(x.es)),
          pi: piOf(x.es),
        })),
      },
    ],
  };

  // 12 — five years: the headline, and each subject's PI and average
  const nowYear = yearFigures(input.examYear, all, input.subjects, rules);
  const trend = [
    ...input.history
      .filter((h) => h.examYear < input.examYear)
      .sort((a, b) => a.examYear - b.examYear)
      .slice(-4),
    nowYear,
  ];
  const trendCols = trend.map((y) => n(`y${y.examYear}`, yearLabel(y.examYear)));
  const bySubjectYear = (
    f: (v: { pi: number | null; average: number | null }) => number | null,
  ): Array<Record<string, Cell>> =>
    codes.map(
      (code) =>
        Object.fromEntries([
          ['subject', nameOf(code)],
          ...trend.map((y) => {
            const v = y.subjects?.[code];
            return [`y${y.examYear}`, v ? f(v) : null];
          }),
        ]) as Record<string, Cell>,
    );
  const a12: Annexure = {
    no: 12,
    title: 'Five-year trend',
    tables: [
      {
        key: 'years',
        title: 'The school',
        columns: [
          t('year', 'Year', 1),
          n('appeared', 'Appeared'),
          n('passPct', 'Pass %'),
          n('aggregate', 'Aggregate %'),
          n('pct90', '90% and above (%)'),
          n('pct75', '75% and above (%)'),
          n('pi', 'PI'),
        ],
        rows: trend.map((y) => ({
          year: yearLabel(y.examYear),
          appeared: y.appeared,
          passPct: y.passPct ?? null,
          aggregate: y.aggregate,
          pct90: y.pct90,
          pct75: y.pct75,
          pi: y.pi ?? null,
        })),
        ...(trend.length < 2
          ? {
              note: 'Earlier years appear as their result files are saved (or their figures typed in).',
            }
          : {}),
      },
      {
        key: 'pi',
        title: 'Performance Index by subject',
        columns: [t('subject', 'Subject', 3), ...trendCols],
        rows: bySubjectYear((v) => v.pi),
      },
      {
        key: 'avg',
        title: 'Average marks by subject',
        columns: [t('subject', 'Subject', 3), ...trendCols],
        rows: bySubjectYear((v) => v.average),
      },
    ],
  };

  // 13 — the office's lists: compartment, absent, failed / withheld / later
  const person = (c: AnCandidate) => ({
    roll: c.roll,
    name: c.name,
    section: c.section,
    admissionNo: c.admissionNo ?? null,
    contact: c.contact ?? null,
  });
  const personCols: AnColumn[] = [
    t('roll', 'Roll no', 1),
    t('name', 'Name', 3),
    t('section', 'Section', 1),
    t('admissionNo', 'Admission no', 1),
  ];
  const byRoll = (a: AnCandidate, b: AnCandidate) => a.roll.localeCompare(b.roll);
  const a13: Annexure = {
    no: 13,
    title: 'Compartment, absent and withheld',
    tables: [
      {
        key: 'compartment',
        title: 'Compartment',
        columns: [...personCols, t('subjects', 'Subjects', 3), t('contact', 'Contact', 2)],
        rows: app
          .filter((c) => c.result === 'COMP')
          .sort(byRoll)
          .map((c) => ({
            ...person(c),
            subjects: c.compartment.map((code) => `${code} ${nameOf(code)}`).join(', '),
          })),
      },
      {
        key: 'absent',
        title: 'Absent',
        columns: [...personCols, t('result', 'Result', 1), t('contact', 'Contact', 2)],
        rows: all
          .filter((c) => !appeared(c))
          .sort(byRoll)
          .map((c) => ({ ...person(c), result: c.result })),
      },
      {
        key: 'other',
        title: 'Failed, withheld or later',
        columns: [...personCols, t('result', 'Result', 1), t('contact', 'Contact', 2)],
        rows: app
          .filter((c) => c.result !== 'PASS' && c.result !== 'COMP')
          .sort(byRoll)
          .map((c) => ({ ...person(c), result: c.result })),
        note: 'FAIL failed, ER essential repeat, RW result withheld, RL result later, UFM unfair means.',
      },
    ],
  };

  return {
    classLabel: input.classLabel,
    examYear: input.examYear,
    rules,
    headline: head,
    annexures: [a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13],
  };
}

const PRINTED_GRADES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D1', 'D2', 'E'] as const;

export const RULE_WORDS: Record<BestFiveRule, string> = {
  'language-plus-four': 'the best language and the best four other subjects',
  'english-plus-four': 'English and the best four other subjects',
  'any-five': 'the best five subjects',
};

/**
 * A teacher's own board results (phase D, for the ACR): each section × subject they taught — the section-wise
 * figures with the PI, the ACR bands — and their students' marks. Nothing of other teachers' sections.
 */
export function teacherView(
  input: Pick<AnInput, 'candidates' | 'subjects' | 'rules'> & {
    teacherIds: (section: string, code: string, roll: string) => string[];
  },
  employeeId: string,
): { tables: AnTable[]; students: number } {
  const kind = new Map(input.subjects.map((s) => [s.code, s.kind]));
  const nameOf = (code: string) =>
    input.subjects.find((s) => s.code === code)?.name ?? `Subject ${code}`;
  const order = new Map(input.subjects.map((s, i) => [s.code, i]));
  const mine = new Map<string, Entry[]>();
  for (const [code, es] of entriesBySubject(input.candidates)) {
    if (kind.get(code) === 'internal') continue;
    for (const e of es) {
      const section = e.c.section ?? '—';
      if (!input.teacherIds(section, code, e.c.roll).includes(employeeId)) continue;
      const k = `${code}\u0000${section}`;
      mine.set(k, [...(mine.get(k) ?? []), e]);
    }
  }
  const groups = [...mine]
    .map(([k, es]) => {
      const [code, section] = k.split('\u0000') as [string, string];
      return { code, section, es };
    })
    .sort(
      (a, b) =>
        (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999) ||
        a.section.localeCompare(b.section, 'en', { numeric: true }),
    );
  const head = (g: { code: string; section: string }) => ({
    code: g.code,
    subject: nameOf(g.code),
    section: g.section,
  });
  const cols: AnColumn[] = [
    t('code', 'Code', 1),
    t('subject', 'Subject', 3),
    t('section', 'Section', 1),
  ];
  const students = new Set(groups.flatMap((g) => g.es.map((e) => e.c.roll)));
  return {
    students: students.size,
    tables: [
      {
        key: 'sections',
        title: 'My sections',
        columns: [
          ...cols,
          n('total', 'Total no.'),
          n('appeared', 'Appeared'),
          n('pass', 'Pass'),
          ...SECTION_BANDS.map(([label], i) => n(`b${i}`, label)),
          n('highest', 'Highest'),
          n('lowest', 'Lowest'),
          n('avg', 'Average'),
          n('pi', 'PI'),
        ],
        rows: groups.map((g) => {
          const s = subjectStats(g.es, input.rules);
          return {
            ...head(g),
            total: s.total,
            appeared: s.appeared,
            pass: s.pass,
            ...Object.fromEntries(SECTION_BANDS.map((b, i) => [`b${i}`, s.band(b)])),
            highest: s.highest,
            lowest: s.lowest,
            avg: s.average,
            pi: piOf(g.es),
          };
        }),
      },
      {
        key: 'acr',
        title: 'ACR bands',
        columns: [
          ...cols,
          ...ACR_BANDS.map(([label], i) => n(`b${i}`, label)),
          n('total', 'Total'),
        ],
        rows: groups.map((g) => {
          const s = subjectStats(g.es, input.rules);
          return {
            ...head(g),
            ...Object.fromEntries(ACR_BANDS.map((b, i) => [`b${i}`, s.band(b)])),
            total: s.appeared,
          };
        }),
      },
      {
        key: 'students',
        title: 'My students',
        columns: [
          ...cols,
          t('roll', 'Roll no', 1),
          t('name', 'Name', 3),
          n('marks', 'Marks'),
          t('grade', 'Grade', 1),
          t('result', 'Result', 1),
        ],
        rows: groups.flatMap((g) =>
          [...g.es]
            .sort((a, b) => a.c.roll.localeCompare(b.c.roll))
            .map((e) => ({
              ...head(g),
              roll: e.c.roll,
              name: e.c.name,
              marks: e.m.marks,
              grade: e.m.grade,
              result: e.c.compartment.includes(g.code)
                ? 'COMP'
                : e.m.marks === null
                  ? 'ABSENT'
                  : e.c.result,
            })),
        ),
      },
    ],
  };
}
