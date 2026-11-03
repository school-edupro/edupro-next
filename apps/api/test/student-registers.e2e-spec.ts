import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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

interface Cell {
  t: string;
  tone?: string;
}
interface SheetJson {
  place: string;
  title?: string;
  head: Cell[][];
  body: Array<{ studentId: string; cells: Cell[] }>;
}
interface RegisterJson {
  all: boolean;
  classes: Array<{ id: string }>;
  classId: string | null;
  sections: Array<{ id: string; code: string }>;
  section: string | null;
  exams: Array<{ id: string; code: string }>;
  picked: string[];
  places: Array<{ id: string; place: string; sheets: SheetJson[]; notes: string[] }>;
}

/**
 * The legacy Student Registers (docs/design/69, part 1): Remark, Attendance and Height & Weight of a
 * class for the exams picked; a manager sees every section, a teacher the sections they teach.
 */
describe('remark, attendance and height & weight registers (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let classTeacher: SeededUser;
  let subjectTeacher: SeededUser;
  let nobody: SeededUser;
  const s = stamp('SR');
  const ids = { klass: '', a: '', b: '', pt1: '', pt2: '', unused: '', cat: '' };
  const student: Record<string, string> = {};
  const get = async (u: SeededUser, url: string) =>
    inject({ method: 'GET', url, headers: headersFor(u.sub, school.id) });
  const run = async (u: SeededUser, type: string, q = '') =>
    (await get(u, `/exams/registers/${type}?classId=${ids.klass}${q}`)).json() as RegisterJson;
  const texts = (cells: Cell[]) => cells.map((c) => c.t);

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      classTeacher = await seedUser(c, school, `${s}-ct`, 'class_teacher');
      subjectTeacher = await seedUser(c, school, `${s}-st`, 'subject_teacher');
      nobody = await seedUser(c, school, `${s}-none`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
    const post = async (url: string, json: unknown) =>
      inject({ method: 'POST', url, headers: headersFor(admin.sub, school.id), json });
    ids.klass = (
      await post('/academics/classes', { code: 'VII', name: 'Class VII', displayOrder: 7 })
    ).json().id;
    ids.a = (await post(`/academics/classes/${ids.klass}/sections`, { name: 'A' })).json().id;
    ids.b = (await post(`/academics/classes/${ids.klass}/sections`, { name: 'B' })).json().id;
    for (const [i, [first, sec]] of (
      [
        ['Asha', ids.a],
        ['BHANU', ids.a],
        ['Chitra', ids.b],
      ] as const
    ).entries()) {
      const r = await post('/people/students', {
        admissionNo: `${s}-${String(i + 1)}`,
        firstName: first,
        lastName: first === 'BHANU' ? 'KUMAR' : 'Reg',
        guardians: [],
        enrolment: { classSectionId: sec, rollNo: i + 1 },
      });
      expect(r.statusCode).toBe(201);
      student[first] = r.json().id;
    }
    await withMigrator(async (c) => {
      const t = await c.query<{ id: string }>(
        `INSERT INTO exam_types (school_id, code, name) VALUES ($1, 'PT', 'Periodic test') RETURNING id::text`,
        [school.id],
      );
      for (const [key, code, on] of [
        ['pt1', 'PT1', '2026-07-01'],
        ['pt2', 'PT2', '2026-08-01'],
        ['unused', 'PT3', '2026-09-01'],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO exams (school_id, academic_year_id, exam_type_id, code, name, starts_on) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text`,
          [school.id, school.yearId, t.rows[0]!.id, code, `Periodic Test ${code.slice(2)}`, on],
        );
        ids[key] = e.rows[0]!.id;
        await c.query(
          `INSERT INTO exam_classes (school_id, exam_id, class_id) VALUES ($1, $2, $3)`,
          [school.id, ids[key], ids.klass],
        );
      }
      // the teachers: the class teacher of VII-A, a subject teacher of VII-B
      for (const [u, kind, sec] of [
        [classTeacher, 'class_teacher', ids.a],
        [subjectTeacher, 'subject_teacher', ids.b],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, $2, 'T', 'Teacher', $3) RETURNING id::text`,
          [school.id, `SR-${kind}`, u.id],
        );
        const subj =
          kind === 'subject_teacher'
            ? (
                await c.query<{ id: string }>(
                  `INSERT INTO subjects (school_id, code, name) VALUES ($1, 'ENG', 'English') RETURNING id::text`,
                  [school.id],
                )
              ).rows[0]!.id
            : null;
        await c.query(
          `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, subject_id, kind)
           VALUES ($1, $2, $3, $4, $5, $6::teacher_assignment_kind)`,
          [school.id, school.yearId, e.rows[0]!.id, sec, subj, kind],
        );
      }
      // remarks: a general remark and a category in PT1; promoted to in PT2
      ids.cat = (
        await c.query<{ id: string }>(
          `INSERT INTO remark_categories (school_id, code, name, sort_order) VALUES ($1, 'DISC', 'Discipline', 1) RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      await c.query(
        `INSERT INTO exam_remarks (school_id, exam_id, student_id, remark) VALUES ($1, $2, $3, 'Works with great care and keeps every notebook neat and complete.')`,
        [school.id, ids.pt1, student.Asha],
      );
      await c.query(
        `INSERT INTO exam_remark_items (school_id, exam_id, student_id, category_id, text) VALUES ($1, $2, $3, $4, 'Punctual')`,
        [school.id, ids.pt1, student.BHANU, ids.cat],
      );
      await c.query(
        `INSERT INTO exam_remarks (school_id, exam_id, student_id, promoted_to) VALUES ($1, $2, $3, 'VIII')`,
        [school.id, ids.pt2, student.Asha],
      );
      // attendance: Asha 45/50 then 18/20; Bhanu 30/50 (below 75%); Chitra 40/50
      for (const [st, exam, p, t] of [
        [student.Asha, ids.pt1, 45, 50],
        [student.Asha, ids.pt2, 18, 20],
        [student.BHANU, ids.pt1, 30, 50],
        [student.Chitra, ids.pt1, 40, 50],
      ] as const)
        await c.query(
          `INSERT INTO exam_attendance (school_id, exam_id, student_id, days_present, days_total) VALUES ($1, $2, $3, $4, $5)`,
          [school.id, exam, st, p, t],
        );
      // heights and weights: Asha in both exams (measured twice in PT2: the later one counts)
      for (const [exam, on, h, w] of [
        [ids.pt1, '2026-07-02', 140, 33],
        [ids.pt2, '2026-08-02', 141, 33.5],
        [ids.pt2, '2026-08-05', 142.5, 34.25],
      ] as const)
        await c.query(
          `INSERT INTO health_records (school_id, student_id, recorded_on, exam_id, height_cm, weight_kg) VALUES ($1, $2, $3, $4, $5, $6)`,
          [school.id, student.Asha, on, exam, h, w],
        );
    });
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it('remarks: the exams with remarks, a column per remark used, the text wrapped, "Promoted to"', async () => {
    const r = await run(admin, 'remark', `&section=${ids.a}&exams=${ids.pt1},${ids.pt2}`);
    expect(r.all).toBe(true);
    // only the exams that have remarks for the class, in their order
    expect(r.exams.map((e) => e.code)).toEqual(['PT1', 'PT2']);
    expect(r.sections.map((x) => x.code)).toEqual(['VII-A', 'VII-B']);
    const sheet = r.places[0]!.sheets[0]!;
    expect(texts(sheet.head[0]!)).toEqual([
      'Sr',
      'Adm No',
      'Roll No',
      'Student',
      'PT1',
      'PT2',
      'Promoted to',
    ]);
    expect(texts(sheet.head[1]!)).toEqual(['General remark', 'Discipline', 'No remarks']);
    expect(texts(sheet.body[0]!.cells).slice(3)).toEqual([
      'Asha Reg',
      'Works with great care and keeps every notebook neat and complete.',
      '',
      '—',
      'VIII',
    ]);
    // a name typed in capitals prints in proper case
    expect(texts(sheet.body[1]!.cells).slice(3, 6)).toEqual(['Bhanu Kumar', '', 'Punctual']);
    // nothing picked: the first exam
    expect((await run(admin, 'remark')).picked).toEqual([ids.pt1]);
  });

  it('attendance: each exam and the overall %, the cut-off marked, a summary and the list below it', async () => {
    const r = await run(admin, 'attendance', `&section=all&exams=${ids.pt1},${ids.pt2}&cutoff=80`);
    expect(r.places.map((p) => p.place)).toEqual(['VII-A', 'VII-B']);
    const [sheet, summary, below] = r.places[0]!.sheets;
    expect(texts(sheet!.head[0]!).slice(4)).toEqual(['PT1', 'PT2', 'Overall']);
    // Asha: 45/50 = 90%, 18/20 = 90%, overall 63/70 = 90%
    expect(texts(sheet!.body[0]!.cells).slice(4)).toEqual([
      '45',
      '50',
      '90.00',
      '18',
      '20',
      '90.00',
      '63',
      '70',
      '90.00',
    ]);
    // Bhanu: 60% is under the cut-off; no PT2 entry
    const bhanu = sheet!.body[1]!.cells;
    expect(bhanu[6]).toMatchObject({ t: '60.00', tone: 'warn' });
    expect(texts(bhanu).slice(7, 10)).toEqual(['—', '—', '—']);
    expect(summary!.title).toBe('Summary');
    expect(texts(summary!.body[0]!.cells)).toEqual(['2', '2', '75.00', '1']);
    expect(below!.title).toBe('Below 80%');
    expect(texts(below!.body[0]!.cells)).toEqual(['1', 'Bhanu Kumar', `${s}-2`, '2', '60.00']);
  });

  it('height & weight: each exam with BMI, the change, the class averages, the latest of two', async () => {
    const r = await run(admin, 'health', `&section=${ids.a}&exams=${ids.pt1},${ids.pt2}`);
    const [sheet, averages] = r.places[0]!.sheets;
    expect(texts(sheet!.head[1]!)).toEqual([
      'Height (cm)',
      'Weight (kg)',
      'BMI',
      'Height (cm)',
      'Weight (kg)',
      'BMI',
      'Height (cm)',
      'Weight (kg)',
    ]);
    // PT2 counts the later measurement: 142.5 cm, 34.25 kg; the change is from PT1
    expect(texts(sheet!.body[0]!.cells).slice(4)).toEqual([
      '140.0',
      '33.0',
      '16.8',
      '142.5',
      '34.25',
      '16.9',
      '+2.5',
      '+1.3',
    ]);
    expect(texts(averages!.body[1]!.cells)).toEqual([
      'PT2 · Periodic Test 2',
      '1',
      '142.5',
      '34.3',
      '16.9',
    ]);
    expect(r.places[0]!.notes.join(' ')).toContain('the latest is shown');
    // BMI hidden
    const plain = await run(admin, 'health', `&section=${ids.a}&exams=${ids.pt1}&bmi=0`);
    expect(texts(plain.places[0]!.sheets[0]!.head[1]!)).toEqual(['Height (cm)', 'Weight (kg)']);
  });

  it('a teacher sees the sections they teach; heights need the health right; nothing assigned, no class', async () => {
    const ct = await run(classTeacher, 'remark', `&section=${ids.b}`);
    expect(ct.all).toBe(false);
    expect(ct.sections.map((x) => x.code)).toEqual(['VII-A']);
    // another section asked: their own one is shown
    expect(ct.places.map((p) => p.place)).toEqual(['VII-A']);
    expect(
      (await get(classTeacher, `/exams/registers/health?classId=${ids.klass}`)).statusCode,
    ).toBe(200);
    const st = await run(subjectTeacher, 'attendance');
    expect(st.sections.map((x) => x.code)).toEqual(['VII-B']);
    expect(
      (await get(subjectTeacher, `/exams/registers/health?classId=${ids.klass}`)).statusCode,
    ).toBe(403);
    const none = await run(nobody, 'remark');
    expect(none.classes).toEqual([]);
    expect(none.places).toEqual([]);
    expect((await get(admin, '/exams/registers/grade')).statusCode).toBe(404);
  });

  it('downloads a PDF or an Excel of a section or of all sections at once', async () => {
    for (const [format, sig] of [
      ['pdf', '%PDF'],
      ['xlsx', 'PK'],
    ] as const) {
      const f = await get(
        admin,
        `/exams/registers/attendance?classId=${ids.klass}&section=all&exams=${ids.pt1}&format=${format}`,
      );
      expect(f.statusCode).toBe(200);
      const body = f.json() as { filename: string; base64: string };
      expect(body.filename).toBe(`attendance-register-class-vii-all.${format}`);
      expect(Buffer.from(body.base64, 'base64').subarray(0, sig.length).toString()).toBe(sig);
    }
    // a remark too long for its cell wraps in the PDF (the file is made, not cut short)
    const pdf = await get(
      admin,
      `/exams/registers/remark?classId=${ids.klass}&section=${ids.a}&exams=${ids.pt1}&format=pdf&paper=A4&orientation=portrait`,
    );
    expect(pdf.statusCode).toBe(200);
    // nothing to print
    expect(
      (await get(nobody, `/exams/registers/remark?classId=${ids.klass}&format=pdf`)).statusCode,
    ).toBe(409);
  });
});
