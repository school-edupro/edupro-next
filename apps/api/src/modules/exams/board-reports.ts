import {
  entriesBySubject,
  gradeNames,
  piOf,
  round2,
  subjectStats,
  yearLabel,
  type AnCandidate,
  type AnColumn,
  type AnMark,
  type AnSubject,
  type AnTable,
  type BoardRules,
  type Cell,
  type Entry,
} from './board-analysis';
import { marksRows, shortSubject, type MarksMethod } from './board-marks';
import { bandRange, gradeTones, type GradeTone } from './board-rules';

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
const gradeLabel = (g: string, rules: BoardRules) => {
  if (rules.grades === 'printed') return `${g} grade (as printed)`;
  const band = rules.scale.find((b) => b.grade === g);
  return band ? `${g} grade (${bandRange(band)}%)` : `${g} grade`;
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
        ...gradeNames(rules).map((g) =>
          row(`g${g}`, gradeLabel(g, rules), (s) => s.grades[g] ?? 0, true),
        ),
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

// ---- Subject Summary: every subject's performance by boys and girls (the old "All Subject Performance") ----

/** The marks ranges of the grade columns: the class's scale, by the marks whatever the grade setting. */
export const markRanges = (rules: BoardRules): Array<[string, number, number]> =>
  rules.scale.map((b) => [`${b.grade} (${bandRange(b)}%)`, b.from, b.to]);

/**
 * Subject Summary: a row a subject — appeared (boys, girls), failures, compartments, pass (boys, girls), the
 * average (boys, girls), the highest, and boys and girls in each marks range — and a total row (counts added up,
 * shares and averages over every subject entry).
 */
export function subjectPerformance(
  candidates: AnCandidate[],
  subjects: AnSubject[],
  rules: BoardRules,
  opts: { gender: Gender; code?: string | undefined },
): AnTable {
  const kind = new Map(subjects.map((s) => [s.code, s.kind]));
  const order = new Map(subjects.map((s, i) => [s.code, i]));
  const nameOf = (code: string) => subjects.find((s) => s.code === code)?.name ?? `Subject ${code}`;
  const MARK_RANGES = markRanges(rules);
  const by = entriesBySubject(
    candidates.filter((c) => opts.gender === 'all' || c.sex === opts.gender),
  );
  const codes = [...by.keys()]
    .filter((c) => kind.get(c) !== 'internal')
    .filter((c) => !opts.code || c === opts.code)
    .filter((c) => by.get(c)!.some((e) => e.m.marks !== null))
    .sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));
  const n = (key: string, label: string, group?: string): AnColumn => ({
    key,
    label,
    num: true,
    ...(group ? { group } : {}),
  });
  const columns: AnColumn[] = [
    n('sno', 'S.No'),
    { key: 'subject', label: 'Subject', width: 3 },
    n('appeared', 'Appeared', 'No. of students'),
    n('boys', 'Boys', 'No. of students'),
    n('girls', 'Girls', 'No. of students'),
    n('failNo', 'No.', 'Failures'),
    n('failPct', '%', 'Failures'),
    n('compNo', 'No.', 'Compartments'),
    n('compPct', '%', 'Compartments'),
    n('passNo', 'No.', 'Pass'),
    n('passPct', '%', 'Pass'),
    n('boysPassNo', 'No.', 'Boys pass'),
    n('boysPassPct', '%', 'Boys pass'),
    n('girlsPassNo', 'No.', 'Girls pass'),
    n('girlsPassPct', '%', 'Girls pass'),
    n('avg', 'All', 'Average %'),
    n('avgBoys', 'Boys', 'Average %'),
    n('avgGirls', 'Girls', 'Average %'),
    n('highest', 'Highest'),
    ...MARK_RANGES.flatMap(([label], i) => [
      n(`r${String(i)}B`, 'Boys', label),
      n(`r${String(i)}G`, 'Girls', label),
    ]),
  ];
  type Marked = Entry & { m: AnMark & { marks: number } };
  const pct = (k: number, of: number) => (of > 0 ? round2((k * 100) / of) : null);
  const avg = (xs: number[]) =>
    xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  const inRange = (m: number, i: number) =>
    Math.floor(m) >= MARK_RANGES[i]![1] && Math.floor(m) <= MARK_RANGES[i]![2];
  const figures = (es: Entry[]) => {
    const app = es.filter((e): e is Marked => e.m.marks !== null);
    const boys = app.filter((e) => e.c.sex === 'M');
    const girls = app.filter((e) => e.c.sex === 'F');
    const outcome = (e: Marked) =>
      e.c.compartment.includes(e.m.code) ? 'comp' : e.m.marks < rules.passMarks ? 'fail' : 'pass';
    const count = (xs: Marked[], o: string) => xs.filter((e) => outcome(e) === o).length;
    const row: Record<string, Cell> = {
      appeared: app.length,
      boys: boys.length,
      girls: girls.length,
      failNo: count(app, 'fail'),
      failPct: pct(count(app, 'fail'), app.length),
      compNo: count(app, 'comp'),
      compPct: pct(count(app, 'comp'), app.length),
      passNo: count(app, 'pass'),
      passPct: pct(count(app, 'pass'), app.length),
      boysPassNo: count(boys, 'pass'),
      boysPassPct: pct(count(boys, 'pass'), boys.length),
      girlsPassNo: count(girls, 'pass'),
      girlsPassPct: pct(count(girls, 'pass'), girls.length),
      avg: avg(app.map((e) => e.m.marks)),
      avgBoys: avg(boys.map((e) => e.m.marks)),
      avgGirls: avg(girls.map((e) => e.m.marks)),
      highest: app.length ? Math.max(...app.map((e) => e.m.marks)) : null,
    };
    MARK_RANGES.forEach((_, i) => {
      row[`r${String(i)}B`] = boys.filter((e) => inRange(e.m.marks, i)).length;
      row[`r${String(i)}G`] = girls.filter((e) => inRange(e.m.marks, i)).length;
    });
    return row;
  };
  // the short names CBSE's sheets use ("English Lng & Lit"), as the old report's — the table is wide
  const rows = codes.map((code, i) => ({
    sno: i + 1,
    subject: shortSubject(nameOf(code)),
    ...figures(by.get(code)!),
  }));
  const total: Record<string, Cell> = {
    sno: '',
    subject: 'Total',
    ...figures(codes.flatMap((code) => by.get(code)!)),
    highest: null,
  };
  return {
    key: 'subject-performance',
    title: 'Subject summary',
    columns,
    rows: [...rows, total],
    strong: [rows.length],
    note: `Percentage-based, not grade-based: the ${gradeNames(rules)[0]!} … ${gradeNames(rules).at(-1)!} columns count marks in those ranges (the class's grade scale). Shares are of those who appeared; a compartment subject is not a pass; averages are of the marks.`,
  };
}

