/**
 * The mobile app's notifications and updates (docs/design/89, phase D): a person switches kinds of push off for a
 * school; a pupil's leave reaches its approvers and its decision the family; a gate pass reaches its approvers; a
 * template on the push channel goes to the person's phone (not to a mobile number); the help-desk's push reaches
 * phones; the app's version check; the old apps' update words and who still uses them. Every name and number here is
 * made up.
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

interface Push {
  title: string;
  token: string;
  variables: Record<string, string>;
}

describe('mobile app: notifications and updates (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let section = '';
  let kid = '';
  const s = stamp('MNT');
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, who: SeededUser, json?: unknown) =>
    inject({ method, url, headers: headersFor(who.sub, school.id), ...(json ? { json } : {}) });
  const pushes = async (who: SeededUser): Promise<Push[]> =>
    withMigrator(
      async (c) =>
        (
          await c.query<Push>(
            `SELECT subject AS title, recipient_address AS token, variables FROM comms_messages
              WHERE school_id = $1 AND channel = 'push' AND recipient_user_id = $2 ORDER BY id`,
            [school.id, who.id],
          )
        ).rows,
    );
  const homework = (title: string) =>
    call('POST', '/academics/daily-work', teacher, {
      classSectionId: section,
      kind: 'homework',
      title,
      body: 'Q1 to Q5',
    });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'T01', 'Tara', 'Teacher', $2)`,
        [school.id, teacher.id],
      );
      await c.query(
        `INSERT INTO comms_templates (school_id, code, channel, name, body, variables)
         VALUES ($1, 'sample_waiting', 'push', 'Waiting for you', '{{what}} is waiting for your decision', '["what"]'::jsonb)`,
        [school.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    await call('PUT', '/platform/settings/attendance.weekly_off', admin, { value: [] });
    const cls = await call('POST', '/academics/classes', admin, {
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
    });
    section = (
      await call('POST', `/academics/classes/${cls.json().id}/sections`, admin, { name: 'A' })
    ).json().id;
    const st = await call('POST', '/people/students', admin, {
      admissionNo: `${s}-1`,
      firstName: 'Kid',
      lastName: 'Sample',
      guardians: [
        {
          guardian: { firstName: 'Pia', lastName: 'Sample', mobile: '9876555501' },
          relation: 'mother',
          isPrimary: true,
        },
      ],
      enrolment: { classSectionId: section, rollNo: 1 },
    });
    expect(st.statusCode).toBe(201);
    kid = st.json().id;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876555501' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    const emp = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = 'T01'`,
        [school.id],
      ),
    );
    expect(
      (
        await call('POST', '/academics/teacher-assignments', admin, {
          employeeId: emp.rows[0]!.id,
          classSectionId: section,
          kind: 'class_teacher',
        })
      ).statusCode,
    ).toBe(201);
    // the parent's and the teacher's phones (the mobile app)
    for (const [who, token] of [
      [parent, `phone-token-${s}-parent`],
      [teacher, `phone-token-${s}-teacher`],
    ] as const)
      expect(
        (
          await call('POST', '/comms/push/devices', who, {
            token,
            app: 'mobile',
            platform: 'android',
          })
        ).statusCode,
      ).toBeLessThan(300);
  });

  afterAll(async () => {
    // nothing from a test school is ever sent
    await withMigrator((c) =>
      c.query(
        `UPDATE comms_messages SET status = 'cancelled' WHERE school_id = $1 AND status IN ('queued', 'sending')`,
        [school.id],
      ),
    );
    if (app) await app.close();
  });

  it('a parent switches homework off for the school: the post reaches the phone only while it is on', async () => {
    const kinds = await call('GET', '/comms/push/events', parent);
    expect(kinds.statusCode).toBe(200);
    expect(kinds.json()).toEqual({
      events: expect.arrayContaining(['homework', 'approvals']),
      off: [],
    });
    const before = (await pushes(parent)).length;
    expect((await homework('Fractions')).statusCode).toBe(201);
    const after = await pushes(parent);
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!).toMatchObject({
      token: `phone-token-${s}-parent`,
      variables: { link: '/homework', event: 'homework', app: 'mobile' },
    });
    const off = await call('PUT', '/comms/push/events', parent, { off: ['homework'] });
    expect(off.json().off).toEqual(['homework']);
    expect((await homework('Decimals')).statusCode).toBe(201);
    expect((await pushes(parent)).length).toBe(before + 1);
    await call('PUT', '/comms/push/events', parent, { off: [] });
    expect((await homework('Percentages')).statusCode).toBe(201);
    expect((await pushes(parent)).length).toBe(before + 2);
    // an unknown kind is refused
    expect((await call('PUT', '/comms/push/events', parent, { off: ['games'] })).statusCode).toBe(
      400,
    );
  });

  it("a pupil's leave reaches the class teacher's phone; the decision reaches the family's", async () => {
    const applied = await call('POST', '/attendance/leaves/mine', parent, {
      studentId: kid,
      leaveType: 'family',
      fromDate: tomorrow,
      toDate: tomorrow,
      reason: 'A family wedding',
    });
    expect(applied.statusCode).toBe(201);
    const id = applied.json().id as string;
    expect(await pushes(teacher)).toContainEqual(
      expect.objectContaining({
        title: 'Leave to approve',
        variables: expect.objectContaining({
          link: `/leaves?tab=inbox&open=${id}`,
          event: 'approvals',
          app: 'mobile',
        }),
      }),
    );
    expect(
      (await call('POST', `/attendance/leaves/${id}/decide`, teacher, { outcome: 'approved' }))
        .statusCode,
    ).toBeLessThan(300);
    expect(await pushes(parent)).toContainEqual(
      expect.objectContaining({
        title: 'Leave approved',
        variables: expect.objectContaining({
          link: '/attendance?view=leave',
          event: 'attendance',
          studentId: kid,
        }),
      }),
    );
  });

  it("a gate pass reaches its first approver's phone", async () => {
    const req = await call('POST', '/gate-passes/mine', parent, {
      studentId: kid,
      kind: 'early_leave',
      atTime: '11:30',
      reason: 'Dentist',
      escortKind: 'other',
      escortName: 'Kamla Devi',
      escortRelation: 'aunt',
      escortMobile: '9876555502',
    });
    expect(req.statusCode).toBe(201);
    expect(await pushes(teacher)).toContainEqual(
      expect.objectContaining({
        title: 'Gate pass to approve',
        variables: expect.objectContaining({ link: '/gate-passes', event: 'approvals' }),
      }),
    );
  });

  it("a request moving to its next level reaches that level's approver", async () => {
    // a two-level request of a kind with no levels of its own skipped (as a consent answer or a lesson)
    const step1 = await withMigrator(async (c) => {
      const levels = [
        { level: 1, name: 'Office', resolver: { kind: 'user', userId: admin.id } },
        { level: 2, name: 'Class teacher', resolver: { kind: 'user', userId: teacher.id } },
      ];
      const d = await c.query<{ id: string }>(
        `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels)
         VALUES ($1, 'sample_two_levels', 'Sample', 'sample_request', $2::jsonb) RETURNING id::text`,
        [school.id, JSON.stringify(levels)],
      );
      const i = await c.query<{ id: string }>(
        `INSERT INTO workflow_instances (school_id, definition_id, entity_type, entity_id, subject, status, current_level, requested_by)
         VALUES ($1, $2, 'sample_request', 1, 'Sample request to approve', 'pending', 1, $3) RETURNING id::text`,
        [school.id, d.rows[0]!.id, parent.id],
      );
      const st = await c.query<{ id: string }>(
        `INSERT INTO workflow_steps (school_id, instance_id, level, name, resolver, assignee_user_ids, status)
         VALUES ($1, $2, 1, 'Office', '{}', ARRAY[$3::bigint], 'pending'),
                ($1, $2, 2, 'Class teacher', '{}', ARRAY[$4::bigint], 'pending')
         RETURNING id::text`,
        [school.id, i.rows[0]!.id, admin.id, teacher.id],
      );
      return st.rows[0]!.id;
    });
    const before = (await pushes(teacher)).filter((p) => p.title === 'Approval waiting').length;
    const ok = await call('POST', `/workflow/steps/${step1}/approve`, admin, {});
    expect(ok.statusCode).toBeLessThan(300);
    const after = (await pushes(teacher)).filter((p) => p.title === 'Approval waiting');
    expect(after.length).toBe(before + 1);
    expect(after.at(-1)!.variables).toMatchObject({ event: 'approvals', app: 'mobile' });
  });

  it("a template on the push channel goes to the person's phone, not to a mobile number", async () => {
    const sent = await call('POST', '/comms/messages', admin, {
      templateCode: 'sample_waiting',
      channel: 'push',
      recipientUserId: teacher.id,
      variables: { what: 'A request' },
    });
    expect(sent.statusCode).toBe(201);
    expect(await pushes(teacher)).toContainEqual(
      expect.objectContaining({
        title: 'Waiting for you',
        token: `phone-token-${s}-teacher`,
        variables: expect.objectContaining({ event: 'approvals', app: 'mobile' }),
      }),
    );
    // someone with no phone or browser for notifications: said plainly
    const none = await call('POST', '/comms/messages', admin, {
      templateCode: 'sample_waiting',
      channel: 'push',
      recipientUserId: admin.id,
      variables: { what: 'A request' },
    });
    expect(none.statusCode).toBe(422);
    expect(none.json()).toMatchObject({ type: 'comms.push.no_device' });
  });

  it("the help-desk's push reaches phones without the school's own Firebase; a person may switch it off", async () => {
    const run = (users: string[]) =>
      withMigrator(async (c) => {
        await c.query('BEGIN');
        try {
          await c.query(`SELECT set_config('app.school_id', $1, true)`, [school.id]);
          const n = await c.query<{ n: number }>(
            `SELECT app.helpdesk_notify(1, 'Reply', '<p>Reply</p>', '{}', $1::bigint[], 'Your query has a reply', 'Tap to read it', '/queries/1') AS n`,
            [users],
          );
          const rows = await c.query<{ app: string | null; event: string }>(
            `SELECT variables->>'app' AS app, variables->>'event' AS event FROM comms_messages
              WHERE school_id = $1 AND channel = 'push' AND variables ? 'helpdesk_query' AND recipient_user_id = ANY($2::bigint[])`,
            [school.id, users],
          );
          return { n: n.rows[0]!.n, rows: rows.rows };
        } finally {
          await c.query('ROLLBACK');
        }
      });
    const sent = await run([parent.id]);
    expect(sent.n).toBe(1);
    expect(sent.rows).toEqual([{ app: 'mobile', event: 'queries' }]);
    await call('PUT', '/comms/push/events', parent, { off: ['queries'] });
    expect((await run([parent.id])).n).toBe(0);
    await call('PUT', '/comms/push/events', parent, { off: [] });
  });

  it("the app's version check; the old apps' words for moving; who still uses the old apps", async () => {
    const old = await inject({
      method: 'GET',
      url: '/auth/mobile/app-version?platform=android&version=0.9.0',
      headers: {},
    });
    expect(old.statusCode).toBe(200);
    expect(old.json()).toMatchObject({
      minimum: expect.any(String),
      mustUpdate: true,
      mayUpdate: true,
    });
    const current = await inject({
      method: 'GET',
      url: '/auth/mobile/app-version?platform=ios&version=99.0.0',
      headers: {},
    });
    expect(current.json()).toMatchObject({ mustUpdate: false, mayUpdate: false });

    const words = 'Install the new EduPro app from the Play Store or the App Store.';
    expect(
      (await call('PUT', '/platform/settings/compat.app_update_message', admin, { value: words }))
        .statusCode,
    ).toBe(200);
    const legacy = await inject({
      method: 'GET',
      url: `/compat/v1/app_version?platform=android&versioncode=0.5&school_id=${school.id}`,
      headers: {},
    });
    expect(legacy.json()).toMatchObject({ versionupdate: '1', message: words });

    await withMigrator(async (c) => {
      for (const [who, type, days] of [
        ['legacy-1', 'parent', 1],
        ['legacy-2', 'parent', 20],
        ['legacy-3', 'teacher', 2],
      ] as const)
        await c.query(
          `INSERT INTO login_events (school_id, method, outcome, occurred_at, detail)
           VALUES ($1, 'compat', 'success', now() - make_interval(days => $2::int), $3::jsonb)`,
          [school.id, days, JSON.stringify({ legacyUser: who, type })],
        );
    });
    expect(
      (await call('POST', '/me/sign-in', parent, { method: 'dev', app: 'mobile' })).statusCode,
    ).toBeLessThan(300);
    const usage = await call('GET', '/platform/old-apps', admin);
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toEqual({
      oldApps: [
        { type: 'parent', week: 1, month: 2 },
        { type: 'teacher', week: 1, month: 1 },
      ],
      oldAppsTotal: { week: 2, month: 3 },
      edupro: { week: 1, month: 1 },
    });
    // a family may not see it
    expect((await call('GET', '/platform/old-apps', parent)).statusCode).toBe(403);
  });
});
