/**
 * The staff app's menu as on the staff website (docs/design/94 phase A): `/me/staff-waiting` counts the work waiting
 * on the person, and `/me/menu?kind=staff` shows the work-waiting screens with it — a manager with a reportee gets My
 * team's attendance, a colleague with none does not; the menu is exactly the shared list with those counts.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { staffScreens, type StaffWaiting } from '@edupro/menus';
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

describe('the staff app’s menu, as on the staff website (e2e, docs/design/94 phase A)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let manager: SeededUser;
  let colleague: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const hrefs = async (u: SeededUser) => {
    const r = await inject({ method: 'GET', url: '/me/menu?kind=staff', headers: h(u) });
    expect(r.statusCode).toBe(200);
    return (r.json() as { groups: Array<{ items: Array<{ href: string }> }> }).groups.flatMap((g) =>
      g.items.map((i) => i.href),
    );
  };

  beforeAll(async () => {
    const s = stamp('SM');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      manager = await seedUser(c, school, `${s}-mgr`, 'class_teacher');
      colleague = await seedUser(c, school, `${s}-col`, 'class_teacher');
      const emp = async (code: string, userId: string | null) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, status)
             VALUES ($1, $2, 'Staff', $2, $3, 'active') RETURNING id::text`,
            [school.id, code, userId],
          )
        ).rows[0]!.id;
      const m = await emp('SM01', manager.id);
      await emp('SM02', colleague.id);
      const r = await emp('SM03', null);
      // one reportee for the manager this session
      await c.query(
        `INSERT INTO postings (school_id, employee_id, academic_year_id, reports_to_employee_id) VALUES ($1, $2, $3, $4)`,
        [school.id, r, school.yearId, m],
      );
    });
    app = await createApp();
    inject = injector(app);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('counts the work waiting on the person', async () => {
    const r = await inject({ method: 'GET', url: '/me/staff-waiting', headers: h(manager) });
    expect(r.statusCode).toBe(200);
    const body = r.json() as { unread: number; waiting: StaffWaiting };
    expect(body.waiting.team).toBe(1);
    expect(body).toMatchObject({ unread: expect.any(Number) });
    const other = (
      await inject({ method: 'GET', url: '/me/staff-waiting', headers: h(colleague) })
    ).json() as { waiting: StaffWaiting };
    expect(other.waiting.team).toBe(0);
  });

  it('the app’s menu shows the work-waiting screens, as the website does', async () => {
    const mine = await hrefs(manager);
    expect(mine).toContain('/my-team');
    expect(await hrefs(colleague)).not.toContain('/my-team');
    // exactly the shared list with the person's rights and counts
    const me = (await inject({ method: 'GET', url: '/me', headers: h(manager) })).json() as {
      permissions: string[];
    };
    const { waiting } = (
      await inject({ method: 'GET', url: '/me/staff-waiting', headers: h(manager) })
    ).json() as { waiting: StaffWaiting };
    expect(mine).toEqual(
      staffScreens(me.permissions, waiting).flatMap((g) => g.items.map((i) => i.href)),
    );
  });
});
