import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  computeRegister,
  countedColumns,
  cutFixed,
  defaultCodes,
  examView,
  newRegisterDef,
  noPaperMessage,
  orderStudents,
  properCase,
  registerProblems,
  subjectStanding,
  subjectsWithoutPaper,
  type PaperSubject,
  type RegColumn,
  type RegisterDef,
  type RegMark,
  type RegStudent,
  type RegSubject,
} from '../src/mark-register';

const mark = (
  max: number,
  v: number | string | null,
  parts?: Array<[string, number, number | null | 'AB']>,
): RegMark => ({
  max,
  marks: typeof v === 'number' ? v : null,
  code: typeof v === 'string' ? v : null,
  entered: v !== null,
  parts: (parts ?? []).map(([name, pmax, pv]) => ({
    name,
    max: pmax,
    marks: typeof pv === 'number' ? pv : null,
    absent: pv === 'AB',
    entered: pv !== null,
  })),
});

const pupil = (
  name: string,
  subjects: Array<{
    id: string;
    kind?: 'compulsory' | 'optional' | 'additional';
    marks: Record<string, RegMark>;
  }>,
  extra: Partial<RegStudent> = {},
): RegStudent => ({
  studentId: name,
  name,
  admissionNo: name,
  rollNo: null,
  sectionId: 'A',
  section: 'VI-A',
  attendance: {},
  subjects: subjects.map((x) => ({
    subjectId: x.id,
    code: x.id,
    name: x.id,
    kind: x.kind ?? 'compulsory',
    marks: x.marks,
  })),
  ...extra,
});

const reg = (
  subjects: RegSubject[],
  exams: string[],
  tweak: Partial<RegisterDef> = {},
): RegisterDef => {
  const d = newRegisterDef();
  return {
    ...d,
    exams: exams.map((key, i) => ({ key, examId: String(i + 1) })),
    codes: Object.fromEntries(exams.map((e) => [e, defaultCodes()])),
    subjects,
    ...tweak,
  };
};
const subject = (
  id: string,
  columns: RegColumn[],
  extra: Partial<RegSubject> = {},
): RegSubject => ({
  key: id,
  subjectId: id,
  columns,
  showTotal: true,
  round: 'none',
  grade: true,
  pct: true,
  ...extra,
});