// ---- Result Analysis: the subject table and its charts (the old "Result Analysis" page) ----

export type GenderView = Gender | 'both';

/** A subject's (or all subjects') figures: the old page's 24 columns. */
function analysisFigures(es: Entry[], rules: BoardRules): Record<string, Cell> {
  const s = subjectStats(es, rules);
  const marks = s.app.map((e) => e.m.marks);
  const between = (from: number, below: number) =>
    marks.filter((m) => m >= from && m < below).length;
  const pc = (k: number, of: number) => (of > 0 ? round2((k * 100) / of) : null);
  const row: Record<string, Cell> = {
    total: s.total,
    appeared: s.appeared,
    absentNo: s.absent,
    absentPct: pc(s.absent, s.total),
    passNo: s.pass,
    passPct: pc(s.pass, s.appeared),
    failNo: s.fail,
    failPct: pc(s.fail, s.appeared),
    compNo: s.comp,
    compPct: pc(s.comp, s.appeared),
    highest: s.highest,
    lowest: s.lowest,
    avg: s.average,
  };
  const div: Array<[string, number, number]> = [
    ['dist', rules.distinction, Infinity],
    ['first', FIRST_DIVISION, rules.distinction],
    ['second', SECOND_DIVISION, FIRST_DIVISION],
    ['third', rules.passMarks, SECOND_DIVISION],
  ];
  for (const [k, from, below] of div) {
    const n = between(from, below);
    row[`${k}No`] = n;
    row[`${k}Pct`] = pc(n, s.appeared);
  }
  for (const g of gradeNames(rules)) row[`g${g}`] = s.grades[g] ?? 0;
  return row;
}

