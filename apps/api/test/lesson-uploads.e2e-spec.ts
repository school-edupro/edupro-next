/**
 * The lesson planner (0097): a teacher uploads a lesson for a date and classes; it goes level by level
 * to the approvers of the rule that fits (the teacher's own, else the class's, else the department's,
 * else the default) and ends acknowledged or rejected. The report, the export and the dashboard follow.
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

describe('lesson uploads with approvers (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  let teacher: SeededUser;
  let other: SeededUser;
  let head: SeededUser;
  const ids: Record<string, string> = {};
  const date = new Date(Date.now() + 5.5 * 3_600_000).toISOString().slice(0, 10);
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const get = (u: SeededUser, url: string) => inject({ method: 'GET', url, headers: h(u) });
  const post = (u: SeededUser, url: string, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const upload = (u: SeededUser, json: Record<string, unknown>) =>
    post(u, '/academics/lessons', { date, targetType: 'class', classIds: [ids.cls], ...json });

  beforeAll(async () => {
    const s = stamp('LU');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      teacher = await seedUser(c, school, `${s}-t1`);
      other = await seedUser(c, school, `${s}-t2`);
      head = await seedUser(c, school, `${s}-hod`);
      for (const [key, u, first, dept] of [
        ['emp1', teacher, 'Tara', 'Science'],
        ['emp2', other, 'Omar', 'Sports'],
        ['hod', head, 'Hema', 'Science'],
        ['coord', coordinator, 'Carl', 'Office'],
      ] as const)
        ids[key] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, department) VALUES ($1, $2, $3, 'Staff', $4, $5) RETURNING id::text`,
            [school.id, key.toUpperCase(), first, u.id, dept],
          )
        ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post(admin, '/academics/classes', {
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
    });
    ids.cls = cls.json().id;
    ids.secA = (
      await post(admin, `/academics/classes/${ids.cls}/sections`, { name: 'A' })
    ).json().id;
    ids.secB = (
      await post(admin, `/academics/classes/${ids.cls}/sections`, { name: 'B' })
    ).json().id;
    for (const [emp, sec] of [
      [ids.emp1, ids.secA],
      [ids.emp2, ids.secB],
      [ids.hod, ids.secB],
    ])
      expect(
        (
          await post(admin, '/academics/teacher-assignments', {
            employeeId: emp,
            classSectionId: sec,
            kind: 'class_teacher',
            // the head of department is a co-class teacher (a section has one actual class teacher)
            isActual: emp !== ids.hod,
          })
        ).statusCode,
      ).toBe(201);
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('lets the office set the approvers by default, department, class and employee', async () => {
    const save = (json: unknown) => post(admin, '/academics/lessons/approvers', json);
    expect(
      (await post(teacher, '/academics/lessons/approvers', { scope: 'default', levels: [] }))
        .statusCode,
    ).toBe(403);
    expect((await save({ scope: 'default', levels: [] })).statusCode).toBe(400);
    expect(
      (await save({ scope: 'department', levels: [{ kind: 'role', roleCode: 'school_admin' }] }))
        .statusCode,
    ).toBe(400);
    expect(
      (await save({ scope: 'default', levels: [{ kind: 'role', roleCode: 'school_admin' }] }))
        .statusCode,
    ).toBe(200);
    // the Science department: its head first, then the coordinator
    expect(
      (
        await save({
          scope: 'department',
          department: 'Science',
          levels: [
            { kind: 'employee', employeeId: ids.hod },
            { kind: 'role', roleCode: 'academic_coordinator' },
          ],
        })
      ).statusCode,
    ).toBe(200);
    const rules = (await get(admin, '/academics/lessons/approvers')).json();
    expect(
      rules.data.map((r: { scope: string; label: string }) => `${r.scope}:${r.label}`),
    ).toEqual(['default:Everyone else (school default)', 'department:Science']);
    expect(rules.data[1].levels.map((l: { label: string }) => l.label)).toEqual([
      'Hema Staff',
      'Academic Coordinator',
    ]);
    expect(rules.departments).toEqual(['Office', 'Science', 'Sports']);
  });

  it('uploads a lesson for the teacher’s classes and sends it to the department’s approvers', async () => {
    const opts = (await get(teacher, '/academics/lessons/options')).json();
    expect(opts.classes).toEqual([{ value: ids.cls, label: 'VI' }]);
    expect(opts.sections).toEqual([{ value: ids.secA, label: 'VI-A' }]);
    expect((await upload(teacher, { topic: 'x' })).statusCode).toBe(400);
    expect(
      (await upload(teacher, { targetType: 'section', sectionIds: [ids.secB], topic: 'Not mine' }))
        .statusCode,
    ).toBe(403);
    const made = await upload(teacher, {
      topic: 'Photosynthesis',
      description: '<p>Leaf <strong>lab</strong></p><script>alert(1)</script>',
    });
    expect(made.statusCode).toBe(201);
    ids.lesson = made.json().id;
    expect(made.json()).toMatchObject({
      status: 'pending',
      currentLevel: 1,
      levels: 2,
      approver: 'Hema Staff',
      classes: 'VI',
      ruleScope: 'department',
      description: '<p>Leaf <strong>lab</strong></p>',
      mine: true,
      myTurn: false,
    });
    // another teacher neither sees nor acts on it
    expect((await get(other, `/academics/lessons/${ids.lesson}`)).statusCode).toBe(404);
    expect(
      (await post(other, `/academics/lessons/${ids.lesson}/decide`, { action: 'acknowledge' }))
        .statusCode,
    ).toBe(403);
  });

  it('moves level by level: the head acknowledges, the coordinator acknowledges or rejects', async () => {
    const decide = (u: SeededUser, id: string, json: unknown) =>
      post(u, `/academics/lessons/${id}/decide`, json);
    // not the coordinator's turn yet
    expect((await decide(coordinator, ids.lesson!, { action: 'acknowledge' })).statusCode).toBe(
      403,
    );
    const waiting = (await get(head, '/academics/lessons?mine=approve')).json();
    expect(waiting.data.map((x: { id: string }) => x.id)).toEqual([ids.lesson]);
    const l1 = await decide(head, ids.lesson!, { action: 'acknowledge', remark: 'Good' });
    expect(l1.json()).toMatchObject({
      status: 'pending',
      currentLevel: 2,
      approver: 'Academic Coordinator',
    });
    expect((await decide(head, ids.lesson!, { action: 'acknowledge' })).statusCode).toBe(403);
    const l2 = await decide(coordinator, ids.lesson!, { action: 'acknowledge' });
    expect(l2.json()).toMatchObject({ status: 'acknowledged' });
    expect(
      l2.json().approvals.map((a: { state: string; actedBy: string | null }) => a.state),
    ).toEqual(['acknowledged', 'acknowledged']);
    expect(
      (await decide(coordinator, ids.lesson!, { action: 'reject', remark: 'late' })).statusCode,
    ).toBe(409);

    // a second lesson is rejected at level 1: a remark is needed
    const second = (await upload(teacher, { topic: 'Respiration' })).json().id as string;
    expect((await decide(head, second, { action: 'reject' })).statusCode).toBe(400);
    expect(
      (await decide(head, second, { action: 'reject', remark: 'Add the activity' })).json(),
    ).toMatchObject({
      status: 'rejected',
    });
    // an employee's own rule wins over the department's; the Sports teacher falls to the default
    expect(
      (
        await post(admin, '/academics/lessons/approvers', {
          scope: 'employee',
          employeeId: ids.emp1,
          levels: [{ kind: 'role', roleCode: 'school_admin' }],
        })
      ).statusCode,
    ).toBe(200);
    expect((await upload(teacher, { topic: 'Own rule' })).json()).toMatchObject({
      levels: 1,
      ruleScope: 'employee',
    });
    const sports = await post(other, '/academics/lessons', {
      date,
      targetType: 'section',
      sectionIds: [ids.secB],
      topic: 'Warm-up drills',
    });
    expect(sports.json()).toMatchObject({ ruleScope: 'default', classes: 'VI-B', levels: 1 });
    ids.sports = sports.json().id;
  });

  it('lists with counts and filters, exports, deletes and shows the dashboard', async () => {
    const all = (await get(admin, '/academics/lessons')).json();
    expect(all.counts).toEqual({ total: 4, pending: 2, acknowledged: 1, rejected: 1 });
    expect(all.office).toBe(true);
    const mine = (await get(teacher, '/academics/lessons')).json();
    expect(mine.counts.total).toBe(3);
    expect(
      (await get(admin, '/academics/lessons?status=rejected'))
        .json()
        .data.map((x: { topic: string }) => x.topic),
    ).toEqual(['Respiration']);
    expect(
      (await get(admin, '/academics/lessons?by=employee_code&q=emp2'))
        .json()
        .data.map((x: { topic: string }) => x.topic),
    ).toEqual(['Warm-up drills']);
    expect((await get(admin, '/academics/lessons?by=class&q=VI-B')).json().data).toHaveLength(1);
    expect((await get(admin, '/academics/lessons?level=1')).json().data).toHaveLength(2);
    for (const format of ['xlsx', 'pdf']) {
      const f = await get(admin, `/academics/lessons?format=${format}`);
      expect(f.statusCode).toBe(200);
      expect(f.rawPayload.length).toBeGreaterThan(800);
    }
    // the teacher deletes their own lesson nobody acted on; not an acknowledged one
    const del = (u: SeededUser, id: string) =>
      inject({ method: 'DELETE', url: `/academics/lessons/${id}`, headers: h(u) });
    expect((await del(teacher, ids.lesson!)).statusCode).toBe(403);
    expect((await del(other, ids.sports!)).statusCode).toBe(200);
    expect((await get(admin, '/academics/lessons')).json().counts.total).toBe(3);
    expect((await get(admin, '/academics/lessons?record=deleted')).json().data).toHaveLength(1);

    expect((await get(teacher, '/academics/lessons/dashboard')).statusCode).toBe(403);
    const d = (await get(admin, '/academics/lessons/dashboard')).json();
    expect(d.kpis).toMatchObject({
      total: 3,
      pending: 1,
      acknowledged: 1,
      rejected: 1,
      notUploaded: 2,
    });
    expect(d.pendingByApprover[0]).toMatchObject({ n: 1 });
    expect(d.byDepartment).toEqual([{ label: 'Science', n: 3, pending: 1 }]);
    expect(d.notUploaded.map((x: { name: string }) => x.name)).toEqual([
      'Hema Staff',
      'Omar Staff',
    ]);
    // the coverage dashboard counts lessons now
    const cov = (await get(admin, '/academics/syllabus/dashboard')).json();
    expect(cov.kpis).toMatchObject({ plansWaiting: 1, plansApproved: 1, plansMissing: 2 });
  });
});
