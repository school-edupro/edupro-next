/**
 * The syllabus behind the lesson planner (0094): the coordinator keeps chapters and topics (on screen or
 * from Excel), the teacher marks a topic done for the section they teach, and coverage, the dashboard
 * and the reports follow.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
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

describe('syllabus and coverage (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let other: SeededUser;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const get = (u: SeededUser, url: string) => inject({ method: 'GET', url, headers: h(u) });
  const post = (u: SeededUser, url: string, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });

  beforeAll(async () => {
    const s = stamp('SY');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-t1`);
      other = await seedUser(c, school, `${s}-t2`);
      for (const [key, u, first] of [
        ['emp1', teacher, 'Tara'],
        ['emp2', other, 'Omar'],
      ] as const)
        ids[key] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, $2, $3, 'Teacher', $4) RETURNING id::text`,
            [school.id, key.toUpperCase(), first, u.id],
          )
        ).rows[0]!.id;
      for (const [code, name] of [
        ['SCI', 'Science'],
        ['MAT', 'Mathematics'],
      ])
        ids[code!] = (
          await c.query<{ id: string }>(
            `INSERT INTO subjects (school_id, code, name, kind) VALUES ($1, $2, $3, 'scholastic') RETURNING id::text`,
            [school.id, code, name],
          )
        ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post(admin, '/academics/classes', {
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
    });
    ids.cls = cls.json().id;
    for (const sec of ['A', 'B'])
      ids[`sec${sec}`] = (
        await post(admin, `/academics/classes/${ids.cls}/sections`, { name: sec })
      ).json().id;
    for (const [emp, sec, sub] of [
      [ids.emp1, ids.secA, ids.SCI],
      [ids.emp2, ids.secB, ids.SCI],
    ])
      expect(
        (
          await post(admin, '/academics/teacher-assignments', {
            employeeId: emp,
            classSectionId: sec,
            kind: 'subject_teacher',
            subjectId: sub,
          })
        ).statusCode,
      ).toBe(201);
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('keeps chapters and topics on screen and from Excel', async () => {
    expect(
      (
        await post(teacher, '/academics/syllabus/chapters', {
          classId: ids.cls,
          subjectId: ids.SCI,
          number: 1,
          name: 'x',
        })
      ).statusCode,
    ).toBe(403);
    const ch = await post(admin, '/academics/syllabus/chapters', {
      classId: ids.cls,
      subjectId: ids.SCI,
      number: 1,
      name: 'Food: where does it come from',
      term: 'Term 1',
      plannedMonth: 4,
    });
    expect(ch.statusCode).toBe(200);
    ids.ch1 = ch.json().id;
    expect(
      (
        await post(admin, '/academics/syllabus/chapters', {
          classId: ids.cls,
          subjectId: ids.SCI,
          number: 1,
          name: 'Again',
        })
      ).statusCode,
    ).toBe(400);
    for (const [n, name] of [
      [1, 'Food variety'],
      [2, 'Plant parts as food'],
    ] as const)
      ids[`t${String(n)}`] = (
        await post(admin, '/academics/syllabus/topics', { chapterId: ids.ch1, number: n, name })
      ).json().id;

    const fmt = await get(admin, '/academics/syllabus/template.xlsx');
    expect(fmt.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Syllabus');
    ws.addRow([
      'Class code',
      'Subject code',
      'Chapter no',
      'Chapter name',
      'Term',
      'Planned month',
      'Topic no',
      'Topic name',
      'Periods',
    ]);
    ws.addRow([
      'VI · Class VI',
      'SCI · Science',
      2,
      'Components of food',
      'Term 1',
      'May',
      1,
      'Nutrients',
      2,
    ]);
    ws.addRow(['VI', 'SCI', 2, 'Components of food', 'Term 1', 'May', 2, 'Balanced diet', '']);
    ws.addRow(['VI', 'XXX', 1, 'Nope', '', '', 1, 'Nope', '']);
    const up = await post(admin, '/academics/syllabus/import', {
      fileBase64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
    });
    expect(up.json()).toMatchObject({ chapters: 1, topics: 2 });
    expect(up.json().problems).toEqual([
      { row: 4, message: 'Subject code is not a subject of the school' },
    ]);
    const tree = (
      await get(admin, `/academics/syllabus/tree?classId=${ids.cls}&subjectId=${ids.SCI}`)
    ).json();
    expect(
      tree.chapters.map((c: { name: string; topics: unknown[] }) => [c.name, c.topics.length]),
    ).toEqual([
      ['Food: where does it come from', 2],
      ['Components of food', 2],
    ]);
  });

  it('lets the teacher of the subject mark a topic for their own section only', async () => {
    const mark = (u: SeededUser, json: Record<string, unknown>) =>
      post(u, '/academics/syllabus/mark', json);
    expect(
      (await mark(teacher, { classSectionId: ids.secA, topicId: ids.t1, status: 'done' }))
        .statusCode,
    ).toBe(200);
    expect(
      (await mark(teacher, { classSectionId: ids.secA, topicId: ids.t2, status: 'not_done' }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await mark(teacher, {
          classSectionId: ids.secA,
          topicId: ids.t2,
          status: 'partial',
        })
      ).statusCode,
    ).toBe(200);
    // not the teacher's section
    expect(
      (await mark(teacher, { classSectionId: ids.secB, topicId: ids.t1, status: 'done' }))
        .statusCode,
    ).toBe(403);
    const mine = (await get(teacher, '/academics/syllabus/mine')).json().data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      section: 'VI-A',
      subject: 'Science',
      topics: 4,
      done: 1,
      partial: 1,
      percent: 38,
    });
    const tree = (
      await get(
        teacher,
        `/academics/syllabus/tree?classId=${ids.cls}&subjectId=${ids.SCI}&classSectionId=${ids.secA}`,
      )
    ).json();
    expect(tree.chapters[0].topics.map((t: { status: string | null }) => t.status)).toEqual([
      'done',
      'partial',
    ]);
  });

  it('shows coverage, the dashboard and the reports to the office', async () => {
    expect((await get(teacher, '/academics/syllabus/coverage')).statusCode).toBe(403);
    const rows = (await get(admin, '/academics/syllabus/coverage')).json().data;
    expect(
      rows.map((r: { section: string; percent: number; teacher: string }) => [
        r.section,
        r.percent,
        r.teacher,
      ]),
    ).toEqual([
      ['VI-A', 38, 'Tara Teacher'],
      ['VI-B', 0, 'Omar Teacher'],
    ]);
    const d = (await get(admin, '/academics/syllabus/dashboard')).json();
    expect(d.kpis).toMatchObject({ topics: 8, done: 1, sections: 2, plansMissing: 2 });
    expect(d.byTeacher[0]).toMatchObject({ label: 'Omar Teacher', percent: 0 });
    for (const q of [
      'report=coverage&format=xlsx',
      'report=missing&format=pdf',
      `report=topics&format=pdf&classSectionId=${ids.secA}&subjectId=${ids.SCI}`,
    ]) {
      const f = await get(admin, `/academics/syllabus/report?${q}`);
      expect(f.statusCode).toBe(200);
      expect(f.rawPayload.length).toBeGreaterThan(800);
    }
    // a chapter a teacher has marked cannot be removed
    expect(
      (
        await inject({
          method: 'DELETE',
          url: `/academics/syllabus/chapters/${ids.ch1}`,
          headers: h(admin),
        })
      ).statusCode,
    ).toBe(409);
  });
});
