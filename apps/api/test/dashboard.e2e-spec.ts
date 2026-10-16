/**
 * Landing page (0151, 0152, docs/design/26-admin-landing.md): the widgets by role, filtered by permission;
 * the user's own order, hidden widgets and pins, and the reset; the school's role settings (widget titles,
 * size, days, rows; quick menu with labels, icons and outside links; lock; copy; push to users; back to
 * built-in; preview; the school's own roles); fee figures without the insights right; pupil birthdays and
 * the wish (only on the day, once a day).
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

/** A 2012 date of birth whose birthday falls `days` from today (India time). */
const dobIn = (days: number) => {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000 + days * 86400e3);
  const md = d.toISOString().slice(5, 10);
  return `2012-${md}`;
};

interface Layout {
  role: string | null;
  widgets: Array<{ key: string; title: string; wide: boolean; days?: number; count?: number }>;
  hidden: string[];
  quickActions: Array<{ href: string; label?: string; icon?: string }>;
  links: Array<{ href: string; label?: string }>;
  locked: boolean;
  personal: boolean;
}
interface Defaults {
  roles: Array<{
    code: string;
    name: string;
    builtIn: boolean;
    custom: boolean;
    locked: boolean;
    widgets: string[];
    settings: Record<string, unknown>;
    quickActions: Array<{ href: string; label?: string }>;
    users: number;
    personal: number;
  }>;
}