const num = (key: string, label: string, group?: string): AnColumn => ({
  key,
  label,
  num: true,
  ...(group ? { group } : {}),
});

/** The Result Analysis figures' columns (analysisFigures): students … divisions, then the class's grades. */
function figureColumns(rules: BoardRules): AnColumn[] {
  const n = num;
  const gradeLabel = (g: string) => {
    const band = rules.scale.find((b) => b.grade === g);
    return rules.grades === 'printed' || !band ? g : `${g} (${bandRange(band)})`;
  };
  return [
    n('total', 'Total', 'Students'),
    n('appeared', 'Appeared', 'Students'),
    n('absentNo', 'No.', 'Absent'),
    n('absentPct', '%', 'Absent'),
    n('passNo', 'No.', 'Pass'),
    n('passPct', '%', 'Pass'),
    n('failNo', 'No.', 'Fail'),
    n('failPct', '%', 'Fail'),
    n('compNo', 'No.', 'Compartment'),
    n('compPct', '%', 'Compartment'),
    n('highest', 'Highest', 'Marks'),
    n('lowest', 'Lowest', 'Marks'),
    n('avg', 'Average', 'Marks'),
    n('distNo', 'No.', 'Distinction'),
    n('distPct', '%', 'Distinction'),
    n('firstNo', 'No.', '1st division'),
    n('firstPct', '%', '1st division'),
    n('secondNo', 'No.', '2nd division'),
    n('secondPct', '%', '2nd division'),
    n('thirdNo', 'No.', '3rd division'),
    n('thirdPct', '%', '3rd division'),
    ...gradeNames(rules).map((g) => n(`g${g}`, gradeLabel(g), 'Grades')),
  ];
}

/**
 * The Result Analysis table: a row a subject (and, for boys against girls, an All, a Boys and a Girls row) with the
 * students, appeared, absent, pass, fail, compartment, marks, divisions and grades, and the total line(s). The
 * grades always add up to those who appeared (from the marks: D from the pass marks to 40, E below; as printed:
 * D1 + D2 as D).
 */
