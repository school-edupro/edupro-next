/**
 * Sprint 11 hardening: lesson plans through a three-level approval, substitutions with conflict checks,
 * per-student and per-route RFID rules with alert throttling, the fee instalment variant, and DPDP onboarding.
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

const nextMonday = () => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((8 - d.getUTCDay()) % 7 || 7));
  return d.toISOString().slice(0, 10);
};
const todayIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const lastWeekday = () => {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000);
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};
const atIst = (hhmm: string, day = todayIst()) => {
  const [hh, mm] = hhmm.split(':').map(Number) as [number, number];
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCHours(hh - 5, mm - 30);
  return d.toISOString();
};

describe('hardening (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  let vp: SeededUser;
  let teacherA: SeededUser;
  let teacherB: SeededUser;
  let parent: SeededUser;
  let sectionId: string;
  let subjectId: string;
  let periodIds: string[] = [];
  let empA: string;
  let empB: string;
  let studentId: string;
  const h = () => headersFor(admin.sub, school.id);

  beforeAll(async () => {
    const s = stamp('H11');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      vp = await seedUser(c, school, `${s}-vp`, 'school_admin');
      teacherA = await seedUser(c, school, `${s}-ta`);
      teacherB = await seedUser(c, school, `${s}-tb`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, designation, user_id) VALUES ($1, 'H11VP', 'Veena', 'Vice', 'Vice Principal', $2), ($1, 'H11A', 'Tara', 'Eleven', 'Teacher', $3), ($1, 'H11B', 'Uma', 'Eleven', 'Teacher', $4)`,
        [school.id, vp.id, teacherA.id, teacherB.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'X', name: 'Class X', displayOrder: 10 },
    });
    sectionId = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'A' },
      })
    ).json().id;
    subjectId = (
      await inject({
        method: 'POST',
        url: '/academics/subjects',
        headers: h(),
        json: { code: 'MAT11', name: 'Mathematics' },
      })
    ).json().id;
    for (const n of [1, 2]) {
      const p = await inject({
        method: 'POST',
        url: '/academics/timetable/periods',
        headers: h(),
        json: { number: n, name: `Period ${n}`, startsAt: `0${7 + n}:00`, endsAt: `0${8 + n}:00` },
      });
      periodIds.push(p.json().id);
    }
    const emps = await inject({ method: 'GET', url: '/people/employees?size=10', headers: h() });
    const byCode = (code: string) =>
      emps.json().data.find((e: { employeeCode: string }) => e.employeeCode === code).id as string;
    empA = byCode('H11A');
    empB = byCode('H11B');
    await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(),
      json: { employeeId: empA, classSectionId: sectionId, kind: 'class_teacher' },
    });
    const sectionB = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'B' },
      })
    ).json().id;
    const taB = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(),
      json: { employeeId: empB, classSectionId: sectionB, kind: 'class_teacher' },
    });
    expect(taB.statusCode).toBe(201);
    // teacher B teaches X-A in period 1 on every weekday
    for (const weekday of [1, 2, 3, 4, 5, 6]) {
      const slot = await inject({
        method: 'PUT',
        url: '/academics/timetable/slots',
        headers: h(),
        json: {
          classSectionId: sectionId,
          weekday,
          periodId: periodIds[0],
          subjectId,
          employeeId: empB,
        },
      });
      expect(slot.statusCode).toBe(200);
    }
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'H11-1',
        firstName: 'Kiran',
        lastName: 'Eleven',
        guardians: [
          {
            guardian: { firstName: 'Meera', lastName: 'Eleven', mobile: '9876540001' },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sectionId, rollNo: 1 },
      },
    });
    studentId = st.json().id;
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE school_id = $2 AND mobile = '9876540001'`,
        [parent.id, school.id],
      );
      await c.query(`UPDATE students SET rfid_tag = 'H11-TAG-1' WHERE id = $1`, [studentId]);
      await c.query(
        `INSERT INTO comms_templates (school_id, code, channel, name, body, variables, is_alert) VALUES ($1, 'bus_boarded', 'whatsapp', 'Bus boarded', '{{student_name}} boarded at {{time}}', '["student_name","time"]'::jsonb, true)`,
        [school.id],
      );
      await c.query(
        `INSERT INTO school_settings (school_id, key, value) VALUES ($1, 'comms.alert_throttle_per_hour', '2'::jsonb)`,
        [school.id],
      );
    });
    await inject({ method: 'POST', url: '/workflow/definitions/defaults', headers: h() });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('lesson plans: only the author writes; three levels approve; the plan returns on rejection', async () => {
    const th = headersFor(teacherA.sub, school.id);
    const monday = nextMonday();
    const bad = await inject({
      method: 'POST',
      url: '/academics/lesson-plans',
      headers: th,
      json: {
        classSectionId: sectionId,
        subjectId,
        weekStart: '2026-10-07',
        title: 'Wrong day',
        topics: [],
      },
    });
    expect(bad.statusCode).toBe(422);
    const empty = await inject({
      method: 'POST',
      url: '/academics/lesson-plans',
      headers: th,
      json: {
        classSectionId: sectionId,
        subjectId,
        weekStart: monday,
        title: 'Fractions week',
        submit: true,
        topics: [],
      },
    });
    expect(empty.statusCode).toBe(422);
    expect(empty.json()).toMatchObject({ type: 'planner.empty' });
    const created = await inject({
      method: 'POST',
      url: '/academics/lesson-plans',
      headers: th,
      json: {
        classSectionId: sectionId,
        subjectId,
        weekStart: monday,
        title: 'Fractions week',
        objectives: 'Add and subtract fractions',
        topics: [
          { day: 1, topic: 'Like denominators', activities: 'Worksheet 3.1' },
          { day: 2, topic: 'Unlike denominators' },
        ],
        submit: true,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      status: 'submitted',
      teacher: 'Tara Eleven',
      section: 'X-A',
      subject: 'Mathematics',
    });
    const dup = await inject({
      method: 'POST',
      url: '/academics/lesson-plans',
      headers: th,
      json: {
        classSectionId: sectionId,
        subjectId,
        weekStart: monday,
        title: 'Again',
        topics: [{ day: 1, topic: 'x' }],
      },
    });
    expect(dup.statusCode).toBe(409);
    const otherTeacher = await inject({
      method: 'PATCH',
      url: `/academics/lesson-plans/${created.json().id}`,
      headers: headersFor(teacherB.sub, school.id),
      json: { title: 'Hijack' },
    });
    expect(otherTeacher.statusCode).toBe(403);
    const locked = await inject({
      method: 'PATCH',
      url: `/academics/lesson-plans/${created.json().id}`,
      headers: th,
      json: { title: 'Edit while submitted' },
    });
    expect(locked.statusCode).toBe(409);
    // L1 coordinator, L2 vice principal (by designation), L3 principal (school admin)
    const approve = async (
      user: SeededUser,
      expectLevel: number,
      decision: 'approve' | 'reject' = 'approve',
    ) => {
      const inbox = await inject({
        method: 'GET',
        url: '/workflow/inbox',
        headers: headersFor(user.sub, school.id),
      });
      const step = inbox
        .json()
        .data.find(
          (s: { instance: { entityType: string; entityId: string } }) =>
            s.instance.entityType === 'lesson_plan' && s.instance.entityId === created.json().id,
        );
      expect(step).toBeDefined();
      expect(step.level).toBe(expectLevel);
      return inject({
        method: 'POST',
        url: `/workflow/steps/${step.id}/${decision}`,
        headers: headersFor(user.sub, school.id),
        json: { note: `${decision} at L${expectLevel}` },
      });
    };
    const adminEarly = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    expect(
      adminEarly
        .json()
        .data.some(
          (s: { instance: { entityType: string } }) => s.instance.entityType === 'lesson_plan',
        ),
    ).toBe(false);
    await approve(coordinator, 1);
    await approve(vp, 2);
    const rejected = await approve(admin, 3, 'reject');
    expect(rejected.json().status).toBe('rejected');
    const returned = await inject({
      method: 'GET',
      url: `/academics/lesson-plans/${created.json().id}`,
      headers: th,
    });
    expect(returned.json()).toMatchObject({
      status: 'returned',
      decisionNote: expect.stringContaining('reject at L3'),
    });
    const resubmitted = await inject({
      method: 'PATCH',
      url: `/academics/lesson-plans/${created.json().id}`,
      headers: th,
      json: { topics: [{ day: 1, topic: 'Like denominators (revised)' }], submit: true },
    });
    expect(resubmitted.json().status).toBe('submitted');
    await approve(coordinator, 1);
    await approve(vp, 2);
    const approved = await approve(admin, 3);
    expect(approved.json().status).toBe('approved');
    const final = await inject({
      method: 'GET',
      url: `/academics/lesson-plans/${created.json().id}`,
      headers: h(),
    });
    expect(final.json().status).toBe('approved');
    const mine = await inject({ method: 'GET', url: '/academics/lesson-plans/mine', headers: th });
    expect(mine.json().data).toHaveLength(1);
    const scoped = await inject({
      method: 'GET',
      url: '/academics/lesson-plans',
      headers: headersFor(teacherB.sub, school.id),
    });
    expect(scoped.json().page.total).toBe(0); // teacher B is class teacher of X-B only
  });

  it('substitutions: free teachers exclude busy ones; conflicts are refused; teachers and families see them', async () => {
    const date = nextMonday(); // a teaching day: the regular slots exist Monday to Saturday
    const free = await inject({
      method: 'GET',
      url: `/academics/substitutions/free-teachers?date=${date}&periodId=${periodIds[0]}&absentEmployeeId=${empB}`,
      headers: h(),
    });
    expect(free.statusCode).toBe(200);
    const ids = free.json().data.map((x: { id: string }) => x.id);
    expect(ids).not.toContain(empB); // absent teacher excluded
    expect(ids).toContain(empA);
    const conflict = await inject({
      method: 'POST',
      url: '/academics/substitutions',
      headers: h(),
      json: {
        onDate: date,
        classSectionId: sectionId,
        periodId: periodIds[0],
        substituteEmployeeId: empB,
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ type: 'substitution.same_teacher' });
    const ok = await inject({
      method: 'POST',
      url: '/academics/substitutions',
      headers: h(),
      json: {
        onDate: date,
        classSectionId: sectionId,
        periodId: periodIds[0],
        substituteEmployeeId: empA,
        reason: 'Sick leave',
      },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({
      substitute: 'Tara Eleven',
      absentTeacher: 'Uma Eleven',
      subject: 'Mathematics',
      section: 'X-A',
    });
    const again = await inject({
      method: 'POST',
      url: '/academics/substitutions',
      headers: h(),
      json: {
        onDate: date,
        classSectionId: sectionId,
        periodId: periodIds[0],
        substituteEmployeeId: empA,
      },
    });
    expect(again.statusCode).toBe(409);
    const busyNow = await inject({
      method: 'GET',
      url: `/academics/substitutions/free-teachers?date=${date}&periodId=${periodIds[0]}`,
      headers: h(),
    });
    expect(busyNow.json().data.map((x: { id: string }) => x.id)).not.toContain(empA);
    const mine = await inject({
      method: 'GET',
      url: '/academics/substitutions/mine',
      headers: headersFor(teacherA.sub, school.id),
    });
    expect(mine.json().data).toHaveLength(1);
    const family = await inject({
      method: 'GET',
      url: `/academics/substitutions?date=${date}`,
      headers: headersFor(parent.sub, school.id),
    });
    expect(family.json().data).toHaveLength(1);
    const removed = await inject({
      method: 'DELETE',
      url: `/academics/substitutions/${ok.json().id}`,
      headers: h(),
    });
    expect(removed.statusCode).toBe(200);
  });

  it('RFID rules v2: per-student late time and muted alerts, route alert rules, throttling', async () => {
    const rule = await inject({
      method: 'PUT',
      url: `/attendance/rules/${studentId}`,
      headers: h(),
      json: { lateAfter: '08:00', alertsMuted: false, reason: 'Comes by 8' },
    });
    expect(rule.statusCode).toBe(200);
    expect(rule.json()).toMatchObject({
      lateAfter: '08:00',
      alertsMuted: false,
      student: 'Kiran Eleven',
    });
    const gate = await inject({
      method: 'POST',
      url: '/attendance/rfid/devices',
      headers: h(),
      json: { code: 'G11', name: 'Gate', kind: 'gate' },
    });
    const tap = await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': gate.json().apiKey },
      json: {
        school: school.code,
        device: 'G11',
        events: [{ tag: 'H11-TAG-1', at: atIst('08:30', lastWeekday()), direction: 'in' }],
      },
    });
    expect(tap.json().outcomes).toEqual({ marked_late: 1 }); // school default would be 09:00 → present; the override says late
    const route = await inject({
      method: 'POST',
      url: '/transport/routes',
      headers: h(),
      json: { code: 'H1', name: 'Hinjewadi' },
    });
    const patched = await inject({
      method: 'PATCH',
      url: `/transport/routes/${route.json().id}`,
      headers: h(),
      json: { alertAlighting: false, lateAfter: '07:30' },
    });
    expect(patched.json()).toMatchObject({
      alertAlighting: false,
      alertBoarding: true,
      lateAfter: '07:30',
    });
    await inject({
      method: 'PUT',
      url: `/transport/routes/${route.json().id}/students`,
      headers: h(),
      json: { assignments: [{ studentId, stopName: 'Phase 1' }] },
    });
    const bus = await inject({
      method: 'POST',
      url: '/attendance/rfid/devices',
      headers: h(),
      json: { code: 'B11', name: 'Bus', kind: 'bus', routeId: route.json().id },
    });
    const key = bus.json().apiKey as string;
    const late = await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': key },
      json: {
        school: school.code,
        device: 'B11',
        events: [{ tag: 'H11-TAG-1', at: atIst('07:45'), direction: 'in' }],
      },
    });
    expect(late.json().outcomes).toEqual({ late_boarding: 1 });
    const off = await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': key },
      json: {
        school: school.code,
        device: 'B11',
        events: [{ tag: 'H11-TAG-1', at: atIst('13:30'), direction: 'out' }],
      },
    });
    expect(off.json().outcomes).toEqual({ alighted: 1 });
    let msgs = await inject({
      method: 'GET',
      url: `/comms/messages?recipientUserId=${parent.id}`,
      headers: h(),
    });
    expect(msgs.json().data).toHaveLength(1); // boarding alert only: alighting alerts are off for this route
    // throttle: limit 2 per hour → the second boarding alert goes, the third is throttled
    await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': key },
      json: {
        school: school.code,
        device: 'B11',
        events: [{ tag: 'H11-TAG-1', at: atIst('07:50'), direction: 'in' }],
      },
    });
    const third = await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': key },
      json: {
        school: school.code,
        device: 'B11',
        events: [{ tag: 'H11-TAG-1', at: atIst('07:55'), direction: 'in' }],
      },
    });
    expect(third.json().outcomes).toEqual({ late_boarding: 1, throttled: 1 });
    msgs = await inject({
      method: 'GET',
      url: `/comms/messages?recipientUserId=${parent.id}`,
      headers: h(),
    });
    expect(msgs.json().data).toHaveLength(2);
    // muted: no alert at all, tap still recorded
    await inject({
      method: 'PUT',
      url: `/attendance/rules/${studentId}`,
      headers: h(),
      json: { alertsMuted: true, reason: 'Parent request' },
    });
    const muted = await inject({
      method: 'POST',
      url: '/attendance/rfid/events',
      headers: { 'x-device-key': key },
      json: {
        school: school.code,
        device: 'B11',
        events: [{ tag: 'H11-TAG-1', at: atIst('14:10'), direction: 'in' }],
      },
    });
    expect(muted.json().outcomes).toEqual({ late_boarding: 1 });
    const list = await inject({ method: 'GET', url: '/attendance/rules', headers: h() });
    expect(list.json().data).toHaveLength(1);
    const cleared = await inject({
      method: 'DELETE',
      url: `/attendance/rules/${studentId}`,
      headers: h(),
    });
    expect(cleared.statusCode).toBe(200);
  });

  it('fee demand instalment variant: two instalments move every due date to the half-year anchors', async () => {
    const head = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition' },
    });
    await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { monthsPerInstalment: 3 },
    });
    const cls = await inject({ method: 'GET', url: '/academics/classes?size=50', headers: h() });
    const classX = cls.json().data.find((k: { code: string }) => k.code === 'X');
    await inject({
      method: 'PUT',
      url: `/fees/structures/${classX.id}`,
      headers: h(),
      json: { entries: [{ headId: head.json().id, amount: 1000, frequency: 'monthly' }] },
    });
    const profile = await inject({
      method: 'PUT',
      url: `/fees/students/${studentId}/profile`,
      headers: h(),
      json: {
        feeGroup: 'general',
        studentType: 'old',
        transportDisabled: false,
        openingBalance: 0,
        instalmentsOverride: 2,
      },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().instalmentsOverride).toBe(2);
    const gen = await inject({
      method: 'POST',
      url: `/fees/students/${studentId}/demands/generate`,
      headers: h(),
    });
    expect(gen.statusCode).toBe(201);
    const demands = await inject({
      method: 'GET',
      url: `/fees/students/${studentId}/demands`,
      headers: h(),
    });
    const dues = new Set((demands.json().rows as Array<{ dueOn: string }>).map((r) => r.dueOn));
    expect(dues.size).toBe(2); // twelve monthly rows, two due dates
    expect(Number(demands.json().total.net)).toBe(12000);
  });

  it('DPDP onboarding: the family acknowledges the current notice and records consents in one step', async () => {
    const before = await inject({
      method: 'GET',
      url: '/engagement/onboarding',
      headers: headersFor(parent.sub, school.id),
    });
    expect(before.json()).toMatchObject({ notice: null, required: false });
    const published = await inject({
      method: 'POST',
      url: '/engagement/privacy-notices',
      headers: h(),
      json: {
        title: 'How we use your data',
        body: 'We use your details to run the school: attendance, fees, communication and safety. You may withdraw optional communication at any time.',
      },
    });
    expect(published.statusCode).toBe(201);
    expect(published.json()).toMatchObject({ version: 1 });
    const pending = await inject({
      method: 'GET',
      url: '/engagement/onboarding',
      headers: headersFor(parent.sub, school.id),
    });
    expect(pending.json()).toMatchObject({ required: true, notice: { version: 1 } });
    const stale = await inject({
      method: 'POST',
      url: '/engagement/onboarding/acknowledge',
      headers: headersFor(parent.sub, school.id),
      json: { version: 9 },
    });
    expect(stale.statusCode).toBe(409);
    const ack = await inject({
      method: 'POST',
      url: '/engagement/onboarding/acknowledge',
      headers: headersFor(parent.sub, school.id),
      json: {
        version: 1,
        consents: [
          { purposeCode: 'comms.email', status: 'withdrawn' },
          { purposeCode: 'comms.whatsapp', status: 'granted' },
        ],
      },
    });
    expect(ack.statusCode).toBe(201);
    expect(ack.json()).toMatchObject({ required: false });
    expect(ack.json().purposes.find((p: { code: string }) => p.code === 'comms.email').status).toBe(
      'withdrawn',
    );
    const v2 = await inject({
      method: 'POST',
      url: '/engagement/privacy-notices',
      headers: h(),
      json: {
        title: 'How we use your data (v2)',
        body: 'Updated wording for bus location sharing and photographs in the gallery, with the same withdrawal rights.',
      },
    });
    expect(v2.json().version).toBe(2);
    const again = await inject({
      method: 'GET',
      url: '/engagement/onboarding',
      headers: headersFor(parent.sub, school.id),
    });
    expect(again.json().required).toBe(true);
    const list = await inject({ method: 'GET', url: '/engagement/privacy-notices', headers: h() });
    expect(
      list
        .json()
        .data.map((n: { version: number; acknowledgements: number }) => [
          n.version,
          n.acknowledgements,
        ]),
    ).toEqual([
      [2, 0],
      [1, 1],
    ]);
    const staff = await inject({
      method: 'POST',
      url: '/engagement/privacy-notices',
      headers: headersFor(teacherA.sub, school.id),
      json: { title: 'x', body: 'y'.repeat(30) },
    });
    expect(staff.statusCode).toBe(403);
  });
});
