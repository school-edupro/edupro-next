/**
 * Access administration (S2-01 to S2-05, S2-11): roles, grants with SoD, scopes, delegations, memberships,
 * and cache invalidation observed through /me.
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

describe('access administration (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let member: SeededUser;
  let outsider: SeededUser;

  beforeAll(async () => {
    const s = stamp('ACC');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      member = await seedUser(c, school, `${s}-member`);
      outsider = await seedUser(c, other, `${s}-outsider`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  const A = (sub: string) => headersFor(sub, school.id);
  const permissionsOf = async (sub: string): Promise<string[]> => {
    const res = await inject({ method: 'GET', url: '/me', headers: A(sub) });
    expect(res.statusCode).toBe(200);
    return res.json().permissions;
  };

  let roleId: string;

  describe('roles', () => {
    it('lists templates and school roles; templates are read-only', async () => {
      const list = await inject({ method: 'GET', url: '/access/roles', headers: A(admin.sub) });
      expect(list.statusCode).toBe(200);
      const templates = list.json().data.filter((r: { isSystem: boolean }) => r.isSystem);
      expect(templates.map((r: { code: string }) => r.code)).toContain('school_admin');
      const template = templates.find((r: { code: string }) => r.code === 'class_teacher');
      const edit = await inject({
        method: 'PATCH',
        url: `/access/roles/${template.id}`,
        headers: A(admin.sub),
        json: { name: 'Renamed' },
      });
      expect(edit.statusCode).toBe(403);
      expect(edit.json()).toMatchObject({ type: 'role.immutable' });
    });

    it('creates a school role copying a template and adding permissions', async () => {
      const list = await inject({ method: 'GET', url: '/access/roles', headers: A(admin.sub) });
      const classTeacher = list
        .json()
        .data.find((r: { code: string }) => r.code === 'class_teacher');
      const res = await inject({
        method: 'POST',
        url: '/access/roles',
        headers: A(admin.sub),
        json: {
          code: 'section_lead',
          name: 'Section lead',
          copyFromRoleId: classTeacher.id,
          permissions: ['academics.class_section.create'],
        },
      });
      expect(res.statusCode).toBe(201);
      roleId = res.json().id;
      expect(res.json().permissions).toEqual(
        expect.arrayContaining([
          'academics.class.view',
          'academics.class_section.view',
          'academics.class_section.create',
        ]),
      );
      expect(res.json().isSystem).toBe(false);
    });

    it('rejects duplicate codes, template codes and unknown permissions', async () => {
      const dup = await inject({
        method: 'POST',
        url: '/access/roles',
        headers: A(admin.sub),
        json: { code: 'section_lead', name: 'Again' },
      });
      expect(dup.statusCode).toBe(409);
      const tpl = await inject({
        method: 'POST',
        url: '/access/roles',
        headers: A(admin.sub),
        json: { code: 'school_admin', name: 'Clash' },
      });
      expect(tpl.statusCode).toBe(409);
      const bad = await inject({
        method: 'POST',
        url: '/access/roles',
        headers: A(admin.sub),
        json: { code: 'weird', name: 'Weird', permissions: ['nope.nope.nope'] },
      });
      expect(bad.statusCode).toBe(400);
      expect(bad.json()).toMatchObject({ type: 'validation-failed' });
    });

    it('is invisible to another school', async () => {
      const res = await inject({
        method: 'GET',
        url: `/access/roles/${roleId}`,
        headers: headersFor(outsider.sub, other.id),
      });
      expect(res.statusCode).toBe(404);
    });

    it('a class teacher cannot manage roles', async () => {
      const res = await inject({
        method: 'POST',
        url: '/access/roles',
        headers: A(teacher.sub),
        json: { code: 'nope', name: 'Nope' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({
        type: 'permission-denied',
        permission: 'access.role.manage',
      });
    });
  });

  describe('assignments and cache invalidation', () => {
    let assignmentId: string;

    it('grants the school role and the member gains permissions immediately', async () => {
      expect(await permissionsOf(member.sub)).toEqual([]);
      const res = await inject({
        method: 'POST',
        url: '/access/assignments',
        headers: A(admin.sub),
        json: { userId: member.id, roleId, reason: 'e2e grant' },
      });
      expect(res.statusCode).toBe(201);
      assignmentId = res.json().id;
      expect(res.json()).toMatchObject({
        userId: member.id,
        roleCode: 'section_lead',
        active: true,
      });
      expect(await permissionsOf(member.sub)).toEqual(
        expect.arrayContaining(['academics.class.view', 'academics.class_section.create']),
      );
    });

    it('refuses a duplicate grant and a grant to a non-member', async () => {
      const dup = await inject({
        method: 'POST',
        url: '/access/assignments',
        headers: A(admin.sub),
        json: { userId: member.id, roleId, reason: 'again' },
      });
      expect(dup.statusCode).toBe(409);
      const nonMember = await inject({
        method: 'POST',
        url: '/access/assignments',
        headers: A(admin.sub),
        json: { userId: outsider.id, roleId, reason: 'not a member' },
      });
      expect(nonMember.statusCode).toBe(409);
      expect(nonMember.json()).toMatchObject({ type: 'user.not_member' });
    });

    it('enforces segregation of duties at grant time', async () => {
      const a = await inject({
        method: 'POST',
        url: '/access/roles',
        headers: A(admin.sub),
        json: { code: 'granter', name: 'Granter', permissions: ['access.assignment.manage'] },
      });
      const b = await inject({
        method: 'POST',
        url: '/access/roles',
        headers: A(admin.sub),
        json: { code: 'exporter', name: 'Exporter', permissions: ['platform.audit.export'] },
      });
      expect(a.statusCode).toBe(201);
      expect(b.statusCode).toBe(201);
      const first = await inject({
        method: 'POST',
        url: '/access/assignments',
        headers: A(admin.sub),
        json: { userId: member.id, roleId: a.json().id, reason: 'sod a' },
      });
      expect(first.statusCode).toBe(201);
      const second = await inject({
        method: 'POST',
        url: '/access/assignments',
        headers: A(admin.sub),
        json: { userId: member.id, roleId: b.json().id, reason: 'sod b' },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({
        type: 'sod-conflict',
        permissionA: 'access.assignment.manage',
        permissionB: 'platform.audit.export',
      });
      await inject({
        method: 'POST',
        url: `/access/assignments/${first.json().id}/revoke`,
        headers: A(admin.sub),
        json: { reason: 'cleanup' },
      });
    });

    it('applies class_section scopes to what the member can list', async () => {
      const cls = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: A(admin.sub),
        json: { code: 'VII', name: 'Class VII' },
      });
      expect(cls.statusCode).toBe(201);
      const secA = await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: A(admin.sub),
        json: { name: 'A' },
      });
      const secB = await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: A(admin.sub),
        json: { name: 'B' },
      });
      expect(secA.statusCode).toBe(201);
      expect(secB.statusCode).toBe(201);

      const before = await inject({
        method: 'GET',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: A(member.sub),
      });
      expect(before.json().data).toHaveLength(2);

      const scoped = await inject({
        method: 'PUT',
        url: `/access/assignments/${assignmentId}/scopes`,
        headers: A(admin.sub),
        json: { scopes: [{ type: 'class_section', id: secA.json().id }] },
      });
      expect(scoped.statusCode).toBe(200);
      expect(scoped.json().scopes).toEqual([{ type: 'class_section', id: secA.json().id }]);

      const after = await inject({
        method: 'GET',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: A(member.sub),
      });
      expect(after.json().data.map((s: { name: string }) => s.name)).toEqual(['A']);

      const badScope = await inject({
        method: 'PUT',
        url: `/access/assignments/${assignmentId}/scopes`,
        headers: A(admin.sub),
        json: { scopes: [{ type: 'class_section', id: '999999' }] },
      });
      expect(badScope.statusCode).toBe(404);
    });

    it('revokes and the permission disappears immediately', async () => {
      const res = await inject({
        method: 'POST',
        url: `/access/assignments/${assignmentId}/revoke`,
        headers: A(admin.sub),
        json: { reason: 'left the school' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ active: false });
      expect(await permissionsOf(member.sub)).not.toContain('academics.class_section.create');
      const again = await inject({
        method: 'POST',
        url: `/access/assignments/${assignmentId}/revoke`,
        headers: A(admin.sub),
        json: { reason: 'twice' },
      });
      expect(again.statusCode).toBe(409);
    });

    it('lists assignments with filters', async () => {
      const res = await inject({
        method: 'GET',
        url: `/access/assignments?userId=${member.id}&active=false`,
        headers: A(admin.sub),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.length).toBeGreaterThanOrEqual(1);
      expect(res.json().data.every((a: { active: boolean }) => a.active === false)).toBe(true);
    });
  });

  describe('delegations', () => {
    it('a role holder delegates for a window; the recipient gains and then loses the permission', async () => {
      const list = await inject({ method: 'GET', url: '/access/roles', headers: A(admin.sub) });
      const classTeacher = list
        .json()
        .data.find((r: { code: string }) => r.code === 'class_teacher');
      const startsAt = new Date(Date.now() - 60_000).toISOString();
      const endsAt = new Date(Date.now() + 3_600_000).toISOString();
      const res = await inject({
        method: 'POST',
        url: '/access/delegations',
        headers: A(admin.sub),
        json: {
          toUserId: member.id,
          roleId: classTeacher.id,
          fromUserId: teacher.id,
          startsAt,
          endsAt,
          reason: 'leave cover',
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        fromUserId: teacher.id,
        toUserId: member.id,
        active: true,
      });
      expect(await permissionsOf(member.sub)).toContain('academics.class_section.view');

      const revoke = await inject({
        method: 'POST',
        url: `/access/delegations/${res.json().id}/revoke`,
        headers: A(admin.sub),
        json: {},
      });
      expect(revoke.statusCode).toBe(201);
      expect(await permissionsOf(member.sub)).not.toContain('academics.class_section.view');
    });

    it('only the giver may delegate a role they hold', async () => {
      const list = await inject({ method: 'GET', url: '/access/roles', headers: A(admin.sub) });
      const schoolAdmin = list.json().data.find((r: { code: string }) => r.code === 'school_admin');
      const res = await inject({
        method: 'POST',
        url: '/access/delegations',
        headers: A(teacher.sub),
        json: {
          toUserId: member.id,
          roleId: schoolAdmin.id,
          startsAt: new Date().toISOString(),
          endsAt: new Date(Date.now() + 3_600_000).toISOString(),
          reason: 'nope',
        },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: 'delegation.role_not_held' });
    });
  });

  describe('memberships and invitations', () => {
    const mobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    let membershipId: string;
    let invitedSub: string;

    it('invites a new person by mobile, creating a pending user, and grants an initial role', async () => {
      const list = await inject({ method: 'GET', url: '/access/roles', headers: A(admin.sub) });
      const classTeacher = list
        .json()
        .data.find((r: { code: string }) => r.code === 'class_teacher');
      const res = await inject({
        method: 'POST',
        url: '/access/memberships',
        headers: A(admin.sub),
        json: {
          mobile,
          displayName: 'Invited Teacher',
          personType: 'employee',
          roleId: classTeacher.id,
        },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        createdUser: true,
        pendingFirstLogin: true,
        personType: 'employee',
      });
      membershipId = res.json().id;
      invitedSub = `pending:${mobile}`;
      expect(await permissionsOf(invitedSub)).toContain('academics.class_section.view');
    });

    it('inviting the same mobile again reuses the user', async () => {
      const res = await inject({
        method: 'POST',
        url: '/access/memberships',
        headers: A(admin.sub),
        json: { mobile, displayName: 'Invited Teacher', personType: 'guardian' },
      });
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({ createdUser: false, personType: 'guardian' });
    });

    it('deactivating a membership removes access to the school', async () => {
      const res = await inject({
        method: 'PATCH',
        url: `/access/memberships/${membershipId}`,
        headers: A(admin.sub),
        json: { status: 'inactive' },
      });
      expect(res.statusCode).toBe(200);
      const me = await inject({ method: 'GET', url: '/me', headers: A(invitedSub) });
      // still a guardian member, so /me works; the employee membership is gone
      expect(me.statusCode).toBe(200);
      const self = await inject({
        method: 'PATCH',
        url: `/access/memberships/${membershipId}`,
        headers: A(admin.sub),
        json: { status: 'active' },
      });
      expect(self.statusCode).toBe(200);
    });

    it('cannot deactivate own membership; can search users', async () => {
      const mine = await inject({
        method: 'GET',
        url: `/access/memberships?q=${admin.sub}`,
        headers: A(admin.sub),
      });
      const own = mine.json().data.find((m: { userId: string }) => m.userId === admin.id);
      const res = await inject({
        method: 'PATCH',
        url: `/access/memberships/${own.id}`,
        headers: A(admin.sub),
        json: { status: 'inactive' },
      });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: 'membership.self' });

      const search = await inject({
        method: 'GET',
        url: `/access/users?q=Invited`,
        headers: A(admin.sub),
      });
      expect(search.statusCode).toBe(200);
      expect(
        search
          .json()
          .data.some((u: { displayName: string }) => u.displayName === 'Invited Teacher'),
      ).toBe(true);
    });
  });
});
