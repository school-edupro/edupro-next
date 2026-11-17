/**
 * CBSE board result analysis, phase B (docs/design/88): each saved candidate's student and details (from the record,
 * or the school's old details sheet), reviewing the ones not found, the CBSE subject codes, and the teachers.
 * All names and numbers are invented.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
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

describe('CBSE board results: students, details, subjects, teachers (e2e, docs/design/88 phase B)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let auditor: SeededUser;
  let s = '';
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const post = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });
  const R = ['28100001', '28100002', '28100003', '28100004'];
  const st: Record<string, string> = {};
  const sec: Record<string, string> = {};
  const emp: Record<string, string> = {};
  let importId = '';
  const cand: Record<string, string> = {};

  const five = (k: number): Array<[string, string, string]> => [
    ['184', String(70 + k), 'B1'],
    ['085', String(80 + k), 'A2'],
    ['041', String(60 + k), 'B2'],
    ['086', String(90 - k), 'A1'],
    ['087', String(75 + k), 'B1'],
  ];
  const fileOf = (): FixtureCandidate[] => [
    { roll: R[0]!, sex: 'F', name: 'ANU DETAIL', subjects: five(0), result: 'PASS' },
    { roll: R[1]!, sex: 'M', name: 'BALA DETAIL', subjects: five(1), result: 'PASS' },
    // the record of CHITRA DETAIL says male: a name match must agree on sex, so she is not found by name
    { roll: R[2]!, sex: 'F', name: 'CHITRA DETAIL', subjects: five(2), result: 'PASS' },
    {
      roll: R[3]!,
      sex: 'M',
      name: 'DEV UNKNOWN',
      subjects: [...five(3), ['777', '88', 'A2']],
      result: 'PASS',
    },
  ];

  beforeAll(async () => {
    s = stamp('BDT');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      auditor = await seedUser(c, school, `${s}-auditor`, 'auditor');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post('/academics/classes', { code: 'X', name: 'Class X', displayOrder: 10 });
    for (const name of ['A', 'B'])
      sec[name] = (
        await post(`/academics/classes/${cls.json().id as string}/sections`, { name })
      ).json().id as string;
    const people: Array<[string, string, 'male' | 'female', string]> = [
      ['ANU', 'DETAIL', 'female', 'A'],
      ['BALA', 'DETAIL', 'male', 'A'],
      ['CHITRA', 'DETAIL', 'male', 'B'],
      ['ELA', 'SPARE', 'female', 'B'],
    ];
    for (const [k, [first, last, gender, section]] of people.entries()) {
      const r = await post('/people/students', {
        admissionNo: `${s}-${String(k)}`,
        firstName: first,
        lastName: last,
        dob: '2011-05-05',
        gender,
        guardians:
          k === 0
            ? [
                {
                  guardian: {
                    firstName: 'Mala',
                    lastName: 'Detail',
                    mobile: `98765${String(Date.now()).slice(-5)}`,
                  },
                  relation: 'mother',
                  isPrimary: true,
                },
              ]
            : [],
        enrolment: { classSectionId: sec[section], rollNo: k + 1 },
      });
      expect(r.statusCode).toBe(201);
      st[first] = r.json().id as string;
    }
    await withMigrator(async (c) => {
      // the first carries her board roll number; her record: OBC, EWS, CWSN, Hindu, a mother on the staff
      await c.query(`UPDATE enrolments SET board_roll_no = $2 WHERE student_id = $1`, [
        st.ANU,
        R[0],
      ]);
      await c.query(
        `UPDATE students SET category = 'OBC', profile = profile || '{"religion": "Hindu", "ews": "Yes", "cwsn": "Yes"}'::jsonb WHERE id = $1`,
        [st.ANU],
      );
      await c.query(
        `UPDATE guardians g SET profile = COALESCE(g.profile, '{}'::jsonb) || '{"school_staff": "Yes"}'::jsonb
           FROM student_guardians sg WHERE sg.guardian_id = g.id AND sg.student_id = $1`,
        [st.ANU],
      );
      await c.query(
        `INSERT INTO subjects (school_id, code, name) VALUES ($1, 'ENG', 'English'), ($1, 'MAT', 'Mathematics'), ($1, 'SCI', 'Science')`,
        [school.id],
      );
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name)
         VALUES ($1, 'T1', 'Tara', 'Teacher'), ($1, 'T2', 'Omar', 'Other') RETURNING id::text`,
        [school.id],
      );
      [emp.tara, emp.omar] = [e.rows[0]!.id, e.rows[1]!.id];
      // Tara teaches English in both sections (the year's teacher assignments)
      for (const section of [sec.A, sec.B])
        await c.query(
          `INSERT INTO teacher_assignments (school_id, academic_year_id, employee_id, class_section_id, subject_id, kind)
           SELECT $1, $2, $3, $4, id, 'subject_teacher' FROM subjects WHERE school_id = $1 AND code = 'ENG'`,
          [school.id, school.yearId, emp.tara, section],
        );
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it("saving takes each found candidate's details from the record, keeps the board roll number, names the subjects", async () => {
    const u = await post('/exams/board-results/gazette', {
      classLabel: 'X',
      academicYearId: school.yearId,
      fileName: 'x.txt',
      text: gazetteX(fileOf()),
    });
    importId = u.json().id as string;
    // CHITRA: same name, but her record says male — not found by name
    expect(u.json().figures.matched).toEqual({ roll: 1, name: 1, none: 2 });
    expect(
      (await get(`/exams/board-results/imports/${importId}`)).json().subjectNames,
    ).toMatchObject({
      '184': 'English Language and Literature',
    });
    await post(`/exams/board-results/imports/${importId}/commit`, {});
    const rows = await withMigrator((c) =>
      c.query<Record<string, unknown>>(
        `SELECT roll_no, match, section, category, religion, ews, cwsn, staff_ward, boarder, details_from, id::text
           FROM board_candidates WHERE school_id = $1 ORDER BY roll_no`,
        [school.id],
      ),
    );
    for (const r of rows.rows) cand[r.roll_no as string] = r.id as string;
    expect(rows.rows[0]).toMatchObject({
      match: 'roll',
      section: 'A',
      category: 'OBC',
      religion: 'Hindu',
      ews: true,
      cwsn: true,
      staff_ward: true,
      boarder: false,
      details_from: 'record',
    });
    expect(rows.rows[1]).toMatchObject({
      match: 'name',
      section: 'A',
      ews: false,
      details_from: 'record',
    });
    expect(rows.rows[2]).toMatchObject({ match: 'none', section: null, details_from: 'none' });
    // the name-matched student's enrolment keeps the board roll number for the next file
    const roll = await withMigrator((c) =>
      c.query<{ board_roll_no: string }>(
        `SELECT board_roll_no FROM enrolments WHERE student_id = $1`,
        [st.BALA],
      ),
    );
    expect(roll.rows[0]!.board_roll_no).toBe(R[1]);
    // the subjects named on the saved results; codes linked to the school's subjects by name
    const named = await withMigrator((c) =>
      c.query<{ subject_code: string; subject_name: string | null }>(
        `SELECT DISTINCT subject_code, subject_name FROM board_results WHERE school_id = $1 ORDER BY 1`,
        [school.id],
      ),
    );
    expect(named.rows).toEqual([
      { subject_code: '041', subject_name: 'Mathematics (Standard)' },
      { subject_code: '085', subject_name: 'Hindi Course-B' },
      { subject_code: '086', subject_name: 'Science' },
      { subject_code: '087', subject_name: 'Social Science' },
      { subject_code: '184', subject_name: 'English Language and Literature' },
      { subject_code: '777', subject_name: null },
    ]);
  });

  it('review: those not found first with suggestions; a pick links the student (details, roll number); not ours; one student once', async () => {
    const r = await get(`/exams/board-results/imports/${importId}/review`);
    expect(r.statusCode).toBe(200);
    const list = r.json() as {
      candidates: Array<{ id: string; roll: string; match: string; suggested: string[] }>;
      students: Array<{ id: string; name: string }>;
    };
    expect(list.candidates.slice(0, 2).map((x) => x.roll)).toEqual([R[2], R[3]]);
    expect(list.students.map((x) => x.name).sort()).toEqual(['CHITRA DETAIL', 'ELA SPARE']);
    expect(list.candidates[0]!.suggested[0]).toBe(st.CHITRA);
    const pick = await post(`/exams/board-results/candidates/${cand[R[2]!]!}/student`, {
      studentId: st.CHITRA,
    });
    expect(pick.json()).toMatchObject({ match: 'picked' });
    const after = await withMigrator(async (c) => ({
      cand: (
        await c.query<{ section: string; details_from: string }>(
          `SELECT section, details_from FROM board_candidates WHERE id = $1`,
          [cand[R[2]!]],
        )
      ).rows[0],
      results: (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM board_results WHERE candidate_id = $1 AND student_id = $2`,
          [cand[R[2]!], st.CHITRA],
        )
      ).rows[0]!.n,
      roll: (
        await c.query<{ board_roll_no: string }>(
          `SELECT board_roll_no FROM enrolments WHERE student_id = $1`,
          [st.CHITRA],
        )
      ).rows[0]!.board_roll_no,
    }));
    expect(after).toEqual({
      cand: { section: 'B', details_from: 'record' },
      results: 5,
      roll: R[2],
    });
    // the same student cannot be two candidates
    expect(
      (
        await post(`/exams/board-results/candidates/${cand[R[3]!]!}/student`, {
          studentId: st.CHITRA,
        })
      ).statusCode,
    ).toBe(409);
    // the fourth is not ours; then a pick is undone
    expect(
      (
        await post(`/exams/board-results/candidates/${cand[R[3]!]!}/student`, { notOurs: true })
      ).json(),
    ).toMatchObject({ match: 'not_ours' });
    expect(
      (
        await post(`/exams/board-results/candidates/${cand[R[2]!]!}/student`, { studentId: null })
      ).json(),
    ).toMatchObject({ match: 'none' });
    // the auditor looks; changing needs the import right
    expect((await get(`/exams/board-results/imports/${importId}/review`, auditor)).statusCode).toBe(
      200,
    );
    expect(
      (
        await post(
          `/exams/board-results/candidates/${cand[R[2]!]!}/student`,
          { studentId: st.CHITRA },
          auditor,
        )
      ).statusCode,
    ).toBe(403);
    await post(`/exams/board-results/candidates/${cand[R[2]!]!}/student`, { studentId: st.CHITRA });
  });

  it('subjects: seeded and linked by name; a code CBSE printed added unnamed; renamed (the results follow); no code twice', async () => {
    const r = await get('/exams/board-results/subjects?classLabel=X');
    const rows = r.json().rows as Array<{
      id: string;
      code: string;
      name: string | null;
      subject: { name: string } | null;
    }>;
    expect(rows[0]).toMatchObject({ code: '777', name: null });
    expect(rows.find((x) => x.code === '184')!.subject).toMatchObject({ name: 'English' });
    expect(rows.find((x) => x.code === '041')!.subject).toMatchObject({ name: 'Mathematics' });
    expect(rows.find((x) => x.code === '086')!.subject).toMatchObject({ name: 'Science' });
    const id777 = rows[0]!.id;
    const put = await inject({
      method: 'PUT',
      url: `/exams/board-results/subjects/${id777}`,
      headers: h(),
      json: { name: 'Robotics', kind: 'skill', subjectId: null },
    });
    expect(put.statusCode).toBe(200);
    const named = await withMigrator((c) =>
      c.query<{ subject_name: string }>(
        `SELECT DISTINCT subject_name FROM board_results WHERE school_id = $1 AND subject_code = '777'`,
        [school.id],
      ),
    );
    expect(named.rows).toEqual([{ subject_name: 'Robotics' }]);
    expect(
      (
        await post('/exams/board-results/subjects', {
          classLabel: 'X',
          code: '184',
          name: 'English',
          kind: 'language',
          subjectId: null,
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await post('/exams/board-results/subjects', {
          classLabel: 'X',
          code: '123',
          name: 'Something New',
          kind: 'additional',
          subjectId: null,
        })
      ).statusCode,
    ).toBe(201);
  });

  it("teachers: the year's assignments; an override for a whole section and for some roll numbers; removed", async () => {
    const t = await get('/exams/board-results/teachers?classLabel=X');
    expect(t.json().examYear).toBe(2027);
    type Row = {
      section: string;
      code: string;
      teachers: Array<{ name: string | null; candidates: number }>;
      overrides: Array<{ id: string }>;
    };
    const cell = (rows: Row[], section: string, code: string) =>
      rows.find((x) => x.section === section && x.code === code)!;
    expect(cell(t.json().rows, 'A', '184').teachers).toEqual([
      { name: 'Tara Teacher', candidates: 2 },
    ]);
    expect(cell(t.json().rows, 'A', '041').teachers).toEqual([{ name: null, candidates: 2 }]);
    const whole = await post('/exams/board-results/teachers', {
      classLabel: 'X',
      examYear: 2027,
      section: 'A',
      code: '041',
      employeeId: emp.omar,
    });
    expect(whole.statusCode).toBe(201);
    await post('/exams/board-results/teachers', {
      classLabel: 'X',
      examYear: 2027,
      section: 'A',
      code: '184',
      teacherName: 'Visiting Faculty',
      rolls: [R[1]],
    });
    const t2 = (await get('/exams/board-results/teachers?classLabel=X&examYear=2027')).json()
      .rows as Row[];
    expect(cell(t2, 'A', '041').teachers).toEqual([{ name: 'Omar Other', candidates: 2 }]);
    expect(cell(t2, 'A', '184').teachers).toEqual([
      { name: 'Tara Teacher', candidates: 1 },
      { name: 'Visiting Faculty', candidates: 1 },
    ]);
    const del = await inject({
      method: 'DELETE',
      url: `/exams/board-results/teachers/${whole.json().id as string}`,
      headers: h(),
    });
    expect(del.statusCode).toBe(200);
    expect(
      cell((await get('/exams/board-results/teachers?classLabel=X')).json().rows, 'A', '041')
        .teachers,
    ).toEqual([{ name: null, candidates: 2 }]);
  });

  it("the school's old details sheet: details overridden, a candidate linked by admission number, teachers set; refresh takes the record again", async () => {
    const wb = new ExcelJS.Workbook();
    const one = wb.addWorksheet('Sheet1');
    one.addRow([
      'BoardRollNo',
      'StudentName',
      'SchoolNumber / Admission Number',
      'Section',
      'Category (Boarder / Staff / Other)',
      'SCSTOBCGEN',
      'Religion (Hindu / Muslim / Christian / Sikh / Jainism / Buddhism / Other)',
      'EWS (Specify Y for EWS Students)',
      'CWSN (Specify Y fro CWSN students)',
    ]);
    one.addRow([R[0], 'ANU DETAIL', `${s}-0`, 'A', 'Boarder', 'OBC', 'Hindu', 'N', 'Y']);
    one.addRow([R[3], 'DEV UNKNOWN', `${s}-3`, 'B', 'Other', 'GEN', '', '', '']);
    one.addRow(['28199999', 'NOT IN FILE', '', 'A', 'Other', 'GEN', '', '', '']);
    const two = wb.addWorksheet('Sheet2');
    two.addRow([
      'Section',
      'SubjectCode',
      'Teacher',
      'Board_RollNumbers_seperated_by_comma_leave_blank_for_whole_class',
    ]);
    two.addRow(['B', '041', 'Omar Other', '']);
    two.addRow(['A', '085', 'Guest Hindi Teacher', `${R[0]!}, ${R[1]!}`]);
    const fileBase64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    // DEV UNKNOWN was "not ours"; set him free so the sheet's admission number can link him (to ELA's number: a stand-in)
    await post(`/exams/board-results/candidates/${cand[R[3]!]!}/student`, { studentId: null });
    const r = await post(`/exams/board-results/imports/${importId}/details-sheet`, {
      fileName: 'data.xlsx',
      fileBase64,
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({
      updated: 2,
      linked: 1,
      unknownRolls: ['28199999'],
      teachers: 2,
      teachersMatched: 1,
    });
    const a = await withMigrator((c) =>
      c.query<Record<string, unknown>>(
        `SELECT roll_no, student_id::text, match, section, boarder, staff_ward, ews, cwsn, details_from
           FROM board_candidates WHERE school_id = $1 AND roll_no = ANY($2::text[]) ORDER BY roll_no`,
        [school.id, [R[0], R[3]]],
      ),
    );
    expect(a.rows[0]).toMatchObject({
      boarder: true,
      staff_ward: false,
      ews: false,
      cwsn: true,
      details_from: 'sheet',
    });
    expect(a.rows[1]).toMatchObject({
      student_id: st.ELA,
      match: 'picked',
      section: 'B',
      details_from: 'sheet',
    });
    const t = (await get('/exams/board-results/teachers?classLabel=X')).json().rows as Array<{
      section: string;
      code: string;
      teachers: Array<{ name: string | null; candidates: number }>;
    }>;
    expect(t.find((x) => x.section === 'B' && x.code === '041')!.teachers).toEqual([
      { name: 'Omar Other', candidates: 2 },
    ]);
    expect(t.find((x) => x.section === 'A' && x.code === '085')!.teachers).toEqual([
      { name: 'Guest Hindi Teacher', candidates: 2 },
    ]);
    // the record again: ANU is not a boarder there and her mother is on the staff
    const back = await post(`/exams/board-results/imports/${importId}/refresh`, {});
    expect(back.json().refreshed).toBe(4);
    const again = await withMigrator((c) =>
      c.query<Record<string, unknown>>(
        `SELECT boarder, staff_ward, details_from FROM board_candidates WHERE school_id = $1 AND roll_no = $2`,
        [school.id, R[0]],
      ),
    );
    expect(again.rows[0]).toEqual({ boarder: false, staff_ward: true, details_from: 'record' });
  });
});
