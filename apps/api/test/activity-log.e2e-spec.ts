/**
 * The employee's daily activity log (0095): time slots of the day saved as a draft and submitted,
 * locked after that unless a reviewer sends it back; the day's status, the dashboard and the reports.
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

const today = () => new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);

describe('employee daily activity log (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let clerk: SeededUser;
  let nobody: SeededUser;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const get = (u: SeededUser, url: string) => inject({ method: 'GET', url, headers: h(u) });
  const put = (u: SeededUser, json: unknown) =>
    inject({ method: 'PUT', url: '/staff/activity/mine', headers: h(u), json });

  beforeAll(async () => {
    const s = stamp('AL');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      clerk = await seedUser(c, school, `${s}-clerk`, 'front_desk');
      nobody = await seedUser(c, school, `${s}-none`);
      for (const [key, u, first, dept] of [
        ['emp1', clerk, 'Meera', 'Office'],
        ['emp2', nobody, 'Omar', 'Sports'],
      ] as const)
        ids[key] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, department) VALUES ($1, $2, $3, 'Staff', $4, $5) RETURNING id::text`,
            [school.id, key.toUpperCase(), first, u.id, dept],
          )
        ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('opens the day with the school’s categories; an employee without the role cannot fill', async () => {
    expect((await get(nobody, '/staff/activity/mine')).statusCode).toBe(403);
    const mine = (await get(clerk, '/staff/activity/mine')).json();
    expect(mine.employee.name).toBe('Meera Staff');
    expect(mine.categories.length).toBeGreaterThan(8);
    expect(mine).toMatchObject({ editable: true, cutoffTime: '18:00', backDays: 2 });
    expect(mine.log).toMatchObject({ state: null, entries: [] });
    expect(mine.recent).toHaveLength(7);
    ids.office = mine.categories.find((k: { code: string }) => k.code === 'office').id;
    ids.meeting = mine.categories.find((k: { code: string }) => k.code === 'meeting').id;
  });

  it('saves a draft, refuses overlaps, and locks the day once it is submitted', async () => {
    const date = today();
    const a = { from: '08:00', to: '10:30', categoryId: ids.office, description: 'Fee counter' };
    const b = { from: '10:30', to: '11:00', categoryId: ids.meeting, description: 'Staff meeting' };
    expect((await put(clerk, { date, entries: [a, b] })).json()).toMatchObject({
      state: 'draft',
      minutes: 180,
    });
    const clash = await put(clerk, {
      date,
      entries: [a, { ...b, from: '10:00' }],
      submit: true,
    });
    expect(clash.statusCode).toBe(400);
    expect(clash.json().detail).toContain('overlap');
    expect((await put(clerk, { date, entries: [], submit: true })).statusCode).toBe(400);
    expect((await put(clerk, { date: '2099-01-01', entries: [a], submit: true })).statusCode).toBe(
      400,
    );
    expect((await put(clerk, { date: '2020-01-01', entries: [a] })).statusCode).toBe(409);
    const done = await put(clerk, {
      date,
      entries: [a, b],
      tomorrowPlan: 'Receipts of class VI',
      submit: true,
    });
    expect(done.json()).toMatchObject({ state: 'submitted', tomorrowPlan: 'Receipts of class VI' });
    ids.log = done.json().id;
    expect((await put(clerk, { date, entries: [a] })).statusCode).toBe(409);
    expect((await get(clerk, '/staff/activity/mine')).json().editable).toBe(false);
  });

  it('shows the reviewer the day; a log sent back can be corrected and submitted again', async () => {
    expect((await get(clerk, '/staff/activity/day')).statusCode).toBe(403);
    const day = (await get(admin, '/staff/activity/day')).json();
    expect(day.counts).toMatchObject({ employees: 2, submitted: 1, missing: 1 });
    expect(day.departments).toEqual(['Office', 'Sports']);
    expect(
      (await get(admin, '/staff/activity/day?state=missing'))
        .json()
        .data.map((x: { name: string }) => x.name),
    ).toEqual(['Omar Staff']);
    const detail = (await get(admin, `/staff/activity/logs/${ids.log}`)).json();
    expect(detail.log.entries).toHaveLength(2);
    // the employee reads their own; another employee's needs the review permission
    expect((await get(clerk, `/staff/activity/logs/${ids.log}`)).statusCode).toBe(200);

    const review = (json: unknown) =>
      inject({
        method: 'POST',
        url: `/staff/activity/logs/${ids.log}/review`,
        headers: h(admin),
        json,
      });
    expect((await review({ action: 'returned' })).statusCode).toBe(400);
    expect((await review({ action: 'returned', note: 'Add the afternoon' })).json().state).toBe(
      'returned',
    );
    const mine = (await get(clerk, '/staff/activity/mine')).json();
    expect(mine).toMatchObject({ editable: true });
    expect(mine.log).toMatchObject({ state: 'returned', reviewNote: 'Add the afternoon' });
    const again = await put(clerk, {
      date: today(),
      entries: [
        { from: '08:00', to: '11:00', categoryId: ids.office, description: 'Fee counter' },
        { from: '12:00', to: '14:00', categoryId: ids.office, description: 'Bank reconciliation' },
      ],
      submit: true,
    });
    expect(again.json()).toMatchObject({ state: 'submitted', minutes: 300 });
    expect((await review({ action: 'reviewed' })).json().state).toBe('reviewed');
  });

  it('has the dashboard, the compliance list and the reports; the office sets the rules', async () => {
    const d = (await get(admin, '/staff/activity/dashboard')).json();
    expect(d.kpis).toMatchObject({ employees: 2, hours: 5 });
    expect(d.byCategory[0]).toMatchObject({ label: 'Office work', hours: 5 });
    expect(d.byDepartment.map((x: { label: string }) => x.label)).toEqual(['Office', 'Sports']);
    const c = (await get(admin, '/staff/activity/compliance?department=Office')).json();
    expect(c.data).toHaveLength(1);
    expect(c.data[0]).toMatchObject({ name: 'Meera Staff', minutes: 300 });
    for (const q of [
      'report=compliance&format=xlsx',
      'report=category&format=pdf',
      'report=day&format=pdf',
      `report=employee&format=xlsx&employeeId=${ids.emp1}`,
    ]) {
      const f = await get(admin, `/staff/activity/report?${q}`);
      expect(f.statusCode).toBe(200);
      expect(f.rawPayload.length).toBeGreaterThan(800);
    }
    const setup = (json: unknown) =>
      inject({ method: 'PUT', url: '/staff/activity/setup', headers: h(admin), json });
    expect(
      (
        await inject({
          method: 'PUT',
          url: '/staff/activity/setup',
          headers: h(clerk),
          json: { cutoffTime: '17:00', backDays: 1 },
        })
      ).statusCode,
    ).toBe(403);
    expect((await setup({ cutoffTime: '17:00', backDays: 1 })).json()).toMatchObject({
      cutoffTime: '17:00',
      backDays: 1,
    });
    const cats = await inject({
      method: 'POST',
      url: '/staff/activity/categories',
      headers: h(admin),
      json: { name: 'Lab maintenance', sortOrder: 5 },
    });
    expect(cats.json().categories[0]).toMatchObject({ name: 'Lab maintenance', active: true });
  });
});
