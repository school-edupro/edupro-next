/**
 * Attendance, completed (0083): an approved leave and a gate pass pre-fill the roster, the school's marking
 * window (a teacher inside it; the coordinator later, or a reopened day), bus attendance by the teacher
 * mapped to a route for the morning and the afternoon trip, the registers and the dashboards.
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

/** Today in school time. */
const today = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);

describe('attendance: leave, gate pass, windows and bus roll (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let other: SeededUser;
  let parent: SeededUser;
  let s: string;
  let section: string;
  let routeId: string;
  const student: Record<string, string> = {};
  const employee: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });
  const post = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'PUT', url, headers: h(u), json });

  beforeAll(async () => {
    s = stamp('AP');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
      other = await seedUser(c, school, `${s}-other`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      for (const [code, first, u] of [
        ['T1', 'Tara', teacher],
        ['T2', 'Omar', other],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, $2, $3, 'Teacher', $4) RETURNING id::text`,
          [school.id, code, first, u.id],
        );
        employee[code] = e.rows[0]!.id;
      }
    });
    app = await createApp();
    inject = injector(app);
    // every day of the week is a school day here, so the test runs on a Sunday too
    await put('/platform/settings/attendance.weekly_off', admin, { value: [] });
    const cls = await post('/academics/classes', admin, {
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
    });
    section = (
      await post(`/academics/classes/${cls.json().id}/sections`, admin, { name: 'A' })
    ).json().id;
    for (const [i, first] of ['Ana', 'Bala', 'Chitra', 'Dev'].entries()) {
      const r = await post('/people/students', admin, {
        admissionNo: `${s}-${String(i + 1)}`,
        firstName: first,
        lastName: 'Roll',
        guardians:
          i === 0
            ? [
                {
                  guardian: { firstName: 'Pari', lastName: 'Roll', mobile: '9876512301' },
                  relation: 'mother',
                  isPrimary: true,
                },
              ]
            : [],
        enrolment: { classSectionId: section, rollNo: i + 1 },
      });
      expect(r.statusCode).toBe(201);
      student[first] = r.json().id;
    }
    const ta = await post('/academics/teacher-assignments', admin, {
      employeeId: employee.T1,
      classSectionId: section,
      kind: 'class_teacher',
    });
    expect(ta.statusCode).toBe(201);
    const route = await post('/transport/routes', admin, { code: 'R1', name: 'Kothrud' });
    routeId = route.json().id;
    const stops = await put(`/transport/routes/${routeId}/stops`, admin, {
      stops: [{ name: 'Karve Nagar', pickupTime: '07:20', dropTime: '14:40' }],
    });
    const stopId = (stops.json().data as Array<{ id: string }>)[0]!.id;
    const on = await put(`/transport/routes/${routeId}/students`, admin, {
      assignments: ['Ana', 'Bala', 'Chitra'].map((n) => ({ studentId: student[n], stopId })),
    });
    expect(on.statusCode).toBe(200);
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876512301' AND school_id = $2`,
        [parent.id, school.id],
      );
      // Bala is on approved leave today; Chitra has an approved gate pass to leave early
      await c.query(
        `INSERT INTO parent_queries (school_id, academic_year_id, number, kind, student_id, subject, body, leave_from, leave_to, status, decision, raised_by_user_id)
         VALUES ($1, $2, 'LV-1', 'leave', $3, 'Leave', 'Family function', $4::date, $4::date, 'closed', 'approved', $5)`,
        [school.id, school.yearId, student.Bala, today, parent.id],
      );
      await c.query(
        `INSERT INTO gate_passes (school_id, student_id, kind, on_date, at_time, reason, audience, source, state, status, pass_no)
         VALUES ($1, $2, 'early_leave', $3::date, '12:30', 'Dentist', 'student', 'parent', 'approved', 'approved', 'GP/1')`,
        [school.id, student.Chitra, today],
      );
    });
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('an approved leave and a gate pass pre-fill the class roster; leave is its own status', async () => {
    const roster = (
      await get(`/attendance/session?classSectionId=${section}&date=${today}`, teacher)
    ).json();
    const of = (name: string) =>
      (
        roster.roster as Array<{
          studentId: string;
          suggested: string | null;
          hint: { leave: unknown; pass: { kind: string } | null } | null;
        }>
      ).find((r) => r.studentId === student[name])!;
    expect(of('Ana')).toMatchObject({ suggested: null, hint: null });
    expect(of('Bala')).toMatchObject({ suggested: 'LV', hint: { leave: { number: 'LV-1' } } });
    expect(of('Chitra')).toMatchObject({
      suggested: 'SR',
      hint: { pass: { kind: 'early_leave', number: 'GP/1' } },
    });
    expect(roster.window).toMatchObject({ open: true, late: false });
    const marked = await post('/attendance/sessions', teacher, {
      classSectionId: section,
      date: today,
      marks: [
        { studentId: student.Ana, code: 'P' },
        { studentId: student.Bala, code: 'LV' },
        { studentId: student.Chitra, code: 'SR' },
        { studentId: student.Dev, code: 'A' },
      ],
    });
    expect(marked.statusCode).toBe(201);
    expect(marked.json().counts).toMatchObject({ P: 1, LV: 1, SR: 1, A: 1 });
    const sum = (await get(`/attendance/summary?date=${today}`)).json().sections[0];
    expect(sum).toMatchObject({ present: 2, absent: 1, leave: 1 });
  });

  it('the marking window: a teacher inside it; later the coordinator marks, or reopens the day', async () => {
    expect((await get('/attendance/desk/setup', teacher)).statusCode).toBe(403);
    const closed = {
      classFrom: '00:00',
      classTo: '00:01',
      busPickFrom: '00:00',
      busPickTo: '00:01',
      backDays: 0,
    };
    const saved = await put('/attendance/desk/setup', admin, {
      ...closed,
      routeTeachers: [{ routeId, trip: 'pick', employeeId: employee.T1 }],
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().windows).toMatchObject({
      classFrom: '00:00',
      classTo: '00:01',
      configured: true,
    });
    expect(saved.json().routeTeachers).toEqual([
      expect.objectContaining({ trip: 'pick', name: 'Tara Teacher', login: true }),
    ]);
    const body = {
      classSectionId: section,
      date: today,
      marks: [{ studentId: student.Dev, code: 'P' }],
    };
    const late = await post('/attendance/sessions', teacher, body);
    expect(late.statusCode).toBe(409);
    expect(late.json().type).toBe('attendance.window_closed');
    expect(
      (await get(`/attendance/session?classSectionId=${section}&date=${today}`, teacher)).json()
        .window,
    ).toMatchObject({ open: false });
    // the admin is not bound by the window; the session is flagged as marked late
    const byAdmin = await post('/attendance/sessions', admin, body);
    expect(byAdmin.statusCode).toBe(201);
    expect(byAdmin.json()).toMatchObject({ markedLate: true });
    // reopened for the class: the teacher may mark again
    const reopen = await post('/attendance/desk/reopen', admin, {
      scope: 'class',
      classSectionId: section,
      date: today,
      hours: 2,
      reason: 'Teacher was on duty',
    });
    expect(reopen.statusCode).toBe(200);
    expect(reopen.json().reopens[0]).toMatchObject({ what: 'Class VI-A', open: true });
    expect(
      (
        await post('/attendance/sessions', teacher, {
          ...body,
          marks: [{ studentId: student.Dev, code: 'A' }],
        })
      ).statusCode,
    ).toBe(201);
  });

  it('bus attendance by the route’s teacher, morning and afternoon, with what is known of the day', async () => {
    // the teacher is mapped to the morning trip only
    const mine = (await get('/attendance/bus-roll/routes', teacher)).json();
    expect(mine).toMatchObject({
      manager: false,
      data: [{ routeId, trip: 'pick', tripLabel: 'Morning (pick)' }],
    });
    expect((await get('/attendance/bus-roll/routes', other)).json().data).toHaveLength(0);
    expect((await get('/attendance/bus-roll/routes', admin)).json().data).toHaveLength(2);
    const roll = (
      await get(`/attendance/bus-roll?routeId=${routeId}&date=${today}&trip=pick`, teacher)
    ).json();
    expect(roll.counts).toMatchObject({ riders: 3, unmarked: 3 });
    const of = (
      r: {
        roster: Array<{ studentId: string; suggested: string | null; classCode: string | null }>;
      },
      name: string,
    ) => r.roster.find((x) => x.studentId === student[name])!;
    expect(of(roll, 'Bala')).toMatchObject({ suggested: 'LV', classCode: 'LV' });
    expect(of(roll, 'Chitra').suggested).toBeNull(); // an early leave does not touch the morning
    // the morning window is closed for the teacher; another teacher has no way in at all
    const marks = [
      { studentId: student.Ana, code: 'P' },
      { studentId: student.Bala, code: 'LV' },
      { studentId: student.Chitra, code: 'P' },
    ];
    expect(
      (await post('/attendance/bus-roll', other, { routeId, date: today, trip: 'pick', marks }))
        .statusCode,
    ).toBe(403);
    expect(
      (await post('/attendance/bus-roll', teacher, { routeId, date: today, trip: 'pick', marks }))
        .statusCode,
    ).toBe(409);
    await post('/attendance/desk/reopen', admin, {
      scope: 'bus',
      routeId,
      trip: 'pick',
      date: today,
      reason: 'Bus came late',
    });
    const done = await post('/attendance/bus-roll', teacher, {
      routeId,
      date: today,
      trip: 'pick',
      marks,
    });
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      markedBy: 'Tara Teacher',
      markedLate: true,
      counts: { P: 2, LV: 1, unmarked: 0 },
    });
    expect(
      (await post('/attendance/bus-roll', teacher, { routeId, date: today, trip: 'drop', marks }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await post('/attendance/bus-roll', teacher, {
          routeId,
          date: today,
          trip: 'pick',
          marks: [{ studentId: student.Dev, code: 'P' }],
        })
      ).statusCode,
    ).toBe(422);
    // the afternoon: the gate pass takes Chitra off the bus, the leave Bala
    const drop = (
      await get(`/attendance/bus-roll?routeId=${routeId}&date=${today}&trip=drop`)
    ).json();
    expect(of(drop, 'Chitra').suggested).toBe('GP');
    expect(of(drop, 'Bala').suggested).toBe('LV');
    const byAdmin = await post('/attendance/bus-roll', admin, {
      routeId,
      date: today,
      trip: 'drop',
      marks: [
        { studentId: student.Ana, code: 'P' },
        { studentId: student.Chitra, code: 'GP', remarks: 'Collected by mother' },
      ],
    });
    expect(byAdmin.json().counts).toMatchObject({ P: 1, GP: 1, unmarked: 1 });
    const summary = (await get(`/attendance/bus-roll/summary?date=${today}`)).json();
    expect(summary.rows).toEqual([
      expect.objectContaining({
        trip: 'pick',
        riders: 3,
        present: 2,
        leave: 1,
        unmarked: 0,
        teachers: 'Tara Teacher',
      }),
      expect.objectContaining({
        trip: 'drop',
        riders: 3,
        present: 1,
        gatePass: 1,
        unmarked: 1,
        teachers: null,
      }),
    ]);
  });

  it('registers for a month (teacher downloads them too), the dashboard and the family’s view', async () => {
    const month = today.slice(0, 7);
    const reg = (
      await get(`/attendance/desk/class-register?classSectionId=${section}&month=${month}`, teacher)
    ).json();
    expect(reg).toMatchObject({ section: 'VI-A', days: [today] });
    expect(
      reg.rows.map((r: { name: string; marks: Record<string, string> }) => [
        r.name,
        r.marks[today],
      ]),
    ).toEqual([
      ['Ana Roll', 'P'],
      ['Bala Roll', 'LV'],
      ['Chitra Roll', 'SR'],
      ['Dev Roll', 'A'],
    ]);
    // a family holds the bus view for its own child only: no roll and no summary of a route
    expect(
      (await get(`/attendance/bus-roll?routeId=${routeId}&date=${today}&trip=pick`, parent))
        .statusCode,
    ).toBe(403);
    expect((await get(`/attendance/bus-roll/summary?date=${today}`, parent)).statusCode).toBe(403);
    for (const url of [
      `/attendance/desk/class-register.xlsx?classSectionId=${section}&month=${month}`,
      `/attendance/desk/class-register.pdf?classSectionId=${section}&month=${month}`,
      `/attendance/bus-roll/register.xlsx?routeId=${routeId}&trip=pick&month=${month}`,
      `/attendance/bus-roll/register.pdf?routeId=${routeId}&trip=pick&month=${month}`,
    ])
      expect((await get(url, teacher)).statusCode).toBe(200);
    expect(
      (
        await get(
          `/attendance/bus-roll/register?routeId=${routeId}&trip=drop&month=${month}`,
          other,
        )
      ).statusCode,
    ).toBe(403);
    const bus = (
      await get(
        `/attendance/bus-roll/register?routeId=${routeId}&trip=pick&month=${month}`,
        teacher,
      )
    ).json();
    expect(bus.rows.find((r: { name: string }) => r.name === 'Bala Roll')).toMatchObject({
      leave: 1,
      present: 0,
    });
    const dash = (await get('/attendance/desk/dashboard')).json();
    expect(dash.class).toMatchObject({
      strength: 4,
      present: 2,
      absent: 1,
      leave: 1,
      unmarked: 0,
      pending: [],
      markedLate: 1,
    });
    expect(dash.bus.pick).toMatchObject({ riders: 3, present: 2, leave: 1, unmarked: 0 });
    expect(dash.bus.drop).toMatchObject({ present: 1, gatePass: 1, unmarked: 1 });
    expect(dash.bus.pending).toHaveLength(0);
    expect(dash.known).toMatchObject({ leave: 1, earlyLeave: 1 });
    expect(dash.trend).toHaveLength(14);
    // the family: the month so far, today in class and on the bus
    const home = (await get('/attendance/desk/mine/today', parent)).json().children[0];
    expect(home).toMatchObject({
      name: 'Ana Roll',
      today: 'P',
      rides: true,
      busPick: 'P',
      busDrop: 'P',
      month: { days: 1, present: 1 },
    });
    const mine = (await get(`/attendance/bus-roll/mine?month=${month}`, parent)).json().children[0];
    expect(mine.days).toEqual([{ date: today, pick: 'P', drop: 'P', route: 'R1' }]);
  });
});
