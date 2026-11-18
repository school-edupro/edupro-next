import { PDFDocument } from 'pdf-lib';
import { analyse, type AnCandidate, type AnSubject } from './board-analysis';
import { resultChartsPdf } from './board-charts-pdf';
import { resultAnalysisTable, resultCharts } from './board-reports';
import {
  BoardRulesSchema,
  DEFAULT_SCALE,
  defaultRules,
  gradeOn,
  gradeTones,
  readRules,
  ruleWords,
  scaleProblem,
  writeRules,
  type BoardRules,
  type GradeBand,
} from './board-rules';

// Every name, roll number and mark here is made up.
const FIVE: GradeBand[] = [
  { grade: 'A+', from: 90, to: 100 },
  { grade: 'A', from: 75, to: 89 },
  { grade: 'B', from: 60, to: 74 },
  { grade: 'C', from: 33, to: 59 },
  { grade: 'F', from: 0, to: 32 },
];
const SUBJECTS: AnSubject[] = [
  { code: '301', name: 'English Core', kind: 'language' },
  { code: '041', name: 'Mathematics', kind: 'main' },
  { code: '042', name: 'Physics', kind: 'main' },
];
let roll = 52000000;
const cand = (marks: Array<[string, number, string?]>): AnCandidate => {
  roll += 1;
  return {
    roll: String(roll),
    name: `CANDIDATE ${String(roll).slice(-2)}`,
    sex: 'M',
    result: 'PASS',
    compartment: [],
    section: 'A',
    stream: null,
    category: null,
    ews: null,
    cwsn: null,
    boarder: null,
    staffWard: null,
    marks: marks.map(([code, m, grade]) => ({ code, marks: m, grade: grade ?? null })),
  };
};

