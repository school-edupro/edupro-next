import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  arrange,
  buildGradeSheet,
  buildStudentWise,
  gradeAnalysis,
  gradeAnalysisAll,
  gradeStats,
  gradeSummary,
  gradeProblems,
  newGradeDef,
  overallOf,
  properName,
  scaleFromLevels,
  type GradeRegisterDef,
  type GradeTree,
} from '../src/grade-register';

/** Grade registers (docs/design/69): the legacy Grade Register's rules. */
const tree: GradeTree = {
  areas: [
    { key: 'co-scholastic', name: 'Co-scholastic' },
    { key: 'discipline', name: 'Discipline' },
  ],
  leaves: [
    {
      id: '1',
      name: 'Work education',
      description: null,
      area: 'Co-scholastic',
      itemId: null,
      itemName: null,
      setName: 'S',
    },
    {
      id: '2',
      name: 'Art',
      description: 'Drawing',
      area: 'Co-scholastic',
      itemId: null,
      itemName: null,
      setName: 'S',
    },
    {
      id: '11',
      name: 'Listens',
      description: null,
      area: 'Discipline',
      itemId: '10',
      itemName: 'Conduct',
      setName: 'S',
    },
    {
      id: '12',
      name: 'Neat work',
      description: null,
      area: 'Discipline',
      itemId: '10',
      itemName: 'Conduct',
      setName: 'S',
    },
  ],
};
const def = (over: Partial<GradeRegisterDef> = {}): GradeRegisterDef => ({
  ...newGradeDef(),
  exams: [{ examId: 'e1', label: 'T1' }],
  ...over,
});

