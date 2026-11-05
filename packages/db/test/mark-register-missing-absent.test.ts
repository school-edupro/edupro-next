import { describe, expect, it } from 'vitest';
import {
  computeRegister,
  defaultCodes,
  newRegisterDef,
  type RegisterDef,
  type RegMark,
  type RegStudent,
  type Sheet,
} from '../src/mark-register';
import { REPORTS, buildReport, type ReportInput } from '../src/mark-register-reports';

/** a paper: a mark, a code, or nothing entered (null); parts: [name, mark | 'AB' | null] */
const mark = (
  v: number | string | null,
  parts: Array<[string, number | 'AB' | null]> = [],
): RegMark => ({
  max: 50,
  marks: typeof v === 'number' ? v : null,
  code: typeof v === 'string' ? v : null,
  entered: v !== null,
  parts: parts.map(([name, m]) => ({
    name,
    max: 25,
    marks: typeof m === 'number' ? m : null,
    absent: m === 'AB',
    entered: m !== null,
  })),
});
type Subj = RegStudent['subjects'][number];
const subj = (id: string, name: string, marks: Subj['marks']): Subj => ({
  subjectId: id,
  code: id,
  name,
  kind: 'compulsory',
  marks,
});
const pupil = (name: string, sec: 'A' | 'B', roll: number, subjects: Subj[]): RegStudent => ({
  studentId: name,
  name,
  admissionNo: `ADM-${name}`,
  rollNo: roll,
  sectionId: sec,
  section: `VI-${sec}`,
  attendance: {},
  subjects,
});
const def: RegisterDef = (() => {
  const d = newRegisterDef();
  const cols = () => [
    { key: 'PT', name: 'PT', kind: 'raw' as const, exam: 'PT', inTotal: true },
    { key: 'T', name: 'Term', kind: 'raw' as const, exam: 'T', inTotal: true },
  ];
  return {
    ...d,
    exams: [
      { key: 'PT', examId: '1' },
      { key: 'T', examId: '2' },
    ],
    codes: { PT: defaultCodes(), T: defaultCodes() },
    subjects: [
      { key: 'ENG', subjectId: 'ENG', columns: cols() },
      { key: 'SST', subjectId: 'SST', columns: cols() },
      { key: 'LANG', slot: { name: 'LANGUAGE', members: ['HIN', 'FRE'] }, columns: cols() },
    ],
    display: { ...d.display, properCase: false },
  };
})();
const parts = (g: number | 'AB' | null, h: number | 'AB' | null) =>
  mark(null, [
    ['Geography', g],
    ['History', h],
  ]);
const students = [
  // absent in English PT and in Geography at the term; everything entered
  pupil('a1', 'A', 1, [
    subj('ENG', 'English', { PT: mark('AB'), T: mark(40) }),
    subj('SST', 'Social Science', { PT: mark(30), T: parts('AB', 20) }),
    subj('HIN', 'Hindi', { PT: mark(30), T: mark(35) }),
  ]),
  // English term missing, History missing; French PT on medical leave (not absent)
  pupil('a2', 'A', 2, [
    subj('ENG', 'English', { PT: mark(30), T: mark(null) }),
    subj('SST', 'Social Science', { PT: mark(28), T: parts(20, null) }),
    subj('FRE', 'French', { PT: mark('ML'), T: mark(30) }),
  ]),
  // does not take Social Science
  pupil('a3', 'A', 3, [
    subj('ENG', 'English', { PT: mark(35), T: mark(45) }),
    subj('HIN', 'Hindi', { PT: mark(30), T: mark(35) }),
  ]),
  // English PT missing, Hindi term absent
  pupil('b1', 'B', 1, [
    subj('ENG', 'English', { PT: mark(null), T: mark(40) }),
    subj('SST', 'Social Science', { PT: mark(30), T: parts(20, 20) }),
    subj('HIN', 'Hindi', { PT: mark(30), T: mark('AB') }),
  ]),
];
const rows = computeRegister(def, students);
const input = (merit: boolean, extra: Partial<ReportInput> = {}): ReportInput => ({
  def,
  rows: merit ? rows : rows.filter((r) => r.sectionId === 'A'),
  students: merit ? students : students.filter((s) => s.sectionId === 'A'),
  place: merit ? 'VI · all sections' : 'VI-A',
  merit,
  order: ['ENG', 'SST', 'LANG'],
  titles: { ENG: 'English', SST: 'Social Science', LANG: 'LANGUAGE' },
  teachers: { 'A|ENG': ['Mrs Rao'], 'B|ENG': ['Mr Sen'], 'A|class': ['Ms Iyer'] },
  parents: { a1: 'F 9800000001 · M 9700000001', b1: 'F 9800000002' },
  ...extra,
});
const cells = (s: Sheet) => s.body.map((r) => r.cells.map((c) => c.t));
const heads = (s: Sheet) => s.head[0]!.map((c) => c.t);

