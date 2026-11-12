/**
 * My leave and My attendance are every employee's (docs/design/85, "As built — My leave for every
 * employee"): a sign-in linked to an active staff record has the right whatever its roles, none at all
 * included; a sign-in with no staff record does not, even through a role that carries it, so it is not shown
 * pages that could only say it is not linked; the roles screen neither offers nor keeps the right. The
 * document a leave asks for: every employee uploads it and opens their own upload; another's file still
 * needs the file right.
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

const OWN = 'leave.own.apply';

describe('My leave and My attendance for every employee (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let noRole: SeededUser;
  let adminStaff: SeededUser;
  let leftStaff: SeededUser;
  let stranger: SeededUser;
  const s = stamp('OW');
  const pdf = Buffer.from('%PDF-1.4\n% EduPro Next test file\n'.repeat(40));
  /** a ready PDF uploaded by u: the slot, then the bytes */
  const upload = async (u: SeededUser) => {
    const slot = await call(u, 'POST', '/platform/files', {
      fileName: 'medical.pdf',
      contentType: 'application/pdf',
      sizeBytes: pdf.length,
      classification: 'personal',
    });
    if (slot.statusCode !== 201) return { status: slot.statusCode, id: '' };
    const put = await inject({
      method: 'PUT',
      url: slot.json().upload.url,
      headers: {},
      raw: { body: pdf, contentType: 'application/pdf' },
    });
    expect(put.statusCode).toBe(200);
    return { status: 201, id: String(slot.json().file.id) };
  };
  const call = (u: SeededUser, method: 'GET' | 'POST', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(u.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const rights = async (u: SeededUser): Promise<string[]> =>
    (await call(u, 'GET', '/me')).json().permissions;

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-ad`, 'school_admin');
      noRole = await seedUser(c, school, `${s}-nr`);
      adminStaff = await seedUser(c, school, `${s}-as`, 'school_admin');
      leftStaff = await seedUser(c, school, `${s}-lf`, 'subject_teacher');
      stranger = await seedUser(c, school, `${s}-st`);
      for (const [u, code, status] of [
        [noRole, 'A', 'active'],
        [adminStaff, 'B', 'active'],
        [leftStaff, 'C', 'inactive'],
      ] as const)
        await c.query(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, department, designation, user_id, status)
           VALUES ($1, $2, $2, 'E2E', 'Science', 'Teacher', $3, $4)`,
          [school.id, `${s}${code}`, u.id, status],
        );
    });
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE id = $1`, [school.id]),
    );
    if (app) await app.close();
  });

  it('an employee with no role has My leave and My attendance; an office sign-in with no staff record has not', async () => {
    expect(await rights(noRole)).toContain(OWN);
    expect(await rights(adminStaff)).toContain(OWN);
    // a role carries it no more: school admin with no staff record, and a teacher who has left
    expect(await rights(admin)).not.toContain(OWN);
    expect(await rights(leftStaff)).not.toContain(OWN);
    // the guard: past it the body is checked (400); short of it, refused (403)
    expect((await call(noRole, 'POST', '/leave/apply', {})).statusCode).toBe(400);
    expect((await call(admin, 'POST', '/leave/apply', {})).statusCode).toBe(403);
    // My leave opens on the employee's own record
    const mine = (await call(noRole, 'GET', '/leave/mine?size=25')).json();
    expect(mine.employee).toMatchObject({ code: `${s}A` });
    expect(mine.can.apply).toBe(true);
  });

  it('the roles screen neither offers the right nor keeps it on a role', async () => {
    const catalogue = (await call(admin, 'GET', '/access/permissions')).json();
    const codes = (Array.isArray(catalogue) ? catalogue : catalogue.data).map(
      (p: { code: string }) => p.code,
    );
    expect(codes).toContain('leave.office.manage');
    expect(codes).not.toContain(OWN);
    const role = await call(admin, 'POST', '/access/roles', {
      code: `ow_${s.toLowerCase().replace(/[^a-z0-9]/g, '')}`.slice(0, 40),
      name: 'Own leave check',
      permissions: [OWN, 'leave.report.view'],
    });
    expect(role.statusCode).toBe(201);
    expect(role.json().permissions).toEqual(['leave.report.view']);
  });

  it('the document: every employee uploads it and opens their own; another’s file needs the file right', async () => {
    expect(await rights(noRole)).toContain('platform.files.upload');
    const mine = await upload(noRole);
    expect(mine.status).toBe(201);
    expect((await call(noRole, 'GET', `/platform/files/${mine.id}/download-url`)).statusCode).toBe(
      200,
    );
    const theirs = await upload(adminStaff);
    expect(theirs.status).toBe(201);
    const refused = await call(noRole, 'GET', `/platform/files/${theirs.id}/download-url`);
    expect(refused.statusCode).toBe(403);
    expect(refused.json().detail).toBe('Missing permission platform.files.view');
    // the school admin (the file right) opens it
    expect((await call(admin, 'GET', `/platform/files/${mine.id}/download-url`)).statusCode).toBe(
      200,
    );
    // a sign-in with no staff record and no role uploads nothing
    expect((await upload(stranger)).status).toBe(403);
  });
});
