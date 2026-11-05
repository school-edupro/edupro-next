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
import { buildReport, type ReportInput } from '../src/mark-register-reports';

const mark = (v: number | string | null): RegMark => ({
  max: 100,
  marks: typeof v === 'number' ? v : null,
  code: typeof v === 'string' ? v : null,
  entered: v !== null,
  parts: [],
});
const pupil = (
  name: string,
  sec: 'A' | 'B',
  eng: number | string | null,
  mat: number | string | null,
): RegStudent => ({
  studentId: name,
  name,
  admissionNo: name,
  rollNo: null,
  sectionId: sec,
  section: `VI-${sec}`,
  attendance: {},
  subjects: [
    { subjectId: 'ENG', code: 'ENG', name: 'English', kind: 'compulsory', marks: { T: mark(eng) } },
    { subjectId: 'MAT', code: 'MAT', name: 'Maths', kind: 'compulsory', marks: { T: mark(mat) } },
  ],
});
const def: RegisterDef = (() => {
  const d = newRegisterDef();
  const col = () => [{ key: 'T', name: 'Term', kind: 'raw' as const, exam: 'T', inTotal: true }];
  return {
    ...d,
    exams: [{ key: 'T', examId: '1' }],
    codes: { T: defaultCodes() },
    subjects: [
      { key: 'ENG', subjectId: 'ENG', columns: col() },
      { key: 'MAT', subjectId: 'MAT', columns: col() },
    ],
    final: { ...d.final, compartmentUpTo: 1 },
    display: { ...d.display, properCase: false },
  };
})();
const students = [
  pupil('a1', 'A', 90, 85),
  pupil('a2', 'A', 30, 50),
  pupil('a3', 'A', 'AB', 60),
  pupil('a4', 'A', 35, 34),
  pupil('a5', 'A', 70, null),
  pupil('b1', 'B', 100, 70),
  pupil('b2', 'B', 20, 10),
  pupil('b3', 'B', 'ML', 80),
];
const rows = computeRegister(def, students);
const input = (merit: boolean, extra: Partial<ReportInput> = {}): ReportInput => ({
  def,
  rows: merit ? rows : rows.filter((r) => r.sectionId === 'A'),
  students: merit ? students : students.filter((s) => s.sectionId === 'A'),
  place: merit ? 'VI · all sections' : 'VI-A',
  merit,
  order: ['ENG', 'MAT'],
  titles: { ENG: 'English', MAT: 'Maths' },
  teachers: {
    'A|ENG': ['Mrs Rao'],
    'B|ENG': ['Mrs Rao'],
    'A|MAT': ['Mr Das'],
    'A|class': ['Ms Iyer'],
  },
  ...extra,
});
/** a table's cells by its first column */
const lines = (s: Sheet) =>
  Object.fromEntries(s.body.map((r) => [r.cells[0]!.t, r.cells.map((c) => c.t)]));

