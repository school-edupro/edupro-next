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
  teachers: { 'A|ENG': 'Mrs Rao', 'B|ENG': 'Mrs Rao', 'A|MAT': 'Mr Das' },
  ...extra,
});
/** a table's cells by its first column */
const lines = (s: Sheet) =>
  Object.fromEntries(s.body.map((r) => [r.cells[0]!.t, r.cells.map((c) => c.t)]));

describe('mark register reports (docs/design/68, phase 2)', () => {
  it('result summary: who passed, the compartment, failed, absent, not entered; failed and absent in N; leave', () => {
    const [main, failedIn, absentIn, leave] = buildReport('summary', input(true));
    const m = lines(main!.sheet);
    expect(m.Students![1]).toBe('8');
    expect(m['Appeared (a final)']![1]).toBe('6');
    expect(m.Passed![1]).toBe('4');
    expect(m['Compartment (failed in 1–1)']![1]).toBe('1');
    expect(m.Failed![1]).toBe('1');
    expect(m['Absent (final withheld)']![1]).toBe('1');
    expect(m['Marks not entered yet']![1]).toBe('1');
    expect(m['Pass % (passed of appeared)']![1]).toBe('66.67');
    // the students a count stands for
    expect(main!.sheet.body[2]!.cells[1]!.names).toEqual([
      'a1 (VI-A)',
      'a4 (VI-A)',
      'b1 (VI-B)',
      'b3 (VI-B)',
    ]);
    expect(lines(failedIn!.sheet)['2 subjects']![2]).toBe('b2 (VI-B): ENG, MAT');
    expect(lines(absentIn!.sheet)['1 subject']![2]).toBe('a3 (VI-A): ENG');
    expect(lines(leave!.sheet)['1 subject']![2]).toBe('b3 (VI-B): ENG');
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
  });

  it('entry status: a section’s subjects by exam with who is pending; a class as a grid of sections', () => {
    const [s] = buildReport('entry', input(false));
    const mat = s!.sheet.body.find((r) => r.cells[0]!.t === 'Maths')!.cells.map((c) => c.t);
    expect(mat).toEqual(['Maths', 'T', '4/5', 'Partial', 'Mr Das', 'a5']);
    const [g] = buildReport('entry', input(true));
    expect(lines(g!.sheet)['VI-A']).toEqual(['VI-A', '100.00%', '80.00%']);
    expect(lines(g!.sheet)['VI-B']).toEqual(['VI-B', '100.00%', '100.00%']);
  });

  it('toppers: the top N of the class with ties, each section’s top 3, every subject’s topper (full marks)', () => {
    const [top, secA, , subjects] = buildReport('toppers', input(true, { top: 2 }));
    expect(top!.sheet.body.map((r) => r.cells[1]!.t)).toEqual(['a1', 'b1']);
    expect(secA!.title).toBe('Top 3 of VI-A');
    expect(lines(subjects!.sheet).English).toEqual([
      'English',
      'b1 (VI-B)',
      '100 / 100',
      'Full marks',
    ]);
  });

  it('teacher-wise: each subject teacher’s sections; a section without one is “Not assigned”', () => {
    const [t] = buildReport('teacher', input(true));
    const rows2 = t!.sheet.body.map((r) =>
      r.cells
        .slice(0, 3)
        .map((c) => c.t)
        .join(' | '),
    );
    expect(rows2).toEqual([
      'Mr Das | Maths | VI-A',
      'Mrs Rao | English | VI-A',
      'Mrs Rao | English | VI-B',
      'Not assigned | Maths | VI-B',
    ]);
    // Mrs Rao in VI-A: appeared 4 (90, 30, 35, 70), one failed (30)
    expect(t!.sheet.body[1]!.cells.map((c) => c.t).slice(3)).toEqual([
      '5',
      '4',
      '56.25',
      '75.00',
      '90',
      '1',
    ]);
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

  it('compare sections: each subject by section and the class, the best section marked; overall figures', () => {
    const [c, overall] = buildReport('compare', input(true));
    const eng = lines(c!.sheet).English!;
    // VI-A English average (90 + 30 + 35 + 70) / 4 = 56.25; VI-B (100 + 20) / 2 = 60 (b3 left out)
    expect(eng[1]).toBe('56.25');
    expect(eng[4]).toBe('▲ 60.00');
    expect(lines(overall!.sheet)['Pass %']).toEqual(['Pass %', '66.67', '66.67', '66.67']);
    expect(buildReport('compare', input(false))[0]!.sheet.body[0]!.cells[0]!.t).toContain(
      'all sections',
    );
  });
});
