/**
 * Examinations v2 (docs/design/65). Part 1: ready-made grade scales, the marks codes and what each does
 * to a result, grade-only subjects, each student's subjects (compulsory / optional / additional, "not
 * taken"), results that leave out what a student does not take, locks per entry type, marks and choices
 * by Excel.
 */
import ExcelJS from 'exceljs';
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

describe('examinations v2 (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  /** the exam office: may enter marks (never unlock) */
  let clerk: SeededUser;
  let classId: string;
  let section: string;
  let examId: string;
  const s = stamp('EV');
  const subject: Record<string, string> = {};
  const student: Record<string, string> = {};
  const scale: Record<string, string> = {};
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const marks = (subjectId: string, rows: unknown[], u = clerk) =>
    call(u, 'PUT', `/exams/${examId}/marks`, { classSectionId: section, subjectId, rows });
  const result = (name: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{ total: string; max_total: string; pct: string; result: string }>(
        `SELECT total::text, max_total::text, pct::text, result FROM exam_results WHERE exam_id = $1 AND student_id = $2`,
        [examId, student[name]],
      );
      return r.rows[0]!;
    });
  const xlsx = async (base64: string, edit: (ws: ExcelJS.Worksheet) => void) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(base64, 'base64') as unknown as ArrayBuffer);
    edit(wb.worksheets[0]!);
    return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  };

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      clerk = await seedUser(c, school, `${s}-clerk`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
    classId = (
      await call(admin, 'POST', '/academics/classes', {
        code: 'XI',
        name: 'Class XI',
        displayOrder: 11,
      })
    ).json().id;
    section = (
      await call(admin, 'POST', `/academics/classes/${classId}/sections`, { name: 'A' })
    ).json().id;
    for (const [code, name] of [
      ['ENG', 'English'],
      ['MAT', 'Mathematics'],
      ['AI', 'Artificial Intelligence'],
      ['ART', 'Art'],
    ]) {
      const r = await call(admin, 'POST', '/academics/subjects', {
        code,
        name,
        kind: 'scholastic',
      });
      expect(r.statusCode).toBe(201);
      subject[code!] = r.json().id;
    }
    for (const [i, first] of ['Asha', 'Bhanu', 'Chitra', 'Dev'].entries()) {
      const r = await call(admin, 'POST', '/people/students', {
        admissionNo: `${s}-${String(i + 1)}`,
        firstName: first,
        lastName: 'Exam',
        guardians: [],
        enrolment: { classSectionId: section, rollNo: i + 1 },
      });
      expect(r.statusCode).toBe(201);
      student[first] = r.json().id;
    }
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it('adds the ready-made grade scales once; lists the marks codes; a school adds its own', async () => {
    const p = await call(admin, 'POST', '/exams/grade-scales/presets');
    expect(p.statusCode).toBe(201);
    for (const x of p.json().data as Array<{ id: string; code: string }>) scale[x.code] = x.id;
    expect(Object.keys(scale)).toEqual(
      expect.arrayContaining(['CBSE_8POINT', 'PRIMARY_6POINT', 'CO_SCHOLASTIC_3']),
    );
    const cbse = (p.json().data as Array<{ code: string; bands: Array<{ grade: string }> }>).find(
      (x) => x.code === 'CBSE_8POINT',
    )!;
    expect(cbse.bands.map((b) => b.grade)).toEqual(['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D', 'E']);
    // a second time adds nothing
    expect((await call(admin, 'POST', '/exams/grade-scales/presets')).json().data).toHaveLength(
      Object.keys(scale).length,
    );
    const codes = await call(admin, 'GET', '/exams/mark-codes');
    expect((codes.json().data as Array<{ code: string }>).map((x) => x.code)).toEqual([
      'AB',
      'ML',
      'EX',
      'NA',
      'OD',
      'L',
      'NEW ADM',
    ]);
    // sports representation: half the maximum
    const own = await call(admin, 'PUT', '/exams/mark-codes', {
      code: 'sr',
      name: 'Sports representation',
      treatment: 'percent',
      value: 50,
      sortOrder: 9,
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().data.at(-1)).toMatchObject({
      code: 'SR',
      treatment: 'percent',
      value: '50.00',
    });
    expect(
      (
        await call(admin, 'PUT', '/exams/mark-codes', {
          code: 'XX',
          name: 'No value',
          treatment: 'fixed',
        })
      ).statusCode,
    ).toBe(400);
  });

  it('a grade-only subject needs a scale; the exam keeps it with the subject', async () => {
    const type = await call(admin, 'POST', '/exams/types', { code: 'T1', name: 'Term 1' });
    const exam = await call(admin, 'POST', '/exams', {
      examTypeId: type.json().id,
      code: 'T1-2026',
      name: 'Term 1',
      classes: [{ classId, gradeScaleId: scale.CBSE_8POINT }],
    });
    expect(exam.statusCode).toBe(201);
    examId = exam.json().id;
    const base = [
      { subjectId: subject.ENG, maxMarks: 100, passMarks: 33 },
      { subjectId: subject.MAT, maxMarks: 100, passMarks: 33 },
      { subjectId: subject.AI, maxMarks: 50 },
    ];
    // the class's CBSE scale serves; a co-scholastic scale of its own is chosen here
    const ok = await call(admin, 'PUT', `/exams/${examId}/subjects`, {
      classId,
      subjects: [
        ...base,
        { subjectId: subject.ART, maxMarks: 0, gradeScaleId: scale.CO_SCHOLASTIC_3 },
      ],
    });
    expect(ok.statusCode).toBe(200);
    expect(
      (
        ok.json().subjects as Array<{ subjectCode: string; maxMarks: string; gradeScaleId: string }>
      ).find((x) => x.subjectCode === 'ART'),
    ).toMatchObject({ maxMarks: '0.00', gradeScaleId: scale.CO_SCHOLASTIC_3 });
  });

  it("records each student's subjects; the marks sheet says who does not take a subject", async () => {
    const empty = (
      await call(admin, 'GET', `/exams/subject-choices?classSectionId=${section}`)
    ).json();
    expect(empty.withChoices).toBe(0);
    // no subjects under Academics: the exam's subjects are offered
    expect(empty.subjects.map((x: { code: string }) => x.code).sort()).toEqual([
      'AI',
      'ART',
      'ENG',
      'MAT',
    ]);
    // Asha takes AI as an additional subject; Bhanu does not take it; Chitra and Dev have no choices
    const set = await call(admin, 'PUT', '/exams/subject-choices', {
      classSectionId: section,
      rows: [
        {
          studentId: student.Asha,
          stream: 'Science',
          subjects: [
            { subjectId: subject.ENG, kind: 'compulsory' },
            { subjectId: subject.MAT, kind: 'compulsory' },
            { subjectId: subject.AI, kind: 'additional' },
            { subjectId: subject.ART, kind: 'compulsory' },
          ],
        },
        {
          studentId: student.Bhanu,
          subjects: [
            { subjectId: subject.ENG, kind: 'compulsory' },
            { subjectId: subject.MAT, kind: 'compulsory' },
            { subjectId: subject.ART, kind: 'optional' },
          ],
        },
      ],
    });
    expect(set.statusCode).toBe(200);
    expect(set.json()).toMatchObject({ changed: 7 });
    // the clerk may read but not set them
    expect(
      (
        await call(clerk, 'PUT', '/exams/subject-choices', {
          classSectionId: section,
          rows: [{ studentId: student.Dev, subjects: [] }],
        })
      ).statusCode,
    ).toBe(403);
    const sheet = (
      await call(
        clerk,
        'GET',
        `/exams/${examId}/marks?classSectionId=${section}&subjectId=${subject.AI}`,
      )
    ).json();
    expect(
      Object.fromEntries(
        (sheet.rows as Array<{ name: string; taken: string | null }>).map((r) => [r.name, r.taken]),
      ),
    ).toEqual({
      'Asha Exam': 'additional',
      'Bhanu Exam': null,
      'Chitra Exam': 'compulsory',
      'Dev Exam': 'compulsory',
    });
    expect(sheet.codes.map((x: { code: string }) => x.code)).toContain('SR');
  });

  it('takes marks, codes and grades; refuses a subject not taken, an unknown code and a wrong grade', async () => {
    const no = await marks(subject.AI!, [{ studentId: student.Bhanu, marks: 40 }]);
    expect(no.statusCode).toBe(409);
    expect(no.json()).toMatchObject({ type: 'exams.subject_not_taken' });
    expect(no.json().detail).toContain('Subject choices');
    expect((await marks(subject.MAT!, [{ studentId: student.Asha, code: 'ZZ' }])).json().type).toBe(
      'exams.unknown_code',
    );
    expect((await marks(subject.ART!, [{ studentId: student.Asha, grade: 'Z' }])).json().type).toBe(
      'exams.grade_not_allowed',
    );
    for (const [sub, rows] of [
      [
        subject.ENG,
        [
          { studentId: student.Asha, marks: 70 },
          { studentId: student.Bhanu, marks: 50 },
          { studentId: student.Chitra, marks: 40 },
          { studentId: student.Dev, marks: 20 },
        ],
      ],
      [
        subject.MAT,
        [
          { studentId: student.Asha, marks: 80 },
          { studentId: student.Bhanu, code: 'ml' },
          { studentId: student.Chitra, absent: true },
          { studentId: student.Dev, marks: 60 },
        ],
      ],
      [
        subject.AI,
        [
          { studentId: student.Asha, marks: 45 },
          { studentId: student.Chitra, marks: 30 },
          { studentId: student.Dev, code: 'SR' },
        ],
      ],
      [
        subject.ART,
        [
          { studentId: student.Asha, grade: 'A' },
          { studentId: student.Bhanu, grade: 'B' },
          { studentId: student.Chitra, grade: 'A' },
          { studentId: student.Dev, code: 'EX' },
        ],
      ],
    ] as const) {
      const r = await marks(sub!, rows as unknown as unknown[]);
      expect(r.statusCode).toBe(200);
    }
    const mat = (
      await call(
        clerk,
        'GET',
        `/exams/${examId}/marks?classSectionId=${section}&subjectId=${subject.MAT}`,
      )
    ).json().rows as Array<{
      name: string;
      marks: string | null;
      code: string | null;
      absent: boolean;
    }>;
    expect(mat.find((r) => r.name === 'Bhanu Exam')).toMatchObject({
      marks: null,
      code: 'ML',
      absent: false,
    });
    expect(mat.find((r) => r.name === 'Chitra Exam')).toMatchObject({ code: 'AB', absent: true });
  });

  it('results leave out what a student does not take, additional and grade-only subjects; codes count as set', async () => {
    expect((await call(admin, 'POST', `/exams/${examId}/results/compute`)).statusCode).toBe(201);
    // Asha: English 70 + Maths 80 (AI additional, Art graded) = 150 / 200
    expect(await result('Asha')).toMatchObject({
      total: '150.00',
      max_total: '200.00',
      result: 'pass',
    });
    // Bhanu: Maths on medical leave is out of the maximum; no AI
    expect(await result('Bhanu')).toMatchObject({
      total: '50.00',
      max_total: '100.00',
      result: 'pass',
    });
    // Chitra (no choices: every subject): AB counts 0 and fails the subject
    expect(await result('Chitra')).toMatchObject({
      total: '70.00',
      max_total: '250.00',
      result: 'fail',
    });
    // Dev: SR = 50 % of AI's 50; English below the pass marks
    expect(await result('Dev')).toMatchObject({
      total: '105.00',
      max_total: '250.00',
      pct: '42.00',
      result: 'fail',
    });
  });

  it('locks remarks for the class; opening again needs the unlock right', async () => {
    const lock = await call(admin, 'PUT', `/exams/${examId}/class-locks`, {
      classId,
      remarks: true,
    });
    expect(lock.statusCode).toBe(200);
    expect(lock.json().classes[0].locks).toEqual({
      indicators: false,
      remarks: true,
      attendance: false,
      health: false,
    });
    const r = await call(clerk, 'PUT', `/exams/${examId}/remarks`, {
      classSectionId: section,
      rows: [{ studentId: student.Asha, remark: 'Good work' }],
    });
    expect(r.statusCode).toBe(409);
    expect(r.json().detail).toContain('Remarks entry is locked');
    // attendance stays open
    expect(
      (
        await call(clerk, 'PUT', `/exams/${examId}/attendance`, {
          classSectionId: section,
          rows: [{ studentId: student.Asha, daysPresent: 90, daysTotal: 100 }],
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (await call(clerk, 'PUT', `/exams/${examId}/class-locks`, { classId, remarks: false }))
        .statusCode,
    ).toBe(403);
    expect(
      (await call(admin, 'PUT', `/exams/${examId}/class-locks`, { classId, remarks: false }))
        .statusCode,
    ).toBe(200);
  });

  it('marks by Excel: the sheet lists who takes the subject, rows are checked, then saved', async () => {
    const dl = await call(
      clerk,
      'GET',
      `/exams/${examId}/marks/excel?classSectionId=${section}&subjectId=${subject.AI}`,
    );
    expect(dl.statusCode).toBe(200);
    const header: string[] = [];
    const names: string[] = [];
    let file = await xlsx(dl.json().base64 as string, (ws) => {
      (ws.getRow(1).values as string[]).slice(1).forEach((v) => header.push(String(v)));
      ws.eachRow((row, n) => {
        if (n > 1) names.push(String(row.getCell(3).value));
      });
      // Chitra 35, Dev a code nobody knows
      ws.getRow(3).getCell(4).value = 35;
      ws.getRow(4).getCell(4).value = 'QQ';
    });
    expect(header).toEqual(['Admission no *', 'Roll no', 'Name', 'Marks (out of 50)']);
    expect(names).toEqual(['Asha Exam', 'Chitra Exam', 'Dev Exam']);
    const url = `/exams/${examId}/marks/upload`;
    const bad = await call(clerk, 'POST', url, {
      classSectionId: section,
      subjectId: subject.AI,
      file,
      apply: true,
    });
    expect(bad.statusCode).toBe(201);
    expect(bad.json()).toMatchObject({ errors: 1, applied: false });
    expect(bad.json().rows[2].error).toContain('not 0 to 50 or a code');
    file = await xlsx(file, (ws) => {
      ws.getRow(4).getCell(4).value = 'ab';
    });
    const good = await call(clerk, 'POST', url, {
      classSectionId: section,
      subjectId: subject.AI,
      file,
      apply: true,
    });
    expect(good.json()).toMatchObject({ errors: 0, ready: 3, applied: true });
    const ai = (
      await call(
        clerk,
        'GET',
        `/exams/${examId}/marks?classSectionId=${section}&subjectId=${subject.AI}`,
      )
    ).json().rows as Array<{ name: string; marks: string | null; code: string | null }>;
    expect(ai.find((r) => r.name === 'Chitra Exam')!.marks).toBe('35.00');
    expect(ai.find((r) => r.name === 'Dev Exam')!.code).toBe('AB');
    // a grade-only subject's sheet takes grades
    const art = await call(
      clerk,
      'GET',
      `/exams/${examId}/marks/excel?classSectionId=${section}&subjectId=${subject.ART}`,
    );
    const artFile = await xlsx(art.json().base64 as string, (ws) => {
      ws.getRow(2).getCell(4).value = 'C';
    });
    expect(
      (
        await call(clerk, 'POST', url, {
          classSectionId: section,
          subjectId: subject.ART,
          file: artFile,
          apply: true,
        })
      ).json(),
    ).toMatchObject({ errors: 0, applied: true });
  });

  it('subject choices by Excel; filling the class subjects gives the rest the compulsory ones', async () => {
    const dl = await call(admin, 'GET', `/exams/subject-choices/excel?classSectionId=${section}`);
    expect(dl.statusCode).toBe(200);
    // Dev: English and Maths only
    const file = await xlsx(dl.json().base64 as string, (ws) => {
      const heads = Array.from(ws.getRow(1).values as string[], (v) => String(v ?? ''));
      const col = (code: string) => heads.findIndex((v) => v.startsWith(`${code} ·`));
      const dev = ws.getRow(5);
      expect(String(dev.getCell(2).value)).toBe('Dev Exam');
      dev.getCell(col('ENG')).value = 'C';
      dev.getCell(col('MAT')).value = 'c';
    });
    const up = await call(admin, 'POST', '/exams/subject-choices/upload', {
      classSectionId: section,
      file,
      apply: true,
    });
    expect(up.json()).toMatchObject({ errors: 0, applied: true });
    const after = (
      await call(admin, 'GET', `/exams/subject-choices?classSectionId=${section}`)
    ).json();
    expect(after.withChoices).toBe(3);
    expect(after.rows.find((r: { name: string }) => r.name === 'Dev Exam').subjects).toHaveLength(
      2,
    );
    // Chitra has none: the class's compulsory subjects (all four: none is elective)
    const fill = await call(admin, 'POST', '/exams/subject-choices/defaults', {
      classSectionId: section,
    });
    expect(fill.json()).toMatchObject({ filled: 1 });
    const chitra = fill.json().rows.find((r: { name: string }) => r.name === 'Chitra Exam');
    expect(chitra.subjects).toHaveLength(4);
  });
});