describe('grade register engine', () => {
  it('arranges areas, items and indicators in the register order, without what is left out', () => {
    const a = arrange(tree, def());
    expect(a.map((x) => x.name)).toEqual(['Co-scholastic', 'Discipline']);
    expect(a[1]!.items).toMatchObject([{ key: '10', name: 'Conduct', single: false }]);
    const b = arrange(
      tree,
      def({
        exLeaves: ['2'],
        order: { areas: ['discipline'], items: {}, leaves: { '10': ['12', '11'] } },
      }),
    );
    expect(b.map((x) => x.key)).toEqual(['discipline', 'co-scholastic']);
    expect(b[0]!.items[0]!.leaves.map((l) => l.id)).toEqual(['12', '11']);
    expect(b[1]!.items.map((x) => x.key)).toEqual(['1']);
    expect(arrange(tree, def({ exAreas: ['co-scholastic', 'discipline'] }))).toEqual([]);
  });

  it('Overall: the most frequent grade (a tie: higher in the scale, then A→Z), or by points', () => {
    const scale = [
      { g: 'A', p: 3 },
      { g: 'B', p: 2 },
      { g: 'C', p: 1 },
    ];
    expect(overallOf(['B', 'a', 'B', ' ', 'B'], def({ overall: 'mode', scale }))).toBe('B');
    // a tie (A and a count as one): the better grade, printed as first given
    expect(overallOf(['B', 'a', 'A', 'B'], def({ overall: 'mode', scale }))).toBe('a');
    // a tie goes to the better grade of the scale
    expect(overallOf(['C', 'A'], def({ overall: 'mode', scale }))).toBe('A');
    // without a scale: A→Z
    expect(overallOf(['C', 'B'], def({ overall: 'mode' }))).toBe('B');
    // points: (3 + 2 + 2) / 3 = 2.33 → B; grades off the scale are left out
    expect(overallOf(['A', 'B', 'B', 'X'], def({ overall: 'points', scale }))).toBe('B');
    // 2.5 is as near B as A: the higher points
    expect(overallOf(['A', 'B'], def({ overall: 'points', scale }))).toBe('A');
    expect(overallOf(['', ' '], def({ overall: 'mode', scale }))).toBeNull();
    expect(overallOf(['A'], def({ overall: 'off', scale }))).toBeNull();
  });

  it('a scale from levels: letters best first, words lowest first', () => {
    expect(scaleFromLevels(['A', 'B', 'C'])).toEqual([
      { g: 'A', p: 3 },
      { g: 'B', p: 2 },
      { g: 'C', p: 1 },
    ]);
    expect(scaleFromLevels(['Beginner', 'Progressing', 'Proficient']).map((x) => x.g)).toEqual([
      'Proficient',
      'Progressing',
      'Beginner',
    ]);
  });

  it('what keeps a register from being saved', () => {
    expect(gradeProblems(def({ exams: [] }))).toContain('Choose at least one assessment');
    expect(gradeProblems(def({ overall: 'points', scale: [{ g: 'A', p: 1 }] }))).toContain(
      'The points rule needs two or more grades with points',
    );
    expect(gradeProblems(def({ exAreas: ['co-scholastic', 'discipline'] }), tree)).toContain(
      'Tick at least one indicator',
    );
    expect(gradeProblems(def(), tree)).toEqual([]);
  });

  it('the class sheet: area, indicator, item and term headers; grades, blanks and the Overall', () => {
    const d = def({
      exams: [
        { examId: 'e1', label: 'T1' },
        { examId: 'e2', label: 'T2' },
      ],
      overall: 'mode',
      blankText: '-',
      labels: { '11': 'Listens well' },
    });
    const [sheet] = buildGradeSheet({
      place: 'VI-A',
      areas: arrange(tree, d),
      def: d,
      exams: [
        { examId: 'e1', label: 'T1', name: 'Term 1' },
        { examId: 'e2', label: 'T2', name: 'Term 2' },
      ],
      students: [{ id: 's1', name: 'ASHA VERMA', adm: 'A1', roll: 1 }],
      grade: (leaf, exam) =>
        exam === 'e1' ? { '1': 'A', '2': 'B', '11': 'B', '12': 'B' }[leaf] : undefined,
    });
    expect(sheet!.head).toHaveLength(4);
    expect(sheet!.head[0]!.map((c) => [c.t, c.span ?? 1])).toEqual([
      ['Sr', 1],
      ['Adm No', 1],
      ['Roll No', 1],
      ['Student', 1],
      ['Co-scholastic', 6],
      ['Discipline', 6],
    ]);
    // items rated themselves take two rows; a heading spans its items; Overall after each area
    expect(sheet!.head[1]!.map((c) => c.t)).toEqual([
      'Work education',
      'Art',
      'Overall',
      'Conduct',
      'Overall',
    ]);
    expect(sheet!.head[2]!.map((c) => c.t)).toEqual(['Listens well', 'Neat work']);
    expect(sheet!.head[3]!.map((c) => c.t)).toEqual(Array(6).fill(['T1', 'T2']).flat());
    expect(sheet!.body[0]!.cells.map((c) => c.t)).toEqual([
      '1',
      'A1',
      '1',
      'Asha Verma',
      'A',
      '-',
      'B',
      '-',
      'A',
      '-',
      'B',
      '-',
      'B',
      '-',
      'B',
      '-',
    ]);
    expect(sheet!.note).toBe('T1 = Term 1 · T2 = Term 2');
    expect(sheet!.widths).toHaveLength(16);
  });

  it('numbered headers come with a legend table', () => {
    const d = def({ descHeader: 'number' });
    const out = buildGradeSheet({
      place: 'VI-A',
      areas: arrange(tree, d),
      def: d,
      exams: [{ examId: 'e1', label: 'T1', name: 'Term 1' }],
      students: [],
      grade: () => undefined,
    });
    expect(out[0]!.head[1]!.map((c) => c.t)).toEqual(['D1', 'D2', 'Conduct']);
    expect(out[1]!.title).toBe('Legend');
    expect(out[1]!.body.map((r) => r.cells[0]!.t)).toEqual(['D1', 'D2', 'D3', 'D4']);
  });

  const runInput = () => {
    const d = def({
      overall: 'mode',
      blankText: '-',
      scale: [
        { g: 'A', p: 2 },
        { g: 'B', p: 1 },
      ],
    });
    const grades: Record<string, string> = {
      '1|s1': 'A',
      '2|s1': 'B',
      '11|s1': 'B',
      '1|s2': 'B',
      '11|s2': 'B',
    };
    return {
      place: 'VI-A',
      areas: arrange(tree, d),
      def: d,
      exams: [{ examId: 'e1', label: 'T1', name: 'Term 1' }],
      students: [
        { id: 's1', name: 'Asha', adm: 'A1', roll: 1 },
        { id: 's2', name: 'Bhanu', adm: 'A2', roll: 2 },
      ],
      grade: (leaf: string, _exam: string, st: string) => grades[`${leaf}|${st}`],
    };
  };

  it('student-wise: a table per student, the area and indicator once, the Overall row', () => {
    const out = buildStudentWise(runInput(), (st) => `VI-A · ${st.name}`);
    expect(out.map((x) => [x.place, x.title])).toEqual([
      ['VI-A · Asha', '1. Asha · Adm A1 · Roll 1'],
      ['VI-A · Bhanu', '2. Bhanu · Adm A2 · Roll 2'],
    ]);
    expect(out[0]!.body.map((r) => r.cells.map((c) => c.t))).toEqual([
      ['Co-scholastic', 'Work education', '', 'A'],
      ['', 'Art', 'Drawing', 'B'],
      ['', 'Overall — Co-scholastic', 'A'],
      ['Discipline', 'Conduct', 'Listens', 'B'],
      ['', '', 'Neat work', '-'],
      ['', 'Overall — Discipline', 'B'],
    ]);
  });

  it('the Grade summary counts each grade, the blanks and opens the students', () => {
    const sum = gradeSummary(runInput());
    expect(sum.head[0]!.map((c) => c.t)).toEqual([
      'Area',
      'Indicator',
      'Description',
      'A',
      'B',
      'Blank',
      'Students',
    ]);
    const work = sum.body[0]!.cells;
    expect(work.map((c) => c.t)).toEqual([
      'Co-scholastic',
      'Work education',
      '',
      '1',
      '1',
      '0',
      '2',
    ]);
    expect(work[3]!.drill!.rows).toEqual([['1', 'Asha', 'A1', '1']]);
  });

  it('the Analysis: % of the grades given per area, indicator and Overall; every section side by side', () => {
    const an = gradeAnalysis(runInput());
    // Co-scholastic: A 1, B 2 of 3 given (Bhanu's Art blank)
    expect(an.body[0]!.cells.map((c) => c.t)).toEqual([
      'Co-scholastic',
      '33.3% (1)',
      '66.7% (2)',
      '3',
      '1',
    ]);
    const all = gradeAnalysisAll(
      'VI',
      [
        { place: 'VI-A', stats: gradeStats(runInput()) },
        { place: 'VI-B', stats: null },
      ],
      [{ label: 'T1' }],
    );
    expect(all.head[0]!.map((c) => c.t)).toEqual(['Area', 'VI-A', 'VI-B']);
    expect(all.body[0]!.cells.map((c) => c.t)).toEqual([
      'Co-scholastic',
      'B 66.7% · A 33.3% (3)',
      'could not be read',
    ]);
  });

  it('proper case only for names typed all in capitals or all small', () => {
    expect(properName("ANITA D'SOUZA")).toBe("Anita D'Souza");
    expect(properName('Rudra McKay')).toBe('Rudra McKay');
  });

  it('the builder preview runs the same engine (scripts/sync-mark-register.mjs)', () => {
    const db = readFileSync(join(__dirname, '../src/grade-register.ts'), 'utf8');
    const ui = readFileSync(join(__dirname, '../../ui/src/grade-register.ts'), 'utf8');
    expect(ui.split('\n').slice(1).join('\n')).toBe(db);
  });
});