describe('board analysis rules a class (docs/design/88)', () => {
  it('checks a grade scale: 2-12 named grades, 0-100 with no gap or overlap', () => {
    expect(scaleProblem(DEFAULT_SCALE)).toBeNull();
    expect(scaleProblem(FIVE)).toBeNull();
    expect(scaleProblem(FIVE.slice(0, 1))).toMatch(/2 to 12/);
    expect(scaleProblem([{ ...FIVE[0]!, to: 99 }, ...FIVE.slice(1)])).toMatch(/end at 100/);
    expect(scaleProblem([...FIVE.slice(0, 4), { ...FIVE[4]!, from: 1 }])).toMatch(/start at 0/);
    expect(scaleProblem([FIVE[0]!, { ...FIVE[1]!, to: 88 }, ...FIVE.slice(2)])).toBe(
      'A+ starts at 90, so A must end at 89 (it ends at 88).',
    );
    expect(scaleProblem([FIVE[0]!, { ...FIVE[1]!, grade: 'a+' }, ...FIVE.slice(2)])).toMatch(
      /twice/,
    );
    expect(scaleProblem([{ ...FIVE[0]!, grade: 'Top grade' }, ...FIVE.slice(1)])).toMatch(
      /not a grade/,
    );
    // the form's rows come in any order: the schema sorts them, highest first
    const parsed = BoardRulesSchema.parse({
      ...defaultRules('XII'),
      scale: [...FIVE].reverse(),
    });
    expect(parsed.scale.map((b) => b.grade)).toEqual(['A+', 'A', 'B', 'C', 'F']);
    expect(
      BoardRulesSchema.safeParse({ ...defaultRules('X'), scale: [FIVE[0], FIVE[2]] }).success,
    ).toBe(false);
  });

  it('grades a mark on the scale, or a printed grade by its name (D1, D2 as D; E as E1)', () => {
    const marks = defaultRules('X');
    expect(gradeOn({ marks: 90.5, grade: null }, marks)).toBe('A2');
    expect(gradeOn({ marks: 32, grade: null }, marks)).toBe('E1');
    const printed: BoardRules = { ...marks, grades: 'printed' };
    expect(gradeOn({ marks: 50, grade: 'D2' }, printed)).toBe('D');
    expect(gradeOn({ marks: 20, grade: 'E' }, printed)).toBe('E1');
    expect(gradeOn({ marks: 95, grade: 'a1' }, printed)).toBe('A1');
    // two grades with the letter A: a printed A1 matches none
    expect(gradeOn({ marks: 95, grade: 'A1' }, { ...printed, scale: FIVE })).toBeNull();
    expect(gradeOn({ marks: 95, grade: null }, { ...marks, scale: FIVE })).toBe('A+');
  });

  it('reads the one set of rules saved before for both classes, and keeps the other class on a save', () => {
    const old = {
      bestFive: 'english-plus-four',
      distinction: 80,
      passMarks: 33,
      grades: 'printed',
    };
    const x = readRules(old, 'X');
    expect(x.isDefault).toBe(false);
    expect(x.rules).toMatchObject({ distinction: 80, grades: 'printed', scale: DEFAULT_SCALE });
    expect(x.rules.bestFive).toEqual({
      include: 'english',
      rest: 'best',
      optional: 'replace',
      optionalKinds: ['skill', 'additional'],
    });
    expect(readRules(old, 'XII').rules.bestFive.optionalKinds).toEqual(['additional']);
    expect(readRules(null, 'XII')).toEqual({ rules: defaultRules('XII'), isDefault: true });

    const xii: BoardRules = {
      ...defaultRules('XII'),
      bestFive: {
        include: 'english',
        rest: 'best',
        optional: 'never',
        optionalKinds: ['additional'],
      },
      scale: FIVE,
    };
    // the old single set becomes X's own; XII gets its new rules
    const saved = writeRules(old, 'XII', xii);
    expect(readRules(saved, 'X').rules.distinction).toBe(80);
    expect(readRules(saved, 'XII').rules).toEqual(xii);
    // a class never saved stays on the defaults
    const fresh = writeRules(null, 'XII', xii);
    expect(fresh.X).toBeUndefined();
    expect(readRules(fresh, 'X').isDefault).toBe(true);
  });

  it('words the rule and colours the grades (the passing ones, the last amber, the failing red)', () => {
    expect(ruleWords(defaultRules('X').bestFive)).toBe(
      'the best language and the best four other subjects',
    );
    expect(
      ruleWords({
        include: 'english',
        rest: 'best',
        optional: 'never',
        optionalKinds: ['skill', 'additional'],
      }),
    ).toBe('English and the best four other subjects; skill and additional subjects never count');
    expect(
      ruleWords({ include: 'none', rest: 'printed', optional: 'failed', optionalKinds: ['skill'] }),
    ).toBe(
      "the first five subjects as CBSE printed them; a skill subject counts only in place of a failed one (CBSE's rule)",
    );
    expect(gradeTones(defaultRules('X'))).toEqual([
      'success',
      'success-soft',
      'navy',
      'navy-soft',
      'cyan',
      'cyan-soft',
      'warning',
      'danger',
    ]);
    expect(gradeTones({ passMarks: 33, scale: FIVE })).toEqual([
      'success',
      'success-soft',
      'navy',
      'warning',
      'danger',
    ]);
  });

  it("counts the annexures, the result analysis and the charts on the class's own grades", async () => {
    const rules: BoardRules = { ...defaultRules('XII'), scale: FIVE };
    const all = [
      cand([
        ['301', 95],
        ['041', 80],
        ['042', 30],
      ]),
      cand([
        ['301', 91],
        ['041', 62],
        ['042', 45],
      ]),
    ];
    const a = analyse({
      classLabel: 'XII',
      examYear: 2026,
      rules,
      candidates: all,
      subjects: SUBJECTS,
      teacher: () => null,
      history: [],
      lastYear: null,
    });
    const s4 = a.annexures[3]!.tables.find((t) => t.key === 'summary')!;
    expect(s4.columns.filter((c) => c.key.startsWith('g')).map((c) => c.label)).toEqual([
      'Total no. of A+',
      'Total no. of A',
      'Total no. of B',
      'Total no. of C',
      'Total no. of F',
      'Total no. of division',
    ]);
    const physics = s4.rows.find((r) => String(r.subject).startsWith('042'))!;
    expect(physics).toMatchObject({ 'gA+': 0, gC: 1, gF: 1, graded: 1 });
    // the A grades are every grade named A…
    const a1 = a.annexures[0]!.tables.find((t) => t.key === 'grades')!;
    expect(a1.columns[2]!.label).toBe('A+, A');
    expect(a1.rows.find((r) => r.subject === 'English Core')).toMatchObject({ a: 2 });

    const t = resultAnalysisTable(all, SUBJECTS, rules, { gender: 'all' });
    expect(t.columns.filter((c) => c.group === 'Grades').map((c) => c.label)).toEqual([
      'A+ (90-100)',
      'A (75-89)',
      'B (60-74)',
      'C (33-59)',
      'F (0-32)',
    ]);
    const ch = resultCharts([{ examYear: 2026, candidates: all }], SUBJECTS, rules, {
      gender: 'all',
    });
    expect(ch.grades).toEqual(['A+', 'A', 'B', 'C', 'F']);
    expect(ch.tones).toHaveLength(5);
    expect(ch.gradeSpread.find((g) => g.code === '041')!.counts).toEqual([0, 1, 1, 0, 0]);
    // the graphs PDF draws the five grades in their tones
    const pdf = await PDFDocument.load(
      await resultChartsPdf(ch, {
        school: 'Sample School',
        address: 'Sample Road',
        logo: null,
        generatedOn: '18-11-2026 10:00 AM',
        by: 'Test Maker',
        title: 'CBSE AISSCE result (Class XII) 2026-27 · result analysis',
        scope: 'all students',
      }),
    );
    expect(pdf.getPageCount()).toBeGreaterThan(0);
  });
});