describe('mark register reports (docs/design/68, phase 2)', () => {
  it('result summary as the legacy prints it: the rules, the counts with % of those who appeared, a table per group', () => {
    const blocks = buildReport('summary', input(true));
    const [main] = blocks;
    expect(main!.title).toBe('Result Summary — 8 student(s), 6 appeared');
    expect(main!.sheet.note).toBe(
      'Fail = subject % below 33% · 1 failed = Compartment, more = Fail · AB = absent (not counted as fail) · ML, L, EX shown separately · optional subjects left out',
    );
    expect(main!.sheet.body.map((r) => r.cells.map((c) => c.t))).toEqual([
      ['Total students', '8', ''],
      ['Passed (no failure, no absence)', '4', '66.67%'],
      ['Failed in 1 subject — Compartment', '1', '16.67%'],
      ['Failed in 2 subjects — Fail', '1', '16.67%'],
      ['Absent in 1 subject', '1', '16.67%'],
      ['Medical leave / code in 1 subject', '1', '16.67%'],
      ['Marks not entered yet', '1', '16.67%'],
      ['Pass % (passed ÷ appeared)', '66.67%'],
    ]);
    // the pass % spans the last two columns
    expect(main!.sheet.body[7]!.cells[1]!.span).toBe(2);
    const by = Object.fromEntries(
      blocks.slice(1).map((b) => [b.title, b.sheet.body.map((r) => r.cells.map((c) => c.t))]),
    );
    expect(by['Failed in 2 subjects — Fail — 1']).toEqual([
      ['1', 'b2', 'VI-B', 'b2', 'ENGLISH (20%), MATHS (10%)', '30 / 200'],
    ]);
    expect(by['Absent in 1 subject — 1']).toEqual([['1', 'a3', 'VI-A', 'a3', 'ENGLISH (AB)', '–']]);
    expect(by['Medical leave / code in 1 subject — 1']).toEqual([
      ['1', 'b3', 'VI-B', 'b3', 'ENGLISH (ML)', '80 / 100'],
    ]);
    expect(by['Marks not entered yet — 1']).toEqual([['1', 'a5', 'VI-A', 'a5', 'MATHS', '']]);
    // a section's table has no Section column
    const sec = buildReport('summary', input(false))[1]!;
    expect(sec.sheet.head[0]!.map((c) => c.t)).toEqual([
      '#',
      'Student Name',
      'Adm No',
      'Subjects',
      'Final',
    ]);
  });

  it('analysis: bands, cumulative, highest, lowest, average and passing % by subject', () => {
    const [a] = buildReport('analysis', input(false));
    const heads = a!.sheet.head[1]!.map((c) => c.t);
    expect(heads.slice(0, 3)).toEqual(['0-32', '33-40', '40-50']);
    const eng = lines(a!.sheet).English!;
    // takers 5 (a1-a5), absent 1 (a3), appeared 4 (a5 has English): 90, 30, 35, 70
    expect(eng.slice(1, 4)).toEqual(['5', '1', '4']);
    // bands 0-32: 30 · 33-40: 35 · 70-80: 70 · 90-100: 90
    expect(eng.slice(4, 12)).toEqual(['1', '1', '0', '0', '0', '1', '0', '1']);
    expect(eng.slice(-4)).toEqual(['90 / 100', '30', '56.25', '75.00']);
    // a count opens its students with the subject's marks
    const band = a!.sheet.body[0]!.cells[11]!;
    expect(band.drill).toEqual({
      title: 'English · 90-100',
      cols: ['#', 'Name', 'Adm No', 'Marks', '%'],
      rows: [['1', 'a1', 'a1', '90 / 100', '90%']],
    });
  });

  it('entry status as the legacy prints it: subjects by exam with a badge, who is pending, the share at the foot', () => {
    const [s] = buildReport('entry', input(false));
    expect(s!.title).toBe('Marks Entry Status — VI-A');
    expect(s!.sheet.head[0]!.map((c) => c.t)).toEqual(['#', 'Subject', 'Teacher', 'Students', 'T']);
    const mat = s!.sheet.body.find((r) => r.cells[1]!.t === 'MATHS')!.cells;
    expect(mat.map((c) => c.t)).toEqual(['2', 'MATHS', 'Mr Das', '5', '4 / 5']);
    expect(mat[4]!.badge).toEqual({ label: 'Partial', tone: 'warning' });
    expect(mat[4]!.drillLabel).toBe('1 pending');
    expect(mat[4]!.drill!.rows).toEqual([['1', 'a5', 'a5', '']]);
    expect(s!.sheet.body[0]!.cells[4]!.badge!.label).toBe('Complete');
    // every subject of the exam: 9 of 10 entered
    expect(s!.sheet.foot!.map((c) => c.t)).toEqual(['All subjects', '90% (9 / 10)']);
    expect(s!.sheet.note).toContain('Entered = any mark (0 included) or code (AB, ML …)');
    // a class: each section's table in turn (the same exams), then the sections against the subjects
    const [a, b, g, more] = buildReport('entry', input(true));
    expect([a!.title, b!.title, g!.title]).toEqual([
      'Marks Entry Status — VI-A',
      'Marks Entry Status — VI-B',
      'Marks Entry Status — VI · all sections (% entered, every exam)',
    ]);
    expect(more).toBeUndefined();
    expect(a!.sheet.body.map((r) => r.cells.map((c) => c.t))).toEqual(
      s!.sheet.body.map((r) => r.cells.map((c) => c.t)),
    );
    expect(a!.sheet.body[1]!.cells[4]!.drill!.title).toBe('MATHS · VI-A · T · pending');
    expect(b!.sheet.head).toEqual(a!.sheet.head);
    expect(b!.sheet.foot!.map((c) => c.t)).toEqual(['All subjects', '100% (6 / 6)']);
    expect(b!.sheet.note).toContain('Entered = any mark');
    expect(lines(g!.sheet)['VI-A']).toEqual(['VI-A', '100%', '80%']);
    expect(lines(g!.sheet)['VI-B']).toEqual(['VI-B', '100%', '100%']);
  });

  it('toppers as the legacy prints them: overall top N with ties and positions, each section’s top 3, subject toppers', () => {
    const [top, secA, , subjects] = buildReport('toppers', input(true, { top: 2 }));
    expect(top!.title).toBe('Overall Toppers — Top 2 of the class · by Final Total');
    expect(top!.sheet.body.map((r) => [r.cells[0]!.badge!.label, r.cells[1]!.t])).toEqual([
      ['1', 'a1'],
      ['2', 'b1'],
    ]);
    expect(top!.sheet.body[0]!.cells.slice(4).map((c) => c.t)).toEqual([
      '175 / 200',
      '87.5%',
      'A2',
    ]);
    expect(top!.sheet.body[0]!.cells[4]!.ratio).toBe(true);
    expect(secA!.title).toBe('Top 3 of VI-A · by Final Total');
    const eng = subjects!.sheet.body.find((r) => r.cells[0]!.t === 'ENGLISH')!.cells;
    expect(eng.map((c) => c.t)).toEqual(['ENGLISH', 'b1', 'VI-B', 'b1', '100 / 100', '100%']);
    expect(eng[1]!.badge).toEqual({ label: 'Full marks', tone: 'success' });
  });

  it('teacher-wise as the legacy prints it: a block per teacher with their classes and a total; no teacher last', () => {
    const blocks = buildReport('teacher', input(true));
    expect(blocks.map((b) => b.title)).toEqual(['MR DAS', 'MRS RAO', 'NO TEACHER MAPPED']);
    expect(blocks[0]!.sheet.note).toContain('Teacher = the teacher assignments');
    const rao = blocks[1]!.sheet;
    expect(rao.body.map((r) => r.cells.map((c) => c.t))).toEqual([
      ['VI-A', 'ENGLISH', '5', '4', '56.25%', '75%', '90', '1'],
      ['VI-B', 'ENGLISH', '3', '2', '60%', '50%', '100', '1'],
    ]);
    expect(rao.foot!.map((c) => c.t)).toEqual([
      'Total — 2 classes',
      '8',
      '6',
      '57.5%',
      '66.67%',
      '',
      '2',
    ]);
    expect(blocks[2]!.sheet.body.map((r) => r.cells[1]!.t)).toEqual(['MATHS']);
  });

  it('at-risk: failing high, compartment medium, borderline and absent to watch; counts by subject', () => {
    const [list, bySubject] = buildReport('risk', input(false, { margin: 5 }));
    expect(list!.sheet.body.map((r) => `${r.cells[0]!.t} ${r.cells[1]!.t}`)).toEqual([
      'Medium a2',
      'Watch a3',
      'Watch a4',
    ]);
    expect(list!.sheet.body[2]!.cells[2]!.t).toBe(
      'ENG 35.00% (borderline), MAT 34.00% (borderline)',
    );
    expect(lines(bySubject!.sheet).English).toEqual(['English', '1', '1', '1']);
  });

  it('failing students: each failing subject with its %, NIL for a section where nobody fails', () => {
    const [f] = buildReport('failing', input(true));
    expect(f!.sheet.body.map((r) => r.cells.map((c) => c.t).slice(0, 4))).toEqual([
      ['VI-A', 'a2', 'English (ENG)', '30.00'],
      ['VI-B', 'b2', 'English (ENG)', '20.00'],
      ['', '', 'Maths (MAT)', '10.00'],
    ]);
    const [one] = buildReport(
      'failing',
      input(false, { rows: rows.filter((r) => r.sectionId === 'B' && r.studentId !== 'b2') }),
    );
    expect(one!.sheet.body[0]!.cells[1]!.t).toBe('NIL');
  });

  it('compare sections as the legacy prints it: the overall result by section and class (best ▲), then by subject', () => {
    const [overall, c] = buildReport('compare', input(true));
    expect(overall!.band).toBe(false);
    expect(overall!.sheet.head[0]!.map((h) => h.t)).toEqual([
      'Overall result',
      'VI-A',
      'VI-B',
      'Class',
    ]);
    expect(overall!.sheet.body.map((r) => r.cells.map((x) => x.t))).toEqual([
      ['Students', '5', '3', '8'],
      ['Appeared', '3', '3', '6'],
      ['Average Final %', '54%', '60% ▲', '57%'],
      ['Pass % (Result PASS ÷ appeared)', '66.67% ▲', '66.67% ▲', '66.67%'],
      ['Compartment (1 failed)', '1', '0', '1'],
      ['Fail (more than 1 failed)', '0', '1', '1'],
      ['Absent (final withheld)', '1', '0', '1'],
    ]);
    // the class column in amber
    expect(overall!.sheet.body[0]!.cells[3]!.tone).toBe('final');
    const eng = lines(c!.sheet).ENGLISH!;
    // VI-A English average (90 + 30 + 35 + 70) / 4 = 56.25; VI-B (100 + 20) / 2 = 60 (b3 left out)
    expect(eng.slice(1)).toEqual([
      '56.25%',
      '75%',
      '90',
      '60% ▲',
      '50%',
      '100',
      '57.5%',
      '66.67%',
      '100',
    ]);
    expect(buildReport('compare', input(false))[0]!.sheet.body[0]!.cells[0]!.t).toContain(
      'all sections',
    );
  });
});
