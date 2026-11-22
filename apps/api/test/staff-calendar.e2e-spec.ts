/**
 * Holidays and the almanac for staff (docs/design/96, part 4): every staff member, whatever their role, reads what is
 * for everyone and for staff — not what is for students; families are refused.
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

interface Calendar {
  holidays: Array<{ name: string; appliesTo: string }>;
  events: Array<{ title: string; audience: string }>;
}

describe('the staff calendar (e2e, docs/design/96 part 4)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let clerk: SeededUser;
  let parent: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    const s = stamp('SC');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      // a staff member with no role that reads the calendar (accounts, store…)
      clerk = await seedUser(c, school, `${s}-clerk`);
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, status)
         VALUES ($1, 'SC01', 'Staff', 'Clerk', $2, 'active')`,
        [school.id, clerk.id],
      );
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
    });
    app = await createApp();
    inject = injector(app);
    const post = (url: string, json: unknown) =>
      inject({ method: 'POST', url, headers: h(admin), json });
    for (const [name, appliesTo] of [
      ['Founders day', 'everyone'],
      ['Staff only day', 'employees'],
      ['Pupils only day', 'students'],
    ] as const)
      expect(
        (
          await post('/academics/calendar/holidays', {
            name,
            startsOn: name.startsWith('Founders')
              ? '2026-12-02'
              : name.startsWith('Staff')
                ? '2026-12-03'
                : '2026-12-04',
            appliesTo,
          })
        ).statusCode,
      ).toBeLessThan(300);
    for (const [title, audience] of [
      ['Sports day', 'everyone'],
      ['Staff workshop', 'employees'],
      ['Pupils picnic', 'students'],
    ] as const)
      expect(
        (await post('/academics/calendar/events', { title, startsOn: '2026-12-10', audience }))
          .statusCode,
      ).toBeLessThan(300);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('a staff member without the calendar right reads the staff calendar', async () => {
    expect(
      (await inject({ method: 'GET', url: '/academics/calendar', headers: h(clerk) })).statusCode,
    ).toBe(403);
    const r = await inject({ method: 'GET', url: '/academics/calendar/staff', headers: h(clerk) });
    expect(r.statusCode).toBe(200);
    const cal = r.json() as Calendar;
    expect(cal.holidays.map((x) => x.name).sort()).toEqual(['Founders day', 'Staff only day']);
    expect(cal.events.map((x) => x.title).sort()).toEqual(['Sports day', 'Staff workshop']);
  });

  it('dates narrow it, as the calendar does', async () => {
    const r = await inject({
      method: 'GET',
      url: '/academics/calendar/staff?from=2026-12-03&to=2026-12-05',
      headers: h(clerk),
    });
    expect((r.json() as Calendar).holidays.map((x) => x.name)).toEqual(['Staff only day']);
  });

  it('a parent is refused', async () => {
    expect(
      (await inject({ method: 'GET', url: '/academics/calendar/staff', headers: h(parent) }))
        .statusCode,
    ).toBe(403);
  });
});
