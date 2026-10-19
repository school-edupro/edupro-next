/**
 * Open a portal as someone (0183, docs/design/31-portal-view-as.md): who can be opened for a student or an
 * employee, making a login first, the one-time hand-off code, view only refusing changes, acting refusing
 * payments, push devices never, administrators never opened, and ending from the portal. The admin app
 * opened as an employee (0188): the token comes back directly, view only refuses office work, acting
 * refuses sessions as others and break-glass.
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

describe('portal opened as someone (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let groupAdmin: SeededUser;
  let accountant: SeededUser;
  let teacher: SeededUser;
  let otherAdmin: SeededUser;
  let studentId = '';
  let fatherId = '';
  let motherId = '';
  let teacherEmp = '';
  let adminEmp = '';
  let acctEmp = '';
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const codeOf = (url: string) => decodeURIComponent(url.split('code=')[1] ?? '');

  beforeAll(async () => {
    const s = stamp('PAS');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      groupAdmin = await seedUser(c, school, `${s}-group`, 'group_admin');
      accountant = await seedUser(c, school, `${s}-acct`, 'accountant');
      teacher = await seedUser(c, school, `${s}-teach`, 'subject_teacher');
      otherAdmin = await seedUser(c, school, `${s}-admin2`, 'school_admin');
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, mobile)
         VALUES ($1, 'T1', 'Tara', 'Teacher', $2, '9800000001'), ($1, 'A1', 'Asha', 'Admin', $3, '9800000002'),
                ($1, 'C1', 'Chitra', 'Counts', $4, '9800000003')
         RETURNING id::text`,
        [school.id, teacher.id, otherAdmin.id, accountant.id],
      );
      teacherEmp = e.rows[0]!.id;
      adminEmp = e.rows[1]!.id;
      acctEmp = e.rows[2]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(admin),
      json: {
        admissionNo: `${s}-1`,
        firstName: 'Ana',
        lastName: 'Reader',
        guardians: [
          {
            guardian: {
              firstName: 'Ravi',
              lastName: 'Reader',
              mobile: `98${String(Date.now()).slice(-8)}`,
              email: `ravi.${s.toLowerCase()}@example.test`,
            },
            relation: 'father',
            isPrimary: true,
          },
          { guardian: { firstName: 'Mala', lastName: 'Reader' }, relation: 'mother' },
        ],
      },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
  });
  afterAll(async () => app.close());

  it('lists the student and each parent with their logins; only those with the right may look', async () => {
    const r = await inject({
      method: 'GET',
      url: `/access/portal-as/student/${studentId}`,
      headers: h(admin),
    });
    expect(r.statusCode).toBe(200);
    const t = r.json().targets as Array<Record<string, unknown>>;
    expect(t.map((x) => x.as)).toEqual(['Student', 'Father', 'Mother']);
    expect(t.every((x) => x.hasLogin === false && x.app === 'parent')).toBe(true);
    expect(t.map((x) => x.canMakeLogin)).toEqual([true, true, false]);
    fatherId = t[1]!.id as string;
    motherId = t[2]!.id as string;
    expect(r.json().modes).toEqual({ view: true, act: true });
    const grp = await inject({
      method: 'GET',
      url: `/access/portal-as/student/${studentId}`,
      headers: h(groupAdmin),
    });
    expect(grp.json().modes).toEqual({ view: true, act: false });
    const no = await inject({
      method: 'GET',
      url: `/access/portal-as/student/${studentId}`,
      headers: h(accountant),
    });
    expect(no.statusCode).toBe(403);
  });

  it('makes a login first: a parent needs a mobile or an email', async () => {
    const before = await inject({
      method: 'POST',
      url: '/access/portal-as',
      headers: h(admin),
      json: { personType: 'guardian', id: fatherId, reason: 'Parent called' },
    });
    expect(before.statusCode).toBe(409);
    expect(before.json().type).toBe('portal.no_login');
    const mother = await inject({
      method: 'POST',
      url: '/access/portal-as/login',
      headers: h(admin),
      json: { personType: 'guardian', id: motherId },
    });
    expect(mother.statusCode).toBe(409);
    expect(mother.json().type).toBe('portal.no_contact');
    for (const [personType, id] of [
      ['guardian', fatherId],
      ['student', studentId],
    ]) {
      const made = await inject({
        method: 'POST',
        url: '/access/portal-as/login',
        headers: h(admin),
        json: { personType, id },
      });
      expect(made.statusCode).toBe(201);
    }
    const r = await inject({
      method: 'GET',
      url: `/access/portal-as/student/${studentId}`,
      headers: h(admin),
    });
    expect(r.json().targets.map((x: { hasLogin: boolean }) => x.hasLogin)).toEqual([
      true,
      true,
      false,
    ]);
    // the parent's account carries the parent role and the guardian membership
    const roles = await withMigrator((c) =>
      c.query<{ code: string; person_type: string }>(
        `SELECT r.code, m.person_type::text FROM guardians g
           JOIN user_roles ur ON ur.user_id = g.user_id AND ur.school_id = g.school_id
           JOIN roles r ON r.id = ur.role_id
           JOIN user_school_memberships m ON m.user_id = g.user_id AND m.school_id = g.school_id
          WHERE g.id = $1`,
        [fatherId],
      ),
    );
    expect(roles.rows).toEqual([{ code: 'parent', person_type: 'guardian' }]);
  });

  it('a reason is needed; the link is for the parent portal and the teacher app cannot use it', async () => {
    const short = await inject({
      method: 'POST',
      url: '/access/portal-as',
      headers: h(admin),
      json: { personType: 'guardian', id: fatherId, reason: 'x' },
    });
    expect(short.statusCode).toBe(400);
    const open = await inject({
      method: 'POST',
      url: '/access/portal-as',
      headers: h(admin),
      json: { personType: 'guardian', id: fatherId, reason: 'Parent says fee page is blank' },
    });
    expect(open.statusCode).toBe(201);
    expect(open.json().url).toMatch(/^http:\/\/localhost:3001\/api\/auth\/handoff\?code=/);
    const code = codeOf(open.json().url);
    // the teacher app cannot take a parent portal code
    const wrongApp = await inject({
      method: 'POST',
      url: '/access/portal-as/handoff',
      headers: {},
      json: { code, app: 'teacher' },
    });
    expect(wrongApp.statusCode).toBe(410);
  });

  it('view only: the one-time code opens the portal as the parent; changes are refused; End closes it', async () => {
    const open = await inject({
      method: 'POST',
      url: '/access/portal-as',
      headers: h(admin),
      json: { personType: 'guardian', id: fatherId, reason: 'Parent says fee page is blank' },
    });
    expect(open.statusCode).toBe(201);
    const code = codeOf(open.json().url);
    const take = await inject({
      method: 'POST',
      url: '/access/portal-as/handoff',
      headers: {},
      json: { code, app: 'parent' },
    });
    expect(take.statusCode).toBe(200);
    expect(take.json()).toMatchObject({ displayName: 'Ravi Reader', schoolId: school.id });
    const token = take.json().token as string;
    const twice = await inject({
      method: 'POST',
      url: '/access/portal-as/handoff',
      headers: {},
      json: { code, app: 'parent' },
    });
    expect(twice.statusCode).toBe(410);

    const me = await inject({ method: 'GET', url: '/me', headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().impersonation).toMatchObject({
      byUserId: admin.id,
      mode: 'view',
      app: 'parent',
    });
    const write = await inject({
      method: 'POST',
      url: '/engagement/feedback',
      headers: bearer(token),
      json: { rating: 5, comment: 'x' },
    });
    expect(write.statusCode).toBe(403);
    expect(write.json().type).toBe('impersonation-view-only');
    const push = await inject({
      method: 'POST',
      url: '/comms/push/devices',
      headers: bearer(token),
      json: {},
    });
    expect(push.statusCode).toBe(403);
    expect(push.json().type).toBe('impersonation-restricted');

    const session = await withMigrator((c) =>
      c.query<{ mode: string; app: string; person_type: string; reason: string }>(
        `SELECT mode, app, person_type, reason FROM impersonation_sessions WHERE id = $1`,
        [open.json().session.id],
      ),
    );
    expect(session.rows[0]).toEqual({
      mode: 'view',
      app: 'parent',
      person_type: 'guardian',
      reason: 'Parent says fee page is blank',
    });

    const end = await inject({
      method: 'POST',
      url: '/access/portal-as/end',
      headers: bearer(token),
    });
    expect(end.statusCode).toBe(200);
    const after = await inject({ method: 'GET', url: '/me', headers: bearer(token) });
    expect(after.statusCode).toBe(401);
  });

  it('acting: the teacher app as the employee; payments refused, other work passes the guard', async () => {
    const list = await inject({
      method: 'GET',
      url: `/access/portal-as/employee/${teacherEmp}`,
      headers: h(admin),
    });
    expect(list.json().targets[0]).toMatchObject({
      as: 'Employee',
      app: 'teacher',
      hasLogin: true,
    });
    // a group admin may view but not act
    const notAct = await inject({
      method: 'POST',
      url: '/access/portal-as',
      headers: h(groupAdmin),
      json: { personType: 'employee', id: teacherEmp, mode: 'act', reason: 'Fill the leave form' },
    });
    expect(notAct.statusCode).toBe(403);
    const open = await inject({
      method: 'POST',
      url: '/access/portal-as',
      headers: h(admin),
      json: { personType: 'employee', id: teacherEmp, mode: 'act', reason: 'Fill the leave form' },
    });
    expect(open.statusCode).toBe(201);
    expect(open.json().url).toMatch(/^http:\/\/localhost:3002\//);
    const take = await inject({
      method: 'POST',
      url: '/access/portal-as/handoff',
      headers: {},
      json: { code: codeOf(open.json().url), app: 'teacher' },
    });
    const token = take.json().token as string;
    const pay = await inject({
      method: 'POST',
      url: '/payments/intents/mine',
      headers: bearer(token),
      json: {},
    });
    expect(pay.statusCode).toBe(403);
    expect(pay.json().type).toBe('impersonation-restricted');
    // past the guard: the request itself is checked (an empty leave request is a validation error)
    const leave = await inject({
      method: 'POST',
      url: '/attendance/leaves/mine',
      headers: bearer(token),
      json: {},
    });
    expect(leave.statusCode).toBe(400);
    await inject({ method: 'POST', url: '/access/portal-as/end', headers: bearer(token) });
  });

  it('the admin app as an employee (0188): the token comes back; view only refuses office work; acting refuses sessions as others; End', async () => {
    const list = await inject({
      method: 'GET',
      url: `/access/portal-as/employee/${acctEmp}`,
      headers: h(admin),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().targets.map((t: { app: string }) => t.app)).toEqual(['teacher', 'admin']);
    expect(list.json().targets[1]).toMatchObject({ as: 'Employee', hasLogin: true, blocked: null });
    // a student or parent is never opened in the admin app
    const wrongApp = await inject({
      method: 'POST',
      url: '/access/portal-as',
      headers: h(admin),
      json: { personType: 'guardian', id: fatherId, app: 'admin', reason: 'Looking around' },
    });
    expect(wrongApp.statusCode).toBe(400);

    const open = await inject({
      method: 'POST',
      url: '/access/portal-as',
      headers: h(admin),
      json: {
        personType: 'employee',
        id: acctEmp,
        app: 'admin',
        reason: 'Fee counter shows nothing',
      },
    });
    expect(open.statusCode).toBe(201);
    expect(open.json()).toMatchObject({
      url: null,
      app: 'admin',
      sub: accountant.sub,
      displayName: expect.any(String),
      schoolId: school.id,
    });
    const token = open.json().token as string;
    expect(token.startsWith('imp.')).toBe(true);
    const me = await inject({ method: 'GET', url: '/me', headers: bearer(token) });
    expect(me.statusCode).toBe(200);
    expect(me.json().impersonation).toMatchObject({
      byUserId: admin.id,
      mode: 'view',
      app: 'admin',
    });
    expect(me.json().user.id).toBe(accountant.id);
    // reading passes; office work is refused while viewing
    const mine = await inject({
      method: 'GET',
      url: '/me/employee-profile',
      headers: bearer(token),
    });
    expect(mine.statusCode).toBe(200);
    const change = await inject({
      method: 'POST',
      url: '/me/employee-profile/changes',
      headers: bearer(token),
      json: { changes: { mobile: '9800000009' } },
    });
    expect(change.statusCode).toBe(403);
    expect(change.json().type).toBe('impersonation-view-only');
    const end = await inject({
      method: 'POST',
      url: '/access/portal-as/end',
      headers: bearer(token),
    });
    expect(end.statusCode).toBe(200);
    expect((await inject({ method: 'GET', url: '/me', headers: bearer(token) })).statusCode).toBe(
      401,
    );

    // acting: their work passes the guard; sessions as others and break-glass do not
    const act = await inject({
      method: 'POST',
      url: '/access/portal-as',
      headers: h(admin),
      json: {
        personType: 'employee',
        id: acctEmp,
        app: 'admin',
        mode: 'act',
        reason: 'Do the fee entry with them',
      },
    });
    expect(act.statusCode).toBe(201);
    const actToken = act.json().token as string;
    const work = await inject({
      method: 'POST',
      url: '/me/employee-profile/changes',
      headers: bearer(actToken),
      json: { changes: {} },
    });
    expect(work.statusCode).not.toBe(403);
    for (const url of ['/access/portal-as', '/access/impersonation', '/access/break-glass']) {
      const nested = await inject({ method: 'POST', url, headers: bearer(actToken), json: {} });
      expect(nested.statusCode).toBe(403);
      expect(nested.json().type).toBe('impersonation-restricted');
    }
    const session = await withMigrator((c) =>
      c.query<{ mode: string; app: string; person_type: string }>(
        `SELECT mode, app, person_type FROM impersonation_sessions WHERE id = $1`,
        [act.json().session.id],
      ),
    );
    expect(session.rows[0]).toEqual({ mode: 'act', app: 'admin', person_type: 'employee' });
    const endAct = await inject({
      method: 'POST',
      url: '/access/portal-as/end',
      headers: bearer(actToken),
    });
    expect(endAct.statusCode).toBe(200);
  });

  it('another administrator is never opened', async () => {
    const list = await inject({
      method: 'GET',
      url: `/access/portal-as/employee/${adminEmp}`,
      headers: h(admin),
    });
    expect(list.json().targets[0].blocked).toBeTruthy();
    const open = await inject({
      method: 'POST',
      url: '/access/portal-as',
      headers: h(admin),
      json: { personType: 'employee', id: adminEmp, reason: 'Looking at their app' },
    });
    expect(open.statusCode).toBe(409);
    expect(open.json().type).toBe('portal.admin');
  });
});
