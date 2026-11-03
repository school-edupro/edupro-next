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

interface Row {
  subjectId: string;
  code: string;
  max: number;
  pass: number | null;
  scaleId: string | null;
  optional: boolean;
}

/**
 * The subject marks master (docs/design/70, part 1): per exam type and class, the subjects with their
 * maximum and pass marks, grade-only scale and Optional; copied, filled from an exam, from last year.
 */
describe('subject marks master (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  const s = stamp('SM');
  const ids: Record<string, string> = {};
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url: `/exams/subject-marks${url}`,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const list = async (typeId: string, classId: string) =>
    (await call(admin, 'GET', `?typeId=${typeId}&classId=${classId}`)).json() as {
      rows: Row[];
      studied: Array<{ code: string }>;
    };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-t`, 'class_teacher');
      const one = async (sql: string, values: unknown[]) =>
        (await c.query<{ id: string }>(sql, values)).rows[0]!.id;
      for (const [key, code, order] of [
        ['vi', 'VI', 6],
        ['vii', 'VII', 7],
      ] as const)
        ids[key] = await one(
          `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, $2, $3, $4) RETURNING id::text`,
          [school.id, code, `Class ${code}`, order],
        );
      for (const [code, name, order] of [
        ['ENG', 'English', 1],
        ['MAT', 'Mathematics', 2],
        ['ART', 'Art', 3],
      ] as const)
        ids[code] = await one(
          `INSERT INTO subjects (school_id, code, name, kind, display_order, status) VALUES ($1, $2, $3, 'scholastic', $4, 'active') RETURNING id::text`,
          [school.id, code, name, order],
        );
      // Class VI studies Maths first (its own order), English, Art; Class VII English and Maths
      for (const [k, subj, order] of [
        ['vi', 'MAT', 1],
        ['vi', 'ENG', 2],
        ['vi', 'ART', 3],
        ['vii', 'ENG', 1],
        ['vii', 'MAT', 2],
      ] as const)
        await c.query(
          `INSERT INTO class_subjects (school_id, academic_year_id, class_id, subject_id, sort_order) VALUES ($1, $2, $3, $4, $5)`,
          [school.id, school.yearId, ids[k], ids[subj], order],
        );
      for (const [key, code, order] of [
        ['pt', 'PT', 1],
        ['hy', 'HY', 2],
      ] as const)
        ids[key] = await one(
          `INSERT INTO exam_types (school_id, code, name, sort_order) VALUES ($1, $2, $3, $4) RETURNING id::text`,
          [school.id, code, code === 'PT' ? 'Periodic test' : 'Half yearly', order],
        );
      ids.scale = await one(
        `INSERT INTO grade_scales (school_id, code, name) VALUES ($1, 'ABC', 'A to C') RETURNING id::text`,
        [school.id],
      );
      // an exam of type PT already set up for Class VI
      ids.pt1 = await one(
        `INSERT INTO exams (school_id, academic_year_id, exam_type_id, code, name) VALUES ($1, $2, $3, 'PT1', 'Periodic Test 1') RETURNING id::text`,
        [school.id, school.yearId, ids.pt],
      );
      await c.query(`INSERT INTO exam_classes (school_id, exam_id, class_id) VALUES ($1, $2, $3)`, [
        school.id,
        ids.pt1,
        ids.vi,
      ]);
      for (const [subj, max, pass, scale] of [
        ['ENG', 20, 7, null],
        ['MAT', 20, 7, null],
        ['ART', 0, null, ids.scale],
      ] as const)
        await c.query(
          `INSERT INTO exam_subjects (school_id, exam_id, class_id, subject_id, max_marks, pass_marks, grade_scale_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [school.id, ids.pt1, ids.vi, ids[subj], max, pass, scale],
        );
    });
    app = await createApp();
    inject = injector(app);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it('starts empty; the class subjects to add come in the class order', async () => {
    expect((await call(admin, 'GET', '/overview')).json()).toMatchObject({
      types: [{ code: 'PT' }, { code: 'HY' }],
      classes: [{ code: 'VI' }, { code: 'VII' }],
      cells: [],
    });
    const l = await list(ids.pt!, ids.vi!);
    expect(l.rows).toEqual([]);
    expect(l.studied.map((x) => x.code)).toEqual(['MAT', 'ENG', 'ART']);
  });

  it('saves a list: marks, pass marks, a grade-only subject with its scale, Optional', async () => {
    const row = (code: string, max: number, pass: number | null, more: Partial<Row> = {}) => ({
      subjectId: ids[code]!,
      max,
      pass,
      scaleId: null,
      optional: false,
      ...more,
    });
    const save = (rows: unknown[], u = admin) =>
      call(u, 'PUT', '', { typeId: ids.pt, classId: ids.vi, rows });
    // a subject with no marks needs its scale; a pass mark is never above the maximum
    expect((await save([row('ART', 0, null)])).statusCode).toBe(400);
    expect((await save([row('ENG', 40, 50)])).statusCode).toBe(400);
    expect((await save([row('ENG', 40, 13), row('ENG', 40, 13)])).statusCode).toBe(400);
    expect((await save([row('ENG', 40, 13)], teacher)).statusCode).toBe(403);
    const ok = await save([
      row('ENG', 40, 13),
      row('MAT', 40, 13),
      row('ART', 0, null, { scaleId: ids.scale, optional: true }),
    ]);
    expect(ok.statusCode).toBe(200);
    // in the class's order: Maths first
    expect(
      (ok.json().rows as Row[]).map((x) => [x.code, x.max, x.pass, x.scaleId, x.optional]),
    ).toEqual([
      ['MAT', 40, 13, null, false],
      ['ENG', 40, 13, null, false],
      ['ART', 0, null, ids.scale, true],
    ]);
    // saved again without Art: Art goes
    const again = await save([row('ENG', 40, 13), row('MAT', 40, 14)]);
    expect((again.json().rows as Row[]).map((x) => [x.code, x.pass])).toEqual([
      ['MAT', 14],
      ['ENG', 13],
    ]);
    // a teacher reads it
    expect((await call(teacher, 'GET', `?typeId=${ids.pt}&classId=${ids.vi}`)).statusCode).toBe(
      200,
    );
  });

  it('copies to other classes (only what each studies) and to other exam types', async () => {
    await call(admin, 'PUT', '', {
      typeId: ids.pt,
      classId: ids.vi,
      rows: [
        { subjectId: ids.ENG, max: 40, pass: 13, scaleId: null, optional: false },
        { subjectId: ids.ART, max: 0, pass: null, scaleId: ids.scale, optional: false },
      ],
    });
    const copied = await call(admin, 'POST', '/copy', {
      typeId: ids.pt,
      classId: ids.vi,
      toClassIds: [ids.vii],
      toTypeIds: [ids.hy],
    });
    expect(copied.json().data).toEqual([
      { to: 'VII', copied: 1, left: ['ART'] },
      { to: 'HY', copied: 2, left: [] },
    ]);
    expect((await list(ids.pt!, ids.vii!)).rows.map((x) => x.code)).toEqual(['ENG']);
    expect((await list(ids.hy!, ids.vi!)).rows.map((x) => [x.code, x.max])).toEqual([
      ['ENG', 40],
      ['ART', 0],
    ]);
    const cells = (await call(admin, 'GET', '/overview')).json().cells as Array<{
      typeId: string;
      classId: string;
      subjects: number;
    }>;
    expect(cells).toEqual(
      expect.arrayContaining([
        { typeId: ids.pt, classId: ids.vi, subjects: 2 },
        { typeId: ids.pt, classId: ids.vii, subjects: 1 },
        { typeId: ids.hy, classId: ids.vi, subjects: 2 },
      ]),
    );
  });

  it("fills an exam type's master from an exam already set up", async () => {
    const filled = await call(admin, 'POST', '/fill', { examId: ids.pt1 });
    // the exam's own marks: nothing to follow
    expect(filled.json()).toEqual({
      typeId: ids.pt,
      data: [{ classId: ids.vi, code: 'VI', subjects: 3 }],
      followed: 0,
    });
    expect(
      (await list(ids.pt!, ids.vi!)).rows.map((x) => [x.code, x.max, x.pass, x.scaleId]),
    ).toEqual([
      // the exam (no marks yet) followed the lists saved above (part 2): MAT from the first, the rest from the second
      ['MAT', 40, 14, null],
      ['ENG', 40, 13, null],
      ['ART', 0, null, ids.scale],
    ]);
  });

  it("starts the year from last year's lists, keeping what is set", async () => {
    await withMigrator(async (c) => {
      const prev = await c.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status)
         VALUES ($1, '2025-26', 'Session 2025-26', '2025-04-01', '2026-03-31', 'closed') RETURNING id::text`,
        [school.id],
      );
      for (const [subj, max] of [
        ['ENG', 50],
        ['MAT', 50],
      ] as const)
        await c.query(
          `INSERT INTO exam_type_subjects (school_id, academic_year_id, exam_type_id, class_id, subject_id, max_marks, pass_marks)
           VALUES ($1, $2, $3, $4, $5, $6, 17)`,
          [school.id, prev.rows[0]!.id, ids.hy, ids.vii, ids[subj], max],
        );
    });
    const r = await call(admin, 'POST', '/last-year', { typeId: ids.hy });
    expect(r.json()).toEqual({ from: '2025-26', added: 2, followed: 0 });
    expect((await list(ids.hy!, ids.vii!)).rows.map((x) => [x.code, x.max])).toEqual([
      ['ENG', 50],
      ['MAT', 50],
    ]);
    // run again: nothing new, nothing overwritten
    expect((await call(admin, 'POST', '/last-year', { typeId: ids.hy })).json().added).toBe(0);
  });

  it("downloads an exam type's lists as Excel or PDF", async () => {
    for (const [format, sig] of [
      ['xlsx', 'PK'],
      ['pdf', '%PDF'],
    ] as const) {
      const f = await call(admin, 'GET', `/file?typeId=${ids.pt}&format=${format}`);
      expect(f.statusCode).toBe(200);
      expect(f.json().filename).toBe(`subject-marks-pt.${format}`);
      expect(
        Buffer.from(f.json().base64 as string, 'base64')
          .subarray(0, sig.length)
          .toString(),
      ).toBe(sig);
    }
  });

  // ---- part 2: the exams take their papers and marks from the master -------------------------------
  interface ExamSubject {
    id: string;
    classId: string;
    subjectCode: string;
    maxMarks: string;
    passMarks: string | null;
    marked: boolean;
    differs: boolean;
  }
  const examCall = (
    u: SeededUser,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    json?: unknown,
  ) =>
    inject({
      method,
      url: `/exams${url}`,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const papers = async (examId: string, classId = ids.vi!) =>
    ((await examCall(admin, 'GET', `/${examId}`)).json().subjects as ExamSubject[])
      .filter((x) => x.classId === classId)
      .map((x) => ({
        ...x,
        max: Number(x.maxMarks),
        pass: x.passMarks === null ? null : Number(x.passMarks),
      }));
  const master = (rows: Array<[string, number, number | null]>) =>
    call(admin, 'PUT', '', {
      typeId: ids.pt,
      classId: ids.vi,
      rows: rows.map(([code, max, pass]) => ({
        subjectId: ids[code],
        max,
        pass,
        scaleId: max === 0 ? ids.scale : null,
        optional: false,
      })),
    });

  it('an exam shows its type master; a paper with no mark follows a change of the master', async () => {
    const exam = (await examCall(admin, 'GET', `/${ids.pt1}`)).json() as {
      subjectMarks: Array<{ classId: string; rows: Array<{ code: string }> }>;
    };
    expect(exam.subjectMarks[0]!.rows.map((x) => x.code)).toEqual(['MAT', 'ENG', 'ART']);
    expect((await papers(ids.pt1!)).every((x) => !x.differs && !x.marked)).toBe(true);
    const saved = await master([
      ['MAT', 30, 10],
      ['ENG', 40, 13],
      ['ART', 0, null],
    ]);
    expect(saved.json().followed).toBe(1);
    expect((await papers(ids.pt1!)).find((x) => x.subjectCode === 'MAT')).toMatchObject({
      max: 30,
      pass: 10,
    });
  });

  it('a paper with marks keeps its own and differs; Apply (a reason) moves it unless a mark is above', async () => {
    const eng = (await papers(ids.pt1!)).find((x) => x.subjectCode === 'ENG')!;
    await withMigrator(async (c) => {
      const sec = await c.query<{ id: string }>(
        `INSERT INTO class_sections (school_id, academic_year_id, class_id, name, capacity) VALUES ($1, $2, $3, 'A', 40) RETURNING id::text`,
        [school.id, school.yearId, ids.vi],
      );
      const st = await c.query<{ id: string }>(
        `INSERT INTO students (school_id, admission_no, first_name, last_name) VALUES ($1, $2, 'Asha', 'Mark') RETURNING id::text`,
        [school.id, `${s}-1`],
      );
      ids.asha = st.rows[0]!.id;
      await c.query(
        `INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, roll_no, joined_on) VALUES ($1, $2, $3, $4, 1, CURRENT_DATE - 10)`,
        [school.id, ids.asha, school.yearId, sec.rows[0]!.id],
      );
      await c.query(
        `INSERT INTO mark_entries (school_id, exam_subject_id, student_id, marks) VALUES ($1, $2, $3, 35)`,
        [school.id, eng.id, ids.asha],
      );
    });
    const saved = await master([
      ['MAT', 30, 10],
      ['ENG', 30, 10],
      ['ART', 0, null],
    ]);
    expect(saved.json().followed).toBe(0);
    expect((await papers(ids.pt1!)).find((x) => x.subjectCode === 'ENG')).toMatchObject({
      max: 40,
      marked: true,
      differs: true,
    });
    const url = `/${ids.pt1}/subjects/${eng.id}/apply-master`;
    expect((await examCall(admin, 'POST', url, {})).statusCode).toBe(400);
    expect((await examCall(teacher, 'POST', url, { reason: 'Out of 30' })).statusCode).toBe(403);
    const above = await examCall(admin, 'POST', url, { reason: 'Out of 30' });
    expect(above.statusCode).toBe(409);
    expect(above.json().detail).toContain(`${s}-1 Asha Mark (35)`);
    await withMigrator((c) =>
      c.query(`UPDATE mark_entries SET marks = 28 WHERE exam_subject_id = $1`, [eng.id]),
    );
    expect((await examCall(admin, 'POST', url, { reason: 'Out of 30' })).statusCode).toBe(201);
    expect((await papers(ids.pt1!)).find((x) => x.subjectCode === 'ENG')).toMatchObject({
      max: 30,
      pass: 10,
      differs: false,
    });
  });

  it("saving an exam's subjects takes the master's marks; a subject not in it is refused", async () => {
    const sci = await withMigrator(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO subjects (school_id, code, name, kind, display_order, status) VALUES ($1, 'SCI', 'Science', 'scholastic', 4, 'active') RETURNING id::text`,
            [school.id],
          )
        ).rows[0]!.id,
    );
    const put = (subjects: Array<{ subjectId: string; maxMarks: number }>) =>
      examCall(admin, 'PUT', `/${ids.pt1}/subjects`, {
        classId: ids.vi,
        subjects: subjects.map((x) => ({
          ...x,
          passMarks: null,
          isElective: false,
          gradeScaleId: null,
        })),
      });
    const ok = await put([
      { subjectId: ids.MAT!, maxMarks: 99 },
      { subjectId: ids.ENG!, maxMarks: 99 },
      { subjectId: ids.ART!, maxMarks: 0 },
    ]);
    expect(ok.statusCode).toBe(200);
    expect((await papers(ids.pt1!)).map((x) => [x.subjectCode, x.max, x.pass])).toEqual([
      ['MAT', 30, 10],
      ['ENG', 30, 10],
      ['ART', 0, null],
    ]);
    const refused = await put([
      { subjectId: ids.MAT!, maxMarks: 30 },
      { subjectId: ids.ENG!, maxMarks: 30 },
      { subjectId: sci, maxMarks: 40 },
    ]);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().type).toBe('exams.not_in_master');
  });

  it('a new exam takes its papers from the master, a class added later too; a copy follows its type', async () => {
    const made = await examCall(admin, 'POST', '', {
      examTypeId: ids.pt,
      code: 'PT2',
      name: 'Periodic Test 2',
      classes: [{ classId: ids.vi }],
    });
    expect(made.statusCode).toBe(201);
    const pt2 = made.json().id as string;
    expect((await papers(pt2)).map((x) => [x.subjectCode, x.max])).toEqual([
      ['MAT', 30],
      ['ENG', 30],
      ['ART', 0],
    ]);
    await examCall(admin, 'PATCH', `/${pt2}`, {
      classes: [{ classId: ids.vi }, { classId: ids.vii }],
    });
    expect((await papers(pt2, ids.vii)).map((x) => [x.subjectCode, x.max])).toEqual([['ENG', 40]]);
    // a copy as a half-yearly: English and Art follow HY's list; Maths (not in it) stays and differs
    const copy = await examCall(admin, 'POST', `/${ids.pt1}/copy`, {
      examTypeId: ids.hy,
      code: 'HY1',
      name: 'Half yearly',
    });
    expect(copy.statusCode).toBe(201);
    const hy = await papers(copy.json().id as string);
    expect(hy.find((x) => x.subjectCode === 'ENG')).toMatchObject({ max: 40, differs: false });
    expect(hy.find((x) => x.subjectCode === 'MAT')).toMatchObject({ max: 30, differs: true });
  });
});