export function resultAnalysisTable(
  candidates: AnCandidate[],
  subjects: AnSubject[],
  rules: BoardRules,
  opts: { gender: GenderView; code?: string | undefined; result?: string | undefined },
): AnTable {
  const kind = new Map(subjects.map((s) => [s.code, s.kind]));
  const order = new Map(subjects.map((s, i) => [s.code, i]));
  const nameOf = (code: string) =>
    shortSubject(subjects.find((s) => s.code === code)?.name ?? `Subject ${code}`);
  const pool = candidates.filter((c) => !opts.result || c.result === opts.result);
  const genders: Gender[] = opts.gender === 'both' ? ['all', 'M', 'F'] : [opts.gender];
  const by = new Map(
    genders.map((g) => [g, entriesBySubject(pool.filter((c) => g === 'all' || c.sex === g))]),
  );
  const codes = [...new Set([...by.values()].flatMap((m) => [...m.keys()]))]
    .filter((c) => kind.get(c) !== 'internal')
    .filter((c) => !opts.code || c === opts.code)
    .filter((c) => [...by.values()].some((m) => (m.get(c) ?? []).some((e) => e.m.marks !== null)))
    .sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));
  const word = (g: Gender) => (g === 'M' ? 'Boys' : g === 'F' ? 'Girls' : 'All');
  const label = (name: string, g: Gender) =>
    opts.gender === 'both' ? `${name} · ${word(g)}` : name;
  const columns: AnColumn[] = [
    num('sno', 'S.No'),
    { key: 'code', label: 'Code', width: 1 },
    { key: 'subject', label: 'Subject', width: 3 },
    ...figureColumns(rules),
  ];
  const rows: Array<Record<string, Cell>> = [];
  codes.forEach((code, i) => {
    for (const g of genders)
      rows.push({
        sno: g === genders[0] ? i + 1 : '',
        code,
        subject: label(nameOf(code), g),
        ...analysisFigures(by.get(g)!.get(code) ?? [], rules),
      });
  });
  const firstTotal = rows.length;
  for (const g of genders)
    rows.push({
      sno: '',
      code: '',
      subject: label('Total', g),
      ...analysisFigures(
        codes.flatMap((code) => by.get(g)!.get(code) ?? []),
        rules,
      ),
      highest: null,
      lowest: null,
    });
  return {
    key: 'result-analysis',
    title: 'Result analysis',
    columns,
    rows,
    strong: genders.map((_, k) => firstTotal + k),
    note: `Shares are of those who appeared (absent: of all). Divisions do not overlap: distinction from ${String(rules.distinction)}, 1st division from ${String(FIRST_DIVISION)}, 2nd from ${String(SECOND_DIVISION)}, 3rd from ${String(rules.passMarks)}. A compartment subject is not a pass. ${
      rules.grades === 'printed'
        ? "Grades as CBSE printed them, matched to the class's grades by name (D1 and D2 counted as D)."
        : "Grades from the marks on the class's scale; they add up to those who appeared."
    }`,
  };
}

// ---- Teacher wise: the Result Analysis a teacher (each subject × section taught, and the teacher's total) ----

/** A teacher of a section's subject for one candidate (the Teachers tab's overrides, else the year's assignments). */
export type TeachersOf = (
  section: string | null,
  code: string,
  roll: string,
) => Array<{ id: string | null; name: string }>;

export const NO_TEACHER = 'none';

/**
 * Teacher wise result analysis: the Result Analysis figures for each subject and section a teacher taught (a section
 * shared by teachers counts under each), the teacher's total when more than one, the PI, and the row's average
 * against the subject's average over the whole class. Teachers by name; "No teacher set" last.
 */
