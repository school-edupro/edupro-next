/**
 * Withdrawal through configured departments (2026-10-01): approvers by role, class teacher and the
 * office; automatic library check; TC gated on the fees department; bulk start, bulk clear and bulk TC
 * (Class XII year end); cancel guarded by the TC; a parent's login revoked only when no other child
 * studies here.
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

interface Clearance {
  department: string;
  status: string;
  step: number;
  auto: boolean;
  bypassed: boolean;
  canAct?: boolean;
  check: { kind: string; due: number; detail: string } | null;
}
interface Withdrawal {
  id: string;
  status: string;
  currentStep: number | null;
  canIssueTc: boolean;
  tc: { id: string; tcNo: string } | null;
  clearances: Clearance[];
}

describe('withdrawal through configured departments (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  let s: string;
  let sectionId: string;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const dept = (w: Withdrawal, d: string) => w.clearances.find((x) => x.department === d)!;

  beforeAll(async () => {
    s = stamp('WD');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-accounts`, 'accountant');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'WT1', 'Tanvi', 'Teacher', $2)`,
        [school.id, teacher.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    await inject({ method: 'POST', url: '/platform/templates/defaults', headers: h() });
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'XII', name: 'Class XII', displayOrder: 12 },
    });
    sectionId = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'A' },
      })
    ).json().id;
    const emp = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE school_id = $1 AND employee_code = 'WT1'`,
        [school.id],
      ),
    );
    await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(),
      json: { employeeId: emp.rows[0]!.id, classSectionId: sectionId, kind: 'class_teacher' },
    });
    for (const [key, first] of [
      ['a', 'Aditi'],
      ['b', 'Bharat'],
      ['c', 'Chetan'],
      ['d', 'Divya'],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `${s}-${key}`,
          firstName: first,
          lastName: 'Twelve',
          enrolment: { classSectionId: sectionId, rollNo: Object.keys(ids).length + 1 },
        },
      });
      expect(r.statusCode).toBe(201);
      ids[key] = r.json().id;
    }
    // the parent of Aditi and Bharat (one guardian, two children)
    await withMigrator(async (c) => {
      const g = await c.query<{ id: string }>(
        `INSERT INTO guardians (school_id, first_name, last_name, user_id) VALUES ($1, 'Pooja', 'Twelve', $2) RETURNING id::text`,
        [school.id, parent.id],
      );
      for (const k of ['a', 'b'])
        await c.query(
          `INSERT INTO student_guardians (school_id, student_id, guardian_id, relation, is_primary) VALUES ($1, $2, $3, 'mother', true)`,
          [school.id, ids[k], g.rows[0]!.id],
        );
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('starts with the default departments and saves the school’s own', async () => {
    const r = await inject({ method: 'GET', url: '/people/withdrawal-departments', headers: h() });
    expect(r.statusCode).toBe(200);
    const deps = r.json().departments as Array<Record<string, unknown>>;
    expect(deps.map((d) => `${String(d.step)}:${String(d.code)}`)).toEqual([
      '1:fees',
      '1:library',
      '1:transport',
      '2:class_teacher',
      '3:principal',
    ]);
    // the school drops transport and makes the principal's step need a document
    const next = deps
      .filter((d) => d.code !== 'transport')
      .map((d) => ({
        code: d.code,
        name: d.name,
        step: d.step,
        approvers: d.approvers,
        autoCheck: d.autoCheck,
        autoClear: d.autoClear,
        bypassAllowed: d.bypassAllowed,
        documentRequired: d.code === 'principal',
        gatesTc: d.gatesTc,
        active: true,
      }));
    const saved = await inject({
      method: 'PUT',
      url: '/people/withdrawal-departments',
      headers: h(),
      json: { departments: next },
    });
    expect(saved.statusCode).toBe(200);
    expect(
      saved
        .json()
        .filter((d: { active: boolean }) => d.active)
        .map((d: { code: string }) => d.code),
    ).toEqual(['fees', 'library', 'class_teacher', 'principal']);
    const refused = await inject({
      method: 'PUT',
      url: '/people/withdrawal-departments',
      headers: h(accountant),
      json: { departments: next },
    });
    expect(refused.statusCode).toBe(403);
  });

  it('a book out keeps the library waiting; approvers act only on their own department and step', async () => {
    await withMigrator(async (c) => {
      const t = await c.query<{ id: string }>(
        `INSERT INTO library_titles (school_id, code, title) VALUES ($1, $2, 'Physics Part 1') RETURNING id::text`,
        [school.id, `${s}-T1`],
      );
      const cp = await c.query<{ id: string }>(
        `INSERT INTO library_copies (school_id, title_id, accession_no, status) VALUES ($1, $2, $3, 'issued') RETURNING id::text`,
        [school.id, t.rows[0]!.id, `${s}-ACC1`],
      );
      await c.query(
        `INSERT INTO library_loans (school_id, copy_id, borrower_kind, borrower_id, due_on) VALUES ($1, $2, 'student', $3, CURRENT_DATE + 7)`,
        [school.id, cp.rows[0]!.id, ids.a],
      );
    });
    const r = await inject({
      method: 'POST',
      url: `/people/students/${ids.a}/withdrawal`,
      headers: h(),
      json: {
        initiatedOn: '2027-03-20',
        leavingOn: '2027-03-31',
        reason: 'Passed out (Class XII)',
      },
    });
    expect(r.statusCode).toBe(201);
    const w = r.json() as Withdrawal;
    ids.wa = w.id;
    expect(dept(w, 'fees')).toMatchObject({ status: 'cleared', auto: true });
    expect(dept(w, 'library')).toMatchObject({ status: 'pending', auto: false });
    expect(dept(w, 'library').check).toMatchObject({ kind: 'library', due: 1 });
    expect(w.currentStep).toBe(1);
    // the fees department has cleared, so the TC may be issued already
    expect(w.canIssueTc).toBe(true);

    const teacherEarly = await inject({
      method: 'PUT',
      url: `/people/withdrawals/${w.id}/clearances/class_teacher`,
      headers: h(teacher),
      json: { status: 'cleared' },
    });
    expect(teacherEarly.statusCode).toBe(409);
    const accountantLibrary = await inject({
      method: 'PUT',
      url: `/people/withdrawals/${w.id}/clearances/library`,
      headers: h(accountant),
      json: { status: 'cleared' },
    });
    expect(accountantLibrary.statusCode).toBe(403);
    const lib = await inject({
      method: 'PUT',
      url: `/people/withdrawals/${w.id}/clearances/library`,
      headers: h(),
      json: { status: 'cleared', remarks: 'book returned at the counter' },
    });
    expect((lib.json() as Withdrawal).currentStep).toBe(2);
    const mine = await inject({
      method: 'GET',
      url: '/people/withdrawals?mine=true',
      headers: h(teacher),
    });
    expect(mine.json().data.map((x: { id: string }) => x.id)).toContain(w.id);
    const ct = await inject({
      method: 'PUT',
      url: `/people/withdrawals/${w.id}/clearances/class_teacher`,
      headers: h(teacher),
      json: { status: 'cleared' },
    });
    expect(ct.statusCode).toBe(200);
    expect((ct.json() as Withdrawal).currentStep).toBe(3);
    const noDoc = await inject({
      method: 'PUT',
      url: `/people/withdrawals/${w.id}/clearances/principal`,
      headers: h(),
      json: { status: 'cleared' },
    });
    expect(noDoc.statusCode).toBe(400);
    expect(noDoc.json()).toMatchObject({ type: 'withdrawal.document_required' });
  });

  it('issues the TC from the withdrawal, keeps the student active until completion, and guards cancel', async () => {
    const tc = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/tc`,
      headers: h(),
      json: { promotionStatus: 'Passed Class XII' },
    });
    expect(tc.statusCode).toBe(201);
    expect((tc.json() as Withdrawal).tc?.tcNo).toMatch(/^TC\//);
    const student = await inject({ method: 'GET', url: `/people/students/${ids.a}`, headers: h() });
    expect(student.json().status).toBe('active');
    const again = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/tc`,
      headers: h(),
      json: {},
    });
    expect(again.statusCode).toBe(409);
    const cancel = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/cancel`,
      headers: h(),
      json: { reason: 'changed mind' },
    });
    expect(cancel.statusCode).toBe(409);
    expect(cancel.json()).toMatchObject({ type: 'withdrawal.tc_issued' });
  });

  it('bulk: starts the class, clears one department for many, issues the TCs together', async () => {
    const bulk = await inject({
      method: 'POST',
      url: '/people/withdrawals/bulk',
      headers: h(),
      json: {
        studentIds: [ids.b, ids.c, ids.d, ids.a],
        leavingOn: '2027-03-31',
        reason: 'Passed out (Class XII)',
      },
    });
    expect(bulk.statusCode).toBe(201);
    expect(bulk.json()).toMatchObject({ started: 3, failed: 1 });
    const started = (bulk.json().results as Array<{ ok: boolean; id?: string }>)
      .filter((r) => r.ok)
      .map((r) => r.id!);
    // fees and library cleared by themselves; the class teacher clears all three at once
    const clear = await inject({
      method: 'POST',
      url: '/people/withdrawals/clearances/bulk',
      headers: h(teacher),
      json: { withdrawalIds: started, department: 'class_teacher', status: 'cleared' },
    });
    expect(clear.json()).toMatchObject({ done: 3, failed: 0 });
    // the principal's step needs a document: a bulk clear without one is refused, with one it clears
    const noDoc = await inject({
      method: 'POST',
      url: '/people/withdrawals/clearances/bulk',
      headers: h(),
      json: { withdrawalIds: started, department: 'principal', status: 'cleared' },
    });
    expect(noDoc.json()).toMatchObject({ done: 0, failed: 3 });
    const reg = await inject({
      method: 'POST',
      url: '/platform/files',
      headers: h(),
      json: {
        fileName: 'no-dues.pdf',
        contentType: 'application/pdf',
        sizeBytes: 9,
        classification: 'personal',
      },
    });
    await inject({
      method: 'PUT',
      url: reg.json().upload.url,
      headers: {},
      raw: { body: Buffer.from('%PDF-1.4\n'), contentType: 'application/pdf' },
    });
    const withDoc = await inject({
      method: 'POST',
      url: '/people/withdrawals/clearances/bulk',
      headers: h(),
      json: {
        withdrawalIds: started,
        department: 'principal',
        status: 'cleared',
        documents: [{ fileId: reg.json().file.id }],
      },
    });
    expect(withDoc.json()).toMatchObject({ done: 3, failed: 0 });
    const tcs = await inject({
      method: 'POST',
      url: '/people/withdrawals/tc/bulk',
      headers: h(),
      json: { withdrawalIds: [...started, ids.wa], promotionStatus: 'Passed Class XII' },
    });
    expect(tcs.statusCode).toBe(201);
    expect(tcs.json()).toMatchObject({ done: 3, failed: 1 });
    ids.wb = started[0]!;
  });

  it('completion revokes the student’s login and a parent’s only when no other child studies here', async () => {
    // Bharat (b) completes first: his mother still has Aditi (a) studying, so she keeps her login
    const doc = async () => {
      const reg = await inject({
        method: 'POST',
        url: '/platform/files',
        headers: h(),
        json: {
          fileName: 'approval.pdf',
          contentType: 'application/pdf',
          sizeBytes: 9,
          classification: 'personal',
        },
      });
      await inject({
        method: 'PUT',
        url: reg.json().upload.url,
        headers: {},
        raw: { body: Buffer.from('%PDF-1.4\n'), contentType: 'application/pdf' },
      });
      return reg.json().file.id as string;
    };
    const finish = async (id: string) => {
      const p = await inject({
        method: 'PUT',
        url: `/people/withdrawals/${id}/clearances/principal`,
        headers: h(),
        json: { status: 'cleared', documents: [{ fileId: await doc() }] },
      });
      expect(p.json().status).toBe('cleared');
      const done = await inject({
        method: 'POST',
        url: `/people/withdrawals/${id}/complete`,
        headers: h(),
      });
      expect(done.statusCode).toBe(201);
    };
    const membership = async () =>
      (
        await withMigrator((c) =>
          c.query<{ status: string }>(
            `SELECT status::text FROM user_school_memberships WHERE user_id = $1 AND school_id = $2 AND person_type = 'guardian'`,
            [parent.id, school.id],
          ),
        )
      ).rows[0]!.status;
    await finish(ids.wb!);
    expect(await membership()).toBe('active');
    // Aditi has paid nine months; she leaves before that: the rest is not asked and the excess comes back
    // she leaves in August (the withdrawal was started with a later date)
    await withMigrator((c) =>
      c.query(`UPDATE student_withdrawals SET leaving_on = '2026-08-15' WHERE id = $1`, [ids.wa]),
    );
    const facts = await withMigrator(async (c) => {
      const r = await c.query<{ class_id: string; leaving_on: string }>(
        `SELECT cs.class_id::text, w.leaving_on::text FROM student_withdrawals w, class_sections cs WHERE w.id = $1 AND cs.id = $2`,
        [ids.wa, sectionId],
      );
      return r.rows[0]!;
    });
    const head = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition fee', sortOrder: 1 },
    });
    await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 1 },
    });
    await inject({
      method: 'PUT',
      url: `/fees/structures/${facts.class_id}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: [{ headId: head.json().id, amount: 1000, frequency: 'monthly' }],
      },
    });
    const gen = await inject({
      method: 'POST',
      url: `/fees/students/${ids.a}/demands/generate`,
      headers: h(),
    });
    expect(gen.statusCode).toBe(201);
    const pay = await inject({
      method: 'POST',
      url: '/payments/receipts',
      headers: h(accountant),
      json: { studentId: ids.a, amount: 9000, mode: 'cash', collectLateFee: false },
    });
    expect(pay.statusCode).toBe(201);
    const later = async () =>
      (
        await withMigrator((c) =>
          c.query<{ months: string; unpaid: string; paid: string }>(
            `SELECT count(*)::text AS months, COALESCE(sum(d.net - d.paid), 0)::text AS unpaid, COALESCE(sum(d.paid), 0)::text AS paid
               FROM fee_demands d JOIN fee_periods fp ON fp.id = d.period_id
              WHERE d.student_id = $1 AND make_date(fp.year, fp.month, 1) > date_trunc('month', $2::date)
                AND d.status IN ('pending', 'partial', 'paid')`,
            [ids.a, facts.leaving_on],
          ),
        )
      ).rows[0]!;
    const before = await later();
    // September to December were paid (4,000); January to March were not (3,000)
    expect(before).toMatchObject({ unpaid: '3000.00', paid: '4000.00' });
    await finish(ids.wa!);
    // the months after the leaving month: nothing is asked any more
    const after = await later();
    expect(Number(after.unpaid)).toBe(0);
    // nothing is refunded yet: the accounts office prints the provisional bill and meets the parent first
    const listRefunds = async () =>
      (
        await inject({
          method: 'GET',
          url: `/payments/refunds?studentId=${ids.a}`,
          headers: h(),
        })
      ).json().data as Array<{
        id: string;
        status: string;
        amount: string;
        feeAction: string;
        reason: string;
      }>;
    expect(await listRefunds()).toHaveLength(0);
    const draft = await inject({ method: 'GET', url: `/fees/students/${ids.a}/fnf`, headers: h() });
    expect(draft.json().totals).toMatchObject({ refundable: '4000.00', direction: 'refund' });
    expect(draft.json()).toMatchObject({ refundsWaiting: '0.00' });
    // then the accountant sends it for approval
    const sent = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/fee-settlement`,
      headers: h(accountant),
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({ replaced: 0, refunds: 1, refundTotal: '4000.00' });
    const refunds = await listRefunds();
    if (Number(before.paid) > 0) {
      expect(refunds).toHaveLength(1);
      expect(refunds[0]).toMatchObject({ status: 'requested', feeAction: 'cancel' });
      expect(Number(refunds[0]!.amount)).toBe(Number(before.paid));
      expect(refunds[0]!.reason).toContain('Withdrawal');
      // a waiting refund of the withdrawal can be worked out again: the old one is closed, a new one raised
      const again = await inject({
        method: 'POST',
        url: `/people/withdrawals/${ids.wa}/fee-settlement`,
        headers: h(),
      });
      expect(again.statusCode).toBe(201);
      expect(again.json()).toMatchObject({ replaced: 1, refunds: 1, refundTotal: '4000.00' });
      const fresh = (
        (
          await inject({
            method: 'GET',
            url: `/payments/refunds?studentId=${ids.a}&status=requested`,
            headers: h(),
          })
        ).json().data as Array<{ id: string }>
      )[0]!;
      expect(fresh.id).not.toBe(refunds[0]!.id);
      const bill = await inject({
        method: 'GET',
        url: `/fees/students/${ids.a}/fnf`,
        headers: h(),
      });
      // the bill is worked out up to the leaving month by itself and lists the refund and the receipt
      expect(bill.json().lastMonth.name).toContain('August');
      expect(bill.json()).toMatchObject({ refundsWaiting: '4000.00', refundable: [] });
      expect(bill.json().receipts).toHaveLength(1);
      const ok = await inject({
        method: 'POST',
        url: `/payments/refunds/${fresh.id}/decide`,
        headers: h(),
        json: { outcome: 'approved' },
      });
      expect(ok.statusCode).toBe(201);
      expect(ok.json()).toMatchObject({ status: 'paid' });
      expect(ok.json().voucherNo).toMatch(/^RF\//);
      expect(Number((await later()).paid)).toBe(0);
    } else {
      expect(refunds).toHaveLength(0);
    }
    // portal after leaving (90 days unless the school says otherwise): the login stays, but the full
    // parent role is set aside for the school's "Former parent" role
    expect(await membership()).toBe('active');
    const roles = await withMigrator((c) =>
      c.query<{ code: string; live: boolean; days: number | null }>(
        `SELECT r.code, ur.revoked_at IS NULL AS live, (ur.valid_to - CURRENT_DATE)::int AS days
           FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1 AND ur.school_id = $2 ORDER BY r.code`,
        [parent.id, school.id],
      ),
    );
    expect(roles.rows).toEqual([
      { code: 'former_parent', live: true, days: 90 },
      { code: 'parent', live: false, days: null },
    ]);
    // fees still open to the parent, attendance not
    const fees = await inject({ method: 'GET', url: '/fees/mine', headers: h(parent) });
    expect(fees.statusCode).toBe(200);
    const att = await inject({ method: 'GET', url: '/attendance/leaves/mine', headers: h(parent) });
    expect(att.statusCode).toBe(403);
    const student = await inject({ method: 'GET', url: `/people/students/${ids.a}`, headers: h() });
    expect(student.json().status).toBe('inactive');
    // the days are the school's to set; the two roles are ordinary school roles it can edit
    const bad = await inject({
      method: 'PUT',
      url: '/people/withdrawal-portal-access',
      headers: h(),
      json: { days: -1 },
    });
    expect(bad.statusCode).toBe(400);
    const set = await inject({
      method: 'PUT',
      url: '/people/withdrawal-portal-access',
      headers: h(),
      json: { days: 30 },
    });
    expect(set.statusCode).toBe(200);
    const got = await inject({
      method: 'GET',
      url: '/people/withdrawal-portal-access',
      headers: h(),
    });
    expect(got.json()).toMatchObject({ days: 30 });
    expect(got.json().parentRoleId).toBeTruthy();
  });

  it('a completed withdrawal is revoked: the pupil is back, logins return, every month is due again', async () => {
    const short = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/revoke`,
      headers: h(),
      json: { reason: 'x' },
    });
    expect(short.statusCode).toBe(400);
    const denied = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/revoke`,
      headers: h(teacher),
      json: { reason: 'Family decided to stay' },
    });
    expect(denied.statusCode).toBe(403);
    // a transfer certificate was issued: it has to be cancelled first
    const blocked = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/revoke`,
      headers: h(),
      json: { reason: 'Family decided to stay' },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().type).toBe('withdrawal.tc_issued');
    const tcId = await withMigrator(async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT tc_id::text AS id FROM student_withdrawals WHERE id = $1`,
        [ids.wa],
      );
      return r.rows[0]!.id;
    });
    const tcGone = await inject({
      method: 'POST',
      url: `/people/tc/${tcId}/cancel`,
      headers: h(),
      json: { reason: 'Pupil is staying' },
    });
    expect([200, 201]).toContain(tcGone.statusCode);
    // no approval levels in this school: the revoke is applied at once
    const ok = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/revoke`,
      headers: h(),
      json: { reason: 'Family decided to stay' },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ status: 'revoked', revokeStatus: 'approved' });
    const student = await inject({ method: 'GET', url: `/people/students/${ids.a}`, headers: h() });
    expect(student.json().status).toBe('active');
    const facts = await withMigrator(async (c) => {
      const e = await c.query<{ status: string; ended_on: string | null }>(
        `SELECT status::text, ended_on::text FROM enrolments WHERE student_id = $1`,
        [ids.a],
      );
      const m = await c.query<{ status: string }>(
        `SELECT status::text FROM user_school_memberships WHERE user_id = $1 AND school_id = $2 AND person_type = 'guardian'`,
        [parent.id, school.id],
      );
      const d = await c.query<{ months: string; net: string; paid: string }>(
        `SELECT count(DISTINCT period_id)::text AS months, sum(net)::text AS net, sum(paid)::text AS paid
           FROM fee_demands WHERE student_id = $1 AND status IN ('pending', 'partial', 'paid')`,
        [ids.a],
      );
      return { enrolment: e.rows[0]!, parent: m.rows[0]!.status, fee: d.rows[0]! };
    });
    expect(facts.enrolment).toMatchObject({ status: 'active', ended_on: null });
    expect(facts.parent).toBe('active');
    // the full parent role is back and the former one has ended
    const back = await withMigrator((c) =>
      c.query<{ code: string }>(
        `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = $1 AND ur.school_id = $2 AND ur.revoked_at IS NULL`,
        [parent.id, school.id],
      ),
    );
    expect(back.rows.map((r) => r.code)).toEqual(['parent']);
    // twelve months at 1,000 again; 9,000 was paid and 4,000 of it refunded, so 5,000 stays paid
    expect(facts.fee).toMatchObject({ months: '12', net: '12000.00', paid: '5000.00' });
    const again = await inject({
      method: 'POST',
      url: `/people/withdrawals/${ids.wa}/revoke`,
      headers: h(),
      json: { reason: 'again' },
    });
    expect(again.statusCode).toBe(409);
  });
});
