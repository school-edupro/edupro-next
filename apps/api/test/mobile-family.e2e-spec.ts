/**
 * The mobile app's family screens (docs/design/89, phase B) against the real API: a parent signed in on a phone
 * (the phone's own session token, not the web's) reads the child's day — attendance, leave, homework and its
 * files, notices, messages, timetable, calendar, date sheet, results, fees — exactly as the app asks, and every
 * field the app reads is there. The app's own widget tests (apps/mobile/test/family_test.dart) use the same shapes.
 * Every name, number and token here is made up.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  type SeededSchool,
  type SeededUser,
  withMigrator,
} from './helpers';

describe('mobile app: the family screens read the real API (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let pupil: SeededUser;
  let sectionId = '';
  let childId = '';
  let otherId = '';
  let workId = '';
  let fileId = '';
  let noticeId = '';
  let phoneToken = '';
  const s = stamp('MFM');
  // the last weekday up to today (attendance is not marked on a Sunday)
  const marked = (() => {
    const d = new Date();
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const today = new Date().toISOString().slice(0, 10);
  const back14 = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);

  /** a call as the app makes it: the phone's bearer token and the profile's school */
  const phone = (method: 'GET' | 'POST', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: { authorization: `Bearer ${phoneToken}`, 'x-school-id': school.id },
      ...(json === undefined ? {} : { json }),
    });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      pupil = await seedUser(c, school, `${s}-pupil`, 'student', 'student');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id)
         VALUES ($1, 'T01', 'Tara', 'Teacher', $2)`,
        [school.id, teacher.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const h = headersFor(admin.sub, school.id);
    // the school signs families in by code, shown on screen during the rollout (lets the app's web build be
    // checked by hand on this test school)
    for (const [key, value] of [
      ['auth.login_mode', 'otp'],
      ['auth.otp_on_screen', true],
    ] as const)
      expect(
        (
          await inject({
            method: 'PUT',
            url: `/platform/settings/${key}`,
            headers: h,
            json: { value },
          })
        ).statusCode,
      ).toBe(200);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h,
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h,
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
    const student = async (adm: string, first: string, mobile: string | null, roll: number) => {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h,
        json: {
          admissionNo: adm,
          firstName: first,
          lastName: 'Sample',
          dob: '2015-01-01',
          gender: 'female',
          guardians: mobile
            ? [
                {
                  guardian: { firstName: 'Pia', lastName: 'Sample', mobile },
                  relation: 'mother',
                  isPrimary: true,
                },
              ]
            : [],
          enrolment: { classSectionId: sectionId, rollNo: roll },
        },
      });
      expect(r.statusCode).toBe(201);
      return r.json().id as string;
    };
    childId = await student(`${s}1`, 'Kid', '9876511101', 1);
    otherId = await student(`${s}2`, 'Other', null, 2);
    await withMigrator((c) =>
      c.query(`UPDATE students SET user_id = $1 WHERE id = $2`, [pupil.id, otherId]),
    );
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876511101' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    const emp = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = 'T01'`,
        [school.id],
      ),
    );
    expect(
      (
        await inject({
          method: 'POST',
          url: '/academics/teacher-assignments',
          headers: h,
          json: { employeeId: emp.rows[0]!.id, classSectionId: sectionId, kind: 'class_teacher' },
        })
      ).statusCode,
    ).toBe(201);

    // the school's day: attendance, homework with a file, a notice to acknowledge
    const th = headersFor(teacher.sub, school.id);
    const att = await inject({
      method: 'POST',
      url: '/attendance/sessions',
      headers: th,
      json: {
        classSectionId: sectionId,
        date: marked,
        marks: [
          { studentId: childId, code: 'P' },
          { studentId: otherId, code: 'A' },
        ],
      },
    });
    expect([200, 201]).toContain(att.statusCode);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const reg = await inject({
      method: 'POST',
      url: '/platform/files',
      headers: th,
      json: { fileName: 'sheet.png', contentType: 'image/png', sizeBytes: png.length },
    });
    expect(reg.statusCode).toBe(201);
    fileId = reg.json().file.id;
    const put = await inject({
      method: 'PUT',
      url: reg.json().upload.url,
      headers: { ...(reg.json().upload.headers ?? {}) },
      raw: { body: png, contentType: 'image/png' },
    });
    expect(put.statusCode).toBe(200);
    const work = await inject({
      method: 'POST',
      url: '/academics/daily-work',
      headers: th,
      json: {
        classSectionId: sectionId,
        kind: 'homework',
        title: 'Plant a seed',
        body: 'Note what happens each day.',
        dueOn: '2099-01-01',
        fileIds: [fileId],
        ackRequired: true,
      },
    });
    expect(work.statusCode).toBe(201);
    workId = work.json().id;
    const notice = await inject({
      method: 'POST',
      url: '/academics/notices',
      headers: h,
      json: { title: 'Sports day', body: 'On Friday', publish: true, ackRequired: true },
    });
    expect(notice.statusCode).toBe(201);
    noticeId = notice.json().id;

    // the parent signs in on a phone (the development token stands in for One Auth)
    const signIn = await inject({
      method: 'POST',
      url: '/auth/mobile/one-auth',
      headers: headersFor(parent.sub, school.id),
      json: {
        device: {
          id: `phone-${s}-1`,
          name: 'Test phone',
          platform: 'android',
          appVersion: '1.0.0',
        },
      },
    });
    expect(signIn.statusCode).toBe(200);
    phoneToken = signIn.json().accessToken;
    expect(phoneToken.startsWith('otp.')).toBe(true);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('the profile, then Home: attendance this month, homework due, notices, unread, date sheet, fees', async () => {
    const profiles = (await phone('GET', '/me/profiles')).json().data as Array<{
      id: string;
      kind: string;
      studentId: string | null;
    }>;
    expect(profiles).toContainEqual(
      expect.objectContaining({
        id: `parent:${school.id}:${childId}`,
        kind: 'parent',
        studentId: childId,
      }),
    );

    const att = await phone('GET', `/attendance/mine?month=${marked.slice(0, 7)}`);
    expect(att.statusCode).toBe(200);
    const kid = (att.json().children as Array<Record<string, unknown>>).find(
      (c) => c.id === childId,
    )!;
    expect(kid).toBeDefined();
    expect(kid.days).toContainEqual(expect.objectContaining({ date: marked, code: 'P' }));
    expect(kid.summary).toEqual(
      expect.objectContaining({
        days: expect.any(Number),
        present: expect.any(Number),
        absent: expect.any(Number),
      }),
    );
    // only the parent's own child
    expect((att.json().children as Array<{ id: string }>).map((c) => c.id)).not.toContain(otherId);

    const viewer = await phone('GET', '/academics/daily-work/viewer');
    expect(viewer.statusCode).toBe(200);
    expect(viewer.json().students).toContainEqual(
      expect.objectContaining({ id: childId, classSectionId: sectionId }),
    );
    const list = await phone(
      'GET',
      `/academics/daily-work?classSectionId=${sectionId}&from=${back14}&to=${today}&size=200`,
    );
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toContainEqual(
      expect.objectContaining({
        id: workId,
        kind: 'homework',
        title: 'Plant a seed',
        body: 'Note what happens each day.',
        assignedOn: expect.any(String),
        dueOn: '2099-01-01',
        files: [expect.objectContaining({ id: fileId })],
        ackRequired: true,
        ackedFor: [],
      }),
    );

    const notices = await phone('GET', `/academics/notices?studentId=${childId}&size=50`);
    expect(notices.statusCode).toBe(200);
    expect(notices.json().data).toContainEqual(
      expect.objectContaining({
        id: noticeId,
        title: 'Sports day',
        publishFrom: expect.any(String),
        isPinned: false,
      }),
    );
    const unread = await phone('GET', '/comms/inbox/unread');
    expect(unread.statusCode).toBe(200);
    expect(typeof unread.json().unread).toBe('number');
    const sheets = await phone('GET', '/exams/mine/date-sheets');
    expect(sheets.statusCode).toBe(200);
    expect(Array.isArray(sheets.json().children)).toBe(true);
    const fees = await phone('GET', '/fees/mine');
    expect(fees.statusCode).toBe(200);
    expect(Array.isArray(fees.json().children)).toBe(true);
  });

  it('homework: the file as a signed link; "I have seen this" kept for the child', async () => {
    const f = await phone('GET', `/academics/daily-work/${workId}/files/${fileId}`);
    expect(f.statusCode).toBe(200);
    expect(f.json()).toMatchObject({ download: { url: expect.stringContaining('token=') } });
    const ack = await phone('POST', '/academics/acks', {
      type: 'daily_work',
      id: workId,
      studentId: childId,
    });
    expect([200, 201]).toContain(ack.statusCode);
    const again = await phone(
      'GET',
      `/academics/daily-work?classSectionId=${sectionId}&from=${back14}&to=${today}&size=200`,
    );
    expect(
      (again.json().data as Array<{ id: string; ackedFor: string[] }>).find((w) => w.id === workId)!
        .ackedFor,
    ).toContain(childId);
  });

  it('a notice in full and acknowledged; messages page by page', async () => {
    const n = await phone('GET', `/academics/notices/${noticeId}`);
    expect(n.statusCode).toBe(200);
    const body = (n.json().data ?? n.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ id: noticeId, title: 'Sports day', ackRequired: true });
    expect(body).toHaveProperty('files');
    const ack = await phone('POST', '/academics/acks', {
      type: 'notice',
      id: noticeId,
      studentId: childId,
    });
    expect([200, 201]).toContain(ack.statusCode);
    const inbox = await phone('GET', `/comms/inbox?studentId=${childId}&page=1&size=20`);
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json()).toMatchObject({
      data: expect.any(Array),
      page: { more: expect.any(Boolean) },
    });
  });

  it('leave: the kinds and rules, an application for the child, cancelled while waiting', async () => {
    const rules = await phone('GET', '/attendance/leaves/mine');
    expect(rules.statusCode).toBe(200);
    expect(rules.json()).toMatchObject({
      longDays: expect.any(Number),
      backDays: expect.any(Number),
      types: expect.arrayContaining([
        expect.objectContaining({ value: expect.any(String), label: expect.any(String) }),
      ]),
      leaves: expect.any(Array),
    });
    const kind = (rules.json().types as Array<{ value: string; certificate?: string }>).find(
      (t) => !t.certificate || t.certificate !== 'always',
    )!;
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const sent = await phone('POST', '/attendance/leaves/mine', {
      studentId: childId,
      leaveType: kind.value,
      fromDate: tomorrow,
      toDate: tomorrow,
      reason: 'A family wedding',
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ status: 'pending', studentId: childId });
    const listed = (await phone('GET', '/attendance/leaves/mine')).json().leaves as Array<
      Record<string, unknown>
    >;
    expect(listed).toContainEqual(
      expect.objectContaining({
        id: sent.json().id,
        studentId: childId,
        leaveTypeLabel: expect.any(String),
        fromDate: tomorrow,
        toDate: tomorrow,
        days: 1,
        status: 'pending',
      }),
    );
    const cancel = await phone('POST', `/attendance/leaves/mine/${sent.json().id}/cancel`);
    expect([200, 201]).toContain(cancel.statusCode);
  });

  it('timetable, calendar, results; web pages for paying, tax certificate, queries and leave with a file', async () => {
    const periods = await phone('GET', '/academics/timetable/periods');
    expect(periods.statusCode).toBe(200);
    expect(Array.isArray(periods.json().data)).toBe(true);
    const slots = await phone('GET', `/academics/timetable/slots?classSectionId=${sectionId}`);
    expect(slots.statusCode).toBe(200);
    expect(Array.isArray(slots.json().data)).toBe(true);
    const cal = await phone('GET', `/academics/calendar?from=${today.slice(0, 8)}01&to=${today}`);
    expect(cal.statusCode).toBe(200);
    expect(cal.json()).toMatchObject({ holidays: expect.any(Array), events: expect.any(Array) });
    const res = await phone('GET', '/exams/mine/results');
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().children)).toBe(true);
    for (const to of [
      `/api/child?id=${childId}&back=%2Ffees`,
      `/api/child?id=${childId}&back=%2Ffees%2Ftax-certificate`,
      `/api/child?id=${childId}&back=%2Fqueries`,
      `/api/child?id=${childId}&back=%2Fattendance%3Fview%3Dleave`,
    ]) {
      const link = await phone('POST', '/auth/mobile/web-handoff', { app: 'parent', to });
      expect(link.statusCode).toBe(200);
      expect(link.json().url).toContain('/api/auth/mobile?code=');
    }
  });
  it('a student on a phone: their own profile, attendance, homework, timetable and results', async () => {
    const signIn = await inject({
      method: 'POST',
      url: '/auth/mobile/one-auth',
      headers: headersFor(pupil.sub, school.id),
      json: {
        device: { id: `phone-${s}-2`, name: 'Test phone', platform: 'ios', appVersion: '1.0.0' },
      },
    });
    expect(signIn.statusCode).toBe(200);
    const as = (url: string) =>
      inject({
        method: 'GET',
        url,
        headers: { authorization: `Bearer ${signIn.json().accessToken}`, 'x-school-id': school.id },
      });
    expect((await as('/me/profiles')).json().data).toContainEqual(
      expect.objectContaining({
        id: `student:${school.id}:${otherId}`,
        kind: 'student',
        studentId: otherId,
      }),
    );
    const att = (await as(`/attendance/mine?month=${marked.slice(0, 7)}`)).json();
    expect(att.children).toEqual([
      expect.objectContaining({
        id: otherId,
        days: expect.arrayContaining([expect.objectContaining({ date: marked, code: 'A' })]),
      }),
    ]);
    expect((await as('/academics/daily-work/viewer')).json().students).toEqual([
      expect.objectContaining({ id: otherId, classSectionId: sectionId }),
    ]);
    const work = await as(
      `/academics/daily-work?classSectionId=${sectionId}&from=${back14}&to=${today}&size=200`,
    );
    expect(work.statusCode).toBe(200);
    expect((work.json().data as Array<{ id: string }>).map((w) => w.id)).toContain(workId);
    expect((await as(`/academics/timetable/slots?classSectionId=${sectionId}`)).statusCode).toBe(
      200,
    );
    expect((await as('/exams/mine/results')).statusCode).toBe(200);
    expect((await as('/exams/mine/date-sheets')).statusCode).toBe(200);
  });
});