export function teacherAnalysisTable(
  candidates: AnCandidate[],
  subjects: AnSubject[],
  rules: BoardRules,
  teachersOf: TeachersOf,
  opts: { gender: Gender; code?: string | undefined; teacher?: string | undefined },
): { table: AnTable; teachers: Array<{ key: string; name: string }> } {
  const kind = new Map(subjects.map((s) => [s.code, s.kind]));
  const order = new Map(subjects.map((s, i) => [s.code, i]));
  const nameOf = (code: string) =>
    shortSubject(subjects.find((s) => s.code === code)?.name ?? `Subject ${code}`);
  const by = entriesBySubject(
    candidates.filter((c) => opts.gender === 'all' || c.sex === opts.gender),
  );
  const codes = [...by.keys()]
    .filter((c) => kind.get(c) !== 'internal')
    .filter((c) => !opts.code || c === opts.code)
    .filter((c) => by.get(c)!.some((e) => e.m.marks !== null));
  const classAvg = new Map(codes.map((c) => [c, subjectStats(by.get(c)!, rules).average]));
  const groups = new Map<
    string,
    { name: string; cells: Map<string, { code: string; section: string; es: Entry[] }> }
  >();
  for (const code of codes)
    for (const e of by.get(code)!) {
      const people = teachersOf(e.c.section, code, e.c.roll);
      const who = people.length ? people : [{ id: NO_TEACHER, name: 'No teacher set' }];
      for (const p of who) {
        const key = p.id ?? `n:${p.name}`;
        const g = groups.get(key) ?? { name: p.name, cells: new Map() };
        const section = e.c.section ?? '—';
        const at = `${code} ${section}`;
        const cell = g.cells.get(at) ?? { code, section, es: [] };
        cell.es.push(e);
        g.cells.set(at, cell);
        groups.set(key, g);
      }
    }
  const teachers = [...groups.entries()]
    .map(([key, g]) => ({ key, name: g.name }))
    .sort(
      (a, b) =>
        Number(a.key === NO_TEACHER) - Number(b.key === NO_TEACHER) || a.name.localeCompare(b.name),
    );
  const rows: Array<Record<string, Cell>> = [];
  const strong: number[] = [];
  teachers
    .filter((t) => !opts.teacher || t.key === opts.teacher)
    .forEach((t, i) => {
      const cells = [...groups.get(t.key)!.cells.values()].sort(
        (a, b) =>
          (order.get(a.code) ?? 999) - (order.get(b.code) ?? 999) ||
          a.code.localeCompare(b.code) ||
          a.section.localeCompare(b.section),
      );
      cells.forEach((x, j) => {
        const f = analysisFigures(x.es, rules);
        const avg = classAvg.get(x.code) ?? null;
        rows.push({
          sno: j === 0 ? i + 1 : '',
          teacher: j === 0 ? t.name : '',
          // the subject with its section, in the frozen columns on screen
          subject: `${nameOf(x.code)} · ${x.section}`,
          code: x.code,
          section: x.section,
          ...f,
          pi: piOf(x.es),
          classAvg: avg,
          vsClass: typeof f.avg === 'number' && avg !== null ? round2(f.avg - avg) : null,
        });
      });
      if (cells.length > 1) {
        const all = cells.flatMap((x) => x.es);
        strong.push(rows.length);
        rows.push({
          sno: '',
          teacher: '',
          subject: `Total (${t.name})`,
          code: '',
          section: '',
          ...analysisFigures(all, rules),
          pi: piOf(all),
          classAvg: null,
          vsClass: null,
        });
      }
    });
  return {
    teachers,
    table: {
      key: 'teacher-analysis',
      title: 'Teacher wise result analysis',
      columns: [
        num('sno', 'S.No'),
        { key: 'teacher', label: 'Teacher', width: 3 },
        { key: 'subject', label: 'Subject · section', width: 3 },
        { key: 'code', label: 'Code', width: 1 },
        ...figureColumns(rules),
        num('pi', 'PI'),
        num('classAvg', 'Class average', 'Against the class'),
        num('vsClass', 'Gap', 'Against the class'),
      ],
      rows,
      strong,
      note: `A row a subject and section the teacher taught (the year's subject teachers, or the Teachers tab's changes); a section shared by teachers counts under each, and a teacher's total adds the rows. Shares are of those who appeared (absent: of all); a compartment subject is not a pass; distinction from ${String(rules.distinction)}, divisions do not overlap. PI: the KV weights on the grades CBSE printed (A1 8 … E 0). Against the class: the subject's average over every section, and the gap — the row's average less it (above the class: plus).`,
    },
  };
}

export interface ResultCharts {
  /** pass % a year (the CBSE result; one subject's passes when a subject is chosen) */
  passTrend: { labels: string[]; series: Array<{ label: string; values: Array<number | null> }> };
  /** the grade labels (the class's scale, A1 … E1 by default) of the grade charts, top first */
  grades: string[];
  /** each grade's chart colour (the design system's tones; the PDF draws the same) */
  tones: GradeTone[];
  /** a subject's students at each grade, and their share of those who appeared */
  gradeSpread: Array<{
    code: string;
    name: string;
    appeared: number;
    counts: number[];
    pct: number[];
  }>;
  /** a subject's highest, average and lowest marks */
  marks: Array<{ code: string; name: string; values: number[] }>;
  /** every subject's (or the chosen one's) grades across the years: a share of those who appeared, a year */
  subjectYears: Array<{
    code: string;
    name: string;
    series: Array<{ label: string; appeared: number; counts: number[]; pct: number[] }>;
  }>;
}

