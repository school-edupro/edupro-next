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

  it('analysis as the legacy prints it: the subjects across the top, the figures down the side', () => {
    const [a, more] = buildReport('analysis', input(false));
    expect(more).toBeUndefined();
    expect(a!.title).toBe('Result analysis — VI-A');
    expect(a!.sheet.head[0]!.map((c) => c.t)).toEqual(['Figure', 'ENGLISH', 'MATHS']);
    const side = a!.sheet.body.map((r) => r.cells[0]!.t);
    expect(side.slice(0, 4)).toEqual(['Total students', 'Absent', 'Appeared', '0-32']);
    expect(side.slice(-4)).toEqual(['Highest marks', 'Lowest marks', 'Average marks', 'Passing %']);
    const eng = a!.sheet.body.map((r) => r.cells[1]!.t);
    // takers 5 (a1-a5), absent 1 (a3), appeared 4 (a5 has English): 90, 30, 35, 70
    expect(eng.slice(0, 3)).toEqual(['5', '1', '4']);
    // bands 0-32: 30 · 33-40: 35 · 70-80: 70 · 90-100: 90
    expect(eng.slice(3, 11)).toEqual(['1', '1', '0', '0', '0', '1', '0', '1']);
    expect(eng.slice(-4)).toEqual(['90 / 100', '30', '56.25', '75.00']);
    // a count opens its students with the subject's marks
    const band = a!.sheet.body.find((r) => r.cells[0]!.t === '90-100')!.cells[1]!;
    expect(band.drill).toEqual({
      title: 'English · 90-100',
      cols: ['#', 'Name', 'Adm No', 'Marks', '%'],
      rows: [['1', 'a1', 'a1', '90 / 100', '90%']],
    });
  });

  it('analysis of a class: one subject a row per section with its teachers; every subject the class, then each section', () => {
    const [a, more] = buildReport('analysis', input(true, { subject: 'ENG', order: ['ENG'] }));
    expect(more).toBeUndefined();
    expect(a!.title).toBe('Result analysis — English, section-wise (by the subject’s %)');
    expect(a!.sheet.head[0]!.slice(0, 4).map((c) => c.t)).toEqual([
      'Section',
      'Teacher',
      'Students',
      'Absent',
    ]);
    const rows = a!.sheet.body.map((r) => r.cells.map((c) => c.t));
    // VI-A as the section's own analysis; VI-B: b3's ML leaves nothing to count (not appeared)
    expect(rows.map((r) => r.slice(0, 5))).toEqual([
      ['VI-A', 'Mrs Rao', '5', '1', '4'],
      ['VI-B', 'Mrs Rao', '3', '0', '2'],
      ['All sections', '', '8', '1', '6'],
    ]);
    const own = buildReport('analysis', input(false))[0]!.sheet.body.map((r) => r.cells[1]!.t);
    expect(rows[0]!.slice(2)).toEqual(own);
    expect(rows[2]!.slice(-4)).toEqual(['100 / 100', '20', '57.50', '66.67']);
    // a count names the section in its list's title
    expect(a!.sheet.body[1]!.cells[2]!.drill!.title).toBe('VI-B · English · Students');
    // a class with every subject: the class as one, then each section, the subjects across the top
    const all = buildReport('analysis', input(true));
    expect(all.map((b) => b.title)).toEqual([
      'Result analysis — VI · all sections',
      'Result analysis — VI-A',
      'Result analysis — VI-B',
    ]);
    expect(lines(all[0]!.sheet)['Total students']).toEqual(['Total students', '8', '8']);
    expect(lines(all[0]!.sheet).Absent).toEqual(['Absent', '1', '0']);
    expect(all[1]!.sheet.body.map((r) => r.cells.map((c) => c.t))).toEqual(
      buildReport('analysis', input(false))[0]!.sheet.body.map((r) => r.cells.map((c) => c.t)),
    );
    expect(all[2]!.sheet.head[0]!.map((c) => c.t)).toEqual(['Figure', 'ENGLISH', 'MATHS']);
    expect(lines(all[2]!.sheet)['Total students']).toEqual(['Total students', '3', '3']);
    expect(all[2]!.sheet.body[0]!.cells[1]!.drill!.title).toBe('VI-B · English · Students');
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
    // a section takes the same N; positions within the list (a2's compartment is not a topper)
    expect(secA!.title).toBe('Top 2 of VI-A · by Final Total');
    expect(secA!.sheet.body.map((r) => [r.cells[0]!.badge!.label, r.cells[1]!.t])).toEqual([
      ['1', 'a1'],
      ['2', 'a4'],
    ]);
    const eng = subjects!.sheet.body.find((r) => r.cells[0]!.t === 'ENGLISH')!.cells;
    expect(eng.map((c) => c.t)).toEqual(['ENGLISH', 'b1', 'VI-B', 'b1', '100 / 100', '100%']);
    expect(eng[1]!.badge).toEqual({ label: 'Full marks', tone: 'success' });
  });

  it('toppers (doc 76): a subject’s own toppers, any N, a % range, the lowest first', () => {
    const names = (b: { sheet: Sheet }) =>
      b.sheet.body.map((r) => [r.cells[0]!.badge?.label ?? '', r.cells[1]!.t]);
    // English for the class: b1 100, a1 90, a5 70, a4 35, a2 30, b2 20 (a3 AB and b3 ML left out)
    const eng = buildReport('toppers', input(true, { subject: 'ENG', order: ['ENG'], top: 2 }));
    expect(eng.map((b) => b.title)).toEqual([
      'English toppers — Top 2 of the class · by the subject’s %',
      'English toppers — Top 2 of VI-A · by the subject’s %',
      'English toppers — Top 2 of VI-B · by the subject’s %',
    ]);
    expect(names(eng[0]!)).toEqual([
      ['1', 'b1'],
      ['2', 'a1'],
    ]);
    expect(eng[0]!.sheet.body[0]!.cells.slice(4).map((c) => c.t)).toEqual([
      '100 / 100',
      '100%',
      'A1',
    ]);
    expect(eng[0]!.sheet.body[0]!.cells[1]!.badge).toEqual({
      label: 'Full marks',
      tone: 'success',
    });
    expect(names(eng[1]!)).toEqual([
      ['1', 'a1'],
      ['2', 'a5'],
    ]);
    expect(names(eng[2]!)).toEqual([
      ['1', 'b1'],
      ['2', 'b2'],
    ]);
    // the lowest in English among 25%–80%: a2 30, a4 35 (a5 70 is third)
    const low = buildReport(
      'toppers',
      input(true, { subject: 'ENG', order: ['ENG'], top: 2, lowest: true, pctFrom: 25, pctTo: 80 }),
    );
    expect(low[0]!.title).toBe('English — Lowest 2 of the class · by the subject’s % · 25%–80%');
    expect(names(low[0]!)).toEqual([
      ['1', 'a2'],
      ['2', 'a4'],
    ]);
    expect(low[0]!.sheet.body[0]!.cells[0]!.badge!.tone).toBe('warning');
    // a section with a subject: its own list only
    expect(
      buildReport('toppers', input(false, { subject: 'ENG', order: ['ENG'] })).map((b) => b.title),
    ).toEqual(['English toppers — Top 3 of VI-A · by the subject’s %']);
    // everyone at 80% and above (no N): a1 175, b1 170, b3 80 of 100 (all passed)
    const all = buildReport('toppers', input(true, { top: null, pctFrom: 80 }));
    expect(all[0]!.title).toBe('Overall Toppers — All of the class · by Final Total · 80%–100%');
    expect(names(all[0]!)).toEqual([
      ['1', 'a1'],
      ['2', 'b1'],
      ['3', 'b3'],
    ]);
    // nobody in the range: said so
    const none = buildReport('toppers', input(true, { pctFrom: 99 }));
    expect(none[0]!.sheet.body.map((r) => r.cells.map((c) => c.t))).toEqual([
      ['Nobody in this range'],
    ]);
    // the lowest finals of the class (a compartment and a fail count): b2 30, a4 69
    const lowest = buildReport('toppers', input(true, { top: 2, lowest: true }));
    expect(lowest[0]!.title).toBe('Overall — Lowest 2 of the class · by Final Total');
    expect(names(lowest[0]!)).toEqual([
      ['1', 'b2'],
      ['2', 'a4'],
    ]);
    const subjectsLow = lowest[lowest.length - 1]!;
    expect(subjectsLow.title).toBe('Lowest in each subject (all ties shown)');
    expect(lines(subjectsLow.sheet).ENGLISH!.slice(1, 2)).toEqual(['b2']);
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

  it('failing students (doc 77): counts by number failed and by subject, then a table per number with every subject', () => {
    // a2: English 30 of 100 (Compartment, final 80 / 200 = 40%); b2: English 20, Maths 10 (Fail, 15%)
    const parents = { a2: 'F 9800000001', b2: 'F 9800000002 · M 9800000003' };
    const blocks = buildReport('failing', input(true, { parents }));
    expect(blocks.map((b) => b.title)).toEqual([
      'Students failing — by the number of subjects failed',
      'Students failing — by subject',
      'Failed in 1 subject — 1 student',
      'Failed in 2 subjects — 1 student',
    ]);
    const [counts, bySubject, one, two] = blocks;
    expect(counts!.sheet.body.map((r) => r.cells.map((c) => c.t))).toEqual([
      ['VI-A', '1', '0', '0', '0', '0', '1'],
      ['VI-B', '0', '1', '0', '0', '0', '1'],
      ['Class', '1', '1', '0', '0', '0', '2'],
    ]);
    expect(counts!.sheet.note).toContain('failing in 1 or more subjects');
    expect(lines(bySubject!.sheet).ENGLISH).toEqual(['ENGLISH', '1', '1', '2']);
    expect(lines(bySubject!.sheet).MATHS).toEqual(['MATHS', '0', '1', '1']);
    expect(one!.sheet.head[0]!.map((c) => c.t)).toEqual([
      'Section',
      'Roll',
      'Student',
      'Adm No',
      'Parent mobile',
      'Class teacher',
      'ENGLISH',
      'MATHS',
      'Final total',
      '%',
      'Result',
      'Teachers of the failed subjects',
    ]);
    expect(one!.sheet.body.map((r) => r.cells.map((c) => c.t))).toEqual([
      [
        'VI-A',
        '',
        'a2',
        'a2',
        'F 9800000001',
        'Ms Iyer',
        '30 / 100',
        '50 / 100',
        '80 / 200',
        '40%',
        'Compartment',
        'ENG – Mrs Rao',
      ],
    ]);
    // a failed subject in red, a passed one plain
    expect(one!.sheet.body[0]!.cells[6]!.tone).toBe('code');
    expect(one!.sheet.body[0]!.cells[7]!.tone).toBeUndefined();
    expect(two!.sheet.body[0]!.cells.slice(4).map((c) => c.t)).toEqual([
      'F 9800000002 · M 9800000003',
      '',
      '20 / 100',
      '10 / 100',
      '30 / 200',
      '15%',
      'Fail',
      'ENG – Mrs Rao · MAT – no teacher mapped',
    ]);
    // failing in 2 or more: b2 only; the range's columns shaded in the counts
    const two2 = buildReport('failing', input(true, { failFrom: 2 }));
    expect(two2.map((b) => b.title).slice(2)).toEqual(['Failed in 2 subjects — 1 student']);
    expect(two2[0]!.sheet.note).toContain('failing in 2 or more subjects');
    expect(two2[0]!.sheet.head[0]![1]!.tone).toBeUndefined();
    expect(two2[0]!.sheet.head[0]![2]!.tone).toBe('final');
    // a final of 30% and above: a2 only
    const pct = buildReport('failing', input(true, { pctFrom: 30 }));
    expect(lines(pct[0]!.sheet).Class!.slice(-1)).toEqual(['1']);
    expect(pct.map((b) => b.title).slice(2)).toEqual(['Failed in 1 subject — 1 student']);
    // failing Maths: b2 only
    const mat = buildReport('failing', input(true, { subject: 'MAT' }));
    expect(mat.map((b) => b.title).slice(2)).toEqual(['Failed in 2 subjects — 1 student']);
    expect(mat[0]!.sheet.note).toContain('failing Maths');
    // nobody in the range: said so
    const none = buildReport('failing', input(true, { failFrom: 3 }));
    expect(none[none.length - 1]!.sheet.body[0]!.cells[0]!.t).toBe(
      'Nobody failing in 3 or more subjects',
    );
    // one section: no Section column, no class line
    const [sec] = buildReport('failing', input(false));
    expect(sec!.sheet.body.map((r) => r.cells.map((c) => c.t))).toEqual([
      ['VI-A', '1', '0', '0', '0', '0', '1'],
    ]);
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
    // finals: VI-A a1 175 (87.5%), a2 80 (40%), a4 69 (34.5%), a3 absent, a5 incomplete;
    // VI-B b1 170 (85%), b2 30 (15%), b3 80 of 100 (80%: its ML is left out)
    expect(overall!.sheet.body.map((r) => r.cells.map((x) => x.t))).toEqual([
      ['Total students', '5', '3', '8'],
      ['Absent (final withheld)', '1', '0', '1'],
      ['Appeared', '3', '3', '6'],
      ['0-32', '0', '1', '1'],
      ['33-40', '1', '0', '1'],
      ['40-50', '1', '0', '1'],
      ['50-60', '0', '0', '0'],
      ['60-70', '0', '0', '0'],
      ['70-80', '0', '0', '0'],
      ['80-90', '1', '2', '3'],
      ['90-100', '0', '0', '0'],
      ['>=50%', '1', '2', '3'],
      ['>=60%', '1', '2', '3'],
      ['>=70%', '1', '2', '3'],
      ['>=80%', '1', '2', '3'],
      ['>=90%', '0', '0', '0'],
      ['Highest marks', '175 / 200', '170 / 200', '175 / 200'],
      ['Lowest marks', '69', '30', '30'],
      ['Average marks', '108.00', '93.33', '100.67'],
      ['Average Final %', '54%', '60% ▲', '57%'],
      ['Pass % (Result PASS ÷ appeared)', '66.67% ▲', '66.67% ▲', '66.67%'],
      ['Compartment (1 failed)', '1', '0', '1'],
      ['Fail (more than 1 failed)', '0', '1', '1'],
    ]);
    // a count opens its students with their final
    expect(lines(overall!.sheet)['0-32']).toBeDefined();
    const low = overall!.sheet.body.find((r) => r.cells[0]!.t === '0-32')!.cells[2]!;
    expect(low.drill).toEqual({
      title: 'VI-B · 0-32',
      cols: ['#', 'Name', 'Adm No', 'Section', 'Marks', '%'],
      rows: [['1', 'b2', 'b2', 'VI-B', '30 / 200', '15%']],
    });
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
