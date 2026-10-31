/**
 * Exams made easy (docs/design/66): an exam's stage worked out from its data (set-up, marks entry,
 * verification, results), the date sheet's times and note, set-up that never deletes entered marks
 * (a subject or a class with marks stays), a new exam copied from an earlier one, and the entry locks:
 * locking one area needs no unlock right, only opening a locked one does; the general remark written
 * alone keeps "took part in" and "promoted to", and an emptied one goes; the register as a file, and
 * the date sheets of staff and of a family; the exam office enters marks anywhere and never reopens;
 * an exam takes its type's areas (others refused) and a class's mapped indicator set.
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

interface Progress {
  stage: string;
  classes: Array<{
    classId: string;
    subjects: number;
    students: number;
    marks: { slots: number; takers: number; entered: number; verified: number };
    stage: string;
  }>;
  totals: { marks: { takers: number; entered: number; slots: number; verified: number } };
}

describe('exams made easy (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let clerk: SeededUser;
  /** the exam office: sets exams up and locks entry, never opens it again */
  let office: SeededUser;
  let parent: SeededUser;
  /** the ready-made exam office: enters marks anywhere, never reopens */
  let examOffice: SeededUser;
  let classId: string;
  let otherClassId: string;
  let section: string;
  let typeId: string;
  let examId: string;
  const s = stamp('XH');
  const subject: Record<string, string> = {};
  const student: Record<string, string> = {};
  const call = (
    u: SeededUser,
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    json?: unknown,
  ) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const progress = async (id = examId) =>
    (await call(admin, 'GET', `/exams/${id}/progress`)).json() as Progress;
  const subjects = (rows: unknown[], id = examId, k = classId) =>
    call(admin, 'PUT', `/exams/${id}/subjects`, { classId: k, subjects: rows });
  const marks = (subjectId: string, rows: unknown[]) =>
    call(clerk, 'PUT', `/exams/${examId}/marks`, { classSectionId: section, subjectId, rows });
  const status = (action: string, u: SeededUser, subjectId: string) =>
    call(u, 'POST', `/exams/${examId}/entry-status/${action}`, {
      classSectionId: section,
      subjectId,
    });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      clerk = await seedUser(c, school, `${s}-clerk`, 'class_teacher');
      office = await seedUser(c, school, `${s}-office`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      examOffice = await seedUser(c, school, `${s}-exams`, 'exam_office');
      const role = await c.query<{ id: string }>(
        `INSERT INTO roles (school_id, code, name, kind) VALUES ($1, 'lock_desk', 'Lock desk', 'module') RETURNING id::text`,
        [school.id],
      );
      await c.query(
        `INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, 'exams.master.view'), ($1, 'exams.master.manage')`,
        [role.rows[0]!.id],
      );
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES ($1, $2, $3, 'e2e')`,
        [school.id, office.id, role.rows[0]!.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    classId = (
      await call(admin, 'POST', '/academics/classes', {
        code: 'V',
        name: 'Class V',
        displayOrder: 5,
      })
    ).json().id;
    otherClassId = (
      await call(admin, 'POST', '/academics/classes', {
        code: 'IV',
        name: 'Class IV',
        displayOrder: 4,
      })
    ).json().id;
    section = (
      await call(admin, 'POST', `/academics/classes/${classId}/sections`, { name: 'A' })
    ).json().id;
    for (const [code, name] of [
      ['ENG', 'English'],
      ['MAT', 'Mathematics'],
      ['SCI', 'Science'],
    ]) {
      const r = await call(admin, 'POST', '/academics/subjects', {
        code,
        name,
        kind: 'scholastic',
      });
      expect(r.statusCode).toBe(201);
      subject[code!] = r.json().id;
    }
    for (const [i, first] of ['Anu', 'Bela'].entries()) {
      const r = await call(admin, 'POST', '/people/students', {
        admissionNo: `${s}-${String(i + 1)}`,
        firstName: first,
        lastName: 'Hub',
        guardians: [],
        enrolment: { classSectionId: section, rollNo: i + 1 },
      });
      expect(r.statusCode).toBe(201);
      student[first] = r.json().id;
    }
    typeId = (await call(admin, 'POST', '/exams/types', { code: 'HY', name: 'Half-yearly' })).json()
      .id;
    examId = (
      await call(admin, 'POST', '/exams', {
        examTypeId: typeId,
        code: 'HY-2026',
        name: 'Half-yearly 2026',
        classes: [{ classId }, { classId: otherClassId }],
      })
    ).json().id;
  }, 120_000);
  afterAll(async () => {
    await app?.close();
  });

  it('starts in set-up; a paper keeps its date and time; a paper ends after it starts; the note', async () => {
    const list = (await call(admin, 'GET', '/exams')).json().data as Array<{
      id: string;
      progress: Progress;
    }>;
    expect(list.find((e) => e.id === examId)!.progress.stage).toBe('setup');
    const wrong = await subjects([
      {
        subjectId: subject.ENG,
        maxMarks: 50,
        examOn: '2026-09-21',
        startsAt: '12:00',
        endsAt: '09:00',
      },
    ]);
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().type).toBe('exams.paper_time');
    const ok = await subjects([
      {
        subjectId: subject.ENG,
        maxMarks: 50,
        passMarks: 17,
        examOn: '2026-09-21',
        startsAt: '09:00',
        endsAt: '12:00',
      },
      { subjectId: subject.MAT, maxMarks: 50, passMarks: 17, examOn: '2026-09-22' },
    ]);
    expect(ok.statusCode).toBe(200);
    const eng = (
      ok.json().subjects as Array<{ subjectId: string; startsAt: string; endsAt: string }>
    ).find((x) => x.subjectId === subject.ENG)!;
    expect(eng).toMatchObject({ startsAt: '09:00', endsAt: '12:00' });
    const note = await call(admin, 'PATCH', `/exams/${examId}`, {
      dateSheetNote: 'Reporting time 7:45 am.',
    });
    expect(note.json().dateSheetNote).toBe('Reporting time 7:45 am.');
    // Class IV has no subjects yet: the exam is still in set-up
    const p = await progress();
    expect(p.stage).toBe('setup');
    expect(p.classes.find((k) => k.classId === classId)).toMatchObject({
      subjects: 2,
      students: 2,
      stage: 'entry',
      marks: { slots: 2, takers: 4, entered: 0 },
    });
  });

  it('marks entry, then verification; a subject or a class with marks stays in the exam', async () => {
    expect(
      (
        await call(admin, 'PATCH', `/exams/${examId}`, {
          classes: [{ classId }],
        })
      ).statusCode,
    ).toBe(200);
    expect((await progress()).stage).toBe('entry');
    for (const code of ['ENG', 'MAT'])
      expect(
        (
          await marks(subject[code]!, [
            { studentId: student.Anu, marks: 40 },
            { studentId: student.Bela, marks: 30 },
          ])
        ).statusCode,
      ).toBe(200);
    const p = await progress();
    expect(p.stage).toBe('verification');
    expect(p.totals.marks).toMatchObject({ takers: 4, entered: 4, slots: 2, verified: 0 });
    // taking MAT out would delete its marks
    const out = await subjects([{ subjectId: subject.ENG, maxMarks: 50 }]);
    expect(out.statusCode).toBe(409);
    expect(out.json()).toMatchObject({
      type: 'exams.subject_has_marks',
      subjectCode: 'MAT',
      entries: 2,
    });
    const gone = await call(admin, 'PATCH', `/exams/${examId}`, {
      classes: [{ classId: otherClassId }],
    });
    expect(gone.statusCode).toBe(409);
    expect(gone.json()).toMatchObject({ type: 'exams.class_has_marks', classCode: 'V' });
  });

  it('every subject verified: results', async () => {
    for (const code of ['ENG', 'MAT']) {
      expect((await status('submit', clerk, subject[code]!)).statusCode).toBe(201);
      expect((await status('verify', admin, subject[code]!)).statusCode).toBe(201);
    }
    const p = await progress();
    expect(p.stage).toBe('results');
    expect(p.totals.marks.verified).toBe(2);
  });

  it('the general remark alone: "took part in" and "promoted to" are kept; an emptied remark goes', async () => {
    const put = (rows: unknown[]) =>
      call(admin, 'PUT', `/exams/${examId}/remarks`, { classSectionId: section, rows });
    const reg = async () =>
      (
        (
          await call(admin, 'GET', `/exams/${examId}/register?classSectionId=${section}`)
        ).json() as {
          rows: Array<{
            studentId: string;
            remark: string | null;
            participation: string | null;
            promotedTo: string | null;
          }>;
        }
      ).rows;
    expect(
      (
        await put([
          {
            studentId: student.Anu,
            remark: 'Good',
            participation: 'Choir',
            promotedTo: 'Class VI',
          },
          { studentId: student.Bela, remark: 'Fine' },
        ])
      ).statusCode,
    ).toBe(200);
    expect((await put([{ studentId: student.Anu, remark: 'Very good' }])).statusCode).toBe(200);
    let rows = await reg();
    expect(rows.find((r) => r.studentId === student.Anu)).toMatchObject({
      remark: 'Very good',
      participation: 'Choir',
      promotedTo: 'Class VI',
    });
    const cleared = await put([
      { studentId: student.Anu, remark: '' },
      { studentId: student.Bela, remark: '' },
    ]);
    expect(cleared.statusCode).toBe(200);
    rows = await reg();
    expect(rows.find((r) => r.studentId === student.Anu)).toMatchObject({
      remark: null,
      participation: 'Choir',
      promotedTo: 'Class VI',
    });
    expect(rows.find((r) => r.studentId === student.Bela)).toMatchObject({
      remark: null,
      participation: null,
    });
    const left = await withMigrator((c) =>
      c.query(
        `SELECT count(*)::int AS n FROM exam_remarks WHERE exam_id = $1 AND student_id = $2`,
        [examId, student.Bela],
      ),
    );
    expect(left.rows[0]).toEqual({ n: 0 });
  });

  it('a copy takes the classes, subjects and parts, not the dates, times or marks', async () => {
    const from = (
      await call(admin, 'POST', '/exams', {
        examTypeId: typeId,
        code: 'PT-1',
        name: 'Periodic test 1',
        classes: [{ classId }],
      })
    ).json().id as string;
    const set = await subjects(
      [{ subjectId: subject.SCI, maxMarks: 50, examOn: '2026-08-01', startsAt: '09:00' }],
      from,
    );
    const sci = (set.json().subjects as Array<{ id: string; subjectId: string }>).find(
      (x) => x.subjectId === subject.SCI,
    )!;
    expect(
      (
        await call(admin, 'PUT', `/exams/${from}/subjects/${sci.id}/parts`, {
          parts: [
            { name: 'Theory', maxMarks: 30 },
            { name: 'Practical', maxMarks: 20 },
          ],
        })
      ).statusCode,
    ).toBe(200);
    const copy = await call(admin, 'POST', `/exams/${from}/copy`, {
      code: 'PT-2',
      name: 'Periodic test 2',
      startsOn: '2026-11-02',
    });
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ code: 'PT-2', examTypeId: typeId, startsOn: '2026-11-02' });
    expect(copy.json().classes.map((k: { classId: string }) => k.classId)).toEqual([classId]);
    const [row] = copy.json().subjects as Array<{
      subjectId: string;
      maxMarks: string;
      examOn: string | null;
      startsAt: string | null;
      parts: Array<{ name: string; maxMarks: string }>;
    }>;
    expect(row).toMatchObject({ subjectId: subject.SCI, examOn: null, startsAt: null });
    expect(Number(row!.maxMarks)).toBe(50);
    expect(row!.parts.map((x) => [x.name, Number(x.maxMarks)])).toEqual([
      ['Theory', 30],
      ['Practical', 20],
    ]);
    const twice = await call(admin, 'POST', `/exams/${from}/copy`, { code: 'PT-2', name: 'Again' });
    expect(twice.statusCode).toBe(409);
  });

  it('locking one area needs no unlock right; opening a locked one does', async () => {
    const pt = (await call(admin, 'GET', '/exams'))
      .json()
      .data.find((e: { code: string }) => e.code === 'PT-2').id as string;
    const lock = (body: Record<string, boolean>, u = office) =>
      call(u, 'PUT', `/exams/${pt}/class-locks`, { classId, ...body });
    expect((await lock({ remarks: true })).statusCode).toBe(200);
    // the old page sent every box: the ones left open opened nothing
    expect(
      (
        await lock({
          marks: false,
          indicators: false,
          remarks: true,
          attendance: true,
          health: false,
        })
      ).statusCode,
    ).toBe(200);
    const shut = await lock({ remarks: false });
    expect(shut.statusCode).toBe(403);
    const opened = await lock({ remarks: false }, admin);
    expect(opened.statusCode).toBe(200);
    expect(opened.json().classes[0].locks).toMatchObject({ remarks: false, attendance: true });
  });

  it('the register as Excel and PDF; date sheets for staff, and for a family once on the portal', async () => {
    for (const format of ['xlsx', 'pdf']) {
      const f = await call(
        admin,
        'GET',
        `/exams/${examId}/register-sheet?classSectionId=${section}&format=${format}`,
      );
      expect(f.statusCode).toBe(200);
      expect(f.json().filename).toMatch(new RegExp(`^register-hy-2026-v-a\\.${format}$`));
      expect(f.json().base64.length).toBeGreaterThan(100);
    }
    const staff = (await call(admin, 'GET', '/exams/date-sheets')).json().data as Array<{
      code: string;
      note: string | null;
      classes: Array<{ classCode: string; papers: Array<Record<string, string | null>> }>;
    }>;
    const hy = staff.find((e) => e.code === 'HY-2026')!;
    expect(hy.note).toBe('Reporting time 7:45 am.');
    expect(hy.classes[0]!.papers[0]).toEqual({
      subject: 'English',
      examOn: '2026-09-21',
      startsAt: '09:00',
      endsAt: '12:00',
    });
    // a family: the child's papers, once the exam is shown on the portal
    const child = (
      await call(admin, 'POST', '/people/students', {
        admissionNo: `${s}-3`,
        firstName: 'Chitra',
        lastName: 'Hub',
        guardians: [
          {
            guardian: { firstName: 'Meera', lastName: 'Hub', mobile: '9876512377' },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: section, rollNo: 3 },
      })
    ).json().id as string;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876512377' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    const mine = async () =>
      (
        (await call(parent, 'GET', '/exams/mine/date-sheets')).json() as {
          children: Array<{
            student: { id: string };
            exams: Array<{ code: string; papers: Array<{ subject: string }> }>;
          }>;
        }
      ).children.find((x) => x.student.id === child)!.exams;
    expect(await mine()).toEqual([]);
    await call(admin, 'PATCH', `/exams/${examId}`, { showOnPortal: true });
    const shown = await mine();
    expect(shown.map((e) => e.code)).toEqual(['HY-2026']);
    expect(shown[0]!.papers.map((p) => p.subject)).toEqual(['English', 'Mathematics']);
    expect((await call(parent, 'GET', '/exams/date-sheets')).statusCode).toBe(403);
  });

  it('the exam office enters marks for any section without being assigned, and cannot reopen them', async () => {
    const eo = (
      await call(admin, 'POST', '/exams', {
        examTypeId: typeId,
        code: 'EO-1',
        name: 'Exam office check',
        classes: [{ classId }],
      })
    ).json().id as string;
    await subjects([{ subjectId: subject.SCI, maxMarks: 20 }], eo);
    const roster = (
      (
        await call(
          admin,
          'GET',
          `/exams/${eo}/marks?classSectionId=${section}&subjectId=${subject.SCI!}`,
        )
      ).json() as {
        rows: Array<{ studentId: string }>;
      }
    ).rows;
    const put = await call(examOffice, 'PUT', `/exams/${eo}/marks`, {
      classSectionId: section,
      subjectId: subject.SCI,
      rows: roster.map((r, i) =>
        i === 0 ? { studentId: r.studentId, code: 'AB' } : { studentId: r.studentId, marks: 15 },
      ),
    });
    expect(put.statusCode).toBe(200);
    const move = (action: string, extra: Record<string, unknown> = {}) =>
      call(examOffice, 'POST', `/exams/${eo}/entry-status/${action}`, {
        classSectionId: section,
        subjectId: subject.SCI,
        ...extra,
      });
    expect((await move('submit')).statusCode).toBe(201);
    expect((await move('reopen', { note: 'A correction' })).statusCode).toBe(403);
  });

  it('an exam takes its type’s areas (others refused); a class’s mapped set comes with a new exam', async () => {
    const pt = await call(admin, 'POST', '/exams/types', {
      code: 'PTX',
      name: 'Periodic test',
      areas: ['marks'],
    });
    expect(pt.json().areas).toEqual(['marks']);
    // a set of indicators mapped to Class V
    const set = await call(admin, 'PUT', '/exams/indicator-sets', {
      code: 'COX',
      name: 'Co-scholastic',
      kind: 'indicators',
      grades: ['A', 'B', 'C'],
      levelWords: {},
      indicators: [{ code: 'ART', name: 'Art', area: 'Co-scholastic', sortOrder: 1 }],
    });
    const setId = set.json().id as string;
    expect(
      (await call(admin, 'PUT', `/exams/indicator-sets/${setId}/classes`, { classIds: [classId] }))
        .statusCode,
    ).toBe(200);
    const listed = (await call(admin, 'GET', '/exams/indicator-sets')).json().data as Array<{
      id: string;
      classIds: string[];
    }>;
    expect(listed.find((x) => x.id === setId)!.classIds).toEqual([classId]);
    // a term exam (every area) gives Class V its set; the periodic test (marks only) none
    const term = (
      await call(admin, 'POST', '/exams', {
        examTypeId: typeId,
        code: 'T-AREAS',
        name: 'Term',
        classes: [{ classId }],
      })
    ).json();
    expect(term.areas).toEqual(['marks', 'indicators', 'remarks', 'attendance', 'health']);
    expect(term.classes[0].indicatorSetId).toBe(setId);
    const test = (
      await call(admin, 'POST', '/exams', {
        examTypeId: pt.json().id,
        code: 'PT-AREAS',
        name: 'Periodic',
        classes: [{ classId }],
      })
    ).json();
    expect(test.areas).toEqual(['marks']);
    expect(test.classes[0].indicatorSetId).toBeNull();
    const art = (
      (await call(admin, 'GET', '/exams/indicator-sets')).json().data as Array<{
        id: string;
        indicators: Array<{ id: string }>;
      }>
    ).find((x) => x.id === setId)!.indicators[0]!.id;
    const off = await call(admin, 'PUT', `/exams/${test.id as string}/indicators`, {
      classSectionId: section,
      rows: [{ studentId: student.Anu, indicatorId: art, grade: 'A' }],
    });
    expect(off.statusCode).toBe(409);
    expect(off.json()).toMatchObject({ type: 'exams.area_off', area: 'indicators' });
    const remarks = await call(admin, 'PUT', `/exams/${test.id as string}/remarks`, {
      classSectionId: section,
      rows: [{ studentId: student.Anu, remark: 'Good' }],
    });
    expect(remarks.json()).toMatchObject({ type: 'exams.area_off', area: 'remarks' });
    expect((await call(admin, 'GET', `/exams/${test.id as string}/progress`)).json()).toMatchObject(
      { areas: ['marks'], stage: 'setup' },
    );
    // indicators taken later: the class's set comes then
    const on = await call(admin, 'PATCH', `/exams/${test.id as string}`, {
      areas: ['marks', 'indicators'],
    });
    expect(on.json().classes[0].indicatorSetId).toBe(setId);
  });
});
