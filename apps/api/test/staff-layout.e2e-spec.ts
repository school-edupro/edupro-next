/**
 * The staff app's layout kept by the school (docs/design/94 phase B; 0413): the standard layout until the school
 * publishes (the app's tabs as they were); a person gets only what they can open (a tab they cannot open gives its
 * place); the office's draft is checked, previewed and published, or discarded; a staff member keeps their own
 * shortcuts; only the settings rights change the layout.
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

interface Mine {
  tabs: Array<{ href: string; label: string }>;
  shortcuts: Array<{ href: string }>;
  ownShortcuts: boolean;
  cards: Array<{ key: string; href: string | null }>;
  screens: Array<{ href: string }>;
  published: boolean;
}

describe('the staff app layout (e2e, docs/design/94 phase B)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let clerk: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const mine = async (u: SeededUser) => {
    const r = await inject({ method: 'GET', url: '/me/staff-layout', headers: h(u) });
    expect(r.statusCode).toBe(200);
    return r.json() as Mine;
  };
  const hrefs = (xs: Array<{ href: string }>) => xs.map((x) => x.href);

  beforeAll(async () => {
    const s = stamp('SL');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      clerk = await seedUser(c, school, `${s}-clerk`);
      for (const [code, u] of [
        ['SL01', teacher],
        ['SL02', clerk],
      ] as const)
        await c.query(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, status)
           VALUES ($1, $2, 'Staff', $2, $3, 'active')`,
          [school.id, code, u.id],
        );
    });
    app = await createApp();
    inject = injector(app);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  it('the standard layout until the school publishes: the app’s tabs as they were', async () => {
    const t = await mine(teacher);
    expect(t.published).toBe(false);
    expect(hrefs(t.tabs)).toEqual(['/', '/attendance', 'classes', '/messages', 'more']);
    expect(hrefs(t.shortcuts)).toEqual(
      expect.arrayContaining(['/attendance', '/daily-work', '/marks']),
    );
    expect(t.cards.map((c) => c.key)).toEqual(
      expect.arrayContaining(['to_mark', 'periods_today', 'marks_to_enter', 'approvals']),
    );
    expect(t.ownShortcuts).toBe(false);
  });

  it('a person gets only what they can open; a tab they cannot open gives its place', async () => {
    const c = await mine(clerk);
    const open = new Set(hrefs(c.screens));
    expect(open.has('/attendance')).toBe(false);
    // three tabs between Home and More, none the clerk cannot open, no Classes without classes
    expect(c.tabs).toHaveLength(5);
    expect(hrefs(c.tabs)).not.toContain('classes');
    for (const tab of c.tabs.slice(1, 4)) expect(open.has(tab.href)).toBe(true);
    for (const s of c.shortcuts) expect(open.has(s.href)).toBe(true);
    expect(c.cards.map((x) => x.key)).not.toContain('to_mark');
    expect(c.cards.map((x) => x.key)).toContain('approvals');
  });

  it('the office’s draft: checked, published to staff, or discarded', async () => {
    const setup = await inject({
      method: 'GET',
      url: '/platform/staff-app-layout',
      headers: h(admin),
    });
    expect(setup.statusCode).toBe(200);
    expect(setup.json()).toMatchObject({ everPublished: false, changed: false });
    expect(setup.json().catalogue.cards.length).toBe(6);

    const bad = await inject({
      method: 'PUT',
      url: '/platform/staff-app-layout',
      headers: h(admin),
      json: { tabs: ['/messages', '/nowhere'], shortcuts: ['/help'], cards: ['nope'] },
    });
    expect(bad.statusCode).toBe(400);
    const errors = bad.json().errors as string[];
    expect(errors).toContain('Choose three tabs between Home and More.');
    expect(errors).toContain('/nowhere cannot be a tab here.');
    expect(errors).toContain('Choose 4 to 12 Home shortcuts.');
    expect(errors).toContain('nope is not a Home card.');

    const draft = {
      tabs: ['/my-leave', '/messages', '/timetable'],
      shortcuts: ['/messages', '/my-leave', '/timetable', '/help'],
      cards: ['approvals', 'my_leave'],
    };
    expect(
      (
        await inject({
          method: 'PUT',
          url: '/platform/staff-app-layout',
          headers: h(admin),
          json: draft,
        })
      ).statusCode,
    ).toBe(200);
    // not yet for staff
    expect(hrefs((await mine(teacher)).tabs)).toEqual([
      '/',
      '/attendance',
      'classes',
      '/messages',
      'more',
    ]);
    const preview = (
      await inject({ method: 'GET', url: '/platform/staff-app-layout', headers: h(admin) })
    ).json();
    expect(preview).toMatchObject({ changed: true, draft });

    expect(
      (
        await inject({
          method: 'POST',
          url: '/platform/staff-app-layout/publish',
          headers: h(admin),
        })
      ).statusCode,
    ).toBe(200);
    const t = await mine(teacher);
    expect(t.published).toBe(true);
    expect(hrefs(t.tabs)).toEqual(['/', '/my-leave', '/messages', '/timetable', 'more']);
    expect(t.cards.map((c) => c.key)).toEqual(['approvals', 'my_leave']);

    // a new draft thrown away: back to what staff have
    await inject({
      method: 'PUT',
      url: '/platform/staff-app-layout',
      headers: h(admin),
      json: { ...draft, cards: ['notices'] },
    });
    await inject({ method: 'POST', url: '/platform/staff-app-layout/discard', headers: h(admin) });
    const after = (
      await inject({ method: 'GET', url: '/platform/staff-app-layout', headers: h(admin) })
    ).json();
    expect(after).toMatchObject({ changed: false, everPublished: true });
    expect(after.draft.cards).toEqual(['approvals', 'my_leave']);
  });

  it('a staff member keeps their own shortcuts, only screens they can open', async () => {
    const bad = await inject({
      method: 'PUT',
      url: '/me/staff-layout/shortcuts',
      headers: h(clerk),
      json: { shortcuts: ['/attendance', '/messages', '/help', '/my-leave'] },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors).toContain('/attendance is not a screen you can open.');
    const ok = await inject({
      method: 'PUT',
      url: '/me/staff-layout/shortcuts',
      headers: h(clerk),
      json: { shortcuts: ['/messages', '/help', '/my-leave', '/my-attendance'] },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ ownShortcuts: true });
    expect(hrefs((ok.json() as Mine).shortcuts)).toEqual([
      '/messages',
      '/help',
      '/my-leave',
      '/my-attendance',
    ]);
    const back = await inject({
      method: 'DELETE',
      url: '/me/staff-layout/shortcuts',
      headers: h(clerk),
    });
    expect(back.json()).toMatchObject({ ownShortcuts: false });
  });

  it('only the settings rights change the layout', async () => {
    expect(
      (await inject({ method: 'GET', url: '/platform/staff-app-layout', headers: h(teacher) }))
        .statusCode,
    ).toBe(403);
    expect(
      (
        await inject({
          method: 'POST',
          url: '/platform/staff-app-layout/publish',
          headers: h(teacher),
        })
      ).statusCode,
    ).toBe(403);
    const audit = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs WHERE school_id = $1 AND action LIKE 'platform.staff_layout.%'`,
        [school.id],
      ),
    );
    expect(audit.rows[0]!.n).toBeGreaterThanOrEqual(3);
  });
});
