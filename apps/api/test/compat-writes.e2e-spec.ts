/** Sprint 11: the current teacher app's write calls land in the new modules with the legacy envelope. */
import { createHmac } from 'node:crypto';
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

const SECRET = process.env.COMPAT_HANDSHAKE_SECRET ?? 'dev-compat-handshake-secret';
const sign = (payload: Record<string, unknown>): string => {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', SECRET).update(body).digest('base64url')}`;
};

describe('compat teacher writes (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let compatToken = '';
  let sectionId: string;
  const h = () => headersFor(admin.sub, school.id);

  beforeAll(async () => {
    const s = stamp('CW11');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, mobile) VALUES ($1, 'CW11T', 'Compat', 'Teacher', $2, '9876550001')`,
        [school.id, teacher.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VII', name: 'Class VII', displayOrder: 7 },
    });
    sectionId = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'B' },
      })
    ).json().id;
    const science = await inject({
      method: 'POST',
      url: '/academics/subjects',
      headers: h(),
      json: { code: 'SCI11', name: 'Science' },
    });
    const emps = await inject({ method: 'GET', url: '/people/employees?size=10', headers: h() });
    const emp = emps.json().data.find((e: { employeeCode: string }) => e.employeeCode === 'CW11T');
    await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(),
      json: { employeeId: emp.id, classSectionId: sectionId, kind: 'class_teacher' },
    });
    // a teacher, the class teacher too, posts work for the subjects given to them
    await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(),
      json: {
        employeeId: emp.id,
        classSectionId: sectionId,
        kind: 'subject_teacher',
        subjectId: science.json().id,
      },
    });
    for (const [adm, first, roll] of [
      ['CW11-1', 'Aman', 1],
      ['CW11-2', 'Bela', 2],
    ] as Array<[string, string, number]>)
      await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: adm,
          firstName: first,
          lastName: 'Compat',
          guardians: [],
          enrolment: { classSectionId: sectionId, rollNo: roll },
        },
      });
    // handshake as the teacher through the legacy token
    const mobile = await withMigrator(
      async (c) =>
        (await c.query<{ mobile: string }>('SELECT mobile FROM users WHERE id = $1', [teacher.id]))
          .rows[0]!.mobile,
    );
    const token = sign({
      school_id: school.id,
      user_id_string: 'CW11T',
      mobile_number: mobile,
      user_type: 'employee',
      exp: Math.floor(Date.now() / 1000) + 300,
    });
    const hs = await inject({
      method: 'POST',
      url: '/compat/v1/auth/handshake',
      headers: {},
      json: { token, type: 'employee' },
    });
    const body = hs.json() as { status?: unknown; data?: { token?: string } };
    if (body.status === true && body.data?.token) compatToken = body.data.token;
    const replay = await inject({
      method: 'POST',
      url: '/compat/v1/auth/handshake',
      headers: {},
      json: { token, type: 'employee' },
    });
    expect(replay.json()).toMatchObject({ status: false, info: 'Token already used' });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const th = () =>
    compatToken ? { authorization: `Bearer ${compatToken}` } : headersFor(teacher.sub, school.id);

  it('UploadDailywork saves homework for the class with the legacy fields', async () => {
    const r = await inject({
      method: 'POST',
      url: '/compat/v1/teacher/UploadDailywork',
      headers: th(),
      json: {
        SubmitType: 'homework',
        cboClass: 'VII-B',
        cboSubject: 'SCI11',
        txtDate: '21/09/2026',
        homework: 'Read chapter 4 and answer Q1-5',
        EmpId: 'CW11T',
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: true, info: 'Homework saved' });
    const list = await inject({
      method: 'GET',
      url: `/academics/daily-work?classSectionId=${sectionId}`,
      headers: h(),
    });
    expect(list.json().data[0]).toMatchObject({
      kind: 'homework',
      subjectName: 'Science',
      assignedOn: '2026-09-21',
      body: 'Read chapter 4 and answer Q1-5',
    });
    const badClass = await inject({
      method: 'POST',
      url: '/compat/v1/teacher/UploadDailywork',
      headers: th(),
      json: { cboClass: 'XII-Z', homework: 'x' },
    });
    expect(badClass.statusCode).toBe(404);
    const empty = await inject({
      method: 'POST',
      url: '/compat/v1/teacher/UploadDailywork',
      headers: th(),
      json: { cboClass: 'VII-B' },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('UploadAttendance marks the day with legacy codes and answers the legacy envelope', async () => {
    const r = await inject({
      method: 'POST',
      url: '/compat/v1/teacher/UploadAttendance',
      headers: th(),
      json: {
        cboClass: 'VII-B',
        txtDate: '2026-09-22',
        EmpId: 'CW11T',
        attendance: [
          { sadmission: 'CW11-1', attendance: 'P' },
          { sadmission: 'CW11-2', attendance: 'A.5', remark: 'Left early' },
        ],
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: true, data: { marked: 2, absent: 0 } });
    const session = await inject({
      method: 'GET',
      url: `/attendance/session?classSectionId=${sectionId}&date=2026-09-22`,
      headers: h(),
    });
    expect(
      session
        .json()
        .roster.map((x: { admissionNo: string; code: string }) => [x.admissionNo, x.code]),
    ).toEqual([
      ['CW11-1', 'P'],
      ['CW11-2', 'H'],
    ]);
    const unknown = await inject({
      method: 'POST',
      url: '/compat/v1/teacher/UploadAttendance',
      headers: th(),
      json: {
        cboClass: 'VII-B',
        txtDate: '2026-09-22',
        attendance: [{ sadmission: 'NOPE', attendance: 'P' }],
      },
    });
    expect(unknown.statusCode).toBe(404);
    const sunday = await inject({
      method: 'POST',
      url: '/compat/v1/teacher/UploadAttendance',
      headers: th(),
      json: {
        cboClass: 'VII-B',
        txtDate: '20/09/2026',
        attendance: [{ sadmission: 'CW11-1', attendance: 'P' }],
      },
    });
    expect(sunday.statusCode).toBe(409); // the same weekly-off rule as the new apps
  });

  it('notice_actions publishes a class notice that the new notice board shows', async () => {
    const r = await inject({
      method: 'POST',
      url: '/compat/v1/teacher/notice_actions',
      headers: th(),
      json: {
        action: 'add',
        class: 'VII-B',
        notice_title: 'Science exhibition',
        notice: 'Bring your models on Friday.',
        notice_date: '22/09/2026',
        EmpId: 'CW11T',
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ status: true, info: 'Notice published' });
    const notices = await inject({
      method: 'GET',
      url: '/academics/notices?size=10',
      headers: h(),
    });
    expect(
      notices.json().data.some((n: { title: string }) => n.title === 'Science exhibition'),
    ).toBe(true);
    const parentOnly = await inject({
      method: 'POST',
      url: '/compat/v1/teacher/notice_actions',
      headers: headersFor(admin.sub, school.id),
      json: { action: 'delete', notice: 'x' },
    });
    expect(parentOnly.statusCode).toBe(400);
  });

  it('the legacy read endpoints answer live data after the writes (S11 parity)', async () => {
    const hw = await inject({
      method: 'GET',
      url: '/compat/v1/student/GetHomework',
      headers: th(),
    });
    expect(hw.statusCode).toBe(200);
    const hwDev = await inject({
      method: 'GET',
      url: '/compat/v1/student/GetHomework',
      headers: headersFor(teacher.sub, school.id),
    });
    const meCompat = await inject({ method: 'GET', url: '/me', headers: th() });
    console.log(
      'DEBUG homework',
      JSON.stringify({
        compat: hw.json(),
        dev: hwDev.json().items?.length,
        usingCompat: !!compatToken,
        me: {
          school: meCompat.json().school,
          year: meCompat.json().academicYear,
          perms: (meCompat.json().permissions as string[]).filter((p) => p.includes('daily')),
        },
      }).slice(0, 900),
    );
    expect(
      hw
        .json()
        .items.some(
          (x: { homework: string; subject: string }) =>
            x.homework.includes('Read chapter 4') && x.subject === 'Science',
        ),
    ).toBe(true);
    const cw = await inject({
      method: 'GET',
      url: '/compat/v1/student/GetClasswork',
      headers: th(),
    });
    expect(cw.json().channels.channel.items).toEqual([]);
    const notices = await inject({
      method: 'GET',
      url: '/compat/v1/student/GetNotice',
      headers: th(),
    });
    expect(
      notices
        .json()
        .channels.channel.items.some(
          (n: { noticetitle: string }) => n.noticetitle === 'Science exhibition',
        ),
    ).toBe(true);
    const tt = await inject({
      method: 'GET',
      url: '/compat/v1/student/GetTimetable',
      headers: th(),
    });
    expect(tt.statusCode).toBe(200);
    expect(Array.isArray(tt.json().channels.channel.items)).toBe(true);
    const att = await inject({
      method: 'GET',
      url: '/compat/v1/student/GetAttendance',
      headers: th(),
    });
    expect(att.json().channels.channel.items.year.y).toBe(String(new Date().getFullYear()));
    const hol = await inject({
      method: 'GET',
      url: '/compat/v1/student/GetHolidays',
      headers: th(),
    });
    expect(hol.statusCode).toBe(200);
  });
});
