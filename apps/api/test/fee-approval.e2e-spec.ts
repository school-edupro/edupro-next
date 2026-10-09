/**
 * Fee changes of a pupil through two approval levels (0110): optional heads by opt-in, level 1 approved
 * by itself when the fee in-charge raises the request, and no direct change for the accounts desk.
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

describe('fee changes through two approval levels (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let studentId: string;
  let swimId: string;

  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const yearTotal = async () =>
    Number(
      (
        (
          await inject({ method: 'GET', url: `/fees/students/${studentId}/demands`, headers: h() })
        ).json() as {
          total: { net: string };
        }
      ).total.net,
    );
  const pendingStep = async (instanceId: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{ id: string; level: number; auto: boolean }>(
        `SELECT s.id::text, s.level,
                EXISTS (SELECT 1 FROM workflow_steps a WHERE a.instance_id = s.instance_id AND a.level < s.level AND a.status = 'approved') AS auto
           FROM workflow_steps s WHERE s.instance_id = $1 AND s.status = 'pending' ORDER BY s.level LIMIT 1`,
        [instanceId],
      );
      return r.rows[0]!;
    });

  beforeAll(async () => {
    const s = stamp('FAP');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    const tui = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition', sortOrder: 1 },
    });
    const swim = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'SWIM', name: 'Swimming', sortOrder: 2, isOptional: true },
    });
    swimId = swim.json().id;
    await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 1 },
    });
    await inject({
      method: 'PUT',
      url: '/fees/grids/structure',
      headers: h(),
      json: {
        classId: cls.json().id,
        rows: [
          { headId: tui.json().id, amounts: Array(12).fill(1000) },
          { headId: swimId, amounts: Array(12).fill(500) },
        ],
      },
    });
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'FAP-1',
        firstName: 'Opt',
        lastName: 'Pupil',
        dob: '2015-01-01',
        admittedOn: '2025-04-05',
        enrolment: { classSectionId: sec.json().id, rollNo: 1 },
      },
    });
    studentId = st.json().id;
    await inject({
      method: 'POST',
      url: `/fees/students/${studentId}/demands/generate`,
      headers: h(),
    });
    expect(
      (await inject({ method: 'POST', url: '/workflow/definitions/defaults', headers: h() }))
        .statusCode,
    ).toBe(201);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('an optional head is not charged until the pupil is opted in', async () => {
    expect(await yearTotal()).toBe(12000);
    const list = await inject({
      method: 'GET',
      url: `/fees/students/${studentId}/optional-heads`,
      headers: h(accountant),
    });
    expect(list.json().data).toEqual([expect.objectContaining({ code: 'SWIM', opted: false })]);
  });

  it('the fee in-charge raises it: level 1 is approved by itself, the principal approves level 2', async () => {
    const req = await inject({
      method: 'POST',
      url: `/fees/students/${studentId}/profile-changes`,
      headers: h(accountant),
      json: {
        optionalHeads: [{ headId: swimId, fromSeq: 4, toSeq: 12 }],
        reason: 'Joined swimming from July',
      },
    });
    expect(req.statusCode).toBe(201);
    const step = await pendingStep(req.json().workflowInstanceId);
    expect(step).toMatchObject({ level: 2, auto: true });
    expect(await yearTotal()).toBe(12000); // nothing until the principal approves
    const mine = await inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/approve`,
      headers: h(accountant),
      json: { note: 'me again' },
    });
    expect(mine.statusCode).toBe(403);
    const ok = await inject({
      method: 'POST',
      url: `/workflow/steps/${step.id}/approve`,
      headers: h(),
      json: { note: 'ok' },
    });
    expect([200, 201]).toContain(ok.statusCode);
    expect(await yearTotal()).toBe(12000 + 9 * 500);
    const list = await inject({
      method: 'GET',
      url: `/fees/students/${studentId}/optional-heads`,
      headers: h(),
    });
    expect(list.json().data[0]).toMatchObject({ opted: true, fromSeq: 4, toSeq: 12 });
  });

  it('somebody else raises it: the fee in-charge approves level 1 first', async () => {
    const req = await inject({
      method: 'POST',
      url: `/fees/students/${studentId}/profile-changes`,
      headers: h(),
      json: { optionalHeads: [], reason: 'Left swimming' },
    });
    expect(req.statusCode).toBe(201);
    const first = await pendingStep(req.json().workflowInstanceId);
    expect(first).toMatchObject({ level: 1, auto: false });
    await inject({
      method: 'POST',
      url: `/workflow/steps/${first.id}/approve`,
      headers: h(accountant),
      json: {},
    });
    expect(await yearTotal()).toBe(12000 + 9 * 500); // level 2 still to come
    const second = await pendingStep(req.json().workflowInstanceId);
    expect(second.level).toBe(2);
    await inject({
      method: 'POST',
      url: `/workflow/steps/${second.id}/approve`,
      headers: h(),
      json: {},
    });
    expect(await yearTotal()).toBe(12000);
  });

  it('the accounts desk cannot change the fee profile directly', async () => {
    const direct = await inject({
      method: 'PUT',
      url: `/fees/students/${studentId}/profile`,
      headers: h(accountant),
      json: { studentType: 'old', hosteller: true },
    });
    expect([403]).toContain(direct.statusCode);
    const harmless = await inject({
      method: 'PUT',
      url: `/fees/students/${studentId}/profile`,
      headers: h(),
      json: { studentType: 'old', hosteller: true },
    });
    expect(harmless.statusCode).toBe(200);
  });
  it('the workflow names who may create the request, and a level can have several roles', async () => {
    const opts = await inject({ method: 'GET', url: '/workflow/options', headers: h() });
    expect(opts.statusCode).toBe(200);
    expect(opts.json().roles.some((r: { code: string }) => r.code === 'accountant')).toBe(true);
    expect(opts.json().roles.some((r: { code: string }) => r.code === 'parent')).toBe(false);
    const defs = (
      await inject({ method: 'GET', url: '/workflow/definitions', headers: h() })
    ).json().data as Array<{ id: string; code: string; creatorRoles: string[] }>;
    const def = defs.find((d) => d.code === 'fee_profile_change')!;
    expect(def.creatorRoles).toEqual([]);
    const save = await inject({
      method: 'PATCH',
      url: `/workflow/definitions/${def.id}`,
      headers: h(),
      json: {
        creatorRoles: ['accountant'],
        levels: [
          {
            level: 1,
            name: 'Office',
            resolver: { kind: 'any_of', roleCodes: ['accountant', 'front_desk'], userIds: [] },
            autoIfRequester: true,
          },
          { level: 2, name: 'Principal', resolver: { kind: 'role', roleCode: 'school_admin' } },
        ],
      },
    });
    expect(save.statusCode).toBe(200);
    expect(save.json().creatorRoles).toEqual(['accountant']);
    // the principal holds no creator role: refused
    const refused = await inject({
      method: 'POST',
      url: `/fees/students/${studentId}/profile-changes`,
      headers: h(),
      json: { hosteller: false, reason: 'Left the hostel' },
    });
    expect(refused.statusCode).toBe(403);
    expect(refused.json().type).toBe('workflow.creator_not_allowed');
    // the accountant may, and being among level 1's roles passes it at once
    const ok = await inject({
      method: 'POST',
      url: `/fees/students/${studentId}/profile-changes`,
      headers: h(accountant),
      json: { hosteller: false, reason: 'Left the hostel' },
    });
    expect(ok.statusCode).toBe(201);
    expect(await pendingStep(ok.json().workflowInstanceId)).toMatchObject({ level: 2, auto: true });
    // switching it off and on keeps the creator roles
    await inject({
      method: 'PATCH',
      url: `/workflow/definitions/${def.id}`,
      headers: h(),
      json: { status: 'active' },
    });
    const again = (
      await inject({ method: 'GET', url: '/workflow/definitions', headers: h() })
    ).json().data as Array<{ id: string; creatorRoles: string[] }>;
    expect(again.find((d) => d.id === def.id)!.creatorRoles).toEqual(['accountant']);
  });
});
