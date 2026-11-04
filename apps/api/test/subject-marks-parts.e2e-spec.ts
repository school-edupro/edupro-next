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

interface Line {
  code: string;
  max: number;
  pass: number | null;
  parentId: string | null;
  isPart: boolean;
}
interface Paper {
  id: string;
  classId: string;
  subjectCode: string;
  maxMarks: string;
  marked: boolean;
  differs: boolean;
  parts: Array<{ id: string; name: string; subjectCode: string | null; maxMarks: string }>;
}

/**
 * A line of the subject marks master as a part of its subject (docs/design/70, after part 2; 0303):
 * Geography and Political Science are the parts of Social Science in Class VIII, not papers. Exams build
 * the subject's parts from them and follow them while unmarked; copies and fills keep the parts.
 */
describe('subject marks: part lines (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const s = stamp('SMP');
  const ids: Record<string, string> = {};
  const call = (method: 'GET' | 'POST' | 'PUT' | 'PATCH', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(admin.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const line = (code: string, max: number, pass: number | null, isPart = false) => ({
    subjectId: ids[code]!,
    max,
    pass,
    scaleId: null,
    optional: false,
    isPart,
  });
  const save = (rows: unknown[], typeId = ids.pt, classId = ids.viii) =>
    call('PUT', '/exams/subject-marks', { typeId, classId, rows });
  const list = async (typeId = ids.pt!, classId = ids.viii!) =>
    (await call('GET', `/exams/subject-marks?typeId=${typeId}&classId=${classId}`)).json()
      .rows as Line[];
  const papers = async (examId: string, classId = ids.viii!) =>
    ((await call('GET', `/exams/${examId}`)).json().subjects as Paper[]).filter(
      (x) => x.classId === classId,
    );
  const partsOf = (p: Paper | undefined) =>
    (p?.parts ?? []).map((x) => [x.subjectCode, Number(x.maxMarks)]);

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      const one = async (sql: string, values: unknown[]) =>
        (await c.query<{ id: string }>(sql, values)).rows[0]!.id;
      for (const [key, code, order] of [
        ['vi', 'VI', 6],
        ['viii', 'VIII', 8],
      ] as const)
        ids[key] = await one(
          `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, $2, $3, $4) RETURNING id::text`,
          [school.id, code, `Class ${code}`, order],
        );
      for (const [code, name, order, parent] of [
        ['ENG', 'English', 1, null],
        ['SST', 'Social Science', 2, null],
        ['GEO', 'Geography', 3, 'SST'],
        ['POLS', 'Political Science', 4, 'SST'],
        ['HIST', 'History', 5, 'SST'],
      ] as const)
        ids[code] = await one(
          `INSERT INTO subjects (school_id, code, name, kind, display_order, status, parent_id) VALUES ($1, $2, $3, 'scholastic', $4, 'active', $5) RETURNING id::text`,
          [school.id, code, name, order, parent ? ids[parent] : null],
        );
      for (const [k, subjects] of [
        ['viii', ['ENG', 'SST', 'GEO', 'POLS']],
        ['vi', ['ENG', 'SST', 'GEO', 'HIST']],
      ] as const)
        for (const [i, subj] of subjects.entries())
          await c.query(
            `INSERT INTO class_subjects (school_id, academic_year_id, class_id, subject_id, sort_order) VALUES ($1, $2, $3, $4, $5)`,
            [school.id, school.yearId, ids[k], ids[subj], i + 1],
          );
      for (const [key, code, order] of [
        ['pt', 'PT', 1],
        ['hy', 'HY', 2],
      ] as const)
        ids[key] = await one(
          `INSERT INTO exam_types (school_id, code, name, sort_order) VALUES ($1, $2, $3, $4) RETURNING id::text`,
          [school.id, code, code, order],
        );
    });
    app = await createApp();
    inject = injector(app);
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it('saves part lines: under a subject of the list, a maximum only, adding up to the subject', async () => {
    const bad = async (rows: unknown[], says: string) => {
      const r = await save(rows);
      expect(r.statusCode).toBe(400);
      expect(r.json().detail).toContain(says);
    };
    await bad(
      [line('SST', 35, 12), line('GEO', 13, 5, true), line('POLS', 22, null, true)],
      'GEO is a part',
    );
    await bad([line('GEO', 13, null, true), line('POLS', 22, null, true)], 'its subject must be in the list');
    await bad([line('ENG', 40, null, true)], 'no subject above it');
    await bad(
      [line('SST', 35, 12), line('GEO', 13, null, true), line('POLS', 20, null, true)],
      'add up to 33, not its maximum of 35',
    );
    const ok = await save([
      line('ENG', 40, 13),
      line('SST', 35, 12),
      line('GEO', 13, null, true),
      line('POLS', 22, null, true),
    ]);
    expect(ok.statusCode).toBe(200);
    expect(
      (await list()).map((x) => [x.code, x.max, x.isPart, x.parentId === ids.SST]),
    ).toEqual([
      ['ENG', 40, false, false],
      ['SST', 35, false, false],
      ['GEO', 13, true, true],
      ['POLS', 22, true, true],
    ]);
  });

  it('a new exam holds the subject with its parts, not the part lines as papers', async () => {
    const made = await call('POST', '/exams', {
      examTypeId: ids.pt,
      code: 'PT1',
      name: 'Periodic Test 1',
      classes: [{ classId: ids.viii }],
    });
    expect(made.statusCode).toBe(201);
    ids.pt1 = made.json().id as string;
    const ps = await papers(ids.pt1);
    expect(ps.map((x) => [x.subjectCode, Number(x.maxMarks)])).toEqual([
      ['ENG', 40],
      ['SST', 35],
    ]);
    const sst = ps.find((x) => x.subjectCode === 'SST');
    expect(partsOf(sst)).toEqual([
      ['GEO', 13],
      ['POLS', 22],
    ]);
    expect(sst?.parts.map((x) => x.name)).toEqual(['Geography', 'Political Science']);
    expect(sst?.differs).toBe(false);
    const exam = (await call('GET', `/exams/${ids.pt1}`)).json() as {
      subjectMarks: Array<{ rows: Array<{ code: string; partOf: string | null }> }>;
    };
    expect(exam.subjectMarks[0]!.rows.filter((x) => x.partOf === ids.SST).map((x) => x.code)).toEqual(
      ['GEO', 'POLS'],
    );
  });

  it('the parts follow the master while unmarked; they are not changed in the exam', async () => {
    const saved = await save([
      line('ENG', 40, 13),
      line('SST', 40, 12),
      line('GEO', 18, null, true),
      line('POLS', 22, null, true),
    ]);
    expect(saved.json().followed).toBe(1);
    const sst = (await papers(ids.pt1!)).find((x) => x.subjectCode === 'SST')!;
    expect([Number(sst.maxMarks), partsOf(sst)]).toEqual([
      40,
      [
        ['GEO', 18],
        ['POLS', 22],
      ],
    ]);
    // only the parts changed: they follow too
    expect(
      (
        await save([
          line('ENG', 40, 13),
          line('SST', 40, 12),
          line('GEO', 20, null, true),
          line('POLS', 20, null, true),
        ])
      ).json().followed,
    ).toBe(1);
    expect(partsOf((await papers(ids.pt1!)).find((x) => x.subjectCode === 'SST'))).toEqual([
      ['GEO', 20],
      ['POLS', 20],
    ]);
    const parts = await call('PUT', `/exams/${ids.pt1}/subjects/${sst.id}/parts`, {
      parts: [{ name: 'Theory', maxMarks: 40 }],
    });
    expect(parts.statusCode).toBe(409);
    expect(parts.json().type).toBe('exams.parts_from_master');
    // a part line is not a paper of its own
    const put = await call('PUT', `/exams/${ids.pt1}/subjects`, {
      classId: ids.viii,
      subjects: ['ENG', 'SST', 'GEO'].map((code) => ({
        subjectId: ids[code],
        maxMarks: 40,
        passMarks: null,
        isElective: false,
        gradeScaleId: null,
      })),
    });
    expect(put.statusCode).toBe(409);
    expect(put.json().type).toBe('exams.master_part');
    expect(put.json().detail).toContain('GEO is a part of SST');
  });

  it('marked in a part: the exam keeps its parts and differs; Apply is refused', async () => {
    const sst = (await papers(ids.pt1!)).find((x) => x.subjectCode === 'SST')!;
    await withMigrator(async (c) => {
      const st = await c.query<{ id: string }>(
        `INSERT INTO students (school_id, admission_no, first_name, last_name) VALUES ($1, $2, 'Ravi', 'Part') RETURNING id::text`,
        [school.id, `${s}-1`],
      );
      await c.query(
        `INSERT INTO mark_part_entries (school_id, part_id, student_id, marks) VALUES ($1, $2, $3, 15)`,
        [school.id, sst.parts[0]!.id, st.rows[0]!.id],
      );
    });
    const saved = await save([
      line('ENG', 40, 13),
      line('SST', 40, 12),
      line('GEO', 25, null, true),
      line('POLS', 15, null, true),
    ]);
    expect(saved.json().followed).toBe(0);
    const now = (await papers(ids.pt1!)).find((x) => x.subjectCode === 'SST')!;
    expect([now.marked, now.differs, partsOf(now)]).toEqual([
      true,
      true,
      [
        ['GEO', 20],
        ['POLS', 20],
      ],
    ]);
    const apply = await call('POST', `/exams/${ids.pt1}/subjects/${sst.id}/apply-master`, {
      reason: 'New split',
    });
    expect(apply.statusCode).toBe(409);
    expect(apply.json().type).toBe('exams.parts_marked');
  });

  it('copies keep the parts with their subject: refused where the class does not study them all', async () => {
    // Class VI studies Geography but not Political Science: Social Science would be short of 40
    const short = await call('POST', '/exams/subject-marks/copy', {
      typeId: ids.pt,
      classId: ids.viii,
      toClassIds: [ids.vi],
    });
    expect(short.statusCode).toBe(409);
    expect(short.json().type).toBe('exams.subject_marks_parts');
    expect(await list(ids.pt!, ids.vi!)).toEqual([]);
    // the same class in another exam type: the whole list with its parts
    const hy = await call('POST', '/exams/subject-marks/copy', {
      typeId: ids.pt,
      classId: ids.viii,
      toTypeIds: [ids.hy],
    });
    expect(hy.statusCode).toBe(201);
    expect((await list(ids.hy!, ids.viii!)).map((x) => [x.code, x.max, x.isPart])).toEqual([
      ['ENG', 40, false],
      ['SST', 40, false],
      ['GEO', 25, true],
      ['POLS', 15, true],
    ]);
  });

  it("fills the master from an exam's parts by sub-subject; Excel and PDF say what each is a part of", async () => {
    // a half-yearly for Class VI set up by hand: Social Science in parts by Geography and History
    const ex = await withMigrator(async (c) => {
      const e = await c.query<{ id: string }>(
        `INSERT INTO exams (school_id, academic_year_id, exam_type_id, code, name) VALUES ($1, $2, $3, 'HY1', 'Half yearly') RETURNING id::text`,
        [school.id, school.yearId, ids.hy],
      );
      const id = e.rows[0]!.id;
      await c.query(`INSERT INTO exam_classes (school_id, exam_id, class_id) VALUES ($1, $2, $3)`, [
        school.id,
        id,
        ids.vi,
      ]);
      for (const [subj, max, pass] of [
        ['ENG', 80, 27],
        ['SST', 80, 27],
      ] as const)
        await c.query(
          `INSERT INTO exam_subjects (school_id, exam_id, class_id, subject_id, max_marks, pass_marks) VALUES ($1, $2, $3, $4, $5, $6)`,
          [school.id, id, ids.vi, ids[subj], max, pass],
        );
      for (const [i, [subj, name, max]] of [
        ['GEO', 'Geography', 40],
        ['HIST', 'History', 40],
      ].entries())
        await c.query(
          `INSERT INTO exam_subject_parts (school_id, exam_subject_id, name, subject_id, max_marks, sort_order)
           SELECT $1, es.id, $2, $3, $4, $5 FROM exam_subjects es WHERE es.exam_id = $6 AND es.subject_id = $7`,
          [school.id, name, ids[subj as string], max, i, id, ids.SST],
        );
      return id;
    });
    const filled = await call('POST', '/exams/subject-marks/fill', { examId: ex });
    expect(filled.statusCode).toBe(201);
    expect((await list(ids.hy!, ids.vi!)).map((x) => [x.code, x.max, x.pass, x.isPart])).toEqual([
      ['ENG', 80, 27, false],
      ['SST', 80, 27, false],
      ['GEO', 40, null, true],
      ['HIST', 40, null, true],
    ]);
    for (const [format, sig] of [
      ['xlsx', 'PK'],
      ['pdf', '%PDF'],
    ] as const) {
      const f = await call('GET', `/exams/subject-marks/file?typeId=${ids.hy}&format=${format}`);
      expect(f.statusCode).toBe(200);
      expect(
        Buffer.from(f.json().base64 as string, 'base64')
          .subarray(0, sig.length)
          .toString(),
      ).toBe(sig);
    }
  });
});
