/**
 * Landing page (0151, docs/design/26-admin-landing.md): the widgets by role, filtered by permission; the
 * user's own order, hidden widgets and pins, and the reset; the school's role defaults; pupil birthdays
 * and the wish (only on the day, once a day).
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
  widgets: Array<{ key: string }>;
  hidden: string[];
  quickActions: string[];
  personal: boolean;
}

describe('dashboard landing (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let nobody: SeededUser;
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
    expect(l.quickActions).toEqual(['/fees/collect', '/people/students']);
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
    expect(acc.quickActions).toEqual(['/fees/collect']);

    const d = (await req('GET', '/dashboard/defaults', admin)).json() as {
      roles: Array<{ code: string; name: string; custom: boolean; widgets: string[] }>;
    };
    const row = d.roles.find((r) => r.code === 'accountant')!;
    expect(row.custom).toBe(true);
    expect(row.widgets).toEqual(['fees_today', 'profile', 'clinic']);
    expect(d.roles.every((r) => !r.name.includes('_'))).toBe(true);
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