describe('missing marks and absent students (docs/design/78)', () => {
  it('are on the Reports menu', () => {
    expect(REPORTS.map((r) => r.kind)).toEqual(expect.arrayContaining(['missing', 'absent']));
  });

  it('missing: the papers per section and exam, then a line per subject × exam with its teacher and names', () => {
    const [counts, a, b] = buildReport('missing', input(true));
    expect(heads(counts!.sheet)).toEqual(['Section', 'PT', 'T', 'Total']);
    expect(cells(counts!.sheet)).toEqual([
      ['VI-A', '0', '2', '2'],
      ['VI-B', '1', '0', '1'],
      ['Class', '1', '2', '3'],
    ]);
    // the count's students open on a click: who, and what is missing
    const t = counts!.sheet.body[0]!.cells[2]!;
    expect(t.drillLabel).toBe('1 student');
    expect(t.drill!.rows).toEqual([
      ['1', 'a2', 'ADM-a2', 'VI-A', 'T: ENGLISH, SOCIAL SCIENCE (History)'],
    ]);
    expect(counts!.sheet.note).toContain('a code (AB, ML …) counts as entered');
    expect(a!.title).toBe('Missing marks — VI-A');
    expect(heads(a!.sheet)).toEqual([
      '#',
      'Subject',
      'Exam',
      'Teacher',
      'Missing / takers',
      'Students',
    ]);
    // Social Science's takers are the two who take it; a missing part is named
    expect(cells(a!.sheet)).toEqual([
      ['1', 'ENGLISH', 'T', 'Mrs Rao', '1 / 3', '2 a2'],
      ['2', 'SOCIAL SCIENCE', 'T', 'no teacher mapped', '1 / 2', '2 a2 (History)'],
    ]);
    expect(a!.sheet.note).toContain('Class teacher: Ms Iyer');
    expect(cells(b!.sheet)).toEqual([['1', 'ENGLISH', 'PT', 'Mr Sen', '1 / 1', '1 b1']]);
  });

  it('missing: one exam, one subject, nothing missing', () => {
    const [counts, a] = buildReport('missing', input(false, { exam: 'PT' }));
    expect(heads(counts!.sheet)).toEqual(['Section', 'PT', 'Total']);
    expect(cells(counts!.sheet)).toEqual([['VI-A', '0', '0']]);
    expect(cells(a!.sheet)[0]![1]).toBe('Nothing missing');
    expect(counts!.sheet.note).toMatch(/^exam PT/);
    const sst = buildReport('missing', input(true, { subject: 'SST', order: ['SST'] }));
    expect(cells(sst[1]!.sheet)).toEqual([
      ['1', 'SOCIAL SCIENCE', 'T', 'no teacher mapped', '1 / 2', '2 a2 (History)'],
    ]);
    expect(cells(sst[2]!.sheet)[0]![1]).toBe('Nothing missing');
  });

  it('absent: AB on a paper or a part, per section and exam; a line per student with parents and class teacher', () => {
    const [counts, a, b] = buildReport('absent', input(true));
    expect(heads(counts!.sheet)).toEqual(['Section', 'PT', 'T', 'Students', 'Papers']);
    // ML (medical leave) is not absent
    expect(cells(counts!.sheet)).toEqual([
      ['VI-A', '1', '1', '1', '2'],
      ['VI-B', '0', '1', '1', '1'],
      ['Class', '1', '2', '2', '3'],
    ]);
    expect(counts!.sheet.body[2]!.cells[3]!.drill!.rows).toEqual([
      ['1', 'a1', 'ADM-a1', 'VI-A', 'PT: ENGLISH · T: SOCIAL SCIENCE (Geography)'],
      ['2', 'b1', 'ADM-b1', 'VI-B', 'T: HINDI'],
    ]);
    expect(a!.title).toBe('Absent — VI-A (1 student)');
    expect(heads(a!.sheet)).toEqual([
      'Roll',
      'Student',
      'Adm No',
      'Parent mobile',
      'Class teacher',
      'Absent in',
      'Papers',
    ]);
    expect(cells(a!.sheet)).toEqual([
      [
        '1',
        'a1',
        'ADM-a1',
        'F 9800000001 · M 9700000001',
        'Ms Iyer',
        'PT: ENGLISH · T: SOCIAL SCIENCE (Geography)',
        '2',
      ],
    ]);
    // a slot prints the student's own language
    expect(cells(b!.sheet)).toEqual([['1', 'b1', 'ADM-b1', 'F 9800000002', '', 'T: HINDI', '1']]);
  });

  it('absent: one exam, one subject, nobody absent', () => {
    const pt = buildReport('absent', input(true, { exam: 'PT' }));
    expect(cells(pt[0]!.sheet)).toEqual([
      ['VI-A', '1', '1', '1'],
      ['VI-B', '0', '0', '0'],
      ['Class', '1', '1', '1'],
    ]);
    expect(pt[2]!.title).toBe('Absent — VI-B');
    expect(cells(pt[2]!.sheet)[0]![1]).toBe('Nobody absent');
    const lang = buildReport('absent', input(true, { subject: 'LANG', order: ['LANG'] }));
    expect(cells(lang[1]!.sheet)[0]![1]).toBe('Nobody absent');
    expect(cells(lang[2]!.sheet)).toEqual([
      ['1', 'b1', 'ADM-b1', 'F 9800000002', '', 'T: HINDI', '1'],
    ]);
  });
});
