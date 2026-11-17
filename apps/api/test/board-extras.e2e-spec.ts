/**
 * CBSE board result analysis, phase D (docs/design/88): the Performance Index, the five-year trend and the office's
 * lists; a teacher's own board results; the result on the student's record and — when the school switches it on —
 * on the parent app; the exam page's figures. All names, roll numbers, marks and phone numbers are invented.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { gazetteX, type FixtureCandidate } from './board-gazette-fixture';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  withMigrator,
  type SeededSchool,
  type SeededUser,
} from './helpers';

interface Table {
  key: string;
  title: string;
  rows: Array<Record<string, string | number | null>>;
}

describe('CBSE board results: PI, trend, lists, teachers, students, parents (e2e, docs/design/88 phase D)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let auditor: SeededUser;
  let teacher: SeededUser;
  let stranger: SeededUser;
  let parent: SeededUser;
  let s = '';
  let year = 0;
  let studentId = '';
  let teacherEmp = '';
  const MOBILE = `98${String(Date.now()).slice(-8)}`;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const post = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'PUT', url, headers: h(u), json });
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });
  const R = ['29200001', '29200002', '29200003', '29200004', '29200005'];

  const file = (): FixtureCandidate[] => [
    {
      roll: R[0]!,
      sex: 'F',
      name: 'ASHA EXTRA',
      subjects: [
        ['184', '095', 'A1'],
        ['085', '092', 'A1'],
        ['041', '100', 'A1'],
        ['086', '091', 'A1'],
        ['087', '093', 'A1'],
      ],
      result: 'PASS',
    },
    {
      roll: R[1]!,
      sex: 'M',
      name: 'BIRJU EXTRA',
      subjects: [
        ['184', '080', 'A2'],
        ['085', '075', 'B1'],
        ['041', '075', 'B1'],
        ['086', '070', 'B2'],
        ['087', '075', 'B1'],
      ],
      result: 'PASS',
    },
    {
      roll: R[2]!,
      sex: 'M',
      name: 'CHETAN EXTRA',
      subjects: [
        ['184', '040', 'D1'],
        ['085', '030', 'E'],
        ['041', '045', 'D1'],
        ['086', '050', 'C2'],
        ['087', '035', 'D2'],
      ],
      result: 'COMP',
      compartment: ['085'],
    },
    {
      roll: R[3]!,
      sex: 'F',
      name: 'DIVYA EXTRA',
      subjects: [
        ['184', '088', 'A2'],
        ['085', '090', 'A1'],
        ['041', '079', 'B1'],
        ['086', '084', 'A2'],
        ['087', '086', 'A2'],
      ],
      result: 'PASS',
    },
    {
      roll: R[4]!,
      sex: 'F',
      name: 'EKTA EXTRA',
      subjects: [
        ['184', '', ''],
        ['085', '', ''],
        ['041', '', ''],
        ['086', '', ''],
        ['087', '', ''],
      ],
      result: 'ABST',
    },
  ];
  const view = async () =>
    (await get('/exams/board-results/analysis?classLabel=X')).json() as {
      analysis: { annexures: Array<{ no: number; title: string; tables: Table[] }> };
    };

  beforeAll(async () => {
    s = stamp('BEX');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      auditor = await seedUser(c, school, `${s}-auditor`, 'auditor');
      teacher = await seedUser(c, school, `${s}-teacher`, 'subject_teacher');
      stranger = await seedUser(c, school, `${s}-stranger`, 'subject_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      teacherEmp = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id)
           VALUES ($1, 'BT1', 'Bina', 'Teacher', $2) RETURNING id::text`,
          [school.id, teacher.id],
        )
      ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post('/academics/classes', { code: 'X', name: 'Class X', displayOrder: 10 });
    const section = (
      await post(`/academics/classes/${cls.json().id as string}/sections`, { name: 'A' })
    ).json().id as string;
    const st = await post('/people/students', {
      admissionNo: `${s}-1`,
      firstName: 'Chetan',
      lastName: 'Extra',
      dob: '2011-04-04',
      gender: 'male',
      guardians: [
        {
          guardian: { firstName: 'Meera', lastName: 'Extra', mobile: MOBILE },
          relation: 'mother',
          isPrimary: true,
        },
      ],
      enrolment: { classSectionId: section, rollNo: 1 },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id as string;
    const u = await post('/exams/board-results/gazette', {
      classLabel: 'X',
      academicYearId: school.yearId,
      fileName: 'class-x.txt',
      text: gazetteX(file()),
    });
    const id = u.json().id as string;
    expect((await post(`/exams/board-results/imports/${id}/commit`, {})).statusCode).toBe(201);
    await withMigrator(async (c) => {
      // CHETAN is our student (found by name in a school; set here), the parent his mother; sections A and B
      await c.query(
        `UPDATE board_candidates SET section = CASE WHEN roll_no IN ($2, $3) THEN 'A' ELSE 'B' END,
                student_id = CASE WHEN roll_no = $4 THEN $5::bigint ELSE student_id END
          WHERE school_id = $1`,
        [school.id, R[0], R[1], R[2], studentId],
      );
      await c.query(
        `UPDATE board_results r SET student_id = bc.student_id FROM board_candidates bc
          WHERE bc.id = r.candidate_id AND bc.school_id = $1`,
        [school.id],
      );
      await c.query(
        `UPDATE guardians SET user_id = $2 WHERE id = (SELECT guardian_id FROM student_guardians WHERE student_id = $1)`,
        [studentId, parent.id],
      );
      year = (
        await c.query<{ y: number }>(
          `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE school_id = $1`,
          [school.id],
        )
      ).rows[0]!.y;
    });
    // Bina teaches Mathematics in section A this examination
    expect(
      (
        await post('/exams/board-results/teachers', {
          classLabel: 'X',
          examYear: year,
          section: 'A',
          code: '041',
          employeeId: teacherEmp,
        })
      ).statusCode,
    ).toBe(201);
  });
  afterAll(async () => {
    await app.close();
  });

  it('Annexures 11-13: the Performance Index, the trend and the office lists', async () => {
    const v = await view();
    expect(v.analysis.annexures.map((x) => x.no)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
    const pi = v.analysis.annexures[10]!.tables;
    // Mathematics as printed: A1 8, B1 6, D1 2, B1 6 = 22 of 32 → 68.75
    expect(pi[0]!.rows.find((r) => r.code === '041')).toMatchObject({
      appeared: 4,
      gA1: 1,
      gB1: 2,
      gD1: 1,
      pi: 68.75,
    });
    // Bina's section A: A1 8 + B1 6 of 16 → 87.5
    expect(pi[1]!.rows.find((r) => r.code === '041' && r.section === 'A')).toMatchObject({
      teacher: 'Bina Teacher',
      pi: 87.5,
    });
    expect(pi[2]!.rows.find((r) => r.teacher === 'Bina Teacher')).toMatchObject({
      code: '041',
      sections: 'A',
    });
    const trend = v.analysis.annexures[11]!.tables[0]!;
    expect(trend.rows).toHaveLength(1);
    expect(trend.rows[0]).toMatchObject({ appeared: 4, passPct: 75 });
    const lists = v.analysis.annexures[12]!.tables;
    expect(lists[0]!.rows).toEqual([
      expect.objectContaining({
        roll: R[2],
        admissionNo: `${s}-1`,
        subjects: '085 Hindi Course-B',
        contact: MOBILE,
      }),
    ]);
    expect(lists[1]!.rows.map((r) => [r.roll, r.result])).toEqual([[R[4], 'ABST']]);
    expect(lists[2]!.rows).toEqual([]);
    // the workbook names the extras' sheets
    const x = await get('/exams/board-results/analysis/file?classLabel=X&format=xlsx');
    expect(x.statusCode).toBe(200);
    // an extra prints on its own too
    const p13 = await get('/exams/board-results/analysis/file?classLabel=X&format=pdf&annexure=13');
    expect(p13.statusCode).toBe(200);
    expect(p13.json().filename).toMatch(/Annexure-13\.pdf$/);
  });

  it('a teacher sees only the sections and subjects they taught; others see nothing of them', async () => {
    const m = await get('/exams/board-results/mine', teacher);
    expect(m.statusCode).toBe(200);
    const d = m.json() as {
      employee: { id: string } | null;
      classes: Array<{ classLabel: string; examYear: number; students: number; tables: Table[] }>;
    };
    expect(d.employee!.id).toBe(teacherEmp);
    expect(d.classes).toHaveLength(1);
    expect(d.classes[0]).toMatchObject({ classLabel: 'X', examYear: year, students: 2 });
    const [sections, acr, students] = d.classes[0]!.tables;
    expect(sections!.rows).toEqual([
      expect.objectContaining({
        code: '041',
        section: 'A',
        appeared: 2,
        highest: 100,
        lowest: 75,
        pi: 87.5,
      }),
    ]);
    expect(acr!.rows[0]).toMatchObject({ total: 2, b6: 1, b8: 1 });
    expect(students!.rows.map((r) => r.roll)).toEqual([R[0], R[1]]);
    // a teacher with no staff record linked: nothing; the auditor has no "own" right
    expect((await get('/exams/board-results/mine', stranger)).json()).toEqual({
      employee: null,
      classes: [],
    });
    expect((await get('/exams/board-results/mine', auditor)).statusCode).toBe(403);
    // the teacher cannot open the whole analysis
    expect((await get('/exams/board-results/analysis?classLabel=X', teacher)).statusCode).toBe(403);
  });

  it("the student's record and the exam page's figures", async () => {
    const r = await get(`/exams/board-results/student/${studentId}`);
    expect(r.statusCode).toBe(200);
    const row = r.json().rows[0];
    expect(row).toMatchObject({
      classLabel: 'X',
      examYear: year,
      roll: R[2],
      result: 'COMP',
      compartment: [{ code: '085', name: 'Hindi Course-B' }],
      bestFive: { total: 200, percent: 40 },
    });
    expect(row.subjects).toHaveLength(5);
    expect(row.subjects.filter((x: { inBestFive: boolean }) => x.inBestFive)).toHaveLength(5);
    const sum = (await get('/exams/board-results/summary')).json();
    expect(sum.classes).toEqual([
      expect.objectContaining({
        classLabel: 'X',
        examYear: year,
        appeared: 4,
        passPct: 75,
        aggregate: 73.65,
        pct90: 25,
      }),
    ]);
  });

  it('the parent app shows the board result only once the school switches it on', async () => {
    const off = await get('/exams/mine/board-results', parent);
    expect(off.statusCode).toBe(200);
    expect(off.json()).toEqual({ enabled: false, children: [] });
    expect((await put('/exams/board-results/parents', { on: true }, auditor)).statusCode).toBe(403);
    expect((await put('/exams/board-results/parents', { on: true })).json()).toEqual({ on: true });
    expect((await get('/exams/board-results/parents', auditor)).json()).toEqual({ on: true });
    const on = (await get('/exams/mine/board-results', parent)).json();
    expect(on.enabled).toBe(true);
    expect(on.children).toEqual([
      expect.objectContaining({
        studentId,
        results: [expect.objectContaining({ roll: R[2], result: 'COMP' })],
      }),
    ]);
    // a family never reaches the school's analysis
    expect((await get('/exams/board-results/analysis?classLabel=X', parent)).statusCode).toBe(403);
    expect((await get(`/exams/board-results/student/${studentId}`, parent)).statusCode).toBe(403);
  });
});
