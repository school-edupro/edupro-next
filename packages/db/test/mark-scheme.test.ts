import { describe, expect, it } from 'vitest';
import {
  computeScheme,
  roundBy,
  schemeProblems,
  SCHEME_PRESETS,
  type GradeBand,
  type SchemeCode,
  type SchemeDef,
  type SchemeMark,
  type SchemeStudent,
} from '../src/mark-scheme';

/** CBSE 8-point, as the ready-made scale */
const CBSE: GradeBand[] = [
  { grade: 'A1', minPct: 91, maxPct: 100 },
  { grade: 'A2', minPct: 81, maxPct: 90.99 },
  { grade: 'B1', minPct: 71, maxPct: 80.99 },
  { grade: 'B2', minPct: 61, maxPct: 70.99 },
  { grade: 'C1', minPct: 51, maxPct: 60.99 },
  { grade: 'C2', minPct: 41, maxPct: 50.99 },
  { grade: 'D', minPct: 33, maxPct: 40.99 },
  { grade: 'E', minPct: 0, maxPct: 32.99 },
];
const CODES: Record<string, SchemeCode> = {
  AB: { treatment: 'zero', value: null, blocks: true },
  ML: { treatment: 'exclude', value: null, blocks: false },
  SR: { treatment: 'percent', value: 50, blocks: false },
  PR: { treatment: 'pro_rata', value: null, blocks: false },
};

const mark = (
  max: number,
  v: number | string | null,
  parts?: Record<string, [number, number | null]>,
): SchemeMark => ({
  max,
  marks: typeof v === 'number' ? v : null,
  code: typeof v === 'string' ? v : null,
  entered: v !== null,
  parts: Object.fromEntries(
    Object.entries(parts ?? {}).map(([k, [pmax, pv]]) => [
      k,
      { max: pmax, marks: pv, absent: false, entered: pv !== null },
    ]),
  ),
});
const pupil = (
  name: string,
  subjects: Array<{
    code: string;
    kind?: 'compulsory' | 'optional' | 'additional';
    marks: Record<string, SchemeMark>;
  }>,
  extra: Partial<SchemeStudent> = {},
): SchemeStudent => ({
  studentId: name,
  name,
  admissionNo: name,
  rollNo: null,
  sectionId: 'A',
  section: 'VI-A',
  attendancePct: null,
  subjects: subjects.map((x) => ({
    subjectId: x.code,
    code: x.code,
    name: x.code,
    kind: x.kind ?? 'compulsory',
    marks: x.marks,
  })),
  ...extra,
});
const preset = (code: string, exams: string[]): SchemeDef => {
  const p = SCHEME_PRESETS.find((x) => x.code === code)!.def;
  return {
    columns: p.columns,
    result: p.result,
    exams: exams.map((key, i) => ({ key, examId: String(i + 1) })),
  };
};
const VI = preset('DPS_VI_VIII', ['MT1', 'MT2', 'SE1', 'SE2', 'TERM']);