/** The charts of the Result Analysis: across the years given (the first is the year asked). */
export function resultCharts(
  years: Array<{ examYear: number; candidates: AnCandidate[] }>,
  subjects: AnSubject[],
  rules: BoardRules,
  opts: { gender: GenderView; code?: string | undefined; result?: string | undefined },
): ResultCharts {
  const kind = new Map(subjects.map((s) => [s.code, s.kind]));
  const order = new Map(subjects.map((s, i) => [s.code, i]));
  const nameOf = (code: string) =>
    shortSubject(subjects.find((s) => s.code === code)?.name ?? `Subject ${code}`);
  const ordered = [...years].sort((a, b) => a.examYear - b.examYear);
  const asked = years[0]!;
  const keep = (cs: AnCandidate[], g: Gender) =>
    cs.filter((c) => (!opts.result || c.result === opts.result) && (g === 'all' || c.sex === g));
  const genders: Gender[] = opts.gender === 'both' ? ['all', 'M', 'F'] : [opts.gender];
  const word = (g: Gender) => (g === 'M' ? 'Boys' : g === 'F' ? 'Girls' : 'All');
  const passPct = (cs: AnCandidate[]) => {
    if (opts.code) {
      const es = entriesBySubject(cs).get(opts.code) ?? [];
      const s = es.length ? subjectStats(es, rules) : null;
      return s && s.appeared ? round2((s.pass * 100) / s.appeared) : null;
    }
    const app = cs.filter((c) => c.marks.some((m) => m.marks !== null));
    return app.length
      ? round2((app.filter((c) => c.result === 'PASS').length * 100) / app.length)
      : null;
  };
  const main: Gender = opts.gender === 'both' ? 'all' : opts.gender;
  const now = entriesBySubject(keep(asked.candidates, main));
  const codes = [...now.keys()]
    .filter((c) => kind.get(c) !== 'internal')
    .filter((c) => !opts.code || c === opts.code)
    .filter((c) => now.get(c)!.some((e) => e.m.marks !== null))
    .sort((a, b) => (order.get(a) ?? 999) - (order.get(b) ?? 999) || a.localeCompare(b));
  const shares = (counts: number[], of: number) =>
    counts.map((n) => (of > 0 ? round2((n * 100) / of) : 0));
  const gradesOf = (es: Entry[]) => {
    const st = es.length ? subjectStats(es, rules) : null;
    const counts = gradeNames(rules).map((g) => (st ? (st.grades[g] ?? 0) : 0));
    const appeared = st ? st.appeared : 0;
    return { appeared, counts, pct: shares(counts, appeared) };
  };
  return {
    passTrend: {
      labels: ordered.map((y) => yearLabel(y.examYear)),
      series: genders.map((g) => ({
        label: word(g),
        values: ordered.map((y) => passPct(keep(y.candidates, g))),
      })),
    },
    grades: gradeNames(rules),
    tones: gradeTones(rules),
    gradeSpread: codes.map((code) => ({ code, name: nameOf(code), ...gradesOf(now.get(code)!) })),
    marks: codes.map((code) => {
      const s = subjectStats(now.get(code)!, rules);
      return { code, name: nameOf(code), values: [s.highest ?? 0, s.average ?? 0, s.lowest ?? 0] };
    }),
    subjectYears: codes.map((code) => ({
      code,
      name: nameOf(code),
      series: ordered.map((y) => ({
        label: yearLabel(y.examYear),
        ...gradesOf(entriesBySubject(keep(y.candidates, main)).get(code) ?? []),
      })),
    })),
  };
}
