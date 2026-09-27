/**
 * Sprint 6 end to end: subjects and class mapping, teacher assignments that create roles and scopes,
 * timetable with the teacher conflict check, CSV import dry run and commit, student status history.
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

describe('academics setup and imports (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser; // gets a login but no role; assignments must grant one
  let viewer: SeededUser; // class_teacher template without scopes: unrestricted read
  let classId: string;
  let sectionA: string;
  let sectionB: string;
  let employeeId: string;
  let otherEmployeeId: string;
  let mathsId: string;
  let englishId: string;
  let periodId: string;

  beforeAll(async () => {
    const s = stamp('S6');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
      viewer = await seedUser(c, school, `${s}-viewer`, 'class_teacher');
      const e1 = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'T01', 'Tara', 'Teacher', $2) RETURNING id::text`,
        [school.id, teacher.id],
      );
      employeeId = e1.rows[0]!.id;
      const e2 = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name) VALUES ($1, 'T02', 'Omar', 'Other') RETURNING id::text`,
        [school.id],
      );
      otherEmployeeId = e2.rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const h = headersFor(admin.sub, school.id);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h,
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    classId = cls.json().id;
    for (const name of ['A', 'B']) {
      const sec = await inject({
        method: 'POST',
        url: `/academics/classes/${classId}/sections`,
        headers: h,
        json: { name, capacity: 40 },
      });
      if (name === 'A') sectionA = sec.json().id;
      else sectionB = sec.json().id;
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---- subjects ---------------------------------------------------------------------------------
  it('admin creates subjects and maps them to a class for the working year', async () => {
    const h = headersFor(admin.sub, school.id);
    const maths = await inject({
      method: 'POST',
      url: '/academics/subjects',
      headers: h,
      json: { code: 'MAT', name: 'Mathematics', displayOrder: 3 },
    });
    expect(maths.statusCode).toBe(201);
    mathsId = maths.json().id;
    const english = await inject({
      method: 'POST',
      url: '/academics/subjects',
      headers: h,
      json: { code: 'ENG', name: 'English', kind: 'language', displayOrder: 1 },
    });
    englishId = english.json().id;
    const dup = await inject({
      method: 'POST',
      url: '/academics/subjects',
      headers: h,
      json: { code: 'MAT', name: 'Again' },
    });
    expect(dup.statusCode).toBe(409);

    const set = await inject({
      method: 'PUT',
      url: `/academics/classes/${classId}/subjects`,
      headers: h,
      json: {
        subjects: [
          { subjectId: englishId, periodsPerWeek: 6 },
          { subjectId: mathsId, periodsPerWeek: 7 },
        ],
      },
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().data.map((x: { code: string }) => x.code)).toEqual(['ENG', 'MAT']);

    const remove = await inject({
      method: 'DELETE',
      url: `/academics/subjects/${mathsId}`,
      headers: h,
    });
    expect(remove.statusCode).toBe(409);
    expect(remove.json()).toMatchObject({ type: 'academics.subject.in_use' });
  });

  it('a class teacher can view subjects but not manage them', async () => {
    const h = headersFor(viewer.sub, school.id);
    const list = await inject({ method: 'GET', url: '/academics/subjects', headers: h });
    expect(list.statusCode).toBe(200);
    expect(list.json().page.total).toBe(2);
    const create = await inject({
      method: 'POST',
      url: '/academics/subjects',
      headers: h,
      json: { code: 'SCI', name: 'Science' },
    });
    expect(create.statusCode).toBe(403);
    expect(create.json()).toMatchObject({ permission: 'academics.subject.manage' });
  });

  // ---- teacher assignments drive RBAC -----------------------------------------------------------
  it('an employee without roles is denied until an assignment exists', async () => {
    const res = await inject({
      method: 'GET',
      url: '/people/students',
      headers: headersFor(teacher.sub, school.id),
    });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ type: 'permission-denied' });
  });

  it('assigning a class teacher grants the template role scoped to that section', async () => {
    const h = headersFor(admin.sub, school.id);
    const res = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h,
      json: { employeeId, classSectionId: sectionA, kind: 'class_teacher' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ employeeCode: 'T01', classCode: 'VI', section: 'A' });

    const second = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h,
      json: { employeeId: otherEmployeeId, classSectionId: sectionA, kind: 'class_teacher' },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ type: 'assignment.class_teacher_exists' });

    const me = await inject({
      method: 'GET',
      url: '/me',
      headers: headersFor(teacher.sub, school.id),
    });
    expect(me.json().permissions).toContain('people.student.view');

    const th = headersFor(teacher.sub, school.id);
    const sections = await inject({
      method: 'GET',
      url: `/academics/classes/${classId}/sections`,
      headers: th,
    });
    expect(sections.statusCode).toBe(200);
    expect(sections.json().data.map((s: { id: string }) => s.id)).toEqual([sectionA]);

    const mine = await inject({
      method: 'GET',
      url: '/academics/teacher-assignments/mine',
      headers: th,
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data).toHaveLength(1);
  });

  it('a subject teacher needs a subject; ending the last assignment revokes the synced role', async () => {
    const h = headersFor(admin.sub, school.id);
    const missing = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h,
      json: { employeeId, classSectionId: sectionB, kind: 'subject_teacher' },
    });
    expect(missing.statusCode).toBe(400);

    const subj = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h,
      json: { employeeId, classSectionId: sectionB, kind: 'subject_teacher', subjectId: mathsId },
    });
    expect(subj.statusCode).toBe(201);
    const th = headersFor(teacher.sub, school.id);
    const sections = await inject({
      method: 'GET',
      url: `/academics/classes/${classId}/sections`,
      headers: th,
    });
    expect(
      sections
        .json()
        .data.map((s: { id: string }) => s.id)
        .sort(),
    ).toEqual([sectionA, sectionB].sort());

    const list = await inject({
      method: 'GET',
      url: `/academics/teacher-assignments?employeeId=${employeeId}`,
      headers: h,
    });
    expect(list.json().data).toHaveLength(2);
    for (const a of list.json().data as Array<{ id: string }>) {
      const end = await inject({
        method: 'POST',
        url: `/academics/teacher-assignments/${a.id}/end`,
        headers: h,
      });
      expect(end.statusCode).toBe(201);
    }
    const denied = await inject({ method: 'GET', url: '/people/students', headers: th });
    expect(denied.statusCode).toBe(403);
    // re-assign for the timetable tests
    const again = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h,
      json: { employeeId, classSectionId: sectionA, kind: 'class_teacher' },
    });
    expect(again.statusCode).toBe(201);
  });

  // ---- timetable --------------------------------------------------------------------------------
  it('periods and slots; a teacher cannot be in two sections in one period', async () => {
    const h = headersFor(admin.sub, school.id);
    const p1 = await inject({
      method: 'POST',
      url: '/academics/timetable/periods',
      headers: h,
      json: { number: 1, name: 'Period 1', startsAt: '08:00', endsAt: '08:40' },
    });
    expect(p1.statusCode).toBe(201);
    periodId = p1.json().id;
    const brk = await inject({
      method: 'POST',
      url: '/academics/timetable/periods',
      headers: h,
      json: { number: 2, name: 'Break', startsAt: '08:40', endsAt: '09:00', kind: 'break' },
    });
    expect(brk.statusCode).toBe(201);
    const bad = await inject({
      method: 'POST',
      url: '/academics/timetable/periods',
      headers: h,
      json: { number: 3, name: 'x', startsAt: '09:00', endsAt: '08:00' },
    });
    expect(bad.statusCode).toBe(400);

    const a = await inject({
      method: 'PUT',
      url: '/academics/timetable/slots',
      headers: h,
      json: { classSectionId: sectionA, weekday: 1, periodId, subjectId: mathsId, employeeId },
    });
    expect(a.statusCode).toBe(200);
    expect(a.json()).toMatchObject({ subjectCode: 'MAT', employeeName: 'Tara Teacher' });

    const clash = await inject({
      method: 'PUT',
      url: '/academics/timetable/slots',
      headers: h,
      json: { classSectionId: sectionB, weekday: 1, periodId, subjectId: mathsId, employeeId },
    });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ type: 'timetable.teacher_conflict', section: 'VI-A' });

    const inBreak = await inject({
      method: 'PUT',
      url: '/academics/timetable/slots',
      headers: h,
      json: { classSectionId: sectionA, weekday: 1, periodId: brk.json().id, subjectId: mathsId },
    });
    expect(inBreak.statusCode).toBe(409);
    expect(inBreak.json()).toMatchObject({ type: 'timetable.not_teaching_period' });

    // replace the same cell: upsert, not a duplicate
    const replace = await inject({
      method: 'PUT',
      url: '/academics/timetable/slots',
      headers: h,
      json: { classSectionId: sectionA, weekday: 1, periodId, subjectId: englishId, employeeId },
    });
    expect(replace.statusCode).toBe(200);
    expect(replace.json().subjectCode).toBe('ENG');

    const removePeriod = await inject({
      method: 'DELETE',
      url: `/academics/timetable/periods/${periodId}`,
      headers: h,
    });
    expect(removePeriod.statusCode).toBe(409);
  });

  it('teachers read their own week and their sections only', async () => {
    const th = headersFor(teacher.sub, school.id);
    const mine = await inject({ method: 'GET', url: '/academics/timetable/mine', headers: th });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data).toHaveLength(1);
    const own = await inject({
      method: 'GET',
      url: `/academics/timetable/slots?classSectionId=${sectionA}`,
      headers: th,
    });
    expect(own.statusCode).toBe(200);
    const other = await inject({
      method: 'GET',
      url: `/academics/timetable/slots?classSectionId=${sectionB}`,
      headers: th,
    });
    expect(other.statusCode).toBe(403);
    expect(other.json()).toMatchObject({ type: 'scope-denied' });
    const edit = await inject({
      method: 'PUT',
      url: '/academics/timetable/slots',
      headers: th,
      json: { classSectionId: sectionA, weekday: 2, periodId, subjectId: mathsId },
    });
    expect(edit.statusCode).toBe(403);
  });

  // ---- imports ----------------------------------------------------------------------------------
  it('validates a student CSV, reports problems, refuses commit until clean, then commits', async () => {
    const h = headersFor(admin.sub, school.id);
    const csvBad = [
      'admission_no,first_name,last_name,dob,gender,section,roll_no,guardian_name,guardian_mobile,guardian_relation',
      'S001,Aarav,Sharma,2014-05-01,male,VI-A,1,Suresh Sharma,9876543210,father',
      'S001,Isha,Verma,2014-13-01,girl,VI-Z,2,Meena Verma,12345,mother',
      ',Noname,,,,,,,,',
    ].join('\n');
    const bad = await inject({
      method: 'POST',
      url: '/people/imports/validate',
      headers: h,
      json: { kind: 'students', fileName: 'students.csv', csv: csvBad },
    });
    expect(bad.statusCode).toBe(201);
    expect(bad.json()).toMatchObject({
      status: 'validated',
      totalRows: 3,
      okRows: 1,
      rejectedRows: 2,
    });
    const fields = (bad.json().report as Array<{ row: number; field: string }>).map(
      (x) => `${x.row}:${x.field}`,
    );
    expect(fields).toEqual(
      expect.arrayContaining([
        '3:admission_no',
        '3:dob',
        '3:gender',
        '3:guardian_mobile',
        '3:section',
        '4:admission_no',
      ]),
    );
    const refused = await inject({
      method: 'POST',
      url: `/people/imports/${bad.json().id}/commit`,
      headers: h,
    });
    expect(refused.statusCode).toBe(409);
    expect(refused.json()).toMatchObject({ type: 'import.has_rejects' });

    const csvGood = [
      'admission_no,first_name,last_name,dob,gender,section,roll_no,guardian_name,guardian_mobile,guardian_relation',
      'S001,Aarav,Sharma,2014-05-01,male,VI-A,1,Suresh Sharma,9876543210,father',
      'S002,Diya,Sharma,2016-02-11,female,VI-B,1,Suresh Sharma,9876543210,father',
      'S003,Kabir,Khan,2014-08-20,male,,,Imran Khan,9811111111,father',
    ].join('\r\n');
    const good = await inject({
      method: 'POST',
      url: '/people/imports/validate',
      headers: h,
      json: { kind: 'students', csv: csvGood },
    });
    expect(good.json()).toMatchObject({ okRows: 3, rejectedRows: 0 });
    const committed = await inject({
      method: 'POST',
      url: `/people/imports/${good.json().id}/commit`,
      headers: h,
    });
    expect(committed.statusCode).toBe(201);
    expect(committed.json().status).toBe('committed');
    const twice = await inject({
      method: 'POST',
      url: `/people/imports/${good.json().id}/commit`,
      headers: h,
    });
    expect(twice.statusCode).toBe(409);

    const students = await inject({ method: 'GET', url: '/people/students?size=50', headers: h });
    const rows = students.json().data as Array<{
      admissionNo: string;
      enrolment: { section: string } | null;
    }>;
    expect(rows.map((r) => r.admissionNo).sort()).toEqual(['S001', 'S002', 'S003']);
    expect(rows.find((r) => r.admissionNo === 'S002')?.enrolment?.section).toBe('B');
    // siblings share one guardian record
    const s1 = rows.find((r) => r.admissionNo === 'S001') as unknown as { id: string };
    const detail = await inject({ method: 'GET', url: `/people/students/${s1.id}`, headers: h });
    expect(detail.json().siblings.map((s: { admissionNo: string }) => s.admissionNo)).toEqual([
      'S002',
    ]);

    // re-import of an existing admission number is rejected at validation
    const again = await inject({
      method: 'POST',
      url: '/people/imports/validate',
      headers: h,
      json: { kind: 'students', csv: csvGood },
    });
    expect(again.json().rejectedRows).toBe(3);

    const history = await inject({ method: 'GET', url: '/people/imports', headers: h });
    expect(history.json().page.total).toBe(3);
  });

  it('employee CSV import and a teacher denied the import permission', async () => {
    const h = headersFor(admin.sub, school.id);
    const csv =
      'employee_code,first_name,last_name,employee_type,designation,mobile\nE100,Neha,Rao,teaching,TGT English,9800000001\n';
    const ok = await inject({
      method: 'POST',
      url: '/people/imports/validate',
      headers: h,
      json: { kind: 'employees', csv },
    });
    expect(ok.json()).toMatchObject({ okRows: 1, rejectedRows: 0 });
    const committed = await inject({
      method: 'POST',
      url: `/people/imports/${ok.json().id}/commit`,
      headers: h,
    });
    expect(committed.statusCode).toBe(201);
    const denied = await inject({
      method: 'POST',
      url: '/people/imports/validate',
      headers: headersFor(teacher.sub, school.id),
      json: { kind: 'employees', csv },
    });
    expect(denied.statusCode).toBe(403);
  });

  // ---- status history ---------------------------------------------------------------------------
  it('records every status change of a student with the reason', async () => {
    const h = headersFor(admin.sub, school.id);
    const students = await inject({ method: 'GET', url: '/people/students?q=S003', headers: h });
    const kabir = students.json().data[0] as { id: string };
    const upd = await inject({
      method: 'PATCH',
      url: `/people/students/${kabir.id}`,
      headers: h,
      json: { status: 'inactive', statusReason: 'Family moved to Nagpur' },
    });
    expect(upd.statusCode).toBe(200);
    const hist = await inject({
      method: 'GET',
      url: `/people/students/${kabir.id}/status-history`,
      headers: h,
    });
    expect(hist.statusCode).toBe(200);
    expect(hist.json().data).toMatchObject([
      { fromStatus: 'active', toStatus: 'inactive', reason: 'Family moved to Nagpur' },
      { fromStatus: null, toStatus: 'active', reason: 'created' },
    ]);
  });
});
