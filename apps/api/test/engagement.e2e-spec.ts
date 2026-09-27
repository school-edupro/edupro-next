/**
 * Sprint 10 engagement: family view, parent queries with scoped staff visibility, internal notes, replies,
 * closing with a leave decision, ratings, feedback with averages, profile change requests applied on approval,
 * and a route assignment showing on the family profile.
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

describe('engagement (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacherA: SeededUser;
  let teacherB: SeededUser;
  let accountant: SeededUser;
  let parent: SeededUser;
  let stranger: SeededUser;
  let sectionA: string;
  let sectionB: string;
  let studentId: string;
  let queryId: string;
  const h = () => headersFor(admin.sub, school.id);
  const ph = () => headersFor(parent.sub, school.id);

  beforeAll(async () => {
    const s = stamp('E10');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacherA = await seedUser(c, school, `${s}-ta`);
      teacherB = await seedUser(c, school, `${s}-tb`);
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      stranger = await seedUser(c, school, `${s}-stranger`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'E10A', 'Tara', 'Ten', $2), ($1, 'E10B', 'Uma', 'Ten', $3)`,
        [school.id, teacherA.id, teacherB.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VIII', name: 'Class VIII', displayOrder: 8 },
    });
    sectionA = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'A' },
      })
    ).json().id;
    sectionB = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'B' },
      })
    ).json().id;
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'E10-1',
        firstName: 'Ira',
        lastName: 'Ten',
        bloodGroup: 'O+',
        guardians: [
          {
            guardian: {
              firstName: 'Pia',
              lastName: 'Ten',
              mobile: '9876520001',
              email: 'pia@example.test',
            },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sectionA, rollNo: 1 },
      },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE school_id = $2 AND mobile = '9876520001'`, [
        parent.id,
        school.id,
      ]),
    );
    const emps = await inject({ method: 'GET', url: '/people/employees?size=10', headers: h() });
    const byCode = (code: string) =>
      emps.json().data.find((e: { employeeCode: string }) => e.employeeCode === code).id;
    for (const [code, section] of [
      ['E10A', sectionA],
      ['E10B', sectionB],
    ] as Array<[string, string]>) {
      const ta = await inject({
        method: 'POST',
        url: '/academics/teacher-assignments',
        headers: h(),
        json: { employeeId: byCode(code), classSectionId: section, kind: 'class_teacher' },
      });
      expect(ta.statusCode).toBe(201);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('shows the family profile with guardians, consents and no route yet', async () => {
    const fam = await inject({ method: 'GET', url: '/engagement/family', headers: ph() });
    expect(fam.statusCode).toBe(200);
    expect(fam.json().children).toHaveLength(1);
    expect(fam.json().children[0]).toMatchObject({
      name: 'Ira Ten',
      section: 'VIII-A',
      bloodGroup: 'O+',
      classTeacher: 'Tara Ten',
      route: null,
    });
    expect(fam.json().children[0].guardians[0]).toMatchObject({
      name: 'Pia Ten',
      isMe: true,
      relation: 'mother',
    });
    expect(fam.json().consents).toHaveLength(5);
    const staff = await inject({ method: 'GET', url: '/engagement/family', headers: h() });
    expect(staff.statusCode).toBe(403);
  });

  it('a parent raises a query; only the class teacher of that section and unscoped staff see it', async () => {
    const cats = await inject({ method: 'GET', url: '/engagement/mine/categories', headers: ph() });
    expect(cats.json().data.map((c: { code: string }) => c.code)).toContain('academics');
    const q = await inject({
      method: 'POST',
      url: '/engagement/mine/queries',
      headers: ph(),
      json: {
        studentId,
        categoryCode: 'academics',
        subject: 'Maths homework load',
        body: 'Ira gets three worksheets a day; is that expected?',
      },
    });
    expect(q.statusCode).toBe(201);
    expect(q.json()).toMatchObject({
      status: 'open',
      kind: 'query',
      assignedRole: 'class_teacher',
      studentName: 'Ira Ten',
      section: 'VIII-A',
    });
    expect(q.json().number).toMatch(/^Q\/.+\/0001$/);
    queryId = q.json().id;
    const other = await inject({
      method: 'POST',
      url: '/engagement/mine/queries',
      headers: headersFor(stranger.sub, school.id),
      json: { studentId, subject: 'Not my child', body: 'Trying to read another family' },
    });
    expect(other.statusCode).toBe(404);
    const peek = await inject({
      method: 'GET',
      url: `/engagement/mine/queries/${queryId}`,
      headers: headersFor(stranger.sub, school.id),
    });
    expect(peek.statusCode).toBe(404);
    const a = await inject({
      method: 'GET',
      url: '/engagement/queries',
      headers: headersFor(teacherA.sub, school.id),
    });
    expect(a.json().page.total).toBe(1);
    const b = await inject({
      method: 'GET',
      url: '/engagement/queries',
      headers: headersFor(teacherB.sub, school.id),
    });
    expect(b.json().page.total).toBe(0);
    const acc = await inject({
      method: 'GET',
      url: '/engagement/queries?categoryCode=academics',
      headers: headersFor(accountant.sub, school.id),
    });
    expect(acc.json().page.total).toBe(1);
    const teacherBGet = await inject({
      method: 'GET',
      url: `/engagement/queries/${queryId}`,
      headers: headersFor(teacherB.sub, school.id),
    });
    expect(teacherBGet.statusCode).toBe(200); // detail is not scoped by section for staff, only the list is
  });

  it('internal notes stay hidden, a reply answers, the parent reopens, closing and rating', async () => {
    const th = headersFor(teacherA.sub, school.id);
    const note = await inject({
      method: 'POST',
      url: `/engagement/queries/${queryId}/responses`,
      headers: th,
      json: { body: 'Checking with the maths teacher', isInternal: true },
    });
    expect(note.json().status).toBe('open');
    const parentSees = await inject({
      method: 'GET',
      url: `/engagement/mine/queries/${queryId}`,
      headers: ph(),
    });
    expect(parentSees.json().responses).toHaveLength(0);
    const reply = await inject({
      method: 'POST',
      url: `/engagement/queries/${queryId}/responses`,
      headers: th,
      json: { body: 'Two worksheets from next week; the third is optional practice.' },
    });
    expect(reply.json()).toMatchObject({ status: 'answered', assignedTo: 'Tara Ten' });
    expect(reply.json().firstResponseAt).not.toBeNull();
    const parentAgain = await inject({
      method: 'GET',
      url: `/engagement/mine/queries/${queryId}`,
      headers: ph(),
    });
    expect(parentAgain.json().responses).toHaveLength(1);
    const reopen = await inject({
      method: 'POST',
      url: `/engagement/mine/queries/${queryId}/responses`,
      headers: ph(),
      json: { body: 'Thank you, that helps.' },
    });
    expect(reopen.json().status).toBe('open');
    const early = await inject({
      method: 'POST',
      url: `/engagement/mine/queries/${queryId}/rate`,
      headers: ph(),
      json: { rating: 5 },
    });
    expect(early.statusCode).toBe(409);
    const closed = await inject({
      method: 'POST',
      url: `/engagement/queries/${queryId}/close`,
      headers: th,
      json: { note: 'Resolved' },
    });
    expect(closed.json().status).toBe('closed');
    const rated = await inject({
      method: 'POST',
      url: `/engagement/mine/queries/${queryId}/rate`,
      headers: ph(),
      json: { rating: 4, comment: 'Quick answer' },
    });
    expect(rated.json()).toMatchObject({ rating: 4, ratingComment: 'Quick answer' });
    const afterClose = await inject({
      method: 'POST',
      url: `/engagement/queries/${queryId}/responses`,
      headers: th,
      json: { body: 'late' },
    });
    expect(afterClose.statusCode).toBe(409);
  });

  it('leave requests need dates and close with a decision', async () => {
    const bad = await inject({
      method: 'POST',
      url: '/engagement/mine/queries',
      headers: ph(),
      json: { studentId, kind: 'leave', subject: 'Family function', body: 'Out of town' },
    });
    expect(bad.statusCode).toBe(400);
    const leave = await inject({
      method: 'POST',
      url: '/engagement/mine/queries',
      headers: ph(),
      json: {
        studentId,
        kind: 'leave',
        categoryCode: 'attendance',
        subject: 'Family function',
        body: 'Out of town',
        leaveFrom: '2026-10-05',
        leaveTo: '2026-10-06',
      },
    });
    expect(leave.statusCode).toBe(201);
    expect(leave.json().number).toMatch(/0002$/);
    const noDecision = await inject({
      method: 'POST',
      url: `/engagement/queries/${leave.json().id}/close`,
      headers: headersFor(teacherA.sub, school.id),
      json: {},
    });
    expect(noDecision.statusCode).toBe(400);
    const ok = await inject({
      method: 'POST',
      url: `/engagement/queries/${leave.json().id}/close`,
      headers: headersFor(teacherA.sub, school.id),
      json: { decision: 'approved', note: 'Approved; please collect the worksheets' },
    });
    expect(ok.json()).toMatchObject({ status: 'closed', decision: 'approved' });
    const mine = await inject({
      method: 'GET',
      url: '/engagement/mine/queries?kind=leave',
      headers: ph(),
    });
    expect(mine.json().page.total).toBe(1);
  });

  it('feedback is summarised per category', async () => {
    for (const [category, rating] of [
      ['teaching', 5],
      ['teaching', 4],
      ['transport', 2],
    ] as Array<[string, number]>) {
      const r = await inject({
        method: 'POST',
        url: '/engagement/feedback',
        headers: ph(),
        json: { studentId, category, rating, comment: `${category} ${rating}` },
      });
      expect(r.statusCode).toBe(201);
    }
    const list = await inject({ method: 'GET', url: '/engagement/feedback', headers: h() });
    expect(list.json().page.total).toBe(3);
    expect(list.json().summary).toEqual([
      { category: 'teaching', count: 2, average: 4.5 },
      { category: 'transport', count: 1, average: 2 },
    ]);
    const denied = await inject({ method: 'GET', url: '/engagement/feedback', headers: ph() });
    expect(denied.statusCode).toBe(403);
  });

  it('profile change requests: allow-listed fields only, applied on approval with an audit trail', async () => {
    const bad = await inject({
      method: 'POST',
      url: '/engagement/change-requests',
      headers: ph(),
      json: { studentId, entity: 'student', changes: { admission_no: 'X' } },
    });
    expect(bad.statusCode).toBe(422);
    const g = await inject({
      method: 'POST',
      url: '/engagement/change-requests',
      headers: ph(),
      json: {
        studentId,
        entity: 'guardian',
        changes: { mobile: '9876520099', 'address.city': 'Pune' },
        reason: 'New number',
      },
    });
    expect(g.statusCode).toBe(201);
    expect(g.json()).toMatchObject({
      status: 'pending',
      entity: 'guardian',
      entityName: 'Pia Ten',
      changes: { mobile: { from: '9876520001', to: '9876520099' } },
    });
    const s = await inject({
      method: 'POST',
      url: '/engagement/change-requests',
      headers: ph(),
      json: { studentId, entity: 'student', changes: { blood_group: 'A+' } },
    });
    expect(s.statusCode).toBe(201);
    const mine = await inject({
      method: 'GET',
      url: '/engagement/change-requests/mine',
      headers: ph(),
    });
    expect(mine.json().page.total).toBe(2);
    const pending = await inject({
      method: 'GET',
      url: '/engagement/change-requests?status=pending',
      headers: h(),
    });
    expect(pending.json().page.total).toBe(2);
    const approved = await inject({
      method: 'POST',
      url: `/engagement/change-requests/${g.json().id}/decide`,
      headers: h(),
      json: { approve: true },
    });
    expect(approved.json().status).toBe('approved');
    const rejected = await inject({
      method: 'POST',
      url: `/engagement/change-requests/${s.json().id}/decide`,
      headers: h(),
      json: { approve: false, note: 'Bring the report' },
    });
    expect(rejected.json()).toMatchObject({ status: 'rejected', decisionNote: 'Bring the report' });
    const student = await inject({
      method: 'GET',
      url: `/people/students/${studentId}`,
      headers: h(),
    });
    expect(student.json().guardians[0]).toMatchObject({ mobile: '9876520099' });
    expect(student.json().bloodGroup).toBe('O+');
    const twice = await inject({
      method: 'POST',
      url: `/engagement/change-requests/${g.json().id}/decide`,
      headers: h(),
      json: { approve: true },
    });
    expect(twice.statusCode).toBe(409);
  });

  it('a transport route with the child on it shows on the family profile', async () => {
    const route = await inject({
      method: 'POST',
      url: '/transport/routes',
      headers: h(),
      json: {
        code: 'r1',
        name: 'Kothrud – Karve Nagar',
        vehicleNo: 'MH12AB1234',
        driverName: 'Ramesh',
        driverMobile: '9876500010',
      },
    });
    expect(route.statusCode).toBe(201);
    expect(route.json()).toMatchObject({ code: 'R1', students: 0 });
    const dup = await inject({
      method: 'POST',
      url: '/transport/routes',
      headers: h(),
      json: { code: 'R1', name: 'again' },
    });
    expect(dup.statusCode).toBe(409);
    const assigned = await inject({
      method: 'PUT',
      url: `/transport/routes/${route.json().id}/students`,
      headers: h(),
      json: {
        assignments: [
          { studentId, stopName: 'Karve Nagar chowk', pickupTime: '07:20', dropTime: '14:10' },
        ],
      },
    });
    expect(assigned.statusCode).toBe(200);
    expect(assigned.json().data[0]).toMatchObject({
      name: 'Ira Ten',
      stopName: 'Karve Nagar chowk',
      pickupTime: '07:20',
    });
    const fam = await inject({ method: 'GET', url: '/engagement/family', headers: ph() });
    expect(fam.json().children[0].route).toMatchObject({
      code: 'R1',
      stopName: 'Karve Nagar chowk',
    });
    const routes = await inject({ method: 'GET', url: '/transport/routes', headers: h() });
    expect(routes.json().data[0].students).toBe(1);
  });
});
