/**
 * Sprint 14: adjustments (waiver, reversal, bounce) with step-up MFA, category and discount changes through
 * the workflow, hostel ledger on the same engine, misc receipts, reconciliation, exam masters, the family's
 * receipt PDF, and the assistant v0 over the query catalogue with permission tests per role.
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

interface Instalment {
  dueOn: string;
  ledger: string;
  net: string;
  paid: string;
  balance: string;
  status: string;
}
interface Ledger {
  instalments: Instalment[];
  totals: { balance: string; payable: string };
  payments: Array<{ id: string; receiptNo: string | null; amount: string; status: string }>;
}

describe('adjustments, hostel, misc, exams and the assistant (e2e, Sprint 14)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let teacher: SeededUser;
  let coordinator: SeededUser;
  let parent: SeededUser;
  let classId: string;
  let sectionId: string;
  const heads: Record<string, string> = {};
  const students = {} as Record<
    'host' | 'waive' | 'reverse' | 'bounce' | 'change' | 'child',
    string
  >;

  const h = (u: SeededUser = admin, extra = '') => headersFor(`${u.sub}${extra}`, school.id);
  const ledgerOf = async (id: string, user: SeededUser = admin) =>
    (
      await inject({ method: 'GET', url: `/fees/students/${id}/ledger`, headers: h(user) })
    ).json() as Ledger;
  const receipt = (json: Record<string, unknown>) =>
    inject({ method: 'POST', url: '/payments/receipts', headers: h(accountant), json });

  beforeAll(async () => {
    const s = stamp('F14');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
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
    for (const [code, name, kind, ledger, i] of [
      ['TUI', 'Tuition fee', 'regular', 'school', 1],
      ['HOS', 'Hostel fee', 'regular', 'hostel', 2],
      ['IDC', 'ID card', 'misc', 'misc', 3],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: '/fees/heads',
        headers: h(),
        json: { code, name, kind, ledger, sortOrder: i },
      });
      expect(r.statusCode).toBe(201);
      heads[code] = r.json().id;
    }
    const p = await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 3 },
    });
    expect(p.statusCode).toBe(201);
    const st = await inject({
      method: 'PUT',
      url: `/fees/structures/${classId}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: [
          { headId: heads.TUI, amount: 2000, frequency: 'monthly' },
          { headId: heads.HOS, amount: 3000, frequency: 'monthly' },
        ],
      },
    });
    expect(st.statusCode).toBe(200);
    await inject({
      method: 'PUT',
      url: '/platform/settings/fees.late_fee_mode',
      headers: h(),
      json: { value: 'daywise' },
    });
    await inject({
      method: 'PUT',
      url: '/platform/settings/fees.late_fee_per_day',
      headers: h(),
      json: { value: '10.00' },
    });
    let roll = 1;
    for (const id of ['host', 'waive', 'reverse', 'bounce', 'change', 'child'] as const) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `F14-${id}`,
          firstName: id,
          lastName: 'Fourteen',
          dob: '2015-01-01',
          admittedOn: '2026-04-05',
          enrolment: { classSectionId: sectionId, rollNo: roll },
        },
      });
      expect(r.statusCode).toBe(201);
      students[id] = r.json().id;
      roll += 1;
      if (id === 'host') {
        const pr = await inject({
          method: 'PUT',
          url: `/fees/students/${students.host}/profile`,
          headers: h(),
          json: { studentType: 'old', hosteller: true },
        });
        expect(pr.statusCode).toBe(200);
        expect(pr.json().hosteller).toBe(true);
      }
      const g = await inject({
        method: 'POST',
        url: `/fees/students/${students[id]}/demands/generate`,
        headers: h(),
      });
      expect(g.statusCode).toBe(201);
    }
    await withMigrator(async (c) => {
      const g = await c.query<{ id: string }>(
        `INSERT INTO guardians (school_id, first_name, last_name, mobile, user_id) VALUES ($1, 'Rekha', 'Fourteen', '9876500014', $2) RETURNING id`,
        [school.id, parent.id],
      );
      await c.query(
        `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'mother', true)`,
        [school.id, students.child, g.rows[0]!.id],
      );
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  // ---- hostel ------------------------------------------------------------------------------------
  it('a hosteller gets hostel instalments on the hostel ledger and a hostel receipt settles only those', async () => {
    const before = await ledgerOf(students.host);
    const hostel = before.instalments.filter((i) => i.ledger === 'hostel');
    const schoolRows = before.instalments.filter((i) => i.ledger === 'school');
    expect(hostel.length).toBe(4);
    expect(schoolRows.length).toBe(4);
    expect(hostel[0]).toMatchObject({ net: '9000.00', balance: '9000.00' });
    expect(schoolRows[0]).toMatchObject({ net: '6000.00' });
    const other = await ledgerOf(students.waive);
    expect(other.instalments.every((i) => i.ledger === 'school')).toBe(true);
    const r = await receipt({
      studentId: students.host,
      amount: 9000,
      mode: 'cash',
      receivedOn: '2026-04-05',
      ledger: 'hostel',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().receiptNo).toMatch(/^HF\/FY2026-27\//);
    expect(r.json()).toMatchObject({ principal: '9000.00', lateFee: '0.00', advance: '0.00' });
    const after = await ledgerOf(students.host);
    expect(
      after.instalments.find((i) => i.ledger === 'hostel' && i.dueOn === '2026-04-10'),
    ).toMatchObject({ balance: '0.00', status: 'paid' });
    expect(
      after.instalments.find((i) => i.ledger === 'school' && i.dueOn === '2026-04-10'),
    ).toMatchObject({ balance: '6000.00' });
  });

  it('a late hostel receipt collects the hostel late fee only; the school instalment keeps its own', async () => {
    // school April settled on time (the hostel April was, above); July instalments due 10 Jul, both paid
    // 20 Jul = 10 days x 10 per day on each ledger, computed and posted per ledger
    const onTime = await receipt({
      studentId: students.host,
      amount: 6000,
      mode: 'cash',
      receivedOn: '2026-04-05',
    });
    expect(onTime.statusCode).toBe(201);
    expect(onTime.json()).toMatchObject({ principal: '6000.00', lateFee: '0.00' });
    const hostel = await receipt({
      studentId: students.host,
      amount: 9100,
      mode: 'cash',
      receivedOn: '2026-07-20',
      ledger: 'hostel',
    });
    expect(hostel.statusCode).toBe(201);
    expect(hostel.json()).toMatchObject({
      principal: '9000.00',
      lateFee: '100.00',
      advance: '0.00',
    });
    const mid = await ledgerOf(students.host);
    expect(
      mid.instalments.find((i) => i.ledger === 'hostel' && i.dueOn === '2026-07-10'),
    ).toMatchObject({ balance: '0.00', status: 'paid' });
    expect(
      mid.instalments.find((i) => i.ledger === 'school' && i.dueOn === '2026-07-10'),
    ).toMatchObject({ balance: '6000.00' });
    const school = await receipt({
      studentId: students.host,
      amount: 6100,
      mode: 'cash',
      receivedOn: '2026-07-20',
    });
    expect(school.statusCode).toBe(201);
    expect(school.json()).toMatchObject({ principal: '6000.00', lateFee: '100.00' });
    const after = await ledgerOf(students.host);
    expect(
      after.instalments.find((i) => i.ledger === 'school' && i.dueOn === '2026-07-10'),
    ).toMatchObject({ balance: '0.00', status: 'paid' });
  });

  // ---- adjustments -------------------------------------------------------------------------------
  it('a waiver reduces a demand row after approval with a fresh MFA sign-in', async () => {
    const demands = (
      await inject({ method: 'GET', url: `/fees/students/${students.waive}/demands`, headers: h() })
    ).json() as { rows: Array<{ id: string; net: string; periodName: string }> };
    const row = demands.rows[0]!;
    const tooMuch = await inject({
      method: 'POST',
      url: '/fees/adjustments',
      headers: h(accountant),
      json: {
        kind: 'waiver',
        demandId: row.id,
        amount: Number(row.net) + 1,
        reason: 'Sibling concession',
      },
    });
    expect(tooMuch.statusCode).toBe(409);
    const req = await inject({
      method: 'POST',
      url: '/fees/adjustments',
      headers: h(accountant),
      json: { kind: 'waiver', demandId: row.id, amount: 500, reason: 'Sibling concession' },
    });
    expect(req.statusCode).toBe(201);
    expect(req.json()).toMatchObject({ kind: 'waiver', status: 'pending', amount: '500.00' });
    const again = await inject({
      method: 'POST',
      url: '/fees/adjustments',
      headers: h(accountant),
      json: { kind: 'waiver', demandId: row.id, amount: 100, reason: 'twice' },
    });
    expect(again.statusCode).toBe(409);
    const notAllowed = await inject({
      method: 'POST',
      url: `/fees/adjustments/${req.json().id}/decide`,
      headers: h(accountant),
      json: { outcome: 'approved' },
    });
    expect(notAllowed.statusCode).toBe(403);
    const stale = await inject({
      method: 'POST',
      url: `/fees/adjustments/${req.json().id}/decide`,
      headers: h(admin, ';mfa=false'),
      json: { outcome: 'approved' },
    });
    expect(stale.statusCode).toBe(403);
    expect(stale.json().type).toBe('mfa-required');
    const ok = await inject({
      method: 'POST',
      url: `/fees/adjustments/${req.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved', note: 'Principal approved' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().status).toBe('approved');
    const after = (
      await inject({ method: 'GET', url: `/fees/students/${students.waive}/demands`, headers: h() })
    ).json() as { rows: Array<{ id: string; net: string; discount: string }> };
    const changed = after.rows.find((r) => r.id === row.id)!;
    expect(Number(changed.net)).toBe(Number(row.net) - 500);
    expect(Number(changed.discount)).toBe(500);
  });

  it('a reversal reopens the demand and keeps the receipt with status reversed', async () => {
    const paid = await receipt({
      studentId: students.reverse,
      amount: 6000,
      mode: 'cash',
      receivedOn: '2026-04-05',
    });
    const paymentId = paid.json().paymentId as string;
    expect((await ledgerOf(students.reverse)).instalments[0]!.status).toBe('paid');
    const req = await inject({
      method: 'POST',
      url: '/fees/adjustments',
      headers: h(accountant),
      json: { kind: 'reversal', paymentId, reason: 'Posted to the wrong student' },
    });
    expect(req.statusCode).toBe(201);
    const ok = await inject({
      method: 'POST',
      url: `/fees/adjustments/${req.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(ok.statusCode).toBe(201);
    const ledger = await ledgerOf(students.reverse);
    expect(ledger.payments[0]).toMatchObject({ id: paymentId, status: 'reversed' });
    expect(ledger.instalments[0]).toMatchObject({ balance: '6000.00' });
    const twice = await inject({
      method: 'POST',
      url: '/fees/adjustments',
      headers: h(accountant),
      json: { kind: 'reversal', paymentId, reason: 'again' },
    });
    expect(twice.statusCode).toBe(409);
  });

  it('a cheque bounce reverses the receipt and adds the bounce charge to the demand', async () => {
    const cash = await receipt({
      studentId: students.bounce,
      amount: 100,
      mode: 'cash',
      receivedOn: '2026-04-05',
    });
    const notCheque = await inject({
      method: 'POST',
      url: '/fees/adjustments',
      headers: h(accountant),
      json: { kind: 'bounce', paymentId: cash.json().paymentId, reason: 'not a cheque' },
    });
    expect(notCheque.statusCode).toBe(409);
    const chq = await receipt({
      studentId: students.bounce,
      amount: 5900,
      mode: 'cheque',
      instrumentNo: '110022',
      bankName: 'HDFC',
      receivedOn: '2026-04-05',
    });
    expect(chq.statusCode).toBe(201);
    const req = await inject({
      method: 'POST',
      url: '/fees/adjustments',
      headers: h(accountant),
      json: { kind: 'bounce', paymentId: chq.json().paymentId, reason: 'Insufficient funds' },
    });
    expect(req.statusCode).toBe(201);
    expect(req.json()).toMatchObject({ kind: 'bounce', charge: '500.00' });
    const ok = await inject({
      method: 'POST',
      url: `/fees/adjustments/${req.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(ok.statusCode).toBe(201);
    const ledger = await ledgerOf(students.bounce);
    expect(ledger.payments.find((p) => p.id === chq.json().paymentId)!.status).toBe('bounced');
    const demands = (
      await inject({
        method: 'GET',
        url: `/fees/students/${students.bounce}/demands`,
        headers: h(),
      })
    ).json() as { rows: Array<{ source: string; net: string; headCode: string }> };
    expect(demands.rows.find((r) => r.source === 'bounce_charge')).toMatchObject({
      net: '500.00',
      headCode: 'BOUNCE',
    });
    expect(Number(ledger.totals.balance)).toBe(6000 * 4 - 100 + 500);
    const list = await inject({
      method: 'GET',
      url: '/fees/adjustments?status=approved',
      headers: h(accountant),
    });
    expect((list.json().data as Array<{ kind: string }>).map((a) => a.kind).sort()).toEqual([
      'bounce',
      'reversal',
      'waiver',
    ]);
  });

  // ---- profile changes ---------------------------------------------------------------------------
  it('a discount change is decided directly without a workflow and through the inbox with one', async () => {
    const disc = await inject({
      method: 'POST',
      url: '/fees/discounts',
      headers: h(),
      json: { code: 'STAFF', name: 'Staff ward', percent: 50 },
    });
    expect(disc.statusCode).toBe(201);
    const req = await inject({
      method: 'POST',
      url: `/fees/students/${students.change}/profile-changes`,
      headers: h(accountant),
      json: { discountId: disc.json().id, reason: 'Mother joined as teacher' },
    });
    expect(req.statusCode).toBe(201);
    expect(req.json()).toMatchObject({ status: 'pending', workflowInstanceId: null });
    const denied = await inject({
      method: 'POST',
      url: `/fees/profile-changes/${req.json().id}/decide`,
      headers: h(teacher),
      json: { outcome: 'approved' },
    });
    expect(denied.statusCode).toBe(403);
    const ok = await inject({
      method: 'POST',
      url: `/fees/profile-changes/${req.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().status).toBe('approved');
    const profile = await inject({
      method: 'GET',
      url: `/fees/students/${students.change}/profile`,
      headers: h(),
    });
    expect(profile.json().discountId).toBe(disc.json().id);
    const ledger = await ledgerOf(students.change);
    expect(ledger.instalments[0]!.net).toBe('3000.00'); // 6000 less 50 %
    // with the workflow installed the next change waits in the inbox
    const defaults = await inject({
      method: 'POST',
      url: '/workflow/definitions/defaults',
      headers: h(),
    });
    expect(defaults.statusCode).toBe(201);
    const req2 = await inject({
      method: 'POST',
      url: `/fees/students/${students.change}/profile-changes`,
      headers: h(accountant),
      json: { hosteller: true, reason: 'Joined the hostel' },
    });
    expect(req2.statusCode).toBe(201);
    expect(req2.json().workflowInstanceId).not.toBeNull();
    const direct = await inject({
      method: 'POST',
      url: `/fees/profile-changes/${req2.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(direct.statusCode).toBe(409);
    const step = await withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT id::text FROM workflow_steps WHERE instance_id = $1 AND status = 'pending' ORDER BY level LIMIT 1`,
        [req2.json().workflowInstanceId],
      );
      return r.rows[0]!.id;
    });
    const approve = await inject({
      method: 'POST',
      url: `/workflow/steps/${step}/approve`,
      headers: h(),
      json: { note: 'ok' },
    });
    expect([200, 201]).toContain(approve.statusCode);
    const after = await ledgerOf(students.change);
    expect(after.instalments.some((i) => i.ledger === 'hostel')).toBe(true);
    const list = await inject({
      method: 'GET',
      url: '/fees/profile-changes?status=approved',
      headers: h(accountant),
    });
    expect((list.json().data as unknown[]).length).toBe(2);
  });

  // ---- misc receipts and reconciliation ----------------------------------------------------------
  it('misc receipts are numbered on the misc ledger for vendors and students; reconciliation runs', async () => {
    const vendor = await inject({
      method: 'POST',
      url: '/fees/misc/receipts',
      headers: h(accountant),
      json: {
        payerKind: 'vendor',
        payerName: 'Acme Books',
        headId: heads.IDC,
        amount: 1500,
        mode: 'upi',
        reference: 'UPI-9',
      },
    });
    expect(vendor.statusCode).toBe(201);
    expect(vendor.json()).toMatchObject({
      receiptNo: 'MF/FY2026-27/000001',
      payerName: 'Acme Books',
      headCode: 'IDC',
    });
    const student = await inject({
      method: 'POST',
      url: '/fees/misc/receipts',
      headers: h(accountant),
      json: {
        payerKind: 'student',
        studentId: students.child,
        headId: heads.IDC,
        amount: 150,
        mode: 'cash',
      },
    });
    expect(student.json()).toMatchObject({
      receiptNo: 'MF/FY2026-27/000002',
      payerName: 'child Fourteen',
    });
    const bad = await inject({
      method: 'POST',
      url: '/fees/misc/receipts',
      headers: h(accountant),
      json: { payerKind: 'vendor', headId: heads.IDC, amount: 10, mode: 'cash' },
    });
    expect(bad.statusCode).toBe(400);
    const list = await inject({
      method: 'GET',
      url: '/fees/misc/receipts?payerKind=vendor',
      headers: h(teacher),
    });
    expect(list.statusCode).toBe(403);
    const ok = await inject({
      method: 'GET',
      url: '/fees/misc/receipts?payerKind=vendor',
      headers: h(accountant),
    });
    expect(ok.json().page.total).toBe(1);
    const run = await inject({
      method: 'POST',
      url: '/fees/reconciliations/run',
      headers: h(accountant),
    });
    expect(run.statusCode).toBe(201);
    expect(run.json()).toMatchObject({
      onlineReceipts: 0,
      unsettledReceipts: 0,
      succeededWithoutReceipt: 0,
    });
    const runs = await inject({ method: 'GET', url: '/fees/reconciliations', headers: h() });
    expect((runs.json().data as unknown[]).length).toBe(1);
  });

  it('the misc form finds an employee payer by name or code; only the desk may look up', async () => {
    const code = `EMP${Date.now() % 1_000_000}`;
    const created = await inject({
      method: 'POST',
      url: '/people/employees',
      headers: h(),
      json: {
        employeeCode: code,
        firstName: 'Meera',
        lastName: 'Fourteen',
        employeeType: 'non_teaching',
        designation: 'Clerk',
      },
    });
    expect(created.statusCode).toBe(201);
    const byName = await inject({
      method: 'GET',
      url: '/fees/misc/employees?q=meera',
      headers: h(accountant),
    });
    expect(byName.statusCode).toBe(200);
    expect(byName.json().data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ employeeCode: code, displayName: 'Meera Fourteen' }),
      ]),
    );
    const byCode = await inject({
      method: 'GET',
      url: `/fees/misc/employees?q=${code.toLowerCase()}`,
      headers: h(accountant),
    });
    expect(byCode.json().data).toHaveLength(1);
    const denied = await inject({
      method: 'GET',
      url: '/fees/misc/employees?q=meera',
      headers: h(teacher),
    });
    expect(denied.statusCode).toBe(403);
    const paid = await inject({
      method: 'POST',
      url: '/fees/misc/receipts',
      headers: h(accountant),
      json: {
        payerKind: 'employee',
        employeeId: created.json().id,
        headId: heads.IDC,
        amount: 100,
        mode: 'cash',
      },
    });
    expect(paid.statusCode).toBe(201);
    expect(paid.json()).toMatchObject({ payerName: 'Meera Fourteen', payerKind: 'employee' });
  });

  // ---- exams -------------------------------------------------------------------------------------
  it('exam masters: types, grade scales with band validation, exams per class with subjects and locks', async () => {
    const type = await inject({
      method: 'POST',
      url: '/exams/types',
      headers: h(coordinator),
      json: { code: 'PT1', name: 'Periodic Test 1', weightage: 10, sortOrder: 1 },
    });
    expect(type.statusCode).toBe(201);
    const overlap = await inject({
      method: 'PUT',
      url: '/exams/grade-scales',
      headers: h(coordinator),
      json: {
        code: 'CBSE8',
        name: 'Eight point',
        bands: [
          { minPct: 91, maxPct: 100, grade: 'A1', points: 10 },
          { minPct: 85, maxPct: 92, grade: 'A2', points: 9 },
        ],
      },
    });
    expect(overlap.statusCode).toBe(400);
    const scale = await inject({
      method: 'PUT',
      url: '/exams/grade-scales',
      headers: h(coordinator),
      json: {
        code: 'CBSE8',
        name: 'Eight point',
        bands: [
          { minPct: 91, maxPct: 100, grade: 'A1', points: 10 },
          { minPct: 81, maxPct: 90.99, grade: 'A2', points: 9 },
          { minPct: 0, maxPct: 80.99, grade: 'B', points: 7 },
        ],
      },
    });
    expect(scale.statusCode).toBe(200);
    expect((scale.json().bands as Array<{ grade: string }>).map((b) => b.grade)).toEqual([
      'A1',
      'A2',
      'B',
    ]);
    const subj = await inject({
      method: 'POST',
      url: '/academics/subjects',
      headers: h(),
      json: { code: 'MAT', name: 'Mathematics' },
    });
    expect(subj.statusCode).toBe(201);
    const exam = await inject({
      method: 'POST',
      url: '/exams',
      headers: h(coordinator),
      json: {
        examTypeId: type.json().id,
        code: 'PT1-2026',
        name: 'Periodic Test 1',
        startsOn: '2026-07-15',
        endsOn: '2026-07-20',
        classes: [{ classId, gradeScaleId: scale.json().id }],
      },
    });
    expect(exam.statusCode).toBe(201);
    expect(exam.json().classes[0]).toMatchObject({
      classCode: 'VI',
      gradeScaleCode: 'CBSE8',
      subjects: 0,
    });
    const badPass = await inject({
      method: 'PUT',
      url: `/exams/${exam.json().id}/subjects`,
      headers: h(coordinator),
      json: { classId, subjects: [{ subjectId: subj.json().id, maxMarks: 40, passMarks: 41 }] },
    });
    expect(badPass.statusCode).toBe(400);
    const subjects = await inject({
      method: 'PUT',
      url: `/exams/${exam.json().id}/subjects`,
      headers: h(coordinator),
      json: {
        classId,
        subjects: [
          { subjectId: subj.json().id, maxMarks: 40, passMarks: 13, examOn: '2026-07-16' },
        ],
      },
    });
    expect(subjects.statusCode).toBe(200);
    expect(subjects.json().subjects[0]).toMatchObject({
      subjectCode: 'MAT',
      maxMarks: '40.00',
      passMarks: '13.00',
      entryLocked: false,
    });
    const lock = await inject({
      method: 'POST',
      url: `/exams/${exam.json().id}/subjects/lock`,
      headers: h(coordinator),
      json: { classId, locked: true },
    });
    expect(lock.json().subjects[0].entryLocked).toBe(true);
    expect(lock.json().classes[0].locked).toBe(1);
    const teacherView = await inject({
      method: 'GET',
      url: `/exams/${exam.json().id}`,
      headers: h(teacher),
    });
    expect(teacherView.statusCode).toBe(200);
    const teacherWrite = await inject({
      method: 'POST',
      url: '/exams/types',
      headers: h(teacher),
      json: { code: 'X', name: 'No' },
    });
    expect(teacherWrite.statusCode).toBe(403);
    const dup = await inject({
      method: 'POST',
      url: '/exams/types',
      headers: h(coordinator),
      json: { code: 'PT1', name: 'Again' },
    });
    expect(dup.statusCode).toBe(409);
  });

  // ---- family receipt PDF ------------------------------------------------------------------------
  it('a guardian queues the PDF of an own receipt and reads only own exports', async () => {
    const templates = await inject({
      method: 'POST',
      url: '/platform/templates/defaults',
      headers: h(),
    });
    expect([200, 201]).toContain(templates.statusCode);
    const paid = await receipt({
      studentId: students.child,
      amount: 6000,
      mode: 'cash',
      receivedOn: '2026-04-05',
    });
    const paymentId = paid.json().paymentId as string;
    const other = await receipt({
      studentId: students.host,
      amount: 100,
      mode: 'cash',
      receivedOn: '2026-04-05',
    });
    const notMine = await inject({
      method: 'POST',
      url: `/fees/mine/receipts/${other.json().paymentId}/pdf`,
      headers: h(parent),
    });
    expect(notMine.statusCode).toBe(404);
    const queued = await inject({
      method: 'POST',
      url: `/fees/mine/receipts/${paymentId}/pdf`,
      headers: h(parent),
    });
    expect(queued.statusCode).toBe(201);
    expect(queued.json().exportId).toBeTruthy();
    const status = await inject({
      method: 'GET',
      url: `/fees/mine/exports/${queued.json().exportId}`,
      headers: h(parent),
    });
    expect(status.statusCode).toBe(200);
    expect(['queued', 'running', 'ready']).toContain(status.json().export.status);
    const listing = await inject({ method: 'GET', url: '/reports/exports', headers: h(parent) });
    expect(listing.statusCode).toBe(200);
    expect((listing.json().data as Array<{ id: string }>).map((e) => e.id)).toEqual([
      queued.json().exportId,
    ]);
    const adminExport = await inject({
      method: 'POST',
      url: `/fees/payments/${other.json().paymentId}/receipt`,
      headers: h(accountant),
    });
    expect(adminExport.statusCode).toBe(201);
    const foreign = await inject({
      method: 'GET',
      url: `/fees/mine/exports/${adminExport.json().exportId}`,
      headers: h(parent),
    });
    expect(foreign.statusCode).toBe(404);
  });

  // ---- assistant ---------------------------------------------------------------------------------
  it("the assistant answers from the catalogue with the caller's permissions, in English and Hindi", async () => {
    const refresh = await inject({ method: 'POST', url: '/insights/marts/refresh', headers: h() });
    expect(refresh.statusCode).toBe(201);
    const cat = await inject({
      method: 'GET',
      url: '/insights/assistant/catalogue',
      headers: h(accountant),
    });
    expect(cat.statusCode).toBe(200);
    const entries = cat.json().data as Array<{ id: string; allowed: boolean }>;
    expect(entries.length).toBeGreaterThanOrEqual(30);
    expect(entries.find((e) => e.id === 'fee_defaulters')!.allowed).toBe(true);
    expect(entries.find((e) => e.id === 'lesson_plans_status')!.allowed).toBe(false);

    const ask = await inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: h(accountant),
      json: { question: 'Show me the fee defaulters of class VI above 1000' },
    });
    expect(ask.statusCode).toBe(201);
    const a = ask.json() as {
      refused: boolean;
      citations: Array<{ query: string; params: Record<string, unknown>; rows: number }>;
      answer: string;
      conversationId: string;
      provider: string;
    };
    expect(a.refused).toBe(false);
    expect(a.citations[0]).toMatchObject({
      query: 'fee_defaulters',
      params: { classId, minAmount: 1000 },
    });
    expect(a.citations[0]!.rows).toBeGreaterThan(0);
    expect(a.answer).toContain('fee_defaulters');
    expect(a.provider).toBe('mock');
    // the same list the fees screen shows
    const screen = await inject({
      method: 'GET',
      url: '/insights/departments/fees',
      headers: h(accountant),
    });
    expect(a.citations[0]!.rows).toBe((screen.json().defaulters as unknown[]).length);

    const follow = await inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: h(accountant),
      json: {
        question: 'And the collection by mode in the last 30 days?',
        conversationId: a.conversationId,
      },
    });
    expect(follow.json().conversationId).toBe(a.conversationId);
    expect(follow.json().citations[0].query).toBe('fee_collection_by_mode');
    const conv = await inject({
      method: 'GET',
      url: `/insights/assistant/conversations/${a.conversationId}`,
      headers: h(accountant),
    });
    expect(conv.json().messages).toHaveLength(4);
    expect(conv.json().turns).toBe(2);

    // a coordinator cannot see misc receipts (no fees.misc.view): refused, no leak
    const teacherAsk = await inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: h(teacher),
      json: { question: 'fee defaulters of class VI' },
    });
    // Sprint 15: teachers hold insights.assistant.use; this one has no assignment, so it is unscoped staff
    expect(teacherAsk.statusCode).toBe(201);
    const coordAsk = await inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: h(coordinator),
      json: { question: 'vendor receipts' },
    });
    expect(coordAsk.statusCode).toBe(201);
    expect(coordAsk.json().refused).toBe(true);
    expect(coordAsk.json().citations).toEqual([]);
    const coordOk = await inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: h(coordinator),
      json: { question: 'attendance today by class' },
    });
    expect(coordOk.json().citations[0].query).toBe('attendance_today');

    // Hindi in, Hindi out
    const hindi = await inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: h(accountant),
      json: { question: 'कक्षा VI के शुल्क बकायादार' },
    });
    expect(hindi.json().citations[0].query).toBe('fee_defaulters');
    expect(hindi.json().answer).toMatch(/[ऀ-ॿ]/);

    const parentAsk = await inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: h(parent),
      json: { question: 'fees' },
    });
    expect(parentAsk.statusCode).toBe(403);

    const audit = await inject({
      method: 'GET',
      url: '/insights/assistant/audit?days=1',
      headers: h(),
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().totals.prompts).toBeGreaterThanOrEqual(5);
    expect(audit.json().totals.refusals).toBeGreaterThanOrEqual(1);
    const auditDenied = await inject({
      method: 'GET',
      url: '/insights/assistant/audit',
      headers: h(accountant),
    });
    expect(auditDenied.statusCode).toBe(403);
    const mine = await inject({
      method: 'GET',
      url: '/insights/assistant/conversations',
      headers: h(accountant),
    });
    expect((mine.json().data as unknown[]).length).toBeGreaterThanOrEqual(2);
  });
});
