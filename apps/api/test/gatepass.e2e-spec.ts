/**
 * Gate pass v2 (0069): a pupil's pass from the parent through the approval levels, the hand-over at the
 * front desk (live photo, one-time code for an outsider) and the gate; a staff RGP with items out and
 * back; the admin's set-up (levels one after another, or any N).
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

// a tiny valid JPEG-typed payload (the service checks the type and the size, not the picture)
const PHOTO = `data:image/jpeg;base64,${Buffer.alloc(1200, 7).toString('base64')}`;

describe('gate pass v2 (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let coordinator: SeededUser;
  let principal: SeededUser;
  let parent: SeededUser;
  let desk: SeededUser;
  let guard: SeededUser;
  let s: string;
  let studentId: string;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const get = async (url: string, u: SeededUser = admin) =>
    (await inject({ method: 'GET', url, headers: h(u) })).json();
  const post = (url: string, u: SeededUser, json: unknown = {}) =>
    inject({ method: 'POST', url, headers: h(u), json });

  beforeAll(async () => {
    s = stamp('GP');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      principal = await seedUser(c, school, `${s}-principal`, 'teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      desk = await seedUser(c, school, `${s}-desk`, 'front_desk');
      guard = await seedUser(c, school, `${s}-guard`, 'gate_security');
      for (const [code, first, user, designation] of [
        ['TG', 'Tara', teacher.id, 'Teacher'],
        ['CG', 'Chitra', coordinator.id, 'Coordinator'],
        ['PG', 'Pooja', principal.id, 'Principal'],
      ] as const)
        await c.query(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id, designation, email)
           VALUES ($1, $2, $3, 'Gate', $4, $5, $6)`,
          [school.id, code, first, user, designation, `${code.toLowerCase()}-${s}@example.test`],
        );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post('/academics/classes', admin, {
      code: 'VI',
      name: 'Class VI',
      displayOrder: 6,
    });
    const sec = await post(`/academics/classes/${cls.json().id}/sections`, admin, { name: 'A' });
    const st = await post('/people/students', admin, {
      admissionNo: `${s}-1`,
      firstName: 'Aanya',
      lastName: 'Gate',
      guardians: [
        {
          guardian: { firstName: 'Rohit', lastName: 'Gate', mobile: '9876519771' },
          relation: 'father',
          isPrimary: true,
        },
      ],
      enrolment: { classSectionId: sec.json().id, rollNo: 1 },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876519771' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    const emp = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = 'TG'`,
        [school.id],
      ),
    );
    const ta = await post('/academics/teacher-assignments', admin, {
      employeeId: emp.rows[0]!.id,
      classSectionId: sec.json().id,
      kind: 'class_teacher',
    });
    expect(ta.statusCode).toBe(201);
  });
  afterAll(async () => {
    await app.close();
  });

  it('the set-up starts with four levels for pupils, one after another; only the admin changes it', async () => {
    const setup = await get('/gate-passes/setup');
    expect(setup.settings).toMatchObject({ studentMode: 'sequence', handoverOtp: true });
    expect(
      (setup.levels as Array<{ audience: string; label: string }>)
        .filter((l) => l.audience === 'student')
        .map((l) => l.label),
    ).toEqual(['Class teacher', 'Coordinator', 'Vice Principal', 'Principal']);
    expect(
      (await inject({ method: 'GET', url: '/gate-passes/setup', headers: h(desk) })).statusCode,
    ).toBe(403);
    expect(
      (await inject({ method: 'GET', url: '/gate-passes', headers: h(teacher) })).statusCode,
    ).toBe(403);
  });

  let passId: string;
  it('a parent asks for a pass with someone else collecting; each level approves in turn', async () => {
    const options = await get('/gate-passes/mine/options', parent);
    expect(options.data[0]).toMatchObject({
      id: studentId,
      guardians: [{ relation: 'father', name: 'Rohit Gate' }],
    });
    // no mother on record
    const bad = await post('/gate-passes/mine', parent, {
      studentId,
      kind: 'early_leave',
      reason: 'Dentist',
      escortKind: 'mother',
    });
    expect(bad.statusCode).toBe(400);
    const req = await post('/gate-passes/mine', parent, {
      studentId,
      kind: 'early_leave',
      atTime: '11:30',
      reason: 'Dentist',
      escortKind: 'other',
      escortName: 'Kamla Devi',
      escortRelation: 'aunt',
      escortMobile: '9876519772',
    });
    expect(req.statusCode).toBe(201);
    passId = req.json().id;
    expect(req.json()).toMatchObject({ state: 'pending', passNo: null, otpNeeded: true });
    // class teacher may act, the coordinator waits, nobody is Vice Principal, the principal waits
    expect(
      (req.json().approvals as Array<{ label: string; status: string }>).map((a) => a.status),
    ).toEqual(['pending', 'waiting', 'skipped', 'waiting']);
    // not the coordinator's turn yet
    expect((await get('/gate-passes/inbox', coordinator)).data).toHaveLength(0);
    expect(
      (await post(`/gate-passes/${passId}/decide`, coordinator, { outcome: 'approved' }))
        .statusCode,
    ).toBe(403);
    expect((await get('/gate-passes/inbox', teacher)).data).toHaveLength(1);
    // a rejection needs its reason
    expect(
      (await post(`/gate-passes/${passId}/decide`, teacher, { outcome: 'rejected' })).statusCode,
    ).toBe(400);
    for (const u of [teacher, coordinator]) {
      const r = await post(`/gate-passes/${passId}/decide`, u, { outcome: 'approved' });
      expect(r.statusCode).toBe(200);
      expect(r.json().state).toBe('pending');
    }
    // the front desk sees where the approval stands
    const queue = await get('/gate-passes?stage=approval', desk);
    expect(queue.data[0]).toMatchObject({
      id: passId,
      approvedLevels: 2,
      levels: 3,
      waitingOn: 'Principal',
      admissionNo: `${s}-1`,
    });
    const last = await post(`/gate-passes/${passId}/decide`, principal, { outcome: 'approved' });
    expect(last.json()).toMatchObject({ state: 'approved', canDecide: false });
    expect(last.json().passNo).toMatch(/^GP\/\d{4}\/\d{5}$/);
    expect(last.json().qr).toContain('<svg');
    // the approvers were told by mail as their turn came
    const mails = await withMigrator((c) =>
      c.query<{ subject: string }>(
        `SELECT subject FROM comms_messages WHERE school_id = $1 AND variables ->> 'gatePass' = $2 ORDER BY id`,
        [school.id, passId],
      ),
    );
    expect(mails.rows.filter((m) => m.subject.startsWith('Gate pass to approve'))).toHaveLength(3);
  });

  it('the gate cannot let the child out before the front desk hands over with photo and the parent’s code', async () => {
    expect((await post(`/gate-passes/${passId}/out`, guard)).json()).toMatchObject({
      type: expect.stringContaining('gate_pass.not_handed_over'),
    });
    // the guard may not hand over; the front desk may not open the gate
    expect(
      (await post(`/gate-passes/${passId}/handover`, guard, { photo: PHOTO })).statusCode,
    ).toBe(403);
    // without the code
    const noCode = await post(`/gate-passes/${passId}/handover`, desk, { photo: PHOTO });
    expect(noCode.statusCode).toBe(409);
    const otp = await post(`/gate-passes/${passId}/otp`, desk);
    expect(otp.json()).toMatchObject({ mobileEnd: '9771', minutes: 10 });
    const code = String(otp.json().devCode);
    expect(code).toMatch(/^\d{6}$/);
    const wrong = await post(`/gate-passes/${passId}/handover`, desk, {
      photo: PHOTO,
      otp: code === '000000' ? '000001' : '000000',
    });
    expect(wrong.json()).toMatchObject({ ok: false });
    const done = await post(`/gate-passes/${passId}/handover`, desk, { photo: PHOTO, otp: code });
    expect(done.json()).toMatchObject({
      ok: true,
      pass: { state: 'handed_over', otpVerified: true, photos: { collector: true } },
    });
    // the gate sees it with the photo taken at the desk, and lets the child out
    const board = await get('/gate-passes/gate/board', guard);
    expect(board.ready.map((p: { id: string }) => p.id)).toContain(passId);
    const photo = await inject({
      method: 'GET',
      url: `/gate-passes/${passId}/photo/collector`,
      headers: h(guard),
    });
    expect(photo.headers['content-type']).toBe('image/jpeg');
    const found = await post('/gate-passes/gate/find', guard, { code: done.json().pass.passCode });
    expect(found.json().id).toBe(passId);
    const out = await post(`/gate-passes/${passId}/out`, guard, { gate: 'Main gate' });
    expect(out.json()).toMatchObject({ state: 'out', outGate: 'Main gate' });
    // the family sees it, with the card to download, and nothing of who could have approved
    const mine = await get(`/gate-passes/mine/${passId}`, parent);
    expect(mine).toMatchObject({ state: 'out', stage: 'Left the campus' });
    expect(mine.approvals.every((a: { approvers: unknown }) => a.approvers === null)).toBe(true);
    const card = await inject({
      method: 'GET',
      url: `/gate-passes/mine/${passId}/card.pdf`,
      headers: h(parent),
    });
    expect(card.headers['content-type']).toBe('application/pdf');
    expect((await get('/gate-passes/mine?state=past', parent)).data).toHaveLength(1);
  });

  it('any-N mode: the front desk makes a pass and one approval of the chosen people is enough', async () => {
    const setup = await get('/gate-passes/setup');
    const save = await inject({
      method: 'PUT',
      url: '/gate-passes/setup',
      headers: h(),
      json: { ...setup.settings, studentMode: 'any', studentNeed: 1, levels: setup.levels },
    });
    expect(save.statusCode).toBe(200);
    const made = await post('/gate-passes', desk, {
      studentId,
      kind: 'early_leave',
      reason: 'Fever',
      escortKind: 'father',
    });
    expect(made.statusCode).toBe(201);
    expect(made.json()).toMatchObject({
      state: 'pending',
      source: 'front_desk',
      escortName: 'Rohit Gate',
      approvalMode: 'any',
      approvalNeed: 1,
      otpNeeded: false,
    });
    // all three holders may act at once; the coordinator alone is enough
    expect((await get('/gate-passes/inbox', principal)).data).toHaveLength(1);
    const ok = await post(`/gate-passes/${made.json().id}/decide`, coordinator, {
      outcome: 'approved',
    });
    expect(ok.json().state).toBe('approved');
    expect((await get('/gate-passes/inbox', principal)).data).toHaveLength(0);
    // the father is on record: photo only, no code
    const done = await post(`/gate-passes/${made.json().id}/handover`, desk, { photo: PHOTO });
    expect(done.json()).toMatchObject({ ok: true, pass: { state: 'handed_over' } });
    // a rejected one ends there, with the reason
    const second = await post('/gate-passes/mine', parent, {
      studentId,
      kind: 'late_arrival',
      reason: 'Traffic',
    });
    const no = await post(`/gate-passes/${second.json().id}/decide`, teacher, {
      outcome: 'rejected',
      note: 'Exam today',
    });
    expect(no.json()).toMatchObject({ state: 'rejected', decisionNote: 'Exam today' });
  });

  it('a member of staff takes an RGP with items; the gate marks out and what came back', async () => {
    // RGP needs the return time
    expect(
      (
        await post('/gate-passes/staff', teacher, {
          category: 'rgp',
          atTime: '10:00',
          reason: 'Bank work',
        })
      ).statusCode,
    ).toBe(400);
    const req = await post('/gate-passes/staff', teacher, {
      category: 'rgp',
      atTime: '10:00',
      returnTime: '12:30',
      reason: 'Bank work',
      destination: 'SBI main branch',
      items: [
        { name: 'Laptop', qty: 1, serialNo: 'LT-0042', returnable: true },
        { name: 'Cheque books', qty: 2, returnable: false },
      ],
    });
    expect(req.statusCode).toBe(201);
    const id = req.json().id;
    expect(req.json()).toMatchObject({ audience: 'staff', kind: 'rgp', items: 2, itemsDue: 1 });
    // staff levels: coordinator, (no vice principal), principal
    expect(
      (req.json().approvals as Array<{ label: string; status: string }>).map(
        (a) => `${a.label}:${a.status}`,
      ),
    ).toEqual(['Coordinator:pending', 'Vice Principal:skipped', 'Principal:waiting']);
    await post(`/gate-passes/${id}/decide`, coordinator, { outcome: 'approved' });
    const ok = await post(`/gate-passes/${id}/decide`, principal, { outcome: 'approved' });
    expect(ok.json().passNo).toMatch(/^RGP\/\d{4}\/\d{5}$/);
    expect((await get('/gate-passes/staff?state=open', teacher)).data).toHaveLength(1);
    // another employee cannot read it
    expect(
      (await inject({ method: 'GET', url: `/gate-passes/${id}`, headers: h(parent) })).statusCode,
    ).toBe(404);
    const out = await post(`/gate-passes/${id}/out`, guard, { gate: 'Main gate' });
    expect(out.json()).toMatchObject({ state: 'out', stage: 'Out: to come back' });
    const dash = await get('/gate-passes/dashboard', desk);
    expect(dash.counts.out).toBe(1);
    expect(dash.itemsDue).toBe(1);
    const laptop = (out.json().itemList as Array<{ id: string; name: string }>).find(
      (i) => i.name === 'Laptop',
    )!;
    const back = await post(`/gate-passes/${id}/in`, guard, {
      note: 'All back',
      items: [{ id: laptop.id, returnedQty: 1 }],
    });
    expect(back.json()).toMatchObject({ state: 'returned', itemsDue: 0 });
    // the register as Excel
    const xl = await inject({
      method: 'GET',
      url: '/gate-passes/report.xlsx?stage=all',
      headers: h(desk),
    });
    expect(xl.statusCode).toBe(200);
    // the employee's own approver level is skipped: the coordinator's own pass goes to the principal
    const own = await post('/gate-passes/staff', coordinator, {
      category: 'nrgp',
      atTime: '14:00',
      reason: 'Half day',
    });
    expect(
      (own.json().approvals as Array<{ label: string; status: string }>).map((a) => a.status),
    ).toEqual(['skipped', 'skipped', 'pending']);
  });
});
