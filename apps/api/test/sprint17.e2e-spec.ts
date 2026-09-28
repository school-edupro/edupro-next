/**
 * Sprint 17: workflow v1 GA (SLA due dates, delegation, cancel, reassign, comments, history),
 * report cards (templates, releases, previews, batch render, the family's withheld rule), GPS
 * positions through a service key with the family's bus view, and the library (accession,
 * circulation, fines).
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

describe('workflow GA, report cards, GPS and library (e2e, Sprint 17)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  let delegate: SeededUser;
  let parent: SeededUser;
  let otherAdmin: SeededUser;
  let s: string;
  let classId: string;
  let sectionId: string;
  let studentId: string;
  let examId: string;
  const h = (u: SeededUser = admin, sc: SeededSchool = school) => headersFor(u.sub, sc.id);

  beforeAll(async () => {
    s = stamp('S17');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      delegate = await seedUser(c, school, `${s}-deleg`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      otherAdmin = await seedUser(c, other, `${s}-other`, 'school_admin');
      await c.query(`UPDATE users SET mobile = '9876517001' WHERE id = $1`, [coordinator.id]);
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    classId = cls.json().id;
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${classId}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
    const sub = await inject({
      method: 'POST',
      url: '/academics/subjects',
      headers: h(),
      json: { code: 'MAT', name: 'Mathematics' },
    });
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: `${s}-001`,
        firstName: 'Riya',
        lastName: 'Seventeen',
        guardians: [
          {
            guardian: { firstName: 'Ravi', lastName: 'Seventeen', mobile: '9876517002' },
            relation: 'father',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sectionId, rollNo: 1 },
      },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876517002' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    const type = await inject({
      method: 'POST',
      url: '/exams/types',
      headers: h(),
      json: { code: 'PT1', name: 'Periodic Test 1' },
    });
    const scale = await inject({
      method: 'PUT',
      url: '/exams/grade-scales',
      headers: h(),
      json: {
        code: 'CBSE8',
        name: 'CBSE eight point',
        bands: [
          { minPct: 91, maxPct: 100, grade: 'A1' },
          { minPct: 71, maxPct: 90.99, grade: 'B1' },
          { minPct: 0, maxPct: 70.99, grade: 'C' },
        ],
      },
    });
    const exam = await inject({
      method: 'POST',
      url: '/exams',
      headers: h(),
      json: {
        examTypeId: type.json().id,
        code: 'PT1-T',
        name: 'PT1',
        classes: [{ classId, gradeScaleId: scale.json().id }],
      },
    });
    examId = exam.json().id;
    await inject({
      method: 'PUT',
      url: `/exams/${examId}/subjects`,
      headers: h(),
      json: { classId, subjects: [{ subjectId: sub.json().id, maxMarks: 40, passMarks: 13 }] },
    });
    // marks are a teacher's job (exams.marks.enter); the fixture writes the entry directly
    await withMigrator((c) =>
      c.query(
        `INSERT INTO mark_entries (school_id, exam_subject_id, student_id, marks)
         SELECT $1, es.id, $2, 34 FROM exam_subjects es WHERE es.exam_id = $3 AND es.class_id = $4`,
        [school.id, studentId, examId, classId],
      ),
    );
    await inject({ method: 'POST', url: `/exams/${examId}/results/compute`, headers: h() });
  });
  afterAll(async () => {
    await app.close();
  });

  // ---- workflow ----
  it('a level with slaHours gets a due date; a delegate of the assignee may act; history records it all', async () => {
    const def = await inject({
      method: 'POST',
      url: '/workflow/definitions',
      headers: h(),
      json: {
        code: `s17_${s.toLowerCase()}`,
        entityType: 'lesson_plan',
        name: 'S17 approval',
        levels: [
          {
            level: 1,
            name: 'Coordinator',
            resolver: { kind: 'role', roleCode: 'academic_coordinator' },
            slaHours: 4,
            escalateTo: { kind: 'role', roleCode: 'school_admin' },
          },
        ],
      },
    });
    expect(def.statusCode).toBe(201);
    // start through the engine directly (the lesson-plan module would do this inside its transaction)
    const instanceId = await withMigrator(async (c) => {
      await c.query(
        `SELECT set_config('app.school_id', $1, false), set_config('app.user_id', $2, false)`,
        [school.id, admin.id],
      );
      const i = await c.query<{ id: string }>(
        `INSERT INTO workflow_instances (school_id, definition_id, entity_type, entity_id, subject, requested_by) VALUES ($1, $2, 'lesson_plan', 1, 'S17 plan', $3) RETURNING id::text`,
        [school.id, def.json().id, admin.id],
      );
      await c.query(
        `INSERT INTO workflow_steps (school_id, instance_id, level, name, resolver, assignee_user_ids, due_at) VALUES ($1, $2, 1, 'Coordinator', '{"kind":"role","roleCode":"academic_coordinator"}', ARRAY[$3::bigint], now() + interval '4 hours')`,
        [school.id, i.rows[0]!.id, coordinator.id],
      );
      return i.rows[0]!.id;
    });
    const inbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h(coordinator) });
    const item = inbox
      .json()
      .data.find((x: { instance: { id: string } }) => x.instance.id === instanceId);
    expect(item).toBeDefined();
    expect(item.dueAt).not.toBeNull();
    expect(item.overdue).toBe(false);
    // the delegate sees nothing yet
    const before = await inject({ method: 'GET', url: '/workflow/inbox', headers: h(delegate) });
    expect(
      before.json().data.some((x: { instance: { id: string } }) => x.instance.id === instanceId),
    ).toBe(false);
    // coordinator delegates the role to the class teacher
    const roleId = await withMigrator(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT id::text FROM roles WHERE code = 'academic_coordinator' AND school_id IS NULL`,
          )
        ).rows[0]!.id,
    );
    const d = await inject({
      method: 'POST',
      url: '/access/delegations',
      headers: h(coordinator),
      json: {
        toUserId: delegate.id,
        roleId,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
        reason: 'On leave this week',
      },
    });
    expect([200, 201]).toContain(d.statusCode);
    const after = await inject({ method: 'GET', url: '/workflow/inbox', headers: h(delegate) });
    expect(
      after.json().data.some((x: { instance: { id: string } }) => x.instance.id === instanceId),
    ).toBe(true);
    const comment = await inject({
      method: 'POST',
      url: `/workflow/instances/${instanceId}/comments`,
      headers: h(),
      json: { note: 'Please expedite' },
    });
    expect(comment.statusCode).toBe(201);
    const act = await inject({
      method: 'POST',
      url: `/workflow/steps/${item.id}/approve`,
      headers: h(delegate),
      json: { note: 'ok as delegate' },
    });
    expect(act.statusCode).toBe(201);
    expect(act.json().status).toBe('approved');
    const hist = await inject({
      method: 'GET',
      url: `/workflow/instances/${instanceId}/history`,
      headers: h(),
    });
    const kinds = hist.json().data.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['comment', 'approved', 'delegated']));
  });

  it('cancel by the requester, reassign by a manager, and the SLA job reminds then escalates', async () => {
    const def = await withMigrator(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `SELECT id::text FROM workflow_definitions WHERE school_id = $1 AND code = $2`,
            [school.id, `s17_${s.toLowerCase()}`],
          )
        ).rows[0]!.id,
    );
    const mk = async () =>
      withMigrator(async (c) => {
        const i = await c.query<{ id: string }>(
          `INSERT INTO workflow_instances (school_id, definition_id, entity_type, entity_id, subject, requested_by) VALUES ($1, $2, 'lesson_plan', floor(random()*1e9)::bigint, 'S17 plan 2', $3) RETURNING id::text`,
          [school.id, def, coordinator.id],
        );
        const st = await c.query<{ id: string }>(
          `INSERT INTO workflow_steps (school_id, instance_id, level, name, resolver, assignee_user_ids, due_at) VALUES ($1, $2, 1, 'Coordinator', '{"kind":"role","roleCode":"academic_coordinator"}', ARRAY[$3::bigint], now() - interval '30 hours') RETURNING id::text`,
          [school.id, i.rows[0]!.id, coordinator.id],
        );
        return { instanceId: i.rows[0]!.id, stepId: st.rows[0]!.id };
      });
    const a = await mk();
    const notMine = await inject({
      method: 'POST',
      url: `/workflow/instances/${a.instanceId}/cancel`,
      headers: h(delegate),
      json: { reason: 'not mine' },
    });
    expect(notMine.statusCode).toBe(403);
    const cancel = await inject({
      method: 'POST',
      url: `/workflow/instances/${a.instanceId}/cancel`,
      headers: h(coordinator),
      json: { reason: 'Submitted twice' },
    });
    expect(cancel.statusCode).toBe(201);
    expect(cancel.json().status).toBe('cancelled');
    const b = await mk();
    const re = await inject({
      method: 'POST',
      url: `/workflow/steps/${b.stepId}/reassign`,
      headers: h(),
      json: { userIds: [delegate.id], note: 'coordinator away' },
    });
    expect(re.statusCode).toBe(201);
    expect(re.json().steps[0].assignees.map((x: { id: string }) => x.id)).toEqual([delegate.id]);
    // the worker's job: overdue by 30 h → reminder + escalation (grace 24 h) to school_admin
    const { runWorkflowSla } = await import('../../workers/src/processors/maintenance');
    const out = await withMigrator(async (c) => {
      await c.query(
        `SELECT set_config('app.school_id', $1, false), set_config('app.user_id', '', false)`,
        [school.id],
      );
      return runWorkflowSla(c as never, school.id);
    });
    expect(out.reminded).toBeGreaterThanOrEqual(1);
    expect(out.escalated).toBeGreaterThanOrEqual(1);
    const hist = await inject({
      method: 'GET',
      url: `/workflow/instances/${b.instanceId}/history`,
      headers: h(),
    });
    const kinds = hist.json().data.map((e: { kind: string }) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['reassigned', 'reminded', 'escalated']));
    const inst = await inject({
      method: 'GET',
      url: `/workflow/instances/${b.instanceId}`,
      headers: h(),
    });
    expect(inst.json().steps[0].assignees.map((x: { id: string }) => x.id)).toEqual(
      expect.arrayContaining([delegate.id, admin.id]),
    );
  });

  // ---- report cards ----
  it('default templates per band; a release; preview with real data; batch render; the family reads and is withheld by the fee rule', async () => {
    const defaults = await inject({
      method: 'POST',
      url: '/exams/report-cards/templates/defaults',
      headers: h(),
    });
    expect(
      defaults
        .json()
        .data.map((t: { band: string }) => t.band)
        .sort(),
    ).toEqual(['middle', 'primary', 'secondary', 'senior']);
    const middle = defaults.json().data.find((t: { band: string }) => t.band === 'middle');
    const rel = await inject({
      method: 'POST',
      url: '/exams/report-cards/releases',
      headers: h(),
      json: {
        termCode: 'T1',
        name: 'Term 1',
        examIds: [examId],
        hideDefaulters: true,
        defaulterMin: 0,
      },
    });
    expect(rel.statusCode).toBe(201);
    const releaseId = rel.json().id;
    const sample = await inject({
      method: 'POST',
      url: `/exams/report-cards/templates/${middle.id}/preview`,
      headers: h(),
      json: { band: 'middle' },
    });
    expect(sample.json().html).toContain('Scholastic areas');
    const real = await inject({
      method: 'POST',
      url: `/exams/report-cards/templates/${middle.id}/preview`,
      headers: h(),
      json: { releaseId, studentId },
    });
    expect(real.statusCode).toBe(201);
    expect(real.json().html).toContain('Riya Seventeen');
    expect(real.json().html).toContain('Mathematics');
    const batch = await inject({
      method: 'POST',
      url: `/exams/report-cards/releases/${releaseId}/render`,
      headers: h(),
      json: { classSectionId: sectionId },
    });
    expect(batch.statusCode).toBe(201);
    expect(batch.json().status).toBe('queued');
    // not released yet: the family sees no term
    const none = await inject({ method: 'GET', url: '/exams/mine/results', headers: h(parent) });
    expect(none.json().children[0].terms).toHaveLength(0);
    await inject({
      method: 'PATCH',
      url: `/exams/report-cards/releases/${releaseId}`,
      headers: h(),
      json: { status: 'released' },
    });
    const mine = await inject({ method: 'GET', url: '/exams/mine/results', headers: h(parent) });
    expect(mine.json().children[0].terms[0]).toMatchObject({ releaseId, termCode: 'T1' });
    const pdf = await inject({
      method: 'POST',
      url: `/exams/mine/report-cards/${releaseId}/${studentId}/pdf`,
      headers: h(parent),
    });
    expect(pdf.statusCode).toBe(201);
    // a pending due makes the pupil a defaulter → withheld for the family
    await withMigrator((c) =>
      c.query(
        `INSERT INTO mart.fee_dues (school_id, academic_year_id, student_id, admission_no, student_name, due_on, net, paid, balance, days_overdue, bucket)
         VALUES ($1, $2, $3, 'x', 'x', CURRENT_DATE - 10, 5000, 0, 5000, 10, '1-30')`,
        [school.id, school.yearId, studentId],
      ),
    );
    const withheld = await inject({
      method: 'POST',
      url: `/exams/mine/report-cards/${releaseId}/${studentId}/pdf`,
      headers: h(parent),
    });
    expect(withheld.statusCode).toBe(409);
    expect(withheld.json().type).toBe('report_card.withheld');
    const foreign = await inject({
      method: 'GET',
      url: `/exams/report-cards/releases/${releaseId}`,
      headers: h(otherAdmin, other),
    });
    expect(foreign.statusCode).toBe(404);
  });

  // ---- GPS ----
  it('the vendor pushes positions with a service key; the office sees the fleet; the family sees its bus', async () => {
    const key = await inject({
      method: 'POST',
      url: '/platform/service-keys',
      headers: headersFor(`${admin.sub};mfa=true`, school.id),
      json: { name: 'gps', scopes: ['transport.gps'] },
    });
    expect(key.statusCode).toBe(201);
    const veh = await inject({
      method: 'POST',
      url: '/transport/vehicles',
      headers: h(),
      json: { regNo: `S17${s.slice(-6)}`, capacity: 40, gpsDeviceId: `IMEI-${s}` },
    });
    expect(veh.statusCode).toBe(201);
    const route = await inject({
      method: 'POST',
      url: '/transport/routes',
      headers: h(),
      json: { code: `R${s.slice(-3)}`, name: 'Route S17' },
    });
    await inject({
      method: 'PATCH',
      url: `/transport/routes/${route.json().id}`,
      headers: h(),
      json: { vehicleId: veh.json().id },
    });
    await inject({
      method: 'PUT',
      url: `/transport/routes/${route.json().id}/students`,
      headers: h(),
      json: { assignments: [{ studentId, stopName: 'Gate 2', pickupTime: '07:10' }] },
    });
    const wrongScope = await inject({
      method: 'POST',
      url: '/transport/gps/positions',
      headers: { 'x-service-key': 'svc_nope' },
      json: [],
    });
    expect(wrongScope.statusCode).toBe(401);
    const push = await inject({
      method: 'POST',
      url: '/transport/gps/positions',
      headers: { 'x-service-key': key.json().key },
      json: {
        data: [
          {
            imei: `IMEI-${s}`,
            lat: 28.57,
            lon: 77.32,
            speed: 30,
            angle: 90,
            ts: Math.floor(Date.now() / 1000),
            acc: 1,
          },
          { imei: 'nope', lat: 1, lon: 2 },
        ],
      },
    });
    expect(push.json()).toEqual({ accepted: 1, unknownDevices: ['nope'] });
    const fleet = await inject({ method: 'GET', url: '/transport/gps/fleet', headers: h() });
    expect(fleet.json().data.some((p: { regNo: string }) => p.regNo === `S17${s.slice(-6)}`)).toBe(
      true,
    );
    const mine = await inject({ method: 'GET', url: '/transport/gps/mine', headers: h(parent) });
    expect(mine.json().children[0].vehicle.regNo).toBe(`S17${s.slice(-6)}`);
    expect(mine.json().children[0].position.lat).toBe('28.570000');
    const foreign = await inject({
      method: 'GET',
      url: '/transport/gps/fleet',
      headers: h(otherAdmin, other),
    });
    expect(foreign.json().data).toEqual([]);
  });

  // ---- library ----
  it('accession, issue with limits, renew, return with a fine, waive; the family sees its loans', async () => {
    const title = await inject({
      method: 'POST',
      url: '/masters/library_titles/rows',
      headers: h(),
      json: {
        values: { code: 'ISBN1', title: 'Matilda', author: 'Roald Dahl', category: 'Fiction' },
      },
    });
    expect(title.statusCode).toBe(201);
    const acc = await inject({
      method: 'POST',
      url: '/library/copies',
      headers: h(),
      json: { titleId: title.json().id, accessionNos: [`${s}-1`, `${s}-2`, `${s}-3`] },
    });
    expect(acc.json().created).toBe(3);
    const cat = await inject({ method: 'GET', url: '/library/catalogue?q=Matilda', headers: h() });
    expect(cat.json().data[0]).toMatchObject({ copies: 3, available: 3 });
    const i1 = await inject({
      method: 'POST',
      url: '/library/loans/issue',
      headers: h(),
      json: { accessionNo: `${s}-1`, borrowerKind: 'student', borrowerId: studentId },
    });
    expect(i1.statusCode).toBe(201);
    const again = await inject({
      method: 'POST',
      url: '/library/loans/issue',
      headers: h(),
      json: { accessionNo: `${s}-1`, borrowerKind: 'student', borrowerId: studentId },
    });
    expect(again.json().type).toBe('library.copy_unavailable');
    await inject({
      method: 'POST',
      url: '/library/loans/issue',
      headers: h(),
      json: { accessionNo: `${s}-2`, borrowerKind: 'student', borrowerId: studentId },
    });
    const limit = await inject({
      method: 'POST',
      url: '/library/loans/issue',
      headers: h(),
      json: { accessionNo: `${s}-3`, borrowerKind: 'student', borrowerId: studentId },
    });
    expect(limit.json().type).toBe('library.limit');
    const renew = await inject({
      method: 'POST',
      url: '/library/loans/renew',
      headers: h(),
      json: { accessionNo: `${s}-2` },
    });
    expect(renew.json().renewed).toBe(1);
    const late = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const ret = await inject({
      method: 'POST',
      url: '/library/loans/return',
      headers: h(),
      json: { accessionNo: `${s}-1`, returnedOn: late },
    });
    expect(Number(ret.json().fineAmount)).toBeGreaterThan(0);
    const blocked = await inject({
      method: 'POST',
      url: '/library/loans/issue',
      headers: h(),
      json: { accessionNo: `${s}-3`, borrowerKind: 'student', borrowerId: studentId },
    });
    expect(blocked.json().type).toBe('library.fine_pending');
    const waive = await inject({
      method: 'POST',
      url: `/library/loans/${ret.json().id}/fine`,
      headers: h(),
      json: { action: 'waive', note: 'first offence' },
    });
    expect(Number(waive.json().fineWaived)).toBe(Number(ret.json().fineAmount));
    const mine = await inject({ method: 'GET', url: '/library/mine', headers: h(parent) });
    expect(mine.json().children[0].loans.length).toBeGreaterThanOrEqual(2);
    const fines = await inject({ method: 'GET', url: '/library/loans?status=fines', headers: h() });
    expect(fines.statusCode).toBe(200);
  });
});