describe('mark schemes (docs/design/65, part 3)', () => {
  it('rounds as the old register did', () => {
    expect(roundBy(79.5, 'whole')).toBe(80);
    expect(roundBy(79.49, 'whole')).toBe(79);
    expect(roundBy(79.5, 'half_kept')).toBe(79.5);
    expect(roundBy(79.6, 'half_kept')).toBe(80);
    expect(roundBy(79.01, 'up')).toBe(80);
    expect(roundBy(12.345, 'two')).toBe(12.35);
  });

  it('every ready-made scheme is complete', () => {
    for (const p of SCHEME_PRESETS) {
      const { examKeys, ...def } = p.def;
      expect(
        schemeProblems({ ...def, exams: examKeys.map((k) => ({ key: k.key, examId: '1' })) }),
      ).toEqual([]);
    }
  });

  it('VI-VIII: PT 15 from the MT average, SE 5 from the SE average, the term exam 80; whole numbers', () => {
    const [r] = computeScheme(
      VI,
      [
        pupil('Asha', [
          {
            code: 'ENG',
            marks: {
              MT1: mark(20, 18),
              MT2: mark(20, 16),
              SE1: mark(5, 4),
              SE2: mark(5, 5),
              TERM: mark(80, 62),
            },
          },
        ]),
      ],
      CODES,
      CBSE,
    );
    const eng = r!.subjects[0]!;
    // 85 % of 15 = 12.75; 90 % of 5 = 4.5; 12.75 + 4.5 + 62 = 79.25 → 79
    expect(eng.values.PT).toEqual({ v: 12.75, max: 15 });
    expect(eng.values.SE).toEqual({ v: 4.5, max: 5 });
    expect(eng.total).toBe(79);
    expect(eng.max).toBe(100);
    expect(eng.grade).toBe('B1');
    expect(r).toMatchObject({
      total: 79,
      max: 100,
      pct: 79,
      grade: 'B1',
      result: 'pass',
      division: 'First',
    });
  });

  it('codes: ML leaves the maximum, AB counts 0 and holds the result, a % code and pro-rata', () => {
    const rows = computeScheme(
      VI,
      [
        pupil('ml', [
          {
            code: 'ENG',
            marks: {
              MT1: mark(20, 'ML'),
              MT2: mark(20, 10),
              SE1: mark(5, 5),
              SE2: mark(5, 5),
              TERM: mark(80, 40),
            },
          },
        ]),
        pupil('ab', [
          {
            code: 'ENG',
            marks: {
              MT1: mark(20, 20),
              MT2: mark(20, 20),
              SE1: mark(5, 5),
              SE2: mark(5, 5),
              TERM: mark(80, 'AB'),
            },
          },
        ]),
        pupil('sr', [
          {
            code: 'ENG',
            marks: {
              MT1: mark(20, 'SR'),
              MT2: mark(20, 20),
              SE1: mark(5, 5),
              SE2: mark(5, 5),
              TERM: mark(80, 80),
            },
          },
        ]),
        pupil('pr', [
          {
            code: 'ENG',
            marks: {
              MT1: mark(20, 'PR'),
              MT2: mark(20, 10),
              SE1: mark(5, 5),
              SE2: mark(5, 5),
              TERM: mark(80, 40),
            },
          },
        ]),
      ],
      CODES,
      CBSE,
    );
    const by = Object.fromEntries(rows.map((x) => [x.name, x]));
    // ML: the PT is MT2's 50 % alone
    expect(by.ml!.subjects[0]!.values.PT).toEqual({ v: 7.5, max: 15 });
    expect(by.ab).toMatchObject({ result: 'absent', rankInClass: null });
    expect(by.ab!.subjects[0]!.values.TERM).toEqual({ v: 0, max: 80, code: 'AB' });
    // SR: half of MT1's 20 = 10; the PT is the average of 50 % and 100 %
    expect(by.sr!.subjects[0]!.values.MT1).toEqual({ v: 10, max: 20, code: 'SR' });
    expect(by.sr!.subjects[0]!.values.PT).toEqual({ v: 11.25, max: 15 });
    // pro-rata: MT1 takes the student's share of the other exams (50 %, 100 %, 100 %, 50 % → 75 %)
    expect(by.pr!.subjects[0]!.values.MT1).toMatchObject({ v: 15, code: 'PR' });
  });

  it('one or two subjects failed is a compartment, three a fail; a missing mark is incomplete, no rank', () => {
    const full = (term: number) => ({
      MT1: mark(20, 10),
      MT2: mark(20, 10),
      SE1: mark(5, 3),
      SE2: mark(5, 3),
      TERM: mark(80, term),
    });
    const rows = computeScheme(
      VI,
      [
        pupil('two', [
          { code: 'ENG', marks: full(10) },
          { code: 'MAT', marks: full(10) },
          { code: 'SCI', marks: full(60) },
        ]),
        pupil('three', [
          { code: 'ENG', marks: full(10) },
          { code: 'MAT', marks: full(10) },
          { code: 'SCI', marks: full(10) },
        ]),
        pupil('gap', [{ code: 'ENG', marks: { ...full(60), SE2: mark(5, null) } }]),
      ],
      CODES,
      CBSE,
    );
    const by = Object.fromEntries(rows.map((x) => [x.name, x]));
    expect(by.two).toMatchObject({ result: 'compartment', failed: ['ENG', 'MAT'] });
    expect(by.three).toMatchObject({ result: 'fail' });
    expect(by.gap).toMatchObject({ result: 'incomplete', total: null, rankInClass: null });
  });

  it('competition ranks: ties share a rank and the next is skipped', () => {
    const one = (name: string, term: number) =>
      pupil(name, [
        {
          code: 'ENG',
          marks: {
            MT1: mark(20, 20),
            MT2: mark(20, 20),
            SE1: mark(5, 5),
            SE2: mark(5, 5),
            TERM: mark(80, term),
          },
        },
      ]);
    const rows = computeScheme(
      VI,
      [one('a', 70), one('b', 65), one('c', 65), one('d', 50)],
      CODES,
      CBSE,
    );
    expect(rows.map((x) => [x.name, x.total, x.rankInClass, x.rankInSection])).toEqual([
      ['a', 90, 1, 1],
      ['b', 85, 2, 2],
      ['c', 85, 2, 2],
      ['d', 70, 4, 4],
    ]);
  });

  it('X: the Monday tests take what the theory leaves of 100; the additional subject stays out', () => {
    const X = preset('DPS_X', ['MT1', 'MT2', 'TERM']);
    const [r] = computeScheme(
      X,
      [
        pupil('x', [
          { code: 'ENG', marks: { MT1: mark(25, 20), MT2: mark(25, 25), TERM: mark(80, 60) } },
          { code: 'SST', marks: { MT1: mark(25, 25), MT2: mark(25, 25), TERM: mark(70, 50) } },
          {
            code: 'AI',
            kind: 'additional',
            marks: { MT1: mark(25, 25), MT2: mark(25, 25), TERM: mark(50, 50) },
          },
        ]),
      ],
      CODES,
      CBSE,
    );
    const by = Object.fromEntries(r!.subjects.map((x) => [x.code, x]));
    // English: 90 % of the 20 the theory leaves = 18; 18 + 60 = 78
    expect(by.ENG!.values.MT).toEqual({ v: 18, max: 20 });
    expect(by.ENG!.total).toBe(78);
    // Social science: 100 % of 30 = 30; + 50 = 80
    expect(by.SST!.values.MT).toEqual({ v: 30, max: 30 });
    expect(by.AI).toMatchObject({ total: 100, kind: 'additional' });
    expect(r).toMatchObject({ total: 158, max: 200, pct: 79 });
  });

  it('XI: theory and practical must each reach 33 %', () => {
    const XI = preset('DPS_XI', ['WT1', 'WT2', 'ASL', 'TERM']);
    // theory 60 + practical 20, ASL 10: the weekly tests take the 10 left of 100
    const term = (th: number, pr: number) =>
      mark(80, th + pr, { Theory: [60, th], Practical: [20, pr] });
    const rows = computeScheme(
      XI,
      [
        pupil('weak theory', [
          {
            code: 'PHY',
            marks: { WT1: mark(20, 20), WT2: mark(20, 20), ASL: mark(10, 10), TERM: term(18, 20) },
          },
        ]),
        pupil('both', [
          {
            code: 'PHY',
            marks: { WT1: mark(20, 10), WT2: mark(20, 10), ASL: mark(10, 5), TERM: term(40, 10) },
          },
        ]),
      ],
      CODES,
      CBSE,
    );
    const by = Object.fromEntries(rows.map((x) => [x.name, x]));
    expect(by['weak theory']!.subjects[0]!.values.WT).toEqual({ v: 10, max: 10 });
    // 58 of 100, but theory 18 of 60 is below 33 %
    expect(by['weak theory']!.subjects[0]).toMatchObject({ total: 58, max: 100, status: 'fail' });
    expect(by['weak theory']!.subjects[0]!.pct).toBeGreaterThan(33);
    expect(by.both!.subjects[0]).toMatchObject({ status: 'pass' });
  });

  it('attendance by slabs, and best of N', () => {
    const def: SchemeDef = {
      exams: [
        { key: 'A', examId: '1' },
        { key: 'B', examId: '2' },
      ],
      columns: [
        { key: 'A', label: 'A', kind: 'raw', exam: 'A' },
        { key: 'B', label: 'B', kind: 'raw', exam: 'B' },
        { key: 'BEST', label: 'Best (10)', kind: 'average', of: ['A', 'B'], best: 1, scale: 10 },
        { key: 'ATT', label: 'Attendance (5)', kind: 'attendance' },
        { key: 'TOT', label: 'Total', kind: 'sum', of: ['BEST', 'ATT'], total: true },
      ],
      attendance: [
        { minPct: 96, marks: 5 },
        { minPct: 91, marks: 4 },
        { minPct: 86, marks: 3 },
        { minPct: 81, marks: 2 },
        { minPct: 76, marks: 1 },
      ],
      result: { passPct: 33, compartmentUpTo: 0, rankBy: 'pct' },
    };
    expect(schemeProblems(def)).toEqual([]);
    const [r] = computeScheme(
      def,
      [
        pupil('a', [{ code: 'ENG', marks: { A: mark(20, 10), B: mark(20, 18) } }], {
          attendancePct: 92.5,
        }),
      ],
      CODES,
      CBSE,
    );
    expect(r!.subjects[0]!.values.BEST).toEqual({ v: 9, max: 10 });
    expect(r!.subjects[0]!.values.ATT).toEqual({ v: 4, max: 5 });
    expect(r!.subjects[0]!.total).toBe(13);
  });

  it('says what is wrong with a scheme', () => {
    expect(
      schemeProblems({
        exams: [{ key: 'A', examId: '1' }],
        columns: [
          { key: 'X', label: 'X', kind: 'average', of: ['Y'] },
          { key: 'Y', label: 'Y', kind: 'raw', exam: 'Z' },
        ],
        result: { passPct: 33, compartmentUpTo: 2, rankBy: 'total' },
      }),
    ).toEqual([
      'Column X: Y must come before it',
      "Column Y: choose one of the scheme's exams",
      'Mark exactly one column as the marks obtained',
    ]);
  });
});