describe('mark registers (docs/design/68)', () => {
  it("the guide's example: UT-1 + UT-2 summed, scaled to 100, then a 5 % weightage", () => {
    const eng = subject('ENG', [
      { key: 'U1', name: 'UT-1', kind: 'raw', exam: 'UT1', hidden: true },
      { key: 'U2', name: 'UT-2', kind: 'raw', exam: 'UT2', hidden: true },
      { key: 'S', name: 'Sum', kind: 'avg', mode: 'sum', of: ['U1', 'U2'], hidden: true },
      { key: 'H', name: '/100', kind: 'conv', source: 'S', method: 'scale', target: 100 },
      {
        key: 'W',
        name: '/5',
        kind: 'conv',
        source: 'H',
        method: 'weight',
        target: 5,
        inTotal: true,
      },
    ]);
    const def = reg([eng], ['UT1', 'UT2']);
    const [a, b] = computeRegister(def, [
      pupil('a', [{ id: 'ENG', marks: { UT1: mark(40, 40), UT2: mark(40, 40) } }]),
      pupil('b', [{ id: 'ENG', marks: { UT1: mark(40, 30), UT2: mark(40, 20) } }]),
    ]);
    expect(a!.subjects.ENG!.values.H).toMatchObject({ v: 100, max: 100 });
    expect(a!.subjects.ENG!.values.W).toMatchObject({ v: 5, max: 5 });
    expect(b!.subjects.ENG!.values.S).toMatchObject({ v: 50, max: 80 });
    expect(b!.subjects.ENG!.values.H).toMatchObject({ v: 62.5 });
    expect(b!.subjects.ENG!.values.W).toMatchObject({ v: 3.13 });
    expect(b!.subjects.ENG!).toMatchObject({ total: 3.13, max: 5, counted: ['W'] });
  });

  it('one total: a best-of and the tests it reads are not both counted; nothing ticked takes the ends of the chains', () => {
    const cols: RegColumn[] = [
      { key: 'P1', name: 'PT-1', kind: 'raw', exam: 'PT1', inTotal: true },
      { key: 'P2', name: 'PT-2', kind: 'raw', exam: 'PT2', inTotal: true },
      {
        key: 'B',
        name: 'Best',
        kind: 'avg',
        mode: 'best',
        best: 1,
        agg: 'avg',
        of: ['P1', 'P2'],
        inTotal: true,
      },
      { key: 'T', name: 'Term', kind: 'raw', exam: 'T', inTotal: true },
    ];
    expect(countedColumns(cols)).toEqual(['B', 'T']);
    expect(countedColumns(cols.map((c) => ({ ...c, inTotal: false })))).toEqual(['B', 'T']);
  });

  it('best of N skips a blank and drops a blocked test while enough are left; a real 0 counts', () => {
    const s = subject('SCI', [
      { key: 'P1', name: 'PT-1', kind: 'raw', exam: 'PT1', hidden: true },
      { key: 'P2', name: 'PT-2', kind: 'raw', exam: 'PT2', hidden: true },
      { key: 'P3', name: 'PT-3', kind: 'raw', exam: 'PT3', hidden: true },
      {
        key: 'B',
        name: 'Best 2',
        kind: 'avg',
        mode: 'best',
        best: 2,
        agg: 'sum',
        of: ['P1', 'P2', 'P3'],
        inTotal: true,
      },
    ]);
    const def = reg([s], ['PT1', 'PT2', 'PT3']);
    const rows = computeRegister(def, [
      pupil('ab', [
        { id: 'SCI', marks: { PT1: mark(25, 'AB'), PT2: mark(25, 24), PT3: mark(25, 19.5) } },
      ]),
      pupil('zero', [
        { id: 'SCI', marks: { PT1: mark(25, 0), PT2: mark(25, 10), PT3: mark(25, 5) } },
      ]),
      pupil('blank', [
        { id: 'SCI', marks: { PT1: mark(25, 20), PT2: mark(25, 18), PT3: mark(25, null) } },
      ]),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    // AB, 24, 19.5 → best 2 = 43.5, nothing withheld
    expect(by.ab!.subjects.SCI).toMatchObject({ total: 43.5, max: 50, withheld: false });
    expect(by.ab!.result).toBe('pass');
    expect(by.zero!.subjects.SCI!.total).toBe(15);
    // PT-3 not held yet: the best two of what is there, and nothing is missing
    expect(by.blank!.subjects.SCI).toMatchObject({ total: 38, missing: false });
  });

  it('codes: AB withholds the subject and the final; Sub from skip, one column or a blend; "show value *"', () => {
    const codes = defaultCodes().map((c) => (c.code === 'ML' ? { ...c, showValue: true } : c));
    const s = subject('MAT', [
      { key: 'U1', name: 'UT-1', kind: 'raw', exam: 'UT1', inTotal: true, subFrom: 'U2' },
      { key: 'U2', name: 'UT-2', kind: 'raw', exam: 'UT2', inTotal: true, subFrom: 'skip' },
      { key: 'T', name: 'Term', kind: 'raw', exam: 'T', inTotal: true },
    ]);
    const def = reg([s], ['UT1', 'UT2', 'T'], {
      codes: { UT1: codes, UT2: codes, T: defaultCodes() },
    });
    const rows = computeRegister(def, [
      pupil('ml1', [
        { id: 'MAT', marks: { UT1: mark(20, 'ML'), UT2: mark(20, 15), T: mark(80, 60) } },
      ]),
      pupil('ml2', [
        { id: 'MAT', marks: { UT1: mark(20, 10), UT2: mark(20, 'ML'), T: mark(80, 60) } },
      ]),
      pupil('ab', [
        { id: 'MAT', marks: { UT1: mark(20, 10), UT2: mark(20, 10), T: mark(80, 'AB') } },
      ]),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    // UT-1 from UT-2 only: 15/20 of 20 = 15, printed 15*
    expect(by.ml1!.subjects.MAT!.values.U1).toMatchObject({ v: 15, code: 'ML', star: true });
    expect(by.ml1!.subjects.MAT).toMatchObject({ total: 90, max: 120 });
    // UT-2 on skip: left out of the marks and the maximum
    expect(by.ml2!.subjects.MAT!.values.U2).toMatchObject({ v: null, max: 0, out: true });
    expect(by.ml2!.subjects.MAT).toMatchObject({ total: 70, max: 100, status: 'pass' });
    expect(by.ab!.subjects.MAT).toMatchObject({ total: null, withheld: true, status: 'absent' });
    expect(by.ab).toMatchObject({
      result: 'absent',
      total: null,
      rankInClass: null,
      withheldBy: ['MAT'],
    });
  });

  it('a slot: each student their own language, its own exam and conversion target', () => {
    const s: RegSubject = {
      key: 'L3',
      slot: { name: 'THIRD LANGUAGE', members: ['SAN', 'FRE'] },
      columns: [
        { key: 'T', name: 'Term', kind: 'raw', exam: 'T', hidden: true, memberExam: { FRE: 'TF' } },
        {
          key: 'C',
          name: 'Con',
          kind: 'conv',
          source: 'T',
          method: 'scale',
          target: 20,
          memberTarget: { FRE: 15 },
          inTotal: true,
        },
      ],
      showTotal: true,
    };
    const def = reg([s], ['T', 'TF']);
    const rows = computeRegister(def, [
      pupil('san', [{ id: 'SAN', marks: { T: mark(80, 60) } }]),
      pupil('fre', [{ id: 'FRE', marks: { T: mark(80, 10), TF: mark(50, 40) } }]),
      pupil('none', [{ id: 'ENG', marks: { T: mark(80, 60) } }]),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.san!.subjects.L3).toMatchObject({ code: 'SAN', total: 15, max: 20 });
    expect(by.fre!.subjects.L3).toMatchObject({ code: 'FRE', total: 12, max: 15 });
    expect(by.none!.subjects.L3).toBeUndefined();
  });

  it('parts: Physics / Chemistry / Biology summed; a class without a part leaves it out; an absent part counts 0', () => {
    const s = subject('SCI', [
      {
        key: 'PH',
        name: 'PHY',
        kind: 'part',
        exam: 'T',
        part: 'Physics',
        group: 'g',
        groupFoot: 'sum',
        hidden: true,
      },
      {
        key: 'CH',
        name: 'CHE',
        kind: 'part',
        exam: 'T',
        part: 'chemistry',
        group: 'g',
        groupFoot: 'sum',
        hidden: true,
      },
      {
        key: 'BI',
        name: 'BIO',
        kind: 'part',
        exam: 'T',
        part: 'Biology',
        group: 'g',
        groupFoot: 'sum',
        hidden: true,
      },
      {
        key: 'S',
        name: 'Term sum',
        kind: 'avg',
        mode: 'sum',
        of: ['PH', 'CH', 'BI'],
        inTotal: true,
      },
    ]);
    const def = reg([s], ['T']);
    const rows = computeRegister(def, [
      pupil('viii', [
        {
          id: 'SCI',
          marks: {
            T: mark(40, 30, [
              ['Physics', 14, 10],
              ['Chemistry', 13, 9],
              ['Biology', 13, 11],
            ]),
          },
        },
      ]),
      pupil('vi', [
        {
          id: 'SCI',
          marks: {
            T: mark(40, 30, [
              ['Physics', 20, 15],
              ['Biology', 20, 'AB'],
            ]),
          },
        },
      ]),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.name, r]));
    expect(by.viii!.subjects.SCI).toMatchObject({ total: 30, max: 40 });
    expect(by.vi!.subjects.SCI!.values.CH).toMatchObject({ out: true, max: 0 });
    // Biology absent: AB counts 0 and withholds
    expect(by.vi!.subjects.SCI).toMatchObject({ withheld: true, status: 'absent' });
  });

  it('total out of, "the rest" of it, rounding (.5 kept per column, .5 up for the final) and a grade per column', () => {
    const s = subject(
      'ENG',
      [
        { key: 'M', name: 'MT', kind: 'raw', exam: 'MT', hidden: true },
        {
          key: 'MC',
          name: 'MT (rest)',
          kind: 'conv',
          source: 'M',
          method: 'scale',
          target: 'rest',
          inTotal: true,
          round: true,
          grade: true,
        },
        { key: 'T', name: 'Theory', kind: 'raw', exam: 'T', inTotal: true },
      ],
      { totalOutOf: 100, round: 'keep' },
    );
    const def = reg([s], ['MT', 'T']);
    const [r] = computeRegister(def, [
      pupil('a', [{ id: 'ENG', marks: { MT: mark(40, 35), T: mark(70, 50) } }]),
    ]);
    // the rest of 100 after the theory's 70 = 30; 35/40 of 30 = 26.25 → 26
    expect(r!.subjects.ENG!.values.MC).toMatchObject({ v: 26, max: 30, grade: 'A2' });
    expect(r!.subjects.ENG).toMatchObject({ total: 76, max: 100, grade: 'B1' });
  });

  it('optional subjects: by the choices (additional out unless added) or by the register; a block there withholds only if asked', () => {
    const cols = (): RegColumn[] => [
      { key: 'T', name: 'Term', kind: 'raw', exam: 'T', inTotal: true },
    ];
    const subjects = [subject('ENG', cols()), subject('MUS', cols(), { countInFinal: false })];
    const kids = [
      pupil('a', [
        { id: 'ENG', marks: { T: mark(100, 70) } },
        { id: 'MUS', kind: 'additional', marks: { T: mark(100, 'AB') } },
      ]),
    ];
    const byChoices = computeRegister(reg(subjects, ['T']), kids)[0]!;
    expect(byChoices).toMatchObject({ total: 70, max: 100, result: 'pass' });
    expect(byChoices.subjects.MUS).toMatchObject({ inFinal: false, withheld: true });
    const blocks = reg(subjects, ['T']);
    blocks.final = { ...blocks.final, optionalBlocks: true };
    expect(computeRegister(blocks, kids)[0]).toMatchObject({ result: 'absent', total: null });
    const byRegister = reg(subjects, ['T']);
    byRegister.final = { ...byRegister.final, optionalMode: 'register' };
    expect(computeRegister(byRegister, kids)[0]!.subjects.MUS!.inFinal).toBe(false);
  });

  it('XI-XII: theory and practical must each reach the pass %', () => {
    const s = subject('PHY', [
      { key: 'TH', name: 'Theory', kind: 'part', exam: 'T', part: 'Theory', inTotal: true },
      { key: 'PR', name: 'Practical', kind: 'part', exam: 'T', part: 'Practical', inTotal: true },
    ]);
    const def = reg([s], ['T']);
    def.final = { ...def.final, partsEach: true };
    const [r] = computeRegister(def, [
      pupil('a', [
        {
          id: 'PHY',
          marks: {
            T: mark(100, 50, [
              ['Theory', 70, 20],
              ['Practical', 30, 30],
            ]),
          },
        },
      ]),
    ]);
    // 50 % overall, but theory 20/70 = 28.57 %
    expect(r!.subjects.PHY).toMatchObject({ pct: 50, status: 'fail' });
  });

  it('exam-wise: each subject on one exam, ranked on it', () => {
    const s = subject('ENG', [
      { key: 'P', name: 'PT-1', kind: 'raw', exam: 'PT1', inTotal: true },
      { key: 'T', name: 'Term', kind: 'raw', exam: 'T', inTotal: true },
    ]);
    const def = { ...reg([s], ['PT1', 'T']), type: 'examwise' as const };
    const kids = [
      pupil('a', [{ id: 'ENG', marks: { PT1: mark(20, 18), T: mark(80, 40) } }]),
      pupil('b', [{ id: 'ENG', marks: { PT1: mark(20, 10), T: mark(80, 70) } }]),
    ];
    const pt = computeRegister(def, kids, { exam: 'PT1' });
    expect(pt.map((r) => [r.name, r.total, r.max, r.rankInClass])).toEqual([
      ['a', 18, 20, 1],
      ['b', 10, 20, 2],
    ]);
    expect(examView(def, 'PT1').subjects[0]!.columns.find((c) => c.key === 'T')!.hidden).toBe(true);
  });

  it('attendance by slabs from the exam days (the % rounded as the old register did)', () => {
    const s = subject('ENG', [
      { key: 'T', name: 'Term', kind: 'raw', exam: 'T', inTotal: true },
      {
        key: 'A',
        name: 'Att',
        kind: 'attendance',
        exam: 'T',
        slabs: [
          { minPct: 96, marks: 5 },
          { minPct: 91, marks: 4 },
        ],
        inTotal: true,
      },
    ]);
    const [r] = computeRegister(reg([s], ['T']), [
      pupil('a', [{ id: 'ENG', marks: { T: mark(80, 60) } }], {
        attendance: { T: { present: 191, total: 200 } },
      }),
    ]);
    // 95.5 % → 96 → 5
    expect(r!.subjects.ENG!.values.A).toMatchObject({ v: 5, max: 5 });
    expect(r!.subjects.ENG).toMatchObject({ total: 65, max: 85 });
  });

  it('ranks 1, 1, 3; order by rank; numbers cut, not rounded; proper-case names', () => {
    const s = subject('ENG', [{ key: 'T', name: 'Term', kind: 'raw', exam: 'T', inTotal: true }]);
    const def = { ...reg([s], ['T']), order: 'rank' as const };
    const rows = computeRegister(def, [
      pupil('c', [{ id: 'ENG', marks: { T: mark(100, 60) } }]),
      pupil('a', [{ id: 'ENG', marks: { T: mark(100, 80) } }]),
      pupil('b', [{ id: 'ENG', marks: { T: mark(100, 80) } }]),
    ]);
    expect(orderStudents(def, rows).map((r) => [r.name, r.rankInSection])).toEqual([
      ['a', 1],
      ['b', 1],
      ['c', 3],
    ]);
    expect(cutFixed(4.75, 1)).toBe('4.7');
    expect(cutFixed(35, 2)).toBe('35.00');
    expect(cutFixed(35.5, 'auto')).toBe('35.5');
    expect(properCase('ABHISHEK VERMA')).toBe('Abhishek Verma');
  });

  it('says what is wrong: a missing exam, a source that is not there, a loop, a slot of one', () => {
    const def = reg(
      [
        subject('ENG', [
          { key: 'A', name: 'A', kind: 'raw', exam: 'X' },
          { key: 'B', name: 'B', kind: 'avg', mode: 'all', of: ['C'] },
          { key: 'C', name: 'C', kind: 'conv', source: 'B', method: 'scale', target: 10 },
          { key: 'D', name: 'D', kind: 'avg', mode: 'all', of: ['Z'] },
        ]),
        { key: 'L', slot: { name: 'LANG', members: ['SAN'] }, columns: [] },
      ],
      ['T'],
    );
    const p = registerProblems(def);
    expect(p).toEqual(
      expect.arrayContaining([
        "ENG · A: choose one of the register's exams",
        'ENG · D: Z is not a column of the subject',
        'ENG: a column is made from itself',
        'LANG: a slot needs a name and two or more subjects',
        'LANG: add its columns',
      ]),
    );
  });

  it('the builder preview runs the same engine (scripts/sync-mark-register.mjs)', () => {
    const db = readFileSync(join(__dirname, '../src/mark-register.ts'), 'utf8');
    const ui = readFileSync(join(__dirname, '../../ui/src/mark-register.ts'), 'utf8');
    expect(ui.split('\n').slice(1).join('\n')).toBe(db);
  });
});

describe('subjects without a paper of their own (docs/design/72)', () => {
  // exams 1 (PT1), 2 (PT2), 3 (ACT2); Social Science in parts Geography and History in PT1 and PT2;
  // Geography a paper of its own in ACT2 only; Japanese on the class list, no paper
  const subjects: PaperSubject[] = [
    {
      id: 'ENG',
      name: 'English',
      papers: [
        { examId: '1', parts: [] },
        { examId: '2', parts: [] },
      ],
    },
    {
      id: 'SST',
      name: 'Social Science',
      papers: [
        { examId: '1', parts: [{ subjectId: 'GEO' }, { subjectId: 'HIST' }] },
        { examId: '2', parts: [{ subjectId: 'GEO' }, { subjectId: 'HIST' }, { subjectId: null }] },
      ],
    },
    { id: 'GEO', name: 'Geography', papers: [{ examId: '3', parts: [] }] },
    { id: 'HIST', name: 'History', papers: [] },
    { id: 'JAPA', name: 'Japanese', papers: [] },
  ];

  it('tells a paper of its own from a part and from neither, in all exams or in some', () => {
    expect(subjectStanding(subjects, 'ENG')).toEqual({
      kind: 'own',
      ownExams: ['1', '2'],
      inside: [],
    });
    expect(subjectStanding(subjects, 'HIST')).toEqual({
      kind: 'part',
      ownExams: [],
      inside: ['SST'],
    });
    expect(subjectStanding(subjects, 'GEO')).toEqual({
      kind: 'own',
      ownExams: ['3'],
      inside: ['SST'],
    });
    expect(subjectStanding(subjects, 'GEO', ['1', '2']).kind).toBe('part');
    expect(subjectStanding(subjects, 'JAPA').kind).toBe('none');
    expect(subjectStanding(subjects, 'SST', ['3'])).toEqual({
      kind: 'none',
      ownExams: [],
      inside: [],
    });
  });

  it("lists the register's subjects without a paper in its exams, and says why", () => {
    const cols: RegColumn[] = [
      { key: 'PT1', name: 'PT1', kind: 'raw', exam: 'PT1' },
      { key: 'AV', name: 'Average', kind: 'avg', mode: 'all', of: [] },
    ];
    const def = reg(
      [
        subject('ENG', cols),
        subject('GEO', cols),
        subject('HIST', cols),
        subject('JAPA', cols),
        { key: 'L', slot: { name: 'LANG', members: ['HIST', 'JAPA'] }, columns: cols },
        { key: 'L2', slot: { name: 'LANG2', members: ['ENG', 'JAPA'] }, columns: cols },
      ],
      ['PT1', 'PT2'],
    );
    const list = subjectsWithoutPaper(def, subjects);
    expect(list).toEqual([
      { key: 'GEO', name: 'Geography', inside: ['Social Science'] },
      { key: 'HIST', name: 'History', inside: ['Social Science'] },
      { key: 'JAPA', name: 'Japanese', inside: [] },
      { key: 'L', name: 'LANG', inside: ['Social Science'] },
    ]);
    expect(noPaperMessage(list.slice(0, 2))).toBe(
      "Geography and History have no paper of their own in this register's exams: they are marked inside Social Science",
    );
    expect(noPaperMessage(list.slice(2, 3))).toBe("Japanese has no paper in this register's exams");
    expect(noPaperMessage([])).toBeNull();
    // with ACT2 read too, Geography has its own paper
    const withAct2 = { ...def, exams: [...def.exams, { key: 'ACT2', examId: '3' }] };
    expect(subjectsWithoutPaper(withAct2, subjects).map((x) => x.key)).toEqual([
      'HIST',
      'JAPA',
      'L',
    ]);
    // before the register reads an exam there is nothing to say
    expect(subjectsWithoutPaper({ ...def, exams: [] }, subjects)).toEqual([]);
  });

  it('an average with nothing to average says so', () => {
    const def = reg(
      [
        subject('ENG', [
          { key: 'A', name: 'A', kind: 'raw', exam: 'T' },
          { key: 'AV', name: 'average', kind: 'avg', mode: 'all', of: [] },
          { key: 'SU', name: 'Sum', kind: 'avg', mode: 'sum', of: [] },
        ]),
      ],
      ['T'],
    );
    expect(registerProblems(def)).toEqual(
      expect.arrayContaining([
        'ENG · average: nothing to average, choose the columns it is made from',
        'ENG · Sum: nothing to add up, choose the columns it is made from',
      ]),
    );
  });
});
