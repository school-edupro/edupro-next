/**
 * Teaching subjects and marks-entry subjects (0084): Physics, Chemistry and Biology sit under Science;
 * teachers are mapped (and give daily work) on what they teach; an exam enters Science in three parts,
 * each by its own teacher, and English in Theory and Practical; the subject's marks are the sum.
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

describe('subject groups and exam parts (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let physics: SeededUser;
  let chemistry: SeededUser;
  let classId: string;
  let section: string;
  let examId: string;
  const subject: Record<string, string> = {};
  const students: string[] = [];
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });
  const post = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'PUT', url, headers: h(u), json });
  type ExamSubject = {
    id: string;
    subjectCode: string;
    maxMarks: string;
    parts: Array<{ id: string; name: string; maxMarks: string }>;
    children: Array<{ code: string }>;
  };
  const examSubject = async (code: string) =>
    ((await get(`/exams/${examId}`)).json().subjects as ExamSubject[]).find(
      (x) => x.subjectCode === code,
    )!;

  beforeAll(async () => {
    const s = stamp('EP');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      physics = await seedUser(c, school, `${s}-phy`);
      chemistry = await seedUser(c, school, `${s}-che`);
      for (const [code, u] of [
        ['TPHY', physics],
        ['TCHE', chemistry],
      ] as const)
        await c.query(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, $2, 'Teacher', $2, $3)`,
          [school.id, code, u.id],
        );
    });
    app = await createApp();
    inject = injector(app);
    classId = (
      await post('/academics/classes', admin, { code: 'IX', name: 'Class IX', displayOrder: 9 })
    ).json().id;
    section = (await post(`/academics/classes/${classId}/sections`, admin, { name: 'A' })).json()
      .id;
    for (const [code, name] of [
      ['SCI', 'Science'],
      ['ENG', 'English'],
    ]) {
      const r = await post('/academics/subjects', admin, { code, name, kind: 'scholastic' });
      expect(r.statusCode).toBe(201);
      subject[code!] = r.json().id;
    }
    for (const [i, first] of ['Asha', 'Bhanu'].entries()) {
      const r = await post('/people/students', admin, {
        admissionNo: `${s}-${String(i + 1)}`,
        firstName: first,
        lastName: 'Parts',
        guardians: [],
        enrolment: { classSectionId: section, rollNo: i + 1 },
      });
      expect(r.statusCode).toBe(201);
      students.push(r.json().id);
    }
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it('teaching subjects sit under a report-card subject; one level only', async () => {
    for (const [code, name] of [
      ['PHY', 'Physics'],
      ['CHE', 'Chemistry'],
      ['BIO', 'Biology'],
    ]) {
      const r = await post('/academics/subjects', admin, {
        code,
        name,
        kind: 'scholastic',
        parentId: subject.SCI,
      });
      expect(r.statusCode).toBe(201);
      expect(r.json()).toMatchObject({ parentId: subject.SCI, parentCode: 'SCI' });
      subject[code!] = r.json().id;
    }
    // a part cannot be a parent, and a parent cannot become a part
    expect(
      (
        await post('/academics/subjects', admin, {
          code: 'OPT',
          name: 'Optics',
          parentId: subject.PHY,
        })
      ).statusCode,
    ).toBe(400);
    const up = await inject({
      method: 'PATCH',
      url: `/academics/subjects/${subject.SCI}`,
      headers: h(),
      json: {
        code: 'SCI',
        name: 'Science',
        kind: 'scholastic',
        displayOrder: 0,
        status: 'active',
        parentId: subject.ENG,
      },
    });
    expect(up.statusCode).toBe(400);
  });

  it('a subject teacher gives daily work only for the subjects mapped to them', async () => {
    const emps = (await get('/people/employees?size=20')).json().data as Array<{
      id: string;
      employeeCode: string;
    }>;
    const emp = (code: string) => emps.find((e) => e.employeeCode === code)!.id;
    for (const [code, subjectId] of [
      ['TPHY', subject.PHY],
      ['TCHE', subject.CHE],
      ['TCHE', subject.BIO], // the Chemistry teacher takes Biology too
    ] as const)
      expect(
        (
          await post('/academics/teacher-assignments', admin, {
            employeeId: emp(code),
            classSectionId: section,
            kind: 'subject_teacher',
            subjectId,
          })
        ).statusCode,
      ).toBe(201);
    const work = (subjectId: string | undefined) =>
      post('/academics/daily-work', physics, {
        classSectionId: section,
        subjectId,
        kind: 'homework',
        title: 'Numericals',
        body: 'Chapter 3, questions 1 to 5',
      });
    expect((await work(subject.PHY)).statusCode).toBe(201);
    const wrong = await work(subject.CHE);
    expect(wrong.statusCode).toBe(403);
    expect(wrong.json().type).toBe('daily.subject_not_assigned');
    expect((await work(undefined)).statusCode).toBe(403);
  });

  it('an exam enters Science in parts by teaching subject, and English in Theory and Practical', async () => {
    const type = await post('/exams/types', admin, {
      code: 'HY',
      name: 'Half yearly',
      weightage: 30,
    });
    const exam = await post('/exams', admin, {
      examTypeId: type.json().id,
      code: 'HY-2026',
      name: 'Half yearly',
      startsOn: '2026-09-15',
      endsOn: '2026-09-25',
      classes: [{ classId }],
    });
    expect(exam.statusCode).toBe(201);
    examId = exam.json().id;
    const set = await put(`/exams/${examId}/subjects`, admin, {
      classId,
      subjects: [
        { subjectId: subject.SCI, maxMarks: 80, passMarks: 27 },
        { subjectId: subject.ENG, maxMarks: 100, passMarks: 33 },
      ],
    });
    expect(set.statusCode).toBe(200);
    const sci = await examSubject('SCI');
    // the teaching subjects under Science are offered as ready-made parts
    expect(sci.children.map((k) => k.code)).toEqual(['BIO', 'CHE', 'PHY']);
    const other = await put(`/exams/${examId}/subjects/${sci.id}/parts`, admin, {
      parts: [{ name: 'English part', subjectId: subject.ENG, maxMarks: 10 }],
    });
    expect(other.statusCode).toBe(400);
    const parts = await put(`/exams/${examId}/subjects/${sci.id}/parts`, admin, {
      parts: [
        { name: 'Physics', subjectId: subject.PHY, maxMarks: 30 },
        { name: 'Chemistry', subjectId: subject.CHE, maxMarks: 25 },
        { name: 'Biology', subjectId: subject.BIO, maxMarks: 25 },
      ],
    });
    expect(parts.statusCode).toBe(200);
    const after = await examSubject('SCI');
    expect(after.parts.map((p) => `${p.name}:${p.maxMarks}`)).toEqual([
      'Physics:30.00',
      'Chemistry:25.00',
      'Biology:25.00',
    ]);
    expect(after.maxMarks).toBe('80.00');
    const eng = await examSubject('ENG');
    await put(`/exams/${examId}/subjects/${eng.id}/parts`, admin, {
      parts: [
        { name: 'Theory', maxMarks: 80 },
        { name: 'Practical', maxMarks: 20 },
      ],
    });
    expect((await examSubject('ENG')).parts).toHaveLength(2);
  });

  it('each teacher enters their own part; the subject total is the sum; a whole figure is refused', async () => {
    // the Physics teacher sees Science (through the Physics part) and may enter that part only
    const mine = (await get(`/exams/${examId}/entry/sections`, physics)).json();
    const list = (Array.isArray(mine) ? mine : mine.data) as Array<{
      subjects: Array<{ code: string; parts: Array<{ id: string; name: string; mine: boolean }> }>;
    }>;
    expect(list[0]!.subjects.map((x) => x.code)).toEqual(['SCI']);
    const part = (name: string) => list[0]!.subjects[0]!.parts.find((p) => p.name === name)!;
    expect(list[0]!.subjects[0]!.parts.map((p) => [p.name, p.mine])).toEqual([
      ['Physics', true],
      ['Chemistry', false],
      ['Biology', false],
    ]);
    const body = (partId: string, marks: Array<number | null>, absent: boolean[] = []) => ({
      classSectionId: section,
      partId,
      rows: students.map((studentId, i) => ({
        studentId,
        marks: marks[i],
        absent: absent[i] ?? false,
      })),
    });
    expect(
      (await put(`/exams/${examId}/part-marks`, physics, body(part('Chemistry').id, [20, 20])))
        .statusCode,
    ).toBe(403);
    expect(
      (await put(`/exams/${examId}/part-marks`, physics, body(part('Physics').id, [31, 20])))
        .statusCode,
    ).toBe(422);
    expect(
      (await put(`/exams/${examId}/part-marks`, physics, body(part('Physics').id, [24, 18])))
        .statusCode,
    ).toBe(200);
    expect(
      (
        await put(
          `/exams/${examId}/part-marks`,
          chemistry,
          body(part('Chemistry').id, [20, null], [false, true]),
        )
      ).statusCode,
    ).toBe(200);
    expect(
      (await put(`/exams/${examId}/part-marks`, chemistry, body(part('Biology').id, [21.5, 19])))
        .statusCode,
    ).toBe(200);
    const sheet = (
      await get(`/exams/${examId}/marks?classSectionId=${section}&subjectId=${subject.SCI}`)
    ).json();
    expect(sheet.examSubject.parts).toHaveLength(3);
    expect(sheet.rows.map((r: { marks: string }) => r.marks)).toEqual(['65.50', '37.00']);
    expect(sheet.rows[1].parts[part('Chemistry').id]).toEqual({ marks: null, absent: true });
    // one figure for the whole subject is refused while it is in parts
    const whole = await put(`/exams/${examId}/marks`, physics, {
      classSectionId: section,
      subjectId: subject.SCI,
      rows: [{ studentId: students[0], marks: 70 }],
    });
    expect(whole.statusCode).toBe(409);
    expect(whole.json().type).toBe('exams.entered_in_parts');
    // a part with marks cannot be removed; its maximum cannot go below the marks entered
    const sci = await examSubject('SCI');
    expect(
      (
        await put(`/exams/${examId}/subjects/${sci.id}/parts`, admin, {
          parts: sci.parts.slice(1).map((p) => ({ ...p, maxMarks: Number(p.maxMarks) })),
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await put(`/exams/${examId}/subjects/${sci.id}/parts`, admin, {
          parts: sci.parts.map((p) => ({
            id: p.id,
            name: p.name,
            maxMarks: p.name === 'Physics' ? 20 : Number(p.maxMarks),
          })),
        })
      ).statusCode,
    ).toBe(409);
    // registers, analysis and report cards read the subject's own marks row, which carries the total
    const totals = await withMigrator(async (c) =>
      (
        await c.query<{ marks: string }>(
          `SELECT m.marks::text FROM mark_entries m JOIN exam_subjects es ON es.id = m.exam_subject_id
            WHERE es.exam_id = $1 AND es.subject_id = $2 ORDER BY m.marks DESC`,
          [examId, subject.SCI],
        )
      ).rows.map((r) => r.marks),
    );
    expect(totals).toEqual(['65.50', '37.00']);
  });
});
