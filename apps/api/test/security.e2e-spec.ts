/**
 * Sprint 5 security controls: MFA freshness (S5-01), impersonation (S5-02), break glass (S5-03),
 * security alerts and metrics (S5-04), compatibility read shapes (S5-07).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

describe('security controls (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let support: SeededUser;
  let teacher: SeededUser;
  let member: SeededUser;

  beforeAll(async () => {
    const s = stamp('SEC');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      support = await seedUser(c, school, `${s}-support`, 'support_engineer');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      member = await seedUser(c, school, `${s}-member`);
      // group_admin holds access.session.impersonate; give the support engineer that role for the test.
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason)
         SELECT $1, $2, id, 'e2e' FROM roles WHERE school_id IS NULL AND code = 'group_admin'`,
        [school.id, support.id],
      );
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const A = (sub: string) => headersFor(sub, school.id);

  describe('MFA freshness (S5-01)', () => {
    it('refuses a privileged action when the authentication is older than the freshness window', async () => {
      const stale = Math.floor(Date.now() / 1000) - 20 * 60; // 20 minutes ago, window is 15
      const roles = (
        await inject({ method: 'GET', url: '/access/roles', headers: A(admin.sub) })
      ).json().data;
      const role = roles.find((r: { code: string }) => r.code === 'class_teacher');
      const res = await inject({
        method: 'POST',
        url: '/access/assignments',
        headers: A(`${admin.sub};auth_time=${stale}`),
        json: { userId: member.id, roleId: role.id, reason: 'stale mfa' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        type: 'mfa-required',
        permission: 'access.assignment.manage',
      });
      const fresh = await inject({
        method: 'POST',
        url: '/access/assignments',
        headers: A(admin.sub),
        json: { userId: member.id, roleId: role.id, reason: 'fresh mfa' },
      });
      expect(fresh.statusCode).toBe(201);
      const noMfa = await inject({
        method: 'POST',
        url: `/access/assignments/${fresh.json().id}/revoke`,
        headers: A(`${admin.sub};mfa=false`),
        json: { reason: 'no mfa' },
      });
      expect(noMfa.statusCode).toBe(403);
    });
  });

  describe('impersonation (S5-02)', () => {
    let token: string;
    let sessionId: string;

    it('starts a reasoned, time-boxed session and the token acts as the target with both identities recorded', async () => {
      const short = await inject({
        method: 'POST',
        url: '/access/impersonation',
        headers: A(support.sub),
        json: { userId: teacher.id, reason: 'short' },
      });
      expect(short.statusCode).toBe(400);
      const res = await inject({
        method: 'POST',
        url: '/access/impersonation',
        headers: A(support.sub),
        json: {
          userId: teacher.id,
          reason: 'Reproducing the timetable bug reported in ticket 4711',
          minutes: 15,
        },
      });
      expect(res.statusCode).toBe(201);
      token = res.json().token;
      sessionId = res.json().session.id;
      expect(token.startsWith('imp.')).toBe(true);
      expect(res.json().session).toMatchObject({
        actorUserId: support.id,
        targetUserId: teacher.id,
        active: true,
      });

      const me = await inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.id).toBe(teacher.id);
      expect(me.json().impersonation).toMatchObject({ sessionId, byUserId: support.id });
      expect(me.json().permissions).toContain('academics.class.view');

      // A mutation under impersonation is audited with impersonated_by = the support engineer.
      const cls = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: { authorization: `Bearer ${token}` },
        json: { code: 'IMP', name: 'Imp class' },
      });
      expect(cls.statusCode).toBe(403); // class teachers cannot create classes: the target's permissions apply
      const audit = await inject({
        method: 'GET',
        url: `/platform/audit?action=access.session.impersonate.start`,
        headers: A(admin.sub),
      });
      expect(audit.json().data[0]).toMatchObject({ actorUserId: support.id, entityId: sessionId });
      const loginEvents = await withMigrator((c) =>
        c.query(
          "SELECT method::text, detail FROM login_events WHERE user_id = $1 AND method = 'impersonation'",
          [teacher.id],
        ),
      );
      expect(loginEvents.rows[0]?.detail).toMatchObject({ sessionId, actorUserId: support.id });
    });

    it('blocks privileged actions while impersonating and ends the session immediately', async () => {
      const privileged = await inject({
        method: 'POST',
        url: '/access/impersonation',
        headers: { authorization: `Bearer ${token}` },
        json: { userId: member.id, reason: 'nested impersonation attempt', minutes: 5 },
      });
      expect(privileged.statusCode).toBe(403);
      const ended = await inject({
        method: 'DELETE',
        url: `/access/impersonation/${sessionId}`,
        headers: A(support.sub),
      });
      expect(ended.statusCode).toBe(200);
      expect(ended.json().active).toBe(false);
      const after = await inject({
        method: 'GET',
        url: '/me',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(after.statusCode).toBe(401);
      expect(after.json()).toMatchObject({ type: 'impersonation-ended' });
      const list = await inject({
        method: 'GET',
        url: '/access/impersonation',
        headers: A(admin.sub),
      });
      expect(list.json().data.some((s: { id: string }) => s.id === sessionId)).toBe(true);
    });
  });

  describe('break glass (S5-03)', () => {
    it('grants a template role for at most four hours with a reason and records the event', async () => {
      const before = await inject({ method: 'GET', url: '/me', headers: A(teacher.sub) });
      expect(before.json().permissions).not.toContain('platform.settings.edit');
      // The teacher cannot open break glass (needs access.assignment.manage); the admin can.
      const denied = await inject({
        method: 'POST',
        url: '/access/break-glass',
        headers: A(teacher.sub),
        json: { reason: 'Fee posting stuck during the audit visit; need settings access' },
      });
      expect(denied.statusCode).toBe(403);
      const tooLong = await inject({
        method: 'POST',
        url: '/access/break-glass',
        headers: A(admin.sub),
        json: {
          reason: 'Fee posting stuck during the audit visit; need settings access',
          hours: 8,
        },
      });
      expect(tooLong.statusCode).toBe(400);
      const res = await inject({
        method: 'POST',
        url: '/access/break-glass',
        headers: A(admin.sub),
        json: {
          reason: 'Fee posting stuck during the audit visit; need group admin to reset',
          roleCode: 'group_admin',
          hours: 2,
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ userId: admin.id, roleCode: 'group_admin', active: true });
      const again = await inject({
        method: 'POST',
        url: '/access/break-glass',
        headers: A(admin.sub),
        json: { reason: 'Second window while the first is open should be refused' },
      });
      expect(again.statusCode).toBe(409);
      const events = await inject({
        method: 'GET',
        url: '/access/break-glass',
        headers: A(admin.sub),
      });
      expect(events.json().data[0]).toMatchObject({
        id: res.json().id,
        reason: expect.stringContaining('audit visit'),
      });
      const audit = await inject({
        method: 'GET',
        url: '/platform/audit?action=access.break_glass.start',
        headers: A(admin.sub),
      });
      expect(audit.json().data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('security alerts and metrics (S5-04)', () => {
    it('raises an alert after ten denials in a minute and exposes Prometheus metrics', async () => {
      for (let i = 0; i < 11; i += 1) {
        const r = await inject({ method: 'GET', url: '/access/roles', headers: A(member.sub) });
        expect(r.statusCode).toBe(403);
      }
      const alerts = await inject({
        method: 'GET',
        url: '/access/security/alerts',
        headers: A(admin.sub),
      });
      expect(alerts.statusCode).toBe(200);
      expect(
        alerts
          .json()
          .data.some(
            (a: { kind: string; schoolId: string }) =>
              a.kind === 'permission_denied' && a.schoolId === school.id,
          ),
      ).toBe(true);
      const metrics = await inject({ method: 'GET', url: '/metrics', headers: {} });
      expect(metrics.statusCode).toBe(200);
      expect(metrics.body).toContain('edupro_http_requests_total');
      expect(metrics.body).toContain('edupro_security_events_total{kind="permission_denied"');
      expect(metrics.body).toContain('edupro_security_alerts_total');
    });
  });

  describe('compatibility read shapes (S5-07)', () => {
    it('answers every recorded legacy shape with the same keys', async () => {
      const shapes = JSON.parse(
        readFileSync(join(__dirname, 'fixtures/compat/legacy-shapes.json'), 'utf8'),
      ) as Record<string, { envelope: string[]; item: string[] }>;
      await inject({
        method: 'POST',
        url: '/people/employees',
        headers: A(admin.sub),
        json: {
          employeeCode: 'D001',
          firstName: 'Dir',
          lastName: 'Ectory',
          designation: 'Clerk',
          posting: {},
        },
      });
      await inject({
        method: 'PUT',
        url: '/platform/settings/compat.holidays',
        headers: A(admin.sub),
        json: { value: [{ date: '2026-10-02', name: 'Gandhi Jayanti' }] },
      });
      const check = async (
        name: string,
        path: string,
        pick: (body: Record<string, unknown>) => unknown[],
      ) => {
        const res = await inject({ method: 'GET', url: path, headers: A(admin.sub) });
        expect(res.statusCode).toBe(200);
        const body = res.json() as Record<string, unknown>;
        for (const key of shapes[name]!.envelope) expect(body).toHaveProperty(key);
        const items = pick(body);
        for (const item of items)
          for (const key of shapes[name]!.item) expect(item).toHaveProperty(key);
        return items;
      };
      const menu = await check(
        'GetMenuDetail',
        '/compat/v1/student/GetMenuDetail',
        (b) => b.items as unknown[],
      );
      expect(menu.length).toBeGreaterThan(0);
      await check(
        'GetSchoolConfig',
        '/compat/v1/student/GetSchoolConfig',
        (b) => b.items as unknown[],
      );
      const directory = await check(
        'GetDirectory',
        '/compat/v1/student/GetDirectory',
        (b) => (b.channel as { items: unknown[] }).items,
      );
      expect(directory.some((d) => (d as { EmpId: string }).EmpId === 'D001')).toBe(true);
      const holidays = await check(
        'GetHolidays',
        '/compat/v1/student/GetHolidays',
        (b) => (b.channel as { items: unknown[] }).items,
      );
      expect(holidays[0]).toMatchObject({
        holidaydate: '02-10-2026',
        holidayname: 'Gandhi Jayanti',
      });
      await check(
        'GetNotice',
        '/compat/v1/student/GetNotice',
        (b) => (b.channels as { channel: { items: unknown[] } }).channel.items,
      );
      await check('GetHomework', '/compat/v1/student/GetHomework', (b) => b.items as unknown[]);
      await check(
        'GetClasswork',
        '/compat/v1/student/GetClasswork',
        (b) => (b.channels as { channel: { items: unknown[] } }).channel.items,
      );
      await check(
        'GetTimetable',
        '/compat/v1/student/GetTimetable',
        (b) => (b.channels as { channel: { items: unknown[] } }).channel.items,
      );
      await check('GetAttendance', '/compat/v1/student/GetAttendance', (b) => [
        (b.channels as { channel: { items: unknown } }).channel.items,
      ]);
    });
  });
});
