/**
 * The mobile app's staff screens (docs/design/89, phase C) against the real API: a teacher signed in on a phone (the
 * phone's own session token) reads My day — assignments, timetable, the day's sections, marks to enter, approvals —
 * marks a class and posts homework with the keys the phone resends with, reads their attendance, leave and payslips,
 * exactly as the app asks; every field the app reads is there. Every name and number here is made up.
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

describe('mobile app: the staff screens read the real API (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let section = '';
  let kid = '';
  let token = '';
  const s = stamp('MST');
  // today in India (the school's day), as the app works it out
  const ist = new Date(Date.now() + 5.5 * 3600000);
  const today = ist.toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const fy = String(ist.getUTCMonth() >= 3 ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1);

  const phone = (method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown, key?: string) =>
    inject({
      method,
      url,
      headers: {
        authorization: `Bearer ${token}`,
        'x-school-id': school.id,
        ...(key ? { 'idempotency-key': key } : {}),
      },
      ...(json === undefined ? {} : { json }),
    });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'T01', 'Tara', 'Teacher', $2)`,
        [school.id, teacher.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const h = headersFor(admin.sub, school.id);
    // the school signs staff in by code, shown on screen during the rollout (lets the app's web build be checked by
    // hand on this test school)
    for (const [key, value] of [
      ['auth.login_mode', 'otp'],
      ['auth.otp_on_screen', true],
    ] as const)
      await inject({
        method: 'PUT',
        url: `/platform/settings/${key}`,
        headers: h,
        json: { value },
      });
    // every day is a school day here, so the test runs on a Sunday too
    await inject({
      method: 'PUT',
      url: '/platform/settings/attendance.weekly_off',
      headers: h,
      json: { value: [] },
    });
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h,
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    section = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h,
        json: { name: 'A' },
      })
    ).json().id;
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h,
      json: {
        admissionNo: `${s}-1`,
        firstName: 'Kid',
        lastName: 'Sample',
        guardians: [
          {
            guardian: { firstName: 'Pia', lastName: 'Sample', mobile: '9876544401' },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: section, rollNo: 1 },
      },
    });
    expect(st.statusCode).toBe(201);
    kid = st.json().id;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876544401' AND school_id = $2`, [
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
          json: { employeeId: emp.rows[0]!.id, classSectionId: section, kind: 'class_teacher' },
        })
      ).statusCode,
    ).toBe(201);
    const signIn = await inject({
      method: 'POST',
      url: '/auth/mobile/one-auth',
      headers: headersFor(teacher.sub, school.id),
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
    token = signIn.json().accessToken;
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND status IN ('queued', 'sending')`,
        [school.id],
      ),
    );
    if (app) await app.close();
  });

  it('My day: the staff profile, assignments, timetable, the day to mark, marks to enter', async () => {
    expect((await phone('GET', '/me/profiles')).json().data).toContainEqual(
      expect.objectContaining({ id: `staff:${school.id}`, kind: 'staff', app: 'teacher' }),
    );
    const mine = await phone('GET', '/academics/teacher-assignments/mine');
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data).toContainEqual(
      expect.objectContaining({
        classSectionId: section,
        classCode: 'VI',
        section: 'A',
        subjectId: null,
        canMarkAttendance: true,
      }),
    );
    for (const url of [
      '/academics/timetable/periods',
      '/academics/timetable/mine',
      '/academics/substitutions/mine',
      '/exams/my-entry',
      '/academics/daily-work/sheet/options',
    ]) {
      const r = await phone('GET', url);
      expect({ url, status: r.statusCode }).toEqual({ url, status: 200 });
      expect(Array.isArray(r.json().data)).toBe(true);
    }
    const sum = await phone('GET', `/attendance/summary?date=${today}`);
    expect(sum.statusCode).toBe(200);
    expect(sum.json().sections).toContainEqual(
      expect.objectContaining({ classSectionId: section, section: 'VI-A', sessionId: null }),
    );
    const opts = (await phone('GET', '/academics/daily-work/sheet/options')).json().data;
    expect(opts).toContainEqual(
      expect.objectContaining({
        classSectionId: section,
        section: 'VI-A',
        subjects: expect.any(Array),
      }),
    );
  });

  it('marking the class: the roll, then the marks sent with a key; sent again, the first answer', async () => {
    const roll = await phone('GET', `/attendance/session?classSectionId=${section}&date=${today}`);
    expect(roll.statusCode).toBe(200);
    expect(roll.json()).toMatchObject({ locked: false });
    expect(roll.json().roster).toContainEqual(
      expect.objectContaining({ studentId: kid, name: expect.any(String), rollNo: 1 }),
    );
    const body = {
      classSectionId: section,
      date: today,
      kind: 'day',
      marks: [{ studentId: kid, code: 'P' }],
    };
    const first = await phone('POST', '/attendance/sessions', body, 'phone-mark-0001');
    expect(first.statusCode).toBe(201);
    const again = await phone('POST', '/attendance/sessions', body, 'phone-mark-0001');
    expect(again.statusCode).toBe(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    const sum = await phone('GET', `/attendance/summary?date=${today}`);
    expect(
      (sum.json().sections as Array<{ classSectionId: string; sessionId: string | null }>).find(
        (x) => x.classSectionId === section,
      )!.sessionId,
    ).not.toBeNull();
  });

  it('homework with a photo: the file sent and completed; the post sent twice is posted once', async () => {
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const reg = await phone('POST', '/platform/files', {
      fileName: 'board.png',
      contentType: 'image/png',
      sizeBytes: png.length,
      classification: 'internal',
    });
    expect(reg.statusCode).toBe(201);
    const put = await inject({
      method: 'PUT',
      url: reg.json().upload.url,
      headers: { ...(reg.json().upload.headers ?? {}) },
      raw: { body: png, contentType: 'image/png' },
    });
    expect(put.statusCode).toBe(200);
    // the app finishes the upload as the S3 store needs (harmless on the local store)
    expect([200, 201, 409]).toContain(
      (await phone('POST', `/platform/files/${reg.json().file.id}/complete`)).statusCode,
    );
    const post = {
      classSectionId: section,
      kind: 'homework',
      title: 'Fractions worksheet',
      body: 'Q1 to Q10',
      dueOn: '2099-01-01',
      fileIds: [reg.json().file.id],
      ackRequired: false,
    };
    const one = await phone('POST', '/academics/daily-work', post, 'phone-work-0001');
    expect(one.statusCode).toBe(201);
    const two = await phone('POST', '/academics/daily-work', post, 'phone-work-0001');
    expect(two.statusCode).toBe(201);
    expect(two.json().id).toBe(one.json().id);
    const list = await phone(
      'GET',
      `/academics/daily-work?classSectionId=${section}&from=${today}&to=${today}&size=200`,
    );
    expect(
      (list.json().data as Array<{ title: string }>).filter(
        (w) => w.title === 'Fractions worksheet',
      ),
    ).toHaveLength(1);
  });

  it('my attendance and a correction sent twice asked once; my leave; my payslips', async () => {
    const att = await phone('GET', `/staff-attendance/mine?month=${month}`);
    expect(att.statusCode).toBe(200);
    expect(att.json()).toMatchObject({
      employee: expect.objectContaining({ code: 'T01' }),
      days: expect.any(Array),
      regularisations: expect.any(Array),
    });
    const ask = { day: today, dayType: 'HD', reason: 'Left early for a meeting' };
    const r1 = await phone('POST', '/staff-attendance/regularisations', ask, 'phone-corr-0001');
    const r2 = await phone('POST', '/staff-attendance/regularisations', ask, 'phone-corr-0001');
    expect(r2.statusCode).toBe(r1.statusCode);
    if (r1.statusCode === 201) {
      expect(r2.headers['idempotent-replayed']).toBe('true');
    } else {
      // no approver set up for this teacher: the route's own refusal, worked out afresh each time (a refused
      // request frees its key)
      expect(r1.json()).toMatchObject({
        type: 'validation-failed',
        detail: expect.stringContaining('approve'),
      });
      expect(r2.headers['idempotent-replayed']).toBeUndefined();
    }
    const leave = await phone('GET', '/leave/mine?size=50');
    expect(leave.statusCode).toBe(200);
    expect(leave.json()).toMatchObject({
      balances: expect.any(Array),
      types: expect.any(Array),
      rows: expect.any(Array),
      can: expect.any(Object),
    });
    const slips = await phone('GET', `/payroll/me/payslips?fy=${fy}`);
    // a teacher with no salary set up yet has no payslips (or no payroll record at all)
    expect([200, 404]).toContain(slips.statusCode);
    if (slips.statusCode === 200)
      expect(slips.json()).toMatchObject({ rows: expect.any(Array), years: expect.any(Array) });
  });

  it("the approvals inbox has the pupil's leave; decided from the phone", async () => {
    const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const applied = await inject({
      method: 'POST',
      url: '/attendance/leaves/mine',
      headers: headersFor(parent.sub, school.id),
      json: {
        studentId: kid,
        leaveType: 'family',
        fromDate: tomorrow,
        toDate: tomorrow,
        reason: 'A family wedding',
      },
    });
    expect(applied.statusCode).toBe(201);
    const box = await phone('GET', '/approvals/inbox');
    expect(box.statusCode).toBe(200);
    expect(box.json().unavailable).toEqual([]);
    expect(box.json().items).toContainEqual(
      expect.objectContaining({ kind: 'leave', id: applied.json().id, decideHere: true }),
    );
    const ok = await phone('POST', `/approvals/leave/${applied.json().id}/decision`, {
      decision: 'approve',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().result).toMatchObject({ status: 'approved' });
  });
});
