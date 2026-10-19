/**
 * Employee ACR (0184, docs/design/32-employee-acr.md), part 1: the set-up a school starts with, the levels
 * it sets (how many, who fills each), the question bank, grade bands and cycles, and who may change them.
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

describe('employee ACR set-up (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    const s = stamp('ACR');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teach`, 'subject_teacher');
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => app.close());

  const setup = async () =>
    (await inject({ method: 'GET', url: '/people/acr/setup', headers: h(admin) })).json();

  it('a school starts with two levels per staff group, five grades and the earlier question bank', async () => {
    const s = await setup();
    expect(
      s.levels.teaching.map((l: { label: string; kind: string; action: string }) => [
        l.label,
        l.kind,
        l.action,
      ]),
    ).toEqual([
      ['HOD', 'acr_hod', 'rate'],
      // 0189: per employee, the Principal designation as the fallback
      ['Principal', 'acr_reviewer', 'review'],
    ]);
    expect(s.bands.map((b: { label: string }) => b.label)).toEqual([
      'Outstanding',
      'Very good',
      'Good',
      'Average',
      'Below average',
    ]);
    expect(s.settings).toEqual({
      scaleLabels: ['Outstanding', 'Very good', 'Good', 'Average', 'Below average'],
      representationDays: 15,
      staffLateAfter: '08:00',
    });
    const q = s.questions as Array<{ part: string; staffGroup: string; kind: string }>;
    expect(q.filter((x) => x.part === 'rate' && x.staffGroup === 'non_teaching')).toHaveLength(21);
    expect(
      q.filter((x) => x.part === 'self' && x.staffGroup === 'teaching' && x.kind === 'scale'),
    ).toHaveLength(10);
    const no = await inject({ method: 'GET', url: '/people/acr/setup', headers: h(teacher) });
    expect(no.statusCode).toBe(403);
  });

  it('levels: as many as the school wants, each one complete, at least one that rates', async () => {
    const put = (levels: unknown[]) =>
      inject({
        method: 'PUT',
        url: '/people/acr/setup/levels',
        headers: h(admin),
        json: { staffGroup: 'non_teaching', levels },
      });
    const noRate = await put([
      { label: 'Principal', kind: 'role', roleCode: 'school_admin', action: 'review' },
    ]);
    expect(noRate.statusCode).toBe(400);
    const incomplete = await put([{ label: 'HOD', kind: 'role', action: 'rate' }]);
    expect(incomplete.statusCode).toBe(400);
    const ok = await put([
      { label: 'Section head', kind: 'approver_l1', action: 'rate' },
      { label: 'Administrator', kind: 'approver_l2', action: 'rate' },
      { label: 'Principal', kind: 'designation', designation: 'Principal', action: 'review' },
      { label: 'Director', kind: 'role', roleCode: 'school_admin', action: 'review' },
    ]);
    expect(ok.statusCode).toBe(200);
    const s = await setup();
    expect(
      s.levels.non_teaching.map(
        (l: { seq: number; label: string }) => `${String(l.seq)} ${l.label}`,
      ),
    ).toEqual(['1 Section head', '2 Administrator', '3 Principal', '4 Director']);
    // the teaching levels are untouched
    expect(s.levels.teaching).toHaveLength(2);
    const byTeacher = await inject({
      method: 'PUT',
      url: '/people/acr/setup/levels',
      headers: h(teacher),
      json: { staffGroup: 'teaching', levels: [{ label: 'x', kind: 'acr_hod', action: 'rate' }] },
    });
    expect(byTeacher.statusCode).toBe(403);
  });

  it('grades need a 0% start and distinct names; the scale words and days to object are saved', async () => {
    const put = (bands: unknown[]) =>
      inject({
        method: 'PUT',
        url: '/people/acr/setup/settings',
        headers: h(admin),
        json: { scaleLabels: ['Excellent', 'Good', 'Fair', 'Poor'], representationDays: 10, bands },
      });
    expect(
      (
        await put([
          { minPct: 80, label: 'A' },
          { minPct: 50, label: 'B' },
        ])
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await put([
          { minPct: 80, label: 'A' },
          { minPct: 0, label: 'A' },
        ])
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await put([
          { minPct: 80, label: 'A' },
          { minPct: 50, label: 'B' },
          { minPct: 0, label: 'C', adverse: true },
        ])
      ).statusCode,
    ).toBe(200);
    const s = await setup();
    expect(s.settings).toEqual({
      scaleLabels: ['Excellent', 'Good', 'Fair', 'Poor'],
      representationDays: 10,
      staffLateAfter: '08:00',
    });
    expect(s.bands).toEqual([
      { minPct: 80, label: 'A', adverse: false },
      { minPct: 50, label: 'B', adverse: false },
      { minPct: 0, label: 'C', adverse: true },
    ]);
  });

  it('questions are added, changed and switched off; cycles one per year', async () => {
    const add = await inject({
      method: 'POST',
      url: '/people/acr/setup/questions',
      headers: h(admin),
      json: {
        part: 'rate',
        staffGroup: 'both',
        section: 'Values',
        text: 'Care for children',
        kind: 'scale',
        weight: 2,
      },
    });
    expect(add.statusCode).toBe(201);
    const off = await inject({
      method: 'PUT',
      url: `/people/acr/setup/questions/${add.json().id}`,
      headers: h(admin),
      json: {
        part: 'rate',
        staffGroup: 'both',
        section: 'Values',
        text: 'Care for children',
        kind: 'scale',
        weight: 2,
        active: false,
      },
    });
    expect(off.statusCode).toBe(200);
    const q = (await setup()).questions.find((x: { id: string }) => x.id === add.json().id);
    expect(q).toMatchObject({ weight: 2, active: false, staffGroup: 'both' });

    const year = await withMigrator((c) =>
      c.query<{ id: string }>('SELECT id::text FROM academic_years WHERE school_id = $1 LIMIT 1', [
        school.id,
      ]),
    );
    const cycle = {
      academicYearId: year.rows[0]!.id,
      name: 'ACR 2026-27',
      selfFrom: '2027-02-01',
      selfTo: '2027-02-28',
    };
    const bad = await inject({
      method: 'POST',
      url: '/people/acr/cycles',
      headers: h(admin),
      json: { ...cycle, selfTo: '2027-01-01' },
    });
    expect(bad.statusCode).toBe(400);
    const made = await inject({
      method: 'POST',
      url: '/people/acr/cycles',
      headers: h(admin),
      json: cycle,
    });
    expect(made.statusCode).toBe(201);
    const twice = await inject({
      method: 'POST',
      url: '/people/acr/cycles',
      headers: h(admin),
      json: cycle,
    });
    expect(twice.statusCode).toBe(409);
    const s = await setup();
    expect(s.cycles[0]).toMatchObject({ name: 'ACR 2026-27', status: 'draft', reports: 0 });
  });
});

/**
 * Part 2, the flow: a cycle starts an ACR for each employee with the people of each level; the window; the
 * self-appraisal; each level only by its people; send back; score, grade and reason; disclosure; objection
 * and decision; who sees what.
 */
