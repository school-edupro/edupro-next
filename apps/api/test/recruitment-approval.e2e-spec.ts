/**
 * Recruitment, part 5 (0201, docs/design/34-recruitment.md): who approves a vacancy is set in Recruitment
 * set-up (named employees, a designation, the HOD of the vacancy's department); a vacancy waiting follows
 * the set-up at once; an empty level is skipped, the raiser's own level and a level of someone who already
 * approved count as approved; the approver finds it in the header approvals and decides on the vacancy
 * page without the recruitment rights. Publishing takes a date and a time (India time), checked; the
 * careers page closes at the minute; the link, its QR and the poster.
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

describe('recruitment: who approves a vacancy, and its window on the careers page (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let raiser: SeededUser;
  let hodSci: SeededUser;
  let principal: SeededUser;
  let teacher: SeededUser;
  const emp: Record<string, string> = {};
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const R = '/people/recruitment';
  /** A date-and-time box's value (India time), `ms` from now. */
  const ist = (ms: number) => new Date(Date.now() + 330 * 60_000 + ms).toISOString().slice(0, 16);
  const HOUR = 3_600_000;
  const DAY = 24 * HOUR;
  let stageIds: string[] = [];

  const raise = async (title: string, department: string, by: SeededUser = raiser) => {
    const r = await call(by, 'POST', `${R}/vacancies`, { title, department, stageIds });
    expect(r.statusCode).toBe(201);
    return r.json().id as string;
  };
  const levels = (body: unknown) => call(admin, 'PUT', `${R}/setup/approval`, { levels: body });

  beforeAll(async () => {
    const s = stamp('RCA');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      raiser = await seedUser(c, school, `${s}-raiser`, 'academic_coordinator');
      hodSci = await seedUser(c, school, `${s}-hodsci`, 'subject_teacher');
      principal = await seedUser(c, school, `${s}-prin`, 'subject_teacher');
      teacher = await seedUser(c, school, `${s}-teach`, 'subject_teacher');
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      for (const [k, code, name, designation, department, user] of [
        ['admin', 'E0', 'Office Admin', 'Principal', 'Administration', admin.id],
        ['hod', 'E3', 'Sci Hod', 'TGT', 'Teaching Senior', hodSci.id],
        ['prin', 'E1', 'Head Prin', 'Principal', 'Administration', principal.id],
        ['nologin', 'E4', 'No Login', 'PGT', 'Teaching Senior', null],
      ] as const) {
        const r = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, designation, department, employee_type, user_id)
           VALUES ($1, $2, $3, $4, $5, 'teaching', $6) RETURNING id::text`,
          [school.id, code, name, designation, department, user],
        );
        emp[k] = r.rows[0]!.id;
      }
      // the Science (Teaching Senior) department has its HOD; Accounts has none
      await c.query(
        `UPDATE departments SET hod_employee_id = $2 WHERE school_id = $1 AND name = 'Teaching Senior'`,
        [school.id, emp.hod],
      );
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call(admin, 'GET', `${R}/setup`)).json();
    stageIds = (setup.stages as Array<{ id: string }>).map((x) => x.id);
  });
  afterAll(async () => app.close());

  let a = '';

  it('the set-up starts with the Principal’s level; levels are checked; a waiting vacancy moves to the new people at once', async () => {
    const s = (await call(admin, 'GET', `${R}/setup/approval`)).json();
    expect(s.levels).toEqual([
      expect.objectContaining({ name: 'Principal approval', by: 'role', roleCode: 'school_admin' }),
    ]);
    expect(s.departments).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Teaching Senior',
          hod: expect.objectContaining({ code: 'E3' }),
        }),
        expect.objectContaining({ name: 'Accounts', hod: null }),
      ]),
    );
    expect(s.designations).toEqual(expect.arrayContaining([{ name: 'Principal', holders: 2 }]));
    expect((await call(teacher, 'GET', `${R}/setup/approval`)).statusCode).toBe(403);

    a = await raise('PGT Physics', 'Teaching Senior');
    expect((await call(raiser, 'POST', `${R}/vacancies/${a}/submit`)).json().status).toBe(
      'pending',
    );
    expect((await call(admin, 'GET', `${R}/vacancies/${a}`)).json().waitingWith).toMatch(
      /Principal approval/,
    );

    // checked on save: a sign-in, a designation from the list; an HOD may not change the levels
    const noLogin = await levels([{ name: 'Review', by: 'employees', employeeIds: [emp.nologin] }]);
    expect(noLogin.statusCode).toBe(400);
    expect(noLogin.json().detail).toMatch(/No Login .*cannot sign in/);
    expect(
      (await levels([{ name: 'Review', by: 'designation', designation: 'Astronaut' }])).statusCode,
    ).toBe(400);
    expect(
      (
        await call(raiser, 'PUT', `${R}/setup/approval`, {
          levels: [{ name: 'HOD review', by: 'hod' }],
        })
      ).statusCode,
    ).toBe(403);

    const saved = await levels([
      { name: 'HOD review', by: 'hod', slaHours: 48 },
      { name: 'Principal approval', by: 'designation', designation: 'principal' },
    ]);
    expect(saved.statusCode).toBe(200);
    expect(saved.json()).toEqual({ saved: 2, moved: 1, approved: 0 });
    const v = (await call(admin, 'GET', `${R}/vacancies/${a}`)).json();
    expect(v.waitingWith).toMatch(/HOD review \(.*hodsci/);
    expect(
      v.approval.steps.map((x: { name: string; status: string; current: boolean }) => [
        x.name,
        x.status,
        x.current,
      ]),
    ).toEqual([
      ['HOD review', 'pending', true],
      ['Principal approval', 'pending', false],
    ]);
    expect(v.events.map((e: { what: string }) => e.what)).toContain('approval_moved');
    // the department's HOD changes in Staff setup → Departments: the vacancy follows at once, and back
    const hodIs = async (code: string) =>
      expect(
        (
          await call(admin, 'POST', '/masters/departments/rows', {
            values: {
              code: 'teaching_senior',
              name: 'Teaching Senior',
              staff_group: 'teaching',
              hod_employee_id: code,
            },
          })
        ).statusCode,
      ).toBe(201);
    await hodIs('E1');
    // the header list (which does not refresh by itself) has it at once
    expect(
      (await call(principal, 'GET', `${R}/to-approve`))
        .json()
        .data.map((x: { id: string }) => x.id),
    ).toEqual([a]);
    expect((await call(admin, 'GET', `${R}/vacancies/${a}`)).json().waitingWith).toMatch(/prin\)/);
    await hodIs('E3');
    expect((await call(admin, 'GET', `${R}/vacancies/${a}`)).json().waitingWith).toMatch(
      /hodsci\)/,
    );
    // the one it waited with before cannot act on it any more
    const old = await call(admin, 'POST', `${R}/vacancies/${a}/approve`, {});
    expect(old.statusCode).toBe(403);
    expect(old.json().type).toBe('recruitment.not_with_you');
    const again = (await call(admin, 'GET', `${R}/setup/approval`)).json();
    expect(again.levels).toEqual([
      expect.objectContaining({ name: 'HOD review', by: 'hod', slaHours: 48 }),
      expect.objectContaining({ by: 'designation', designation: 'Principal' }),
    ]);
  });

  it('the approver without the recruitment rights finds it in the header approvals, opens it and approves; the next level follows; sending back needs a reason', async () => {
    const mine = (await call(hodSci, 'GET', `${R}/to-approve`)).json().data;
    expect(mine).toEqual([
      expect.objectContaining({ id: a, level: 'HOD review', title: 'PGT Physics', posts: 1 }),
    ]);
    expect((await call(teacher, 'GET', `${R}/to-approve`)).json().data).toEqual([]);
    const v = (await call(hodSci, 'GET', `${R}/vacancies/${a}`)).json();
    expect(v.can).toMatchObject({ view: false, approve: true, publish: false, edit: false });
    expect((await call(teacher, 'GET', `${R}/vacancies/${a}`)).statusCode).toBe(404);
    expect((await call(hodSci, 'GET', `${R}/vacancies`)).statusCode).toBe(403);

    expect((await call(hodSci, 'POST', `${R}/vacancies/${a}/approve`, {})).json()).toEqual({
      status: 'pending',
    });
    expect((await call(hodSci, 'GET', `${R}/to-approve`)).json().data).toEqual([]);
    expect(
      (await call(principal, 'GET', `${R}/to-approve`))
        .json()
        .data.map((x: { id: string }) => x.id),
    ).toEqual([a]);
    // the HOD who approved still opens it (to follow it), without acting
    expect((await call(hodSci, 'GET', `${R}/vacancies/${a}`)).json().can.approve).toBe(false);

    expect(
      (await call(principal, 'POST', `${R}/vacancies/${a}/send-back`, { note: '' })).statusCode,
    ).toBe(400);
    expect(
      (
        await call(principal, 'POST', `${R}/vacancies/${a}/send-back`, { note: 'Say the pay band' })
      ).json(),
    ).toEqual({ status: 'rejected' });
    expect((await call(admin, 'GET', `${R}/vacancies/${a}`)).json()).toMatchObject({
      status: 'rejected',
      decisionNote: 'Say the pay band',
    });
  });

  it('an empty level is skipped; a level of someone who already approved, and the raiser’s own, count as approved; nobody at all refuses the sending', async () => {
    expect(
      (
        await levels([
          { name: 'HOD review', by: 'hod' },
          { name: 'HOD again', by: 'employees', employeeIds: [emp.hod] },
          { name: 'Principal approval', by: 'designation', designation: 'Principal' },
        ])
      ).statusCode,
    ).toBe(200);
    // Accounts has no HOD: the first level is skipped
    const b = await raise('Accountant', 'Accounts');
    await call(raiser, 'POST', `${R}/vacancies/${b}/submit`);
    const vb = (await call(admin, 'GET', `${R}/vacancies/${b}`)).json();
    expect(
      vb.approval.steps.map((x: { status: string; current: boolean; note: string | null }) => [
        x.status,
        x.current,
        x.note,
      ]),
    ).toEqual([
      ['skipped', false, 'Nobody at this level'],
      ['pending', true, null],
      ['pending', false, null],
    ]);
    // the HOD approves the first level: the second is theirs too, so it counts; the Principal's waits
    const c = await raise('TGT Chemistry', 'Teaching Senior');
    await call(raiser, 'POST', `${R}/vacancies/${c}/submit`);
    await call(hodSci, 'POST', `${R}/vacancies/${c}/approve`, { note: 'Needed' });
    const vc = (await call(admin, 'GET', `${R}/vacancies/${c}`)).json();
    expect(
      vc.approval.steps.map((x: { status: string; current: boolean; note: string | null }) => [
        x.status,
        x.current,
        x.note,
      ]),
    ).toEqual([
      ['approved', false, 'Needed'],
      ['approved', false, 'Approved at an earlier level by the same person'],
      ['pending', true, null],
    ]);
    // raised by the office admin, who holds the Principal's designation: that level is theirs
    const d = await raise('Lab Assistant', 'Teaching Senior', admin);
    await call(admin, 'POST', `${R}/vacancies/${d}/submit`);
    expect((await call(hodSci, 'POST', `${R}/vacancies/${d}/approve`, {})).json()).toEqual({
      status: 'approved',
    });
    const vd = (await call(admin, 'GET', `${R}/vacancies/${d}`)).json();
    expect(vd.status).toBe('approved');
    expect(vd.approval.steps[2]).toMatchObject({
      status: 'approved',
      note: "Raised by this level's approver",
    });
    // only an HOD level and a department without one: nobody can approve
    await levels([{ name: 'HOD review', by: 'hod' }]);
    const e = await raise('Clerk', 'Accounts');
    const refused = await call(raiser, 'POST', `${R}/vacancies/${e}/submit`);
    expect(refused.statusCode).toBe(409);
    expect(refused.json().type).toBe('recruitment.no_approver');
    expect((await call(admin, 'GET', `${R}/vacancies/${e}`)).json().status).toBe('draft');
    // the Accountant would have nobody under the new levels: it stays with the HOD it waited with
    const vb2 = (await call(admin, 'GET', `${R}/vacancies/${b}`)).json();
    expect(vb2.status).toBe('pending');
    expect(vb2.waitingWith).toMatch(/HOD again/);
  });

  it('published with a date and a time, checked; the dates change while it is up; the link, its QR and the poster; it closes at the minute', async () => {
    const d = (
      (await call(admin, 'GET', `${R}/vacancies?status=approved`)).json().data as Array<{
        id: string;
        title: string;
      }>
    ).find((x) => x.title === 'Lab Assistant')!.id;
    const pub = (body: unknown) => call(admin, 'POST', `${R}/vacancies/${d}/publish`, body);
    const msg = async (body: unknown) => {
      const r = await pub(body);
      expect(r.statusCode).toBe(400);
      return r.json().detail as string;
    };
    expect(await msg({ opensAt: ist(-DAY), closesAt: ist(DAY) })).toMatch(/Open from: .*passed/);
    expect(await msg({ opensAt: ist(-2 * DAY), closesAt: ist(-DAY) })).toMatch(/passed/);
    expect(await msg({ opensAt: ist(0), closesAt: ist(HOUR / 2) })).toMatch(/at least an hour/);
    expect(await msg({ opensAt: ist(0), closesAt: ist(400 * DAY) })).toMatch(/a year at most/);
    expect((await pub({ opensAt: '2026-11-01', closesAt: ist(DAY) })).statusCode).toBe(400);
    const opensAt = ist(0);
    expect((await pub({ opensAt, closesAt: ist(2 * HOUR) })).statusCode).toBe(200);
    const v = (await call(admin, 'GET', `${R}/vacancies/${d}`)).json();
    expect(v.status).toBe('published');
    expect(new Date(v.closesAt).getTime() - new Date(v.opensAt).getTime()).toBeGreaterThan(HOUR);
    expect(v.share).toEqual({
      url: expect.stringMatching(new RegExp(`/careers/${d}$`)),
      open: true,
    });
    expect(v.events.at(-1).note).toMatch(
      /^\d{2}-\d{2}-\d{4}, \d{1,2}:\d{2} (am|pm) to \d{2}-\d{2}-\d{4}, \d{1,2}:\d{2} (am|pm)$/,
    );
    // the last date moves; the opening already passed stays as it was
    expect((await pub({ opensAt, closesAt: ist(3 * HOUR) })).statusCode).toBe(200);
    expect((await call(admin, 'GET', `${R}/vacancies/${d}`)).json().events.at(-1).what).toBe(
      'rescheduled',
    );

    const qr = (await call(admin, 'GET', `${R}/vacancies/${d}/qr`)).json();
    expect(qr).toMatchObject({ contentType: 'image/png', url: v.share.url });
    expect(qr.base64.length).toBeGreaterThan(100);
    const poster = (await call(admin, 'GET', `${R}/vacancies/${d}/poster`)).json();
    expect(poster.contentType).toBe('application/pdf');
    expect(poster.base64.startsWith('JVBER')).toBe(true);
    const careers = (await call(admin, 'GET', `${R}/setup/careers`)).json();
    expect(careers.url).toMatch(/\/careers$/);
    expect(careers.open).toBe(1);
    expect((await call(teacher, 'GET', `${R}/vacancies/${d}/qr`)).statusCode).toBe(403);
    // a draft has no link
    expect((await call(admin, 'GET', `${R}/vacancies/${a}/qr`)).statusCode).toBe(409);

    // on the careers page now; once the last minute passes it is gone and the vacancy closed
    const code = school.code;
    expect(
      (await inject({ method: 'GET', url: `/public/careers/${code}/vacancies/${d}`, headers: {} }))
        .statusCode,
    ).toBe(200);
    await withMigrator((c) =>
      c.query(
        `UPDATE vacancies SET opens_at = now() - interval '2 hours', closes_at = now() - interval '1 minute' WHERE id = $1`,
        [d],
      ),
    );
    expect(
      (await inject({ method: 'GET', url: `/public/careers/${code}/vacancies/${d}`, headers: {} }))
        .statusCode,
    ).toBe(404);
    const closed = (await call(admin, 'GET', `${R}/vacancies/${d}`)).json();
    expect(closed.status).toBe('closed');
    expect(closed.closedAt).toBe(closed.closesAt);
  });
});