describe('dashboard landing (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let nobody: SeededUser;
  let bursar: SeededUser;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const req = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    u: SeededUser,
    json?: unknown,
  ) => inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const layout = async (u: SeededUser) => (await req('GET', '/dashboard', u)).json() as Layout;
  const keys = (l: Layout) => l.widgets.map((w) => w.key);

  beforeAll(async () => {
    const s = stamp('DB');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      nobody = await seedUser(c, school, `${s}-none`);
      // a role the school made under Access, held with the built-in accountant role
      bursar = await seedUser(c, school, `${s}-bursar`, 'accountant');
      const role = await c.query<{ id: string }>(
        `INSERT INTO roles (school_id, code, name, kind) VALUES ($1, 'bursar_desk', 'Bursar Desk', 'module') RETURNING id::text`,
        [school.id],
      );
      await c.query(
        `INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, 'fees.ledger.view')`,
        [role.rows[0]!.id],
      );
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES ($1, $2, $3, 'e2e')`,
        [school.id, bursar.id, role.rows[0]!.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await req('POST', '/academics/classes', admin, {
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
    });
    const sec = await req('POST', `/academics/classes/${cls.json().id as string}/sections`, admin, {
      name: 'A',
    });
    for (const [key, days, n] of [
      ['today', 0, 1],
      ['soon', 3, 2],
      ['later', 20, 3],
    ] as const) {
      const st = await req('POST', '/people/students', admin, {
        admissionNo: `${s}-${n}`,
        firstName: `Bday${key}`,
        lastName: 'Pupil',
        gender: 'female',
        dob: dobIn(days),
        enrolment: { classSectionId: sec.json().id, rollNo: n },
      });
      expect(st.statusCode).toBe(201);
      ids[key] = st.json().id as string;
    }
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND status IN ('queued', 'sending')`,
        [school.id],
      ),
    ).catch(() => undefined);
    if (app) await app.close();
  });

  it('gives each role its own widgets, only those its permissions allow', async () => {
    const a = await layout(admin);
    expect(a.role).toBe('school_admin');
    expect(keys(a)).toEqual(expect.arrayContaining(['profile', 'today', 'fees_today']));
    expect(a.personal).toBe(false);

    const acc = await layout(accountant);
    expect(acc.role).toBe('accountant');
    expect(keys(acc)[0]).toBe('profile');
    expect(keys(acc)).toContain('fees_today');
    expect(keys(acc)).not.toContain('clinic');

    const none = await layout(nobody);
    expect(keys(none)).toContain('profile');
    expect(keys(none)).not.toContain('fees_today');
  });

  it('keeps the user’s own order, hidden widgets and pins, and resets to the role’s page', async () => {
    const put = await req('PUT', '/dashboard/layout', admin, {
      widgets: ['holidays', 'profile', 'no_such_widget', 'news'],
      hidden: ['news'],
      quickActions: ['/fees/collect', '/people/students'],
    });
    expect(put.statusCode).toBe(200);
    const l = await layout(admin);
    expect(keys(l)).toEqual(['holidays', 'profile']);
    expect(l.hidden).toEqual(['news']);
    expect(l.quickActions.map((q) => q.href)).toEqual(['/fees/collect', '/people/students']);
    expect(l.personal).toBe(true);

    expect((await req('DELETE', '/dashboard/layout', admin)).statusCode).toBe(200);
    const back = await layout(admin);
    expect(back.personal).toBe(false);
    expect(keys(back)).toContain('today');
  });

  it('lets the school set a role’s landing page; others may not', async () => {
    expect((await req('GET', '/dashboard/defaults', accountant)).statusCode).toBe(403);
    expect(
      (
        await req('PUT', '/dashboard/defaults/accountant', accountant, {
          widgets: [],
          quickActions: [],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await req('PUT', '/dashboard/defaults/no_such_role', admin, {
          widgets: [],
          quickActions: [],
        })
      ).statusCode,
    ).toBe(404);

    const set = await req('PUT', '/dashboard/defaults/accountant', admin, {
      widgets: ['fees_today', 'profile', 'clinic'],
      quickActions: ['/fees/collect'],
    });
    expect(set.statusCode).toBe(200);
    const acc = await layout(accountant);
    // clinic is in the defaults but the accountant cannot see it
    expect(keys(acc)).toEqual(['fees_today', 'profile']);
    expect(acc.quickActions.map((q) => q.href)).toEqual(['/fees/collect']);

    const d = (await req('GET', '/dashboard/defaults', admin)).json() as {
      roles: Array<{ code: string; name: string; custom: boolean; widgets: string[] }>;
    };
    const row = d.roles.find((r) => r.code === 'accountant')!;
    expect(row.custom).toBe(true);
    expect(row.widgets).toEqual(['fees_today', 'profile', 'clinic']);
    expect(d.roles.every((r) => !r.name.includes('_'))).toBe(true);
  });

  it('applies the school’s widget titles, size, days and rows; rejects values out of range', async () => {
    const bad = await req('PUT', '/dashboard/defaults/accountant', admin, {
      widgets: ['news'],
      settings: { news: { count: 50 } },
    });
    expect(bad.statusCode).toBe(400);
    const set = await req('PUT', '/dashboard/defaults/accountant', admin, {
      widgets: ['fees_today', 'news', 'birthdays_students', 'profile'],
      settings: {
        fees_today: { title: 'Collection', size: 'normal' },
        news: { count: 5 },
        no_such_widget: { title: 'x' },
        profile: { title: 'Profile' },
      },
    });
    expect(set.statusCode).toBe(200);
    const acc = await layout(accountant);
    const fees = acc.widgets.find((w) => w.key === 'fees_today')!;
    expect(fees.title).toBe('Collection');
    expect(fees.wide).toBe(false);
    expect(acc.widgets.find((w) => w.key === 'news')!.count).toBe(5);
    const d = (await req('GET', '/dashboard/defaults', admin)).json() as Defaults;
    // unknown widgets and unchanged titles are not stored
    expect(d.roles.find((r) => r.code === 'accountant')!.settings).toEqual({
      fees_today: { title: 'Collection', size: 'normal' },
      news: { count: 5 },
    });
  });

  it('keeps the quick menu in order with names, icons and the school’s outside links', async () => {
    const noName = await req('PUT', '/dashboard/defaults/accountant', admin, {
      widgets: ['profile', 'quick_actions'],
      quickActions: [{ href: 'https://example.org/' }],
    });
    expect(noName.statusCode).toBe(400);
    const http = await req('PUT', '/dashboard/defaults/accountant', admin, {
      widgets: ['profile', 'quick_actions'],
      quickActions: [{ href: 'http://example.org/', label: 'Site' }],
    });
    expect(http.statusCode).toBe(400);
    const ok = await req('PUT', '/dashboard/defaults/accountant', admin, {
      widgets: ['profile', 'quick_actions'],
      quickActions: [
        { href: '/fees/cashier', label: 'Collect fee', icon: 'wallet' },
        { href: 'https://example.org/', label: 'School website', icon: 'link' },
        '/fees/reports',
        '/fees/cashier',
      ],
    });
    expect(ok.statusCode).toBe(200);
    const acc = await layout(accountant);
    expect(acc.quickActions).toEqual([
      { href: '/fees/cashier', label: 'Collect fee', icon: 'wallet' },
      { href: 'https://example.org/', label: 'School website', icon: 'link' },
      { href: '/fees/reports' },
    ]);
    expect(acc.links.map((l) => l.href)).toEqual(['https://example.org/']);

    // a user's own pins keep the school's names; an outside link the role does not have is dropped
    await req('PUT', '/dashboard/layout', accountant, {
      widgets: ['quick_actions', 'profile'],
      quickActions: [
        '/fees/reports',
        'https://example.org/',
        'https://elsewhere.example/',
        '/fees/cashier',
      ],
    });
    const mine = await layout(accountant);
    expect(mine.quickActions.map((q) => q.label ?? q.href)).toEqual([
      '/fees/reports',
      'School website',
      'Collect fee',
    ]);
  });

  it('locks a role: no own arrangement is used or saved, and push clears them', async () => {
    const before = (await req('GET', '/dashboard/defaults', admin)).json() as Defaults;
    expect(before.roles.find((r) => r.code === 'accountant')!.personal).toBeGreaterThanOrEqual(1);

    const d = before.roles.find((r) => r.code === 'accountant')!;
    await req('PUT', '/dashboard/defaults/accountant', admin, {
      widgets: d.widgets,
      quickActions: d.quickActions,
      settings: d.settings,
      locked: true,
    });
    const acc = await layout(accountant);
    expect(acc.locked).toBe(true);
    expect(acc.personal).toBe(false);
    expect(acc.widgets.map((w) => w.key)).toEqual(['profile', 'quick_actions']);
    const save = await req('PUT', '/dashboard/layout', accountant, { widgets: ['news'] });
    expect(save.statusCode).toBe(409);
    expect(save.json().type).toContain('dashboard.locked');

    const push = await req('POST', '/dashboard/defaults/accountant/apply', admin);
    expect([200, 201]).toContain(push.statusCode);
    expect(push.json().cleared).toBeGreaterThanOrEqual(1);
    const after = (await req('GET', '/dashboard/defaults', admin)).json() as Defaults;
    expect(after.roles.find((r) => r.code === 'accountant')!.personal).toBe(0);
    expect((await req('POST', '/dashboard/defaults/accountant/apply', accountant)).statusCode).toBe(
      403,
    );
  });

  it('copies one role’s page to another and goes back to the built-in page', async () => {
    expect(
      (await req('POST', '/dashboard/defaults/front_desk/copy', admin, { from: 'front_desk' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await req('POST', '/dashboard/defaults/front_desk/copy', admin, { from: 'no_such_role' }))
        .statusCode,
    ).toBe(404);
    const copy = await req('POST', '/dashboard/defaults/front_desk/copy', admin, {
      from: 'accountant',
    });
    expect([200, 201]).toContain(copy.statusCode);
    let d = (await req('GET', '/dashboard/defaults', admin)).json() as Defaults;
    const acc = d.roles.find((r) => r.code === 'accountant')!;
    const fd = d.roles.find((r) => r.code === 'front_desk')!;
    expect(fd.custom).toBe(true);
    expect(fd.widgets).toEqual(acc.widgets);
    expect(fd.quickActions).toEqual(acc.quickActions);
    expect(fd.locked).toBe(true);

    expect((await req('DELETE', '/dashboard/defaults/front_desk', admin)).statusCode).toBe(200);
    d = (await req('GET', '/dashboard/defaults', admin)).json() as Defaults;
    const back = d.roles.find((r) => r.code === 'front_desk')!;
    expect(back.custom).toBe(false);
    expect(back.locked).toBe(false);
    expect(back.widgets).toContain('front_office');
  });

  it('previews a role as its permissions show it, for the landing managers only', async () => {
    expect((await req('GET', '/dashboard/preview/accountant', accountant)).statusCode).toBe(403);
    await req('DELETE', '/dashboard/defaults/accountant', admin);
    const p = (await req('GET', '/dashboard/preview/accountant', admin)).json() as Layout & {
      permissions: string[];
    };
    expect(p.role).toBe('accountant');
    expect(p.permissions).toContain('fees.ledger.view');
    expect(p.permissions).not.toContain('platform.dashboard.manage');
    expect(p.widgets.map((w) => w.key)).toContain('fees_today');
    expect(p.personal).toBe(false);
    expect((await req('GET', '/dashboard/preview/parent', admin)).statusCode).toBe(404);
  });

  it('lists the school’s own roles and lands their holders on them once set', async () => {
    const d = (await req('GET', '/dashboard/defaults', admin)).json() as Defaults;
    const own = d.roles.find((r) => r.code === 'bursar_desk');
    expect(own).toMatchObject({ name: 'Bursar Desk', builtIn: false, custom: false, users: 1 });
    expect(d.roles.some((r) => r.code === 'parent' || r.code === 'class_teacher')).toBe(false);
    // not set yet: the built-in accountant role wins
    expect((await layout(bursar)).role).toBe('accountant');
    await req('PUT', '/dashboard/defaults/bursar_desk', admin, {
      widgets: ['fees_dues', 'profile'],
    });
    const l = await layout(bursar);
    expect(l.role).toBe('bursar_desk');
    expect(l.widgets.map((w) => w.key)).toEqual(['fees_dues', 'profile']);
  });

  it('gives the fee figures to those who see fees without the insights right', async () => {
    const f = await req('GET', '/dashboard/w/fees_today', accountant);
    expect(f.statusCode).toBe(200);
    expect(f.json()).toHaveProperty('collectedToday');
    expect(f.json()).toHaveProperty('byMode30d');
    expect((await req('GET', '/dashboard/w/fees_today', nobody)).statusCode).toBe(404);
  });

  it('lists today’s and the coming week’s birthdays', async () => {
    const b = (await req('GET', '/dashboard/w/birthdays_students', admin)).json() as {
      today: Array<{ id: string; wished: boolean; days: number }>;
      upcoming: Array<{ id: string; days: number }>;
    };
    expect(b.today.map((x) => x.id)).toContain(ids.today);
    expect(b.today.find((x) => x.id === ids.today)!.wished).toBe(false);
    expect(b.upcoming.find((x) => x.id === ids.soon)?.days).toBe(3);
    expect([...b.today, ...b.upcoming].map((x) => x.id)).not.toContain(ids.later);

    // days ahead as the school set them (1 to 31)
    const far = (await req('GET', '/dashboard/w/birthdays_students?days=25', admin)).json() as {
      upcoming: Array<{ id: string }>;
    };
    expect(far.upcoming.map((x) => x.id)).toContain(ids.later);

    expect((await req('GET', '/dashboard/w/hostel', admin)).statusCode).toBe(404);
    expect((await req('GET', '/dashboard/w/no_such', admin)).statusCode).toBe(404);
  });

  it('wishes only on the birthday, once a day, by those allowed', async () => {
    expect(
      (await req('POST', '/dashboard/wish', accountant, { kind: 'student', id: ids.today }))
        .statusCode,
    ).toBe(403);

    const soon = await req('POST', '/dashboard/wish', admin, { kind: 'student', id: ids.soon });
    expect(soon.statusCode).toBe(409);
    expect(soon.json().type).toContain('dashboard.not_birthday');

    const w = await req('POST', '/dashboard/wish', admin, { kind: 'student', id: ids.today });
    expect([200, 201]).toContain(w.statusCode);
    expect(Array.isArray(w.json().channels)).toBe(true);

    const again = await req('POST', '/dashboard/wish', admin, { kind: 'student', id: ids.today });
    expect(again.statusCode).toBe(409);
    expect(again.json().type).toContain('dashboard.already_wished');

    const b = (await req('GET', '/dashboard/w/birthdays_students', admin)).json() as {
      today: Array<{ id: string; wished: boolean }>;
    };
    expect(b.today.find((x) => x.id === ids.today)!.wished).toBe(true);

    const audit = await withMigrator((c) =>
      c.query(`SELECT 1 FROM audit_logs WHERE school_id = $1 AND action = 'people.birthday.wish'`, [
        school.id,
      ]),
    );
    expect(audit.rowCount).toBe(1);
  });
});
