/**
 * A teacher's login reaches only their sections (0304, 4 Nov 2026). A login made after the person's
 * Teacher assignments takes them at once; a Class Teacher / Subject Teacher role with no section scope
 * reaches no section (it reached the whole school: every class's papers in the teacher app's Marks).
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

describe('teacher login scopes (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const ids: Record<string, string> = {};
  const asAdmin = () => headersFor(admin.sub, school.id);
  const sub = (employeeId: string) => `employee:${school.id}:${employeeId}`;
  const sectionsAs = async (employeeId: string) => {
    const r = await inject({
      method: 'GET',
      url: `/academics/classes/${ids.cls}/sections`,
      headers: headersFor(sub(employeeId), school.id),
    });
    expect(r.statusCode).toBe(200);
    return (r.json() as { data: Array<{ name: string }> }).data.map((s) => s.name).sort();
  };
  const scopesOf = (employeeId: string) =>
    withMigrator(
      async (c) =>
        (
          await c.query<{ code: string; sections: string[] | null }>(
            `SELECT r.code, (SELECT array_agg(cs.name ORDER BY cs.name) FROM user_role_scopes s
                             JOIN class_sections cs ON cs.id = s.scope_id
                            WHERE s.user_role_id = ur.id AND s.scope_type = 'class_section') AS sections
             FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN employees e ON e.user_id = ur.user_id
            WHERE e.id = $1 AND ur.school_id = $2 AND ur.revoked_at IS NULL ORDER BY r.code`,
            [employeeId, school.id],
          )
        ).rows,
    );

  beforeAll(async () => {
    const s = stamp('TLS');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}S`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      ids.cls = (
        await c.query<{ id: string }>(
          `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, 'VI', 'Class VI', 6) RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      for (const name of ['A', 'B'])
        ids[name] = (
          await c.query<{ id: string }>(
            `INSERT INTO class_sections (school_id, academic_year_id, class_id, name, capacity) VALUES ($1, $2, $3, $4, 40) RETURNING id::text`,
            [school.id, school.yearId, ids.cls, name],
          )
        ).rows[0]!.id;
      ids.cs = (
        await c.query<{ id: string }>(
          `INSERT INTO subjects (school_id, code, name) VALUES ($1, 'CS', 'Computer Science') RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      for (const code of ['T1', 'T2'])
        ids[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, email) VALUES ($1, $2, $2, $3) RETURNING id::text`,
            [school.id, code, `${s.toLowerCase()}-${code.toLowerCase()}@example.com`],
          )
        ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => app.close());

  it('a login made after the assignments takes their sections at once', async () => {
    const a = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: asAdmin(),
      json: {
        employeeId: ids.T1,
        classSectionId: ids.A,
        kind: 'subject_teacher',
        subjectId: ids.cs,
      },
    });
    expect(a.statusCode).toBe(201);
    expect(await scopesOf(ids.T1!)).toEqual([]); // no login yet: nobody to give the role to
    const login = await inject({
      method: 'POST',
      url: `/people/staff/${ids.T1}/login`,
      headers: asAdmin(),
      json: {},
    });
    expect(login.json()).toMatchObject({ hasLogin: true });
    expect(await scopesOf(ids.T1!)).toEqual([{ code: 'subject_teacher', sections: ['A'] }]);
    expect(await sectionsAs(ids.T1!)).toEqual(['A']);
  });

  it('a teacher login with no assignment reaches no section (not the whole school)', async () => {
    const login = await inject({
      method: 'POST',
      url: `/people/staff/${ids.T2}/login`,
      headers: asAdmin(),
      json: {},
    });
    expect(login.json()).toMatchObject({ hasLogin: true });
    expect(await scopesOf(ids.T2!)).toEqual([{ code: 'subject_teacher', sections: null }]);
    expect(await sectionsAs(ids.T2!)).toEqual([]);
    // an assignment then gives that section only
    const a = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: asAdmin(),
      json: {
        employeeId: ids.T2,
        classSectionId: ids.B,
        kind: 'subject_teacher',
        subjectId: ids.cs,
      },
    });
    expect(a.statusCode).toBe(201);
    expect(await sectionsAs(ids.T2!)).toEqual(['B']);
    // the school admin still sees both
    const all = await inject({
      method: 'GET',
      url: `/academics/classes/${ids.cls}/sections`,
      headers: asAdmin(),
    });
    expect((all.json() as { data: unknown[] }).data).toHaveLength(2);
  });
});