describe('employee ACR flow (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let hod: SeededUser;
  let principal: SeededUser;
  let teacher: SeededUser;
  let clerk: SeededUser;
  let outsider: SeededUser;
  let teacherEmp = '';
  let cycleId = '';
  let reportId = '';
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const today = new Date().toISOString().slice(0, 10);
  const shift = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    const s = stamp('ACF');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      hod = await seedUser(c, school, `${s}-hod`, 'subject_teacher');
      principal = await seedUser(c, school, `${s}-prin`, 'subject_teacher');
      teacher = await seedUser(c, school, `${s}-teach`, 'subject_teacher');
      clerk = await seedUser(c, school, `${s}-clerk`);
      outsider = await seedUser(c, school, `${s}-out`, 'subject_teacher');
      const e = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, user_id, designation, employee_type)
         VALUES ($1, 'H1', 'Hema', $2, 'HOD Science', 'teaching'),
                ($1, 'P1', 'Prem', $3, 'Principal', 'teaching'),
                ($1, 'O1', 'Om', $4, 'PGT', 'teaching')
         RETURNING id::text`,
        [school.id, hod.id, principal.id, outsider.id],
      );
      const hodEmp = e.rows[0]!.id;
      const t = await c.query<{ id: string }>(
        `INSERT INTO employees (school_id, employee_code, first_name, user_id, designation, employee_type, profile)
         VALUES ($1, 'T1', 'Tara', $2, 'TGT', 'teaching', jsonb_build_object('acr_hod', $3::text)),
                ($1, 'C1', 'Chetan', $4, 'Clerk', 'non_teaching', '{}')
         RETURNING id::text`,
        [school.id, teacher.id, hodEmp, clerk.id],
      );
      teacherEmp = t.rows[0]!.id;
      // the outsider's own ACR HOD is the HOD too
      await c.query(
        `UPDATE employees SET profile = jsonb_build_object('acr_hod', $2::text) WHERE id = $1`,
        [e.rows[2]!.id, hodEmp],
      );
    });
    app = await createApp();
    inject = injector(app);
    const year = await withMigrator((c) =>
      c.query<{ id: string }>('SELECT id::text FROM academic_years WHERE school_id = $1 LIMIT 1', [
        school.id,
      ]),
    );
    const cy = await call(admin, 'POST', '/people/acr/cycles', {
      academicYearId: year.rows[0]!.id,
      name: 'ACR test',
      selfFrom: shift(-1),
      selfTo: shift(10),
    });
    cycleId = cy.json().id;
  });
  afterAll(async () => app.close());

  it('starting a cycle makes an ACR for every active employee; a level with nobody is reported', async () => {
    expect((await call(teacher, 'POST', `/people/acr/cycles/${cycleId}/start`)).statusCode).toBe(
      403,
    );
    const r = await call(admin, 'POST', `/people/acr/cycles/${cycleId}/start`);
    expect(r.statusCode).toBe(201);
    expect(r.json().added).toBe(5);
    // the clerk has no ACR HOD on record; the HOD and the Principal have no ACR HOD either
    expect(r.json().unassigned.map((x: { level: string }) => x.level)).toContain('HOD');
    const again = await call(admin, 'POST', `/people/acr/cycles/${cycleId}/start`);
    expect(again.json().added).toBe(0);
    const board = await call(admin, 'GET', '/people/acr/board');
    expect(board.json().counts).toEqual({ self: 5 });
    const mine = await call(teacher, 'GET', '/people/acr/mine');
    expect(mine.json().data).toHaveLength(1);
    reportId = mine.json().data[0].id;
    expect(mine.json().data[0]).toMatchObject({
      staffGroup: 'teaching',
      status: 'self',
      employee: { id: teacherEmp },
    });
    const clerkMine = await call(clerk, 'GET', '/people/acr/mine');
    expect(clerkMine.json().data[0].staffGroup).toBe('non_teaching');
  });

  it('the self-appraisal: only the employee, inside the window, every required answer', async () => {
    const v = (await call(teacher, 'GET', `/people/acr/reports/${reportId}`)).json();
    expect(v.can.self).toBe(true);
    expect(v.questions.rate).toEqual([]); // the employee does not see the rating form now
    expect(v.self.facts).toMatchObject({ results: [], activityLog: null });
    const self = v.questions.self as Array<{ id: string; kind: string; required: boolean }>;
    // someone else cannot open it
    expect((await call(outsider, 'GET', `/people/acr/reports/${reportId}`)).statusCode).toBe(404);
    expect(
      (await call(outsider, 'PUT', `/people/acr/reports/${reportId}/self`, { answers: {} }))
        .statusCode,
    ).toBe(404);
    const scale = self.filter((q) => q.kind === 'scale');
    const draft = await call(teacher, 'PUT', `/people/acr/reports/${reportId}/self`, {
      answers: { [scale[0]!.id]: 4 },
    });
    expect(draft.statusCode).toBe(200);
    const outOfScale = await call(teacher, 'PUT', `/people/acr/reports/${reportId}/self`, {
      answers: { [scale[0]!.id]: 9 },
    });
    expect(outOfScale.statusCode).toBe(400);
    const missing = await call(teacher, 'POST', `/people/acr/reports/${reportId}/self/submit`, {
      answers: {},
    });
    expect(missing.statusCode).toBe(400);
    // the window, checked on the server
    await withMigrator((c) =>
      c.query(`UPDATE acr_cycles SET self_from = $2, self_to = $3 WHERE id = $1`, [
        cycleId,
        shift(5),
        shift(9),
      ]),
    );
    const early = await call(teacher, 'PUT', `/people/acr/reports/${reportId}/self`, {
      answers: {},
    });
    expect(early.statusCode).toBe(409);
    await withMigrator((c) =>
      c.query(`UPDATE acr_cycles SET self_from = $2, self_to = $3 WHERE id = $1`, [
        cycleId,
        today,
        shift(10),
      ]),
    );
    const answers = Object.fromEntries(
      self.map((q) => [q.id, q.kind === 'scale' ? 4 : 'Done with care']),
    );
    const done = await call(teacher, 'POST', `/people/acr/reports/${reportId}/self/submit`, {
      answers,
    });
    expect(done.statusCode).toBe(200);
    const after = (await call(teacher, 'GET', `/people/acr/reports/${reportId}`)).json();
    expect(after).toMatchObject({ status: 'review', currentLevel: 1, can: { self: false } });
    expect(after.self.pct).toBe(80);
    expect(after.self.facts.period.from).toBeTruthy();
  });

  it('each level only by its people; send back; the reviewer gives a grade and a reason to change it', async () => {
    const waiting = (await call(hod, 'GET', '/people/acr/to-assess')).json().waiting;
    expect(waiting.map((x: { id: string }) => x.id)).toContain(reportId);
    const v = (await call(hod, 'GET', `/people/acr/reports/${reportId}`)).json();
    expect(v.can.level).toEqual({ seq: 1, action: 'rate' });
    const rate = v.questions.rate as Array<{ id: string; kind: string }>;
    // the Principal cannot fill the HOD's level
    expect(
      (
        await call(principal, 'POST', `/people/acr/reports/${reportId}/levels/1/submit`, {
          answers: {},
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await call(hod, 'POST', `/people/acr/reports/${reportId}/levels/1/submit`, { answers: {} }))
        .statusCode,
    ).toBe(400);
    // all ratings 2 of 5 = 40%: Below average (adverse)
    const low = Object.fromEntries(
      rate.map((q) => [q.id, q.kind === 'scale' ? 2 : 'Needs support']),
    );
    const r1 = await call(hod, 'POST', `/people/acr/reports/${reportId}/levels/1/submit`, {
      answers: low,
      remarks: 'Struggles with class management',
    });
    expect(r1.json()).toEqual({ status: 'review', next: 'Principal' });
    // the Principal sends it back to the HOD, who submits again
    expect(
      (await call(principal, 'POST', `/people/acr/reports/${reportId}/send-back`, { reason: 'x' }))
        .statusCode,
    ).toBe(400);
    const back = await call(principal, 'POST', `/people/acr/reports/${reportId}/send-back`, {
      reason: 'Please add the remarks on results',
    });
    expect(back.json()).toEqual({ status: 'review', level: 1 });
    await call(hod, 'POST', `/people/acr/reports/${reportId}/levels/1/submit`, {
      answers: low,
      remarks: 'Results added',
    });
    const pv = (await call(principal, 'GET', `/people/acr/reports/${reportId}`)).json();
    expect(pv.levels[0]).toMatchObject({ status: 'done', scorePct: 40, grade: 'Below average' });
    const noAgree = await call(
      principal,
      'POST',
      `/people/acr/reports/${reportId}/levels/2/submit`,
      {
        grade: 'Below average',
        remarks: 'Seen',
      },
    );
    expect(noAgree.statusCode).toBe(400);
    const noReason = await call(
      principal,
      'POST',
      `/people/acr/reports/${reportId}/levels/2/submit`,
      {
        grade: 'Good',
        agreement: 'partly',
        remarks: 'Seen',
      },
    );
    expect(noReason.statusCode).toBe(400);
    const done = await call(principal, 'POST', `/people/acr/reports/${reportId}/levels/2/submit`, {
      grade: 'Average',
      gradeReason: 'Improved in the last term',
      agreement: 'partly',
      remarks: 'Needs mentoring',
    });
    expect(done.json()).toEqual({ status: 'disclosed', grade: 'Average' });
    const events = (await call(admin, 'GET', `/people/acr/reports/${reportId}`))
      .json()
      .events.map((e: { what: string }) => e.what);
    expect(events).toEqual([
      'started',
      'self_submitted',
      'level_done',
      'returned',
      'level_done',
      'level_done',
      'disclosed',
    ]);
  });

  it('the employee sees the ACR, objects to an adverse grade in time; the school decides', async () => {
    const v = (await call(teacher, 'GET', `/people/acr/reports/${reportId}`)).json();
    expect(v.result).toMatchObject({
      scorePct: 40,
      grade: 'Average',
      adverse: true,
      objectBy: shift(15),
    });
    expect(v.levels[1]).toMatchObject({ remarks: 'Needs mentoring', agreement: 'partly' });
    expect(v.can).toMatchObject({ acknowledge: true, represent: true });
    expect(
      (await call(teacher, 'POST', `/people/acr/reports/${reportId}/represent`, { text: 'short' }))
        .statusCode,
    ).toBe(400);
    const rep = await call(teacher, 'POST', `/people/acr/reports/${reportId}/represent`, {
      text: 'My section results improved from 61% to 78% this year; please consider them.',
    });
    expect(rep.json()).toEqual({ status: 'represented' });
    expect(
      (
        await call(teacher, 'POST', `/people/acr/reports/${reportId}/decide`, {
          decision: 'upheld',
          note: 'no change',
        })
      ).statusCode,
    ).toBe(403);
    const dec = await call(admin, 'POST', `/people/acr/reports/${reportId}/decide`, {
      decision: 'revised',
      grade: 'Good',
      note: 'Results confirmed by the exam cell',
    });
    expect(dec.json()).toEqual({ status: 'closed', grade: 'Good' });
    const fin = (await call(teacher, 'GET', `/people/acr/reports/${reportId}`)).json();
    expect(fin).toMatchObject({
      status: 'closed',
      result: { grade: 'Good', adverse: false, decision: 'revised' },
    });
  });

  it('the school puts someone on a level the record left empty, and enters the office figures', async () => {
    const board = (await call(admin, 'GET', '/people/acr/board')).json();
    const clerkAcr = board.rows.find(
      (r: { employee: { name: string } }) => r.employee.name === 'Chetan',
    );
    const pv = (await call(admin, 'GET', `/people/acr/reports/${clerkAcr.id as string}`)).json();
    expect(pv.levels[0].people).toEqual([]);
    const hodEmp = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = 'H1'`,
        [school.id],
      ),
    );
    const set = await call(
      admin,
      'PUT',
      `/people/acr/reports/${clerkAcr.id as string}/levels/1/people`,
      {
        employeeIds: [hodEmp.rows[0]!.id],
      },
    );
    expect(set.statusCode).toBe(200);
    const self = await call(
      admin,
      'PUT',
      `/people/acr/reports/${clerkAcr.id as string}/levels/1/people`,
      {
        // an employee never assesses their own ACR
        employeeIds: [clerkAcr.employee.id as string],
      },
    );
    expect(self.statusCode).toBe(400);
    const office = await call(admin, 'PUT', `/people/acr/reports/${reportId}/office`, {
      cl: 6,
      el: 2,
      absent: 8,
    });
    expect(office.statusCode).toBe(200);
    const v = (await call(admin, 'GET', `/people/acr/reports/${reportId}`)).json();
    expect(v.self.office).toEqual({ cl: 6, el: 2, absent: 8 });
  });

  it('assessors (0189): who is missing; set by code and by id, never oneself; the reviewer falls back to the Principal; re-read for the open cycle', async () => {
    const list = (await call(admin, 'GET', '/people/acr/setup/assessors')).json();
    const keys = list.columns.map((c: { key: string }) => c.key);
    expect(keys).toContain('acr_hod');
    expect(keys).toContain('acr_reviewer');
    expect(list.columns.find((c: { key: string }) => c.key === 'acr_reviewer').fallback).toBe(
      'Principal',
    );
    const clerkRow = list.rows.find((r: { code: string }) => r.code === 'C1');
    expect(clerkRow.missing).toBe(true);
    expect(clerkRow.assessors.acr_hod).toBeNull();
    const tara = list.rows.find((r: { code: string }) => r.code === 'T1');
    expect(tara.assessors.acr_hod).toMatchObject({ code: 'H1' });
    // the teacher's reviewer level fell back to the Principal when the cycle started
    const v = (await call(admin, 'GET', `/people/acr/reports/${reportId}`)).json();
    expect(v.levels[1].people.map((p: { name: string }) => p.name)).toEqual(['Prem']);
    // by code (the Excel way) and by id; oneself is refused and the row left as it was
    const principalId = list.rows.find((r: { code: string }) => r.code === 'P1').id;
    const save = await call(admin, 'PUT', '/people/acr/setup/assessors', {
      rows: [
        { employee: 'c1', assessors: { acr_hod: 'o1', acr_reviewer: principalId } },
        { employee: 'H1', assessors: { acr_hod: 'H1' } },
        { employee: 'ZZ9', assessors: { acr_hod: 'H1' } },
      ],
    });
    expect(save.statusCode).toBe(200);
    expect(save.json().changed).toBe(1);
    expect(save.json().errors).toHaveLength(2);
    const after = (await call(admin, 'GET', '/people/acr/setup/assessors?missing=true')).json();
    expect(after.rows.map((r: { code: string }) => r.code)).not.toContain('C1');
    expect(
      (await call(admin, 'GET', '/people/acr/setup/assessors?q=chetan')).json().rows[0].assessors
        .acr_hod,
    ).toMatchObject({ code: 'O1' });
    expect(
      (await call(teacher, 'PUT', '/people/acr/setup/assessors', { rows: [] })).statusCode,
    ).toBe(403);
    // the open cycle re-reads the records: the clerk's HOD level now has Om
    const rr = await call(admin, 'POST', `/people/acr/cycles/${cycleId}/reresolve`);
    expect(rr.statusCode).toBe(201);
    expect(rr.json().changed).toBeGreaterThanOrEqual(1);
    const board = (await call(admin, 'GET', '/people/acr/board')).json();
    const clerkAcr = board.rows.find(
      (r: { employee: { code: string } }) => r.employee.code === 'C1',
    );
    const pv = (await call(admin, 'GET', `/people/acr/reports/${clerkAcr.id as string}`)).json();
    expect(pv.levels[0].people.map((p: { name: string }) => p.name)).toEqual(['Om']);
    expect(pv.levels[1].people.map((p: { name: string }) => p.name)).toEqual(['Prem']);
  });
});
