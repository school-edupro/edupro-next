/**
 * The day's sheet of homework and classwork (0092): a class teacher has every subject of the class, a
 * subject teacher the ones given to them; one save posts to several sections; the family sees the work
 * from its publish time, and its teachers with the contact masked as the school set it. Uploads follow
 * the size the school set for the section; teacher assignments export as Excel and PDF.
 */
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

describe('daily work sheet (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let classTeacher: SeededUser;
  let mathsTeacher: SeededUser;
  let parent: SeededUser;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const get = (u: SeededUser, url: string) => inject({ method: 'GET', url, headers: h(u) });

  beforeAll(async () => {
    const s = stamp('WS');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      classTeacher = await seedUser(c, school, `${s}-ct`);
      mathsTeacher = await seedUser(c, school, `${s}-mt`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      const one = async (sql: string, params: unknown[]) =>
        (await c.query<{ id: string }>(sql, params)).rows[0]!.id;
      for (const [code, name] of [
        ['ENG', 'English'],
        ['MAT', 'Mathematics'],
        ['SCI', 'Science'],
        ['FRE', 'French'],
      ])
        ids[code!] = await one(
          `INSERT INTO subjects (school_id, code, name, kind) VALUES ($1, $2, $3, 'scholastic') RETURNING id::text`,
          [school.id, code, name],
        );
      for (const [key, u, first, last, mobile] of [
        ['empCt', classTeacher, 'Anita', 'Rao', '9876543210'],
        ['empMt', mathsTeacher, 'Suresh', 'Nair', '9123456789'],
      ] as const)
        ids[key] = await one(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, mobile, email)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
          [school.id, key, first, last, u.id, mobile, `${key.toLowerCase()}@school.test`],
        );
    });
    app = await createApp();
    inject = injector(app);
    const post = (url: string, json: unknown) =>
      inject({ method: 'POST', url, headers: h(admin), json });
    const cls = await post('/academics/classes', { code: 'VI', name: 'Class VI', displayOrder: 6 });
    ids.cls = cls.json().id;
    for (const sec of ['A', 'B'])
      ids[`sec${sec}`] = (
        await post(`/academics/classes/${ids.cls}/sections`, { name: sec })
      ).json().id;
    const st = await post('/people/students', {
      admissionNo: `${s}-1`,
      firstName: 'Aarav',
      lastName: 'Shah',
      guardians: [
        {
          guardian: { firstName: 'Mr', lastName: 'Shah', mobile: '9876512388' },
          relation: 'father',
          isPrimary: true,
        },
      ],
      enrolment: { classSectionId: ids.secA, rollNo: 1 },
    });
    expect(st.statusCode).toBe(201);
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE id = (SELECT guardian_id FROM student_guardians WHERE student_id = $2 LIMIT 1)`,
        [parent.id, st.json().id],
      );
      // the class studies English, Mathematics and Science (not French)
      for (const code of ['ENG', 'MAT', 'SCI'])
        await c.query(
          `INSERT INTO class_subjects (school_id, academic_year_id, class_id, subject_id) VALUES ($1, $2, $3, $4)`,
          [school.id, school.yearId, ids.cls, ids[code]],
        );
    });
    const assign = (employeeId: string, kind: string, sec: string, subjectId?: string) =>
      inject({
        method: 'POST',
        url: '/academics/teacher-assignments',
        headers: h(admin),
        json: { employeeId, classSectionId: sec, kind, subjectId },
      });
    expect((await assign(ids.empCt!, 'class_teacher', ids.secA!)).statusCode).toBe(201);
    // the class teacher teaches English and Science there; Mathematics is another teacher's
    expect((await assign(ids.empCt!, 'subject_teacher', ids.secA!, ids.ENG)).statusCode).toBe(201);
    expect((await assign(ids.empCt!, 'subject_teacher', ids.secA!, ids.SCI)).statusCode).toBe(201);
    expect((await assign(ids.empMt!, 'subject_teacher', ids.secA!, ids.MAT)).statusCode).toBe(201);
    expect((await assign(ids.empMt!, 'subject_teacher', ids.secB!, ids.MAT)).statusCode).toBe(201);
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('gives every teacher, the class teacher too, only the subjects assigned to them', async () => {
    const ct = (await get(classTeacher, '/academics/daily-work/sheet/options')).json().data;
    expect(ct).toHaveLength(1);
    expect(ct[0].section).toBe('VI-A');
    expect(ct[0].subjects.map((x: { code: string }) => x.code).sort()).toEqual(['ENG', 'SCI']);
    expect(ct[0]).toMatchObject({ classId: ids.cls, className: 'Class VI' });
    const mt = (await get(mathsTeacher, '/academics/daily-work/sheet/options')).json().data;
    expect(mt.map((x: { section: string }) => x.section)).toEqual(['VI-A', 'VI-B']);
    for (const s of mt) expect(s.subjects.map((x: { code: string }) => x.code)).toEqual(['MAT']);
    // a class that is not theirs is refused
    expect(
      (await get(classTeacher, `/academics/daily-work/sheet?sections=${ids.secB}`)).statusCode,
    ).toBe(403);
  });

  it('saves the sheet for several sections and keeps it from the family until the publish time', async () => {
    const save = (u: SeededUser, json: Record<string, unknown>) =>
      inject({ method: 'POST', url: '/academics/daily-work/sheet', headers: h(u), json });
    const row = (subjectId: string, homework = '', classwork = '') => ({
      subjectId,
      homework,
      classwork,
    });
    // the subject teacher: both sections, published at once
    const maths = await save(mathsTeacher, {
      date: '2026-10-07',
      classSectionIds: [ids.secA, ids.secB],
      rows: [row(ids.MAT!, 'Exercise 4.2, sums 1 to 10', 'Fractions on the number line')],
    });
    expect(maths.json()).toMatchObject({ created: 4, updated: 0, sections: 2 });
    // a subject that is not theirs is not posted
    expect(
      (
        await save(mathsTeacher, {
          date: '2026-10-07',
          classSectionIds: [ids.secA],
          rows: [row(ids.ENG!, 'Read chapter 3')],
        })
      ).statusCode,
    ).toBe(403);
    // the class teacher: English now, Science for tomorrow morning
    const later = await save(classTeacher, {
      date: '2026-10-07',
      classSectionIds: [ids.secA],
      publishAt: '2099-01-01T15:00',
      rows: [row(ids.SCI!, 'Draw the water cycle')],
    });
    expect(later.json()).toMatchObject({ created: 1 });
    expect(
      (
        await save(classTeacher, {
          date: '2026-10-07',
          classSectionIds: [ids.secA],
          rows: [row(ids.ENG!, 'Read chapter 3'), row(ids.MAT!, 'Exercise 4.2, sums 1 to 12')],
        })
      ).json(),
    ).toMatchObject({ created: 1, updated: 0 });

    const sheet = (
      await get(mathsTeacher, `/academics/daily-work/sheet?date=2026-10-07&classId=${ids.cls}`)
    ).json();
    const maths2 = sheet.rows.find((r: { subject: { code: string } }) => r.subject.code === 'MAT');
    expect(sheet.chosen).toHaveLength(2);
    expect(sheet.classes).toEqual([{ id: ids.cls, name: 'Class VI' }]);
    expect(maths2.homework.text).toBe('Exercise 4.2, sums 1 to 10');
    expect(maths2.classwork.text).toBe('Fractions on the number line');

    const seen = (
      await get(
        parent,
        `/academics/daily-work?classSectionId=${ids.secA}&from=2026-10-07&to=2026-10-07`,
      )
    ).json().data as Array<{ subjectName: string; kind: string; body: string }>;
    expect(seen.map((w) => `${w.subjectName}:${w.kind}`).sort()).toEqual([
      'English:homework',
      'Mathematics:classwork',
      'Mathematics:homework',
    ]);
    expect(seen.some((w) => w.subjectName === 'Science')).toBe(false);
  });

  it('has the same sheet for assignments, with a due date', async () => {
    const res = await inject({
      method: 'POST',
      url: '/academics/daily-work/sheet',
      headers: h(classTeacher),
      json: {
        date: '2026-10-07',
        classSectionIds: [ids.secA],
        mode: 'assignment',
        rows: [{ subjectId: ids.ENG, assignment: 'Essay: my town', dueOn: '2026-10-14' }],
      },
    });
    expect(res.json()).toMatchObject({ created: 1 });
    const list = (
      await get(parent, `/academics/daily-work?classSectionId=${ids.secA}&kind=assignment`)
    ).json().data;
    expect(list[0]).toMatchObject({
      kind: 'assignment',
      dueOn: '2026-10-14',
      body: 'Essay: my town',
    });
    const early = await inject({
      method: 'POST',
      url: '/academics/daily-work/sheet',
      headers: h(classTeacher),
      json: {
        date: '2026-10-07',
        classSectionIds: [ids.secA],
        mode: 'assignment',
        rows: [{ subjectId: ids.ENG, assignment: 'Essay', dueOn: '2026-10-01' }],
      },
    });
    expect(early.statusCode).toBe(400);
  });

  it('shows the family its teachers, with the contact as the school set it', async () => {
    const masked = (await get(parent, '/academics/my-teachers')).json();
    const list = masked.students[0].teachers as Array<Record<string, unknown>>;
    expect(list[0]).toMatchObject({
      name: 'Anita Rao',
      role: 'class_teacher',
      mobile: '98XXXXXX10',
      email: 'em***@school.test',
    });
    expect(list[1]).toMatchObject({ name: 'Suresh Nair', subjects: ['Mathematics'] });
    const settings = {
      publishTime: '15:00',
      teacherMobile: 'full',
      teacherEmail: 'hidden',
      maxMb: { daily_work: 1, assignment: 5, documents: 15, notices: 10, gallery: 10 },
    };
    expect(
      (
        await inject({
          method: 'PUT',
          url: '/academics/settings',
          headers: h(classTeacher),
          json: settings,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await inject({
          method: 'PUT',
          url: '/academics/settings',
          headers: h(admin),
          json: settings,
        })
      ).statusCode,
    ).toBe(200);
    const full = (await get(parent, '/academics/my-teachers')).json().students[0].teachers[0];
    expect(full).toMatchObject({ mobile: '9876543210', email: null });
    // the sheet now starts with the school's publish time
    const sheet = (
      await get(classTeacher, `/academics/daily-work/sheet?date=2099-01-05&sections=${ids.secA}`)
    ).json();
    expect(sheet).toMatchObject({ publishAt: '2099-01-05T15:00', maxMb: 1 });
  });

  it('refuses a homework file larger than the school allows', async () => {
    const reg = await inject({
      method: 'POST',
      url: '/platform/files',
      headers: h(classTeacher),
      json: {
        fileName: 'big.pdf',
        contentType: 'application/pdf',
        sizeBytes: 2 * 1024 * 1024,
        classification: 'internal',
      },
    });
    expect(reg.statusCode).toBe(201);
    const fileId = reg.json().file.id as string;
    await withMigrator((c) => c.query(`UPDATE files SET status = 'ready' WHERE id = $1`, [fileId]));
    const res = await inject({
      method: 'POST',
      url: '/academics/daily-work/sheet',
      headers: h(classTeacher),
      json: {
        date: '2026-10-08',
        classSectionIds: [ids.secA],
        rows: [{ subjectId: ids.ENG, homework: 'See the sheet', homeworkFileIds: [fileId] }],
      },
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().detail).toContain('larger than 1 MB');
  });

  it('downloads the report of what was posted as Excel and PDF', async () => {
    for (const q of ['format=xlsx&kind=daily', 'format=pdf&kind=assignment', 'format=pdf']) {
      const f = await get(
        classTeacher,
        `/academics/daily-work/report?from=2026-10-01&to=2026-10-31&${q}`,
      );
      expect(f.statusCode).toBe(200);
      expect(f.rawPayload.length).toBeGreaterThan(800);
    }
  });

  it('exports teacher assignments by class and by teacher', async () => {
    const byTeacher = (
      await get(admin, `/academics/teacher-assignments?employeeId=${ids.empMt}`)
    ).json().data;
    expect(byTeacher).toHaveLength(2);
    for (const format of ['xlsx', 'pdf']) {
      const f = await get(
        admin,
        `/academics/teacher-assignments/export?format=${format}&classSectionId=${ids.secA}`,
      );
      expect(f.statusCode).toBe(200);
      expect(String(f.headers['content-disposition'])).toContain(`.${format}`);
      expect(f.rawPayload.length).toBeGreaterThan(800);
    }
  });
});
