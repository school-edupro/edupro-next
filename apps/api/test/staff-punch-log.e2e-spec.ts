/**
 * The staff punch log (docs/design/85, "the biometric log as the old Employee / Attendance Details"): punches
 * from a biometric machine (a double tap, an unknown ID), the machine at a glance and Process now, a
 * department's and an employee's raw punches with their limits and the Excel, every version of a day after a
 * correction, the unmatched punches and an unknown ID given to an employee; the rights.
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

const ist = (offsetDays: number) =>
  new Date(Date.now() + 5.5 * 3600 * 1000 + offsetDays * 86_400_000).toISOString().slice(0, 10);
const at = (day: string, hms: string) => `${day}T${hms}+05:30`;

describe('staff punch log (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let teacher: SeededUser;
  let key: string;
  const ids: Record<string, string> = {};
  const s = stamp('PL');
  const day = ist(-1);
  const day2 = ist(-2);
  const call = (u: SeededUser, method: 'GET' | 'POST', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      office = await seedUser(c, school, `${s}-lo`, 'leave_office');
      teacher = await seedUser(c, school, `${s}-t`, 'subject_teacher');
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      for (const [code, bio] of [
        ['P1', 'BIO-P1'],
        ['P2', 'BIO-P2'],
        ['P3', null],
      ] as const)
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, employee_type, gender, biometric_id)
             VALUES ($1, $2, $2, 'E2E', 'Science', 'teaching', 'female', $3) RETURNING id::text`,
            [school.id, `${s}${code}`, bio],
          )
        ).rows[0]!.id;
      // the teacher is P1's and P2's reporting manager this year
      ids.M1 = (
        await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, employee_type, gender, user_id)
           VALUES ($1, $2, 'Manager', 'E2E', 'Science', 'teaching', 'female', $3) RETURNING id::text`,
          [school.id, `${s}M1`, teacher.id],
        )
      ).rows[0]!.id;
      for (const e of [ids.P1, ids.P2])
        await c.query(
          `INSERT INTO postings (school_id, employee_id, academic_year_id, reports_to_employee_id) VALUES ($1, $2, $3, $4)`,
          [school.id, e, school.yearId, ids.M1],
        );
    });
    app = await createApp();
    inject = injector(app);
    await call(office, 'GET', '/leave/setup/overview');
    // no weekly off: any day is a working day
    await withMigrator((c) =>
      c.query(`UPDATE staff_weekoff_rules SET status = 'inactive' WHERE school_id = $1`, [
        school.id,
      ]),
    );
    const dev = await call(admin, 'POST', '/attendance/rfid/devices', {
      code: 'BIO1',
      name: 'Staff room punch',
      kind: 'biometric',
    });
    expect(dev.statusCode).toBe(201);
    key = dev.json().apiKey;
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('the machine’s punches, Process now, a department’s and an employee’s log, the limits, the Excel', async () => {
    const r = await inject({
      method: 'POST',
      url: '/attendance/punch/events',
      headers: { 'x-device-key': key },
      json: {
        school: school.code,
        device: 'BIO1',
        events: [
          { id: 'BIO-P1', at: at(day, '08:00:10') },
          { id: 'BIO-P1', at: at(day, '08:00:40') },
          { id: 'BIO-P1', at: at(day, '12:30:00') },
          { id: 'BIO-P1', at: at(day, '13:00:00') },
          { id: 'BIO-P1', at: at(day, '16:00:00') },
          { id: 'BIO-P2', at: at(day, '08:10:00') },
          { id: 'BIO-X9', at: at(day, '08:05:00') },
          { id: 'BIO-X9', at: at(day, '16:05:00') },
          { id: 'BIO-X9', at: at(day2, '08:02:00') },
        ],
      },
    });
    expect(r.json().outcomes).toEqual({ recorded: 5, duplicate: 1, unknown_id: 3 });
    const ov = (await call(office, 'GET', '/staff-punches/overview')).json();
    expect(ov.devices).toEqual([expect.objectContaining({ code: 'BIO1', waiting: 5, unknown: 3 })]);
    expect(ov.can).toEqual({ assign: true, process: true });
    expect(ov.lists.departments).toContain('Science');
    // Process now works them into the days
    expect(
      (await call(office, 'POST', '/staff-attendance/run', { what: 'sync' })).json().n,
    ).toBeGreaterThan(0);
    expect((await call(office, 'GET', '/staff-punches/overview')).json().devices[0].waiting).toBe(
      0,
    );
    const dept = (
      await call(office, 'GET', `/staff-punches/log?department=Science&from=${day}&to=${day}`)
    ).json();
    expect(dept.figures).toEqual({ n: 5, people: 2, days: 1, waiting: 0 });
    expect(dept.rows[0]).toMatchObject({
      time: '16:00:00',
      employee: { code: `${s}P1` },
      device: 'Staff room punch (BIO1)',
      sourceWords: 'Machine',
      processed: true,
      marked: 'P',
    });
    const one = (
      await call(office, 'GET', `/staff-punches/log?employeeId=${ids.P2!}&from=${day}&to=${day}`)
    ).json();
    expect(one.rows).toEqual([expect.objectContaining({ time: '08:10:00', marked: 'A' })]);
    // a department up to 31 days, an employee up to 92
    expect(
      (
        await call(
          office,
          'GET',
          `/staff-punches/log?department=Science&from=${ist(-32)}&to=${day}`,
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(
          office,
          'GET',
          `/staff-punches/log?employeeId=${ids.P1!}&from=${ist(-93)}&to=${day}`,
        )
      ).statusCode,
    ).toBe(400);
    const file = (
      await call(
        office,
        'GET',
        `/staff-punches/log?department=Science&from=${day}&to=${day}&format=xlsx`,
      )
    ).json();
    expect(file.filename).toMatch(/^Staff-punches/);
  });

  it('every version of a day: the correction Active, the one it replaced InActive; how it was worked out', async () => {
    expect(
      (
        await call(office, 'POST', '/staff-attendance/days', {
          employeeId: ids.P2,
          day,
          out: '16:00',
          reason: 'Forgot to punch out',
        })
      ).statusCode,
    ).toBeLessThan(300);
    const v = (
      await call(
        office,
        'GET',
        `/staff-punches/versions?employeeId=${ids.P2!}&from=${day}&to=${day}`,
      )
    ).json();
    expect(
      v.rows.map((r: { active: boolean; attendance: string }) => [r.active, r.attendance]),
    ).toEqual([
      [true, 'P'],
      [false, 'A'],
    ]);
    expect(v.rows[0]).toMatchObject({ in: '08:10', out: '16:00', remark: 'Forgot to punch out' });
    expect(v.rows[0].by).not.toBe('The system');
    expect(v.rows[0].trace).toEqual([
      ['Set', 'Corrected by the office'],
      ['Why', 'Forgot to punch out'],
    ]);
    expect(v.rows[1].trace).toBeNull();
    expect(v).toMatchObject({ days: 1, changed: 1 });
    const p1 = (
      await call(
        office,
        'GET',
        `/staff-punches/versions?employeeId=${ids.P1!}&from=${day}&to=${day}`,
      )
    ).json();
    expect(p1.rows).toHaveLength(1);
    expect(p1.rows[0]).toMatchObject({ active: true, attendance: 'P', by: 'The system' });
    expect(p1.rows[0].trace.map((x: [string, string]) => x[0])).toContain('Worked');
  });

  it('the unmatched punches; an unknown ID given to an employee; the refusals and the rights', async () => {
    const u = (await call(office, 'GET', `/staff-punches/unmatched?from=${day2}&to=${day}`)).json();
    expect(u).toMatchObject({ unknown: 3, double: 1 });
    expect(u.rows[0]).toMatchObject({ id: 'BIO-X9', kind: 'unknown', punches: 3, days: 2 });
    expect(u.rows[1]).toMatchObject({ id: 'BIO-P1', kind: 'double', employee: { code: `${s}P1` } });
    // only the office gives an ID
    expect(
      (
        await call(teacher, 'POST', '/staff-punches/unmatched/assign', {
          biometricId: 'BIO-X9',
          employeeId: ids.P3,
        })
      ).statusCode,
    ).toBe(403);
    const done = (
      await call(office, 'POST', '/staff-punches/unmatched/assign', {
        biometricId: 'BIO-X9',
        employeeId: ids.P3,
      })
    ).json();
    expect(done).toMatchObject({ punches: 3, days: 2 });
    const p3 = (
      await call(office, 'GET', `/staff-punches/log?employeeId=${ids.P3!}&from=${day2}&to=${day}`)
    ).json();
    expect(p3.figures).toMatchObject({ n: 3, days: 2, waiting: 0 });
    expect(
      (await call(office, 'GET', `/staff-punches/unmatched?from=${day2}&to=${day}`))
        .json()
        .rows.map((r: { id: string }) => r.id),
    ).toEqual(['BIO-P1']);
    // an ID someone holds, or an employee with another ID: refused
    expect(
      (
        await call(office, 'POST', '/staff-punches/unmatched/assign', {
          biometricId: 'BIO-P2',
          employeeId: ids.P3,
        })
      ).statusCode,
    ).toBe(409);
    // the machines' view is not open to a teacher
    expect((await call(teacher, 'GET', '/staff-punches/overview')).statusCode).toBe(403);
  });

  it('a reporting manager sees the punches of their reportees only: the team, one of them, their days', async () => {
    const t = (await call(teacher, 'GET', '/staff-punches/team')).json();
    expect(t.all).toBe(false);
    expect(t.reportees.map((r: { code: string }) => r.code).sort()).toEqual([`${s}P1`, `${s}P2`]);
    const team = (
      await call(teacher, 'GET', `/staff-punches/log?team=1&from=${day2}&to=${day}`)
    ).json();
    expect(team).toMatchObject({ mode: 'team', figures: { n: 5, people: 2 } });
    expect(team.words).toMatch(/^My team \(2 people\)/);
    expect(
      (
        await call(teacher, 'GET', `/staff-punches/log?employeeId=${ids.P1!}&from=${day}&to=${day}`)
      ).json().figures.n,
    ).toBe(4);
    expect(
      (
        await call(
          teacher,
          'GET',
          `/staff-punches/versions?employeeId=${ids.P2!}&from=${day}&to=${day}`,
        )
      ).json().rows,
    ).toHaveLength(2);
    // not someone who does not report to them, not a department, not the unmatched
    for (const url of [
      `/staff-punches/log?employeeId=${ids.P3!}&from=${day}&to=${day}`,
      `/staff-punches/versions?employeeId=${ids.P3!}&from=${day}&to=${day}`,
      `/staff-punches/log?department=Science&from=${day}&to=${day}`,
      `/staff-punches/unmatched?from=${day}&to=${day}`,
    ])
      expect([url, (await call(teacher, 'GET', url)).statusCode]).toEqual([url, 403]);
    // the team up to 31 days
    expect(
      (await call(teacher, 'GET', `/staff-punches/log?team=1&from=${ist(-32)}&to=${day}`))
        .statusCode,
    ).toBe(400);
    // the office sees everyone; a manager with nobody reporting is refused
    expect((await call(office, 'GET', '/staff-punches/team')).json()).toMatchObject({
      all: true,
      reportees: [],
    });
    expect(
      (await call(office, 'GET', `/staff-punches/log?team=1&from=${day}&to=${day}`)).statusCode,
    ).toBe(403);
  });
});
