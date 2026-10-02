/**
 * Admission number changes (administrators, with a reason; history kept; old number still finds the
 * student; sibling links follow; the profile editor cannot change it) and roll numbers / sections
 * (class teacher renumbers their own section; coordinator moves within the same class only).
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

describe('admission number and roll numbers (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  let teacher: SeededUser;
  let clerk: SeededUser;
  let s: string;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    s = stamp('AR');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      clerk = await seedUser(c, school, `${s}-clerk`, 'academic_coordinator');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'AR1', 'Tina', 'Teacher', $2)`,
        [school.id, teacher.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const mk = async (code: string, order: number) => {
      const r = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: h(),
        json: { code, name: `Class ${code}`, displayOrder: order },
      });
      return r.json().id as string;
    };
    ids.c6 = await mk('VI', 6);
    ids.c7 = await mk('VII', 7);
    for (const [k, cls, name] of [
      ['A', ids.c6, 'A'],
      ['B', ids.c6, 'B'],
      ['S7', ids.c7, 'A'],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: `/academics/classes/${cls}/sections`,
        headers: h(),
        json: { name },
      });
      ids[k] = r.json().id;
    }
    const emp = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = 'AR1'`,
        [school.id],
      ),
    );
    await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(),
      json: { employeeId: emp.rows[0]!.id, classSectionId: ids.A, kind: 'class_teacher' },
    });
    for (const [key, first, roll] of [
      ['x', 'Zara', 1],
      ['y', 'Aman', 2],
      ['z', 'Mira', 3],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `${s}-${key}`,
          firstName: first,
          lastName: 'Roll',
          enrolment: { classSectionId: ids.A, rollNo: roll },
        },
      });
      ids[key] = r.json().id;
    }
  });
  afterAll(async () => {
    await app.close();
  });

  it('only an administrator changes the admission number, with a reason; history, search and siblings follow', async () => {
    // Mira records Zara as her sibling by Zara's number
    await inject({
      method: 'PATCH',
      url: `/people/students/${ids.z}/profile`,
      headers: h(),
      json: { values: { sibling_in_school: 'Yes', sibling_admission_no: `${s}-x` } },
    });
    const viaProfile = await inject({
      method: 'PATCH',
      url: `/people/students/${ids.x}/profile`,
      headers: h(),
      json: { values: { admission_no: `${s}-X2` } },
    });
    expect(viaProfile.statusCode).toBe(400);
    expect(viaProfile.json().errors.admission_no).toMatch(/administrator/);
    const notAdmin = await inject({
      method: 'POST',
      url: `/people/students/${ids.x}/admission-no`,
      headers: h(coordinator),
      json: { admissionNo: `${s}-X2`, reason: 'typed wrongly' },
    });
    expect(notAdmin.statusCode).toBe(403);
    const taken = await inject({
      method: 'POST',
      url: `/people/students/${ids.x}/admission-no`,
      headers: h(),
      json: { admissionNo: `${s}-y`, reason: 'typed wrongly' },
    });
    expect(taken.statusCode).toBe(409);
    const ok = await inject({
      method: 'POST',
      url: `/people/students/${ids.x}/admission-no`,
      headers: h(),
      json: { admissionNo: `${s}-X2`, reason: 'typed wrongly at admission' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data[0]).toMatchObject({
      oldNo: `${s}-x`,
      newNo: `${s}-X2`,
      reason: 'typed wrongly at admission',
    });
    const byOld = await inject({ method: 'GET', url: `/people/students?q=${s}-x`, headers: h() });
    expect(byOld.json().data.map((x: { id: string }) => x.id)).toContain(ids.x);
    const mira = await inject({
      method: 'GET',
      url: `/people/students/${ids.z}/profile`,
      headers: h(),
    });
    expect(mira.json().values.sibling_admission_no).toBe(`${s}-X2`);
  });

  it('the class teacher renumbers their own section; numbers must be unique; other sections are refused', async () => {
    const list = await inject({ method: 'GET', url: '/people/sections', headers: h(teacher) });
    expect(list.json().data.map((x: { id: string }) => x.id)).toEqual([ids.A]);
    const dup = await inject({
      method: 'PUT',
      url: `/people/sections/${ids.A}/roll`,
      headers: h(teacher),
      json: {
        rolls: [
          { studentId: ids.x, rollNo: 1 },
          { studentId: ids.y, rollNo: 1 },
        ],
      },
    });
    expect(dup.statusCode).toBe(400);
    // by name: Aman 1, Mira 2, Zara 3 (swaps numbers already in use)
    const ok = await inject({
      method: 'PUT',
      url: `/people/sections/${ids.A}/roll`,
      headers: h(teacher),
      json: {
        rolls: [
          { studentId: ids.y, rollNo: 1 },
          { studentId: ids.z, rollNo: 2 },
          { studentId: ids.x, rollNo: 3 },
        ],
      },
    });
    expect(ok.statusCode).toBe(200);
    const sec = await inject({
      method: 'GET',
      url: `/people/sections/${ids.A}/roll`,
      headers: h(teacher),
    });
    expect(
      sec
        .json()
        .students.map((x: { name: string; rollNo: number }) => `${String(x.rollNo)}:${x.name}`),
    ).toEqual(['1:Aman Roll', '2:Mira Roll', '3:Zara Roll']);
    expect(sec.json()).toMatchObject({ canRenumber: true, canMove: false });
    const other = await inject({
      method: 'PUT',
      url: `/people/sections/${ids.B}/roll`,
      headers: h(teacher),
      json: { rolls: [{ studentId: ids.x, rollNo: 1 }] },
    });
    expect(other.statusCode).toBe(403);
    const move = await inject({
      method: 'POST',
      url: `/people/sections/${ids.A}/move`,
      headers: h(teacher),
      json: { studentId: ids.x, toSectionId: ids.B },
    });
    expect(move.statusCode).toBe(403);
  });

  it('the coordinator moves a student to another section of the same class only', async () => {
    const otherClass = await inject({
      method: 'POST',
      url: `/people/sections/${ids.A}/move`,
      headers: h(coordinator),
      json: { studentId: ids.x, toSectionId: ids.S7 },
    });
    expect(otherClass.statusCode).toBe(409);
    const ok = await inject({
      method: 'POST',
      url: `/people/sections/${ids.A}/move`,
      headers: h(coordinator),
      json: { studentId: ids.x, toSectionId: ids.B },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ section: 'VI-B', rollNo: 1 });
    const student = await inject({ method: 'GET', url: `/people/students/${ids.x}`, headers: h() });
    expect(student.json().enrolment).toMatchObject({ classSectionId: ids.B, rollNo: 1 });
    expect(clerk).toBeDefined();
  });
});
