/**
 * Sprint 16: the shadow run (legacy feed through a service key, dual posting, daily reconciliation,
 * variance workbench), exam results (register sheet, analysis, promotion proposals) and AI reports v1
 * with the cost dashboard.
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

describe('shadow run, exam results and AI reports (e2e, Sprint 16)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let teacher: SeededUser; // class teacher of VI-A (scoped)
  let parent: SeededUser;
  let classId: string;
  let sectionA: string;
  let mat: string;
  let eng: string;
  let examId: string;
  let s: string;
  const students: string[] = [];
  const admissions: string[] = [];
  const h = (u: SeededUser = admin, extra = '') => headersFor(`${u.sub}${extra}`, school.id);

  beforeAll(async () => {
    s = stamp('F16');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      teacher = await seedUser(c, school, `${s}-ct`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'T16CT', 'Teacher', 'Sixteen', $2)`,
        [school.id, teacher.id],
      );
      await c.query(`UPDATE users SET mobile = '9876516000' WHERE id = $1`, [admin.id]);
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
    sectionA = sec.json().id;
    for (const [code, name] of [
      ['MAT', 'Mathematics'],
      ['ENG', 'English'],
    ]) {
      const r = await inject({
        method: 'POST',
        url: '/academics/subjects',
        headers: h(),
        json: { code, name, kind: 'scholastic' },
      });
      if (code === 'MAT') mat = r.json().id;
      else eng = r.json().id;
    }
    for (const [i, first] of ['Asha', 'Bhanu', 'Chirag'].entries()) {
      const adm = `${s}-${i + 1}`;
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: adm,
          firstName: first,
          lastName: 'Sixteen',
          guardians:
            i === 0
              ? [
                  {
                    guardian: { firstName: 'Gita', lastName: 'Sixteen', mobile: '9876516001' },
                    relation: 'mother',
                    isPrimary: true,
                  },
                ]
              : [],
          enrolment: { classSectionId: sectionA, rollNo: i + 1 },
        },
      });
      expect(r.statusCode).toBe(201);
      students.push(r.json().id);
      admissions.push(adm);
    }
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876516001' AND school_id = $2`,
        [parent.id, school.id],
      );
    });
    const emps = (
      await inject({ method: 'GET', url: '/people/employees?size=20', headers: h() })
    ).json().data as Array<{ id: string; employeeCode: string }>;
    const ta = await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(),
      json: {
        employeeId: emps.find((e) => e.employeeCode === 'T16CT')!.id,
        classSectionId: sectionA,
        kind: 'class_teacher',
      },
    });
    expect(ta.statusCode).toBe(201);
    // fees: one head, quarterly periods, ₹2,000 a month, demands for everyone
    const head = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition fee', kind: 'regular', ledger: 'school', sortOrder: 1 },
    });
    expect(head.statusCode).toBe(201);
    expect(
      (
        await inject({
          method: 'POST',
          url: '/fees/periods/generate',
          headers: h(),
          json: { dueDay: 10, monthsPerInstalment: 3 },
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await inject({
          method: 'PUT',
          url: `/fees/structures/${classId}`,
          headers: h(),
          json: {
            feeGroup: 'general',
            entries: [{ headId: head.json().id, amount: 2000, frequency: 'monthly' }],
          },
        })
      ).statusCode,
    ).toBe(200);
    for (const id of students)
      expect(
        (
          await inject({
            method: 'POST',
            url: `/fees/students/${id}/demands/generate`,
            headers: h(),
          })
        ).statusCode,
      ).toBe(201);
    // exams: PT1 for VI with the CBSE scale, two subjects out of 40 (pass 13)
    const type = await inject({
      method: 'POST',
      url: '/exams/types',
      headers: h(),
      json: { code: 'PT1', name: 'Periodic Test 1', weightage: 10 },
    });
    const scale = await inject({
      method: 'PUT',
      url: '/exams/grade-scales',
      headers: h(),
      json: {
        code: 'CBSE8',
        name: 'CBSE eight point',
        bands: [
          { minPct: 91, maxPct: 100, grade: 'A1', points: 10 },
          { minPct: 81, maxPct: 90.99, grade: 'A2', points: 9 },
          { minPct: 71, maxPct: 80.99, grade: 'B1', points: 8 },
          { minPct: 61, maxPct: 70.99, grade: 'B2', points: 7 },
          { minPct: 51, maxPct: 60.99, grade: 'C1', points: 6 },
          { minPct: 41, maxPct: 50.99, grade: 'C2', points: 5 },
          { minPct: 33, maxPct: 40.99, grade: 'D', points: 4 },
          { minPct: 0, maxPct: 32.99, grade: 'E', points: 0 },
        ],
      },
    });
    expect(scale.statusCode).toBe(200);
    const exam = await inject({
      method: 'POST',
      url: '/exams',
      headers: h(),
      json: {
        examTypeId: type.json().id,
        code: 'PT1-2026',
        name: 'Periodic Test 1',
        startsOn: '2026-07-15',
        endsOn: '2026-07-20',
        classes: [{ classId, gradeScaleId: scale.json().id }],
      },
    });
    examId = exam.json().id;
    expect(
      (
        await inject({
          method: 'PUT',
          url: `/exams/${examId}/subjects`,
          headers: h(),
          json: {
            classId,
            subjects: [
              { subjectId: mat, maxMarks: 40, passMarks: 13 },
              { subjectId: eng, maxMarks: 40, passMarks: 13 },
            ],
          },
        })
      ).statusCode,
    ).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  // ---- shadow run --------------------------------------------------------------------------------
  describe('shadow run', () => {
    let key: string;
    const legacy = (
      receipt: string,
      adm: string,
      date: string,
      amount: number,
      mode = 'Cash',
      extra: Record<string, unknown> = {},
    ) => ({
      receipt,
      sadmission: adm,
      sname: 'x',
      sclass: 'VI',
      fees_amount: String(amount),
      ReceiptDate: date,
      PaymentMode: mode,
      FinancialYear: '2026-2027',
      status: 'Active',
      lines: [
        {
          ReceiptNo: receipt,
          TutionFee: String(amount),
          ActualLateFee: '0',
          AdjustedLateFee: '0',
          Discount: '0',
          ReceiptDate: date,
        },
      ],
      ...extra,
    });

    it('issues a service key once and refuses guessed or revoked keys on the ingest route', async () => {
      const created = await inject({
        method: 'POST',
        url: '/platform/service-keys',
        headers: h(),
        json: { name: 'legacy-cron', scopes: ['shadow.feed'] },
      });
      expect(created.statusCode).toBe(201);
      key = created.json().key;
      expect(key).toMatch(/^svc_[0-9a-f]{48}$/);
      const list = await inject({ method: 'GET', url: '/platform/service-keys', headers: h() });
      expect(list.json().data[0]).toMatchObject({
        name: 'legacy-cron',
        scopes: ['shadow.feed'],
        status: 'active',
      });
      expect(list.json().data[0].key).toBeUndefined();
      const guessed = await inject({
        method: 'POST',
        url: '/shadow/feeds/ingest',
        headers: { 'x-service-key': 'svc_' + 'a'.repeat(48) },
        json: {
          kind: 'receipts',
          source: 'guess',
          rows: [legacy('TF9', admissions[0]!, '2026-04-05', 1)],
        },
      });
      expect(guessed.statusCode).toBe(401);
      const none = await inject({
        method: 'POST',
        url: '/shadow/feeds/ingest',
        headers: {},
        json: {
          kind: 'receipts',
          source: 'guess',
          rows: [legacy('TF9', admissions[0]!, '2026-04-05', 1)],
        },
      });
      expect(none.statusCode).toBe(401);
      const staleMfa = await inject({
        method: 'POST',
        url: '/platform/service-keys',
        headers: h(admin, ';mfa=false'),
        json: { name: 'other', scopes: ['shadow.feed'] },
      });
      expect(staleMfa.statusCode).toBe(403);
    });

    it('dual-posts fed legacy receipts through app.post_receipt, idempotently, with the legacy number as reference', async () => {
      const feed = await inject({
        method: 'POST',
        url: '/shadow/feeds/ingest',
        headers: { 'x-service-key': key },
        json: {
          kind: 'receipts',
          source: 'legacy-cron',
          rows: [
            legacy('TF1001', admissions[0]!, '2026-04-05', 6000),
            legacy('TF1002', admissions[1]!, '2026-04-08', 6000, 'Cheque', {
              ChequeNo: 'CHQ16',
              BankName: 'SBI',
              ChequeDate: '2026-04-08',
            }),
          ],
        },
      });
      expect(feed.statusCode).toBe(201);
      expect(feed.json()).toMatchObject({
        kind: 'receipts',
        rows: 2,
        accepted: 2,
        posted: 2,
        skipped: 0,
        rejected: 0,
      });
      const again = await inject({
        method: 'POST',
        url: '/shadow/feeds/ingest',
        headers: { 'x-service-key': key },
        json: {
          kind: 'receipts',
          source: 'legacy-cron',
          rows: [legacy('TF1001', admissions[0]!, '2026-04-05', 6000)],
        },
      });
      expect(again.json()).toMatchObject({ posted: 0, skipped: 1 });
      const ledger = await inject({
        method: 'GET',
        url: `/fees/students/${students[0]}/ledger`,
        headers: h(),
      });
      const pay = ledger.json().payments[0];
      expect(pay).toMatchObject({
        amount: '6000.00',
        reference: 'TF1001',
        mode: 'cash',
        status: 'posted',
      });
      expect(pay.receiptNo).toMatch(/^TF\//);
      expect(ledger.json().instalments[0]).toMatchObject({ balance: '0.00', status: 'paid' });
      const feeds = await inject({ method: 'GET', url: '/shadow/feeds', headers: h(accountant) });
      expect(feeds.json().data[0]).toMatchObject({
        source: 'legacy-cron',
        receivedBy: 'legacy-cron',
      });
      const denied = await inject({ method: 'GET', url: '/shadow/feeds', headers: h(teacher) });
      expect(denied.statusCode).toBe(403);
    });

    it('a cancelled legacy receipt reverses the shadow posting; a staff CSV feed and rejects are recorded', async () => {
      const cancel = await inject({
        method: 'POST',
        url: '/shadow/feeds',
        headers: h(accountant),
        json: {
          kind: 'receipts',
          source: 'upload',
          rows: [
            legacy('TF1002', admissions[1]!, '2026-04-08', 6000, 'Cheque', { status: 'Cancelled' }),
          ],
        },
      });
      expect(cancel.statusCode).toBe(201);
      const ledger = await inject({
        method: 'GET',
        url: `/fees/students/${students[1]}/ledger`,
        headers: h(),
      });
      expect(ledger.json().payments[0]).toMatchObject({ reference: 'TF1002', status: 'reversed' });
      expect(ledger.json().instalments[0]).toMatchObject({ balance: '6000.00' });
      const csv = [
        'receipt,sadmission,ReceiptDate,fees_amount,PaymentMode,FinancialYear,status',
        `TF1003,${admissions[2]},2026-04-09,6000,UPI,2026-2027,Active`,
        `TF1004,NOPE-1,2026-04-09,1500,Cash,2026-2027,Active`,
        `TF1005,${admissions[2]},,100,Cash,2026-2027,Active`,
      ].join('\n');
      const feed = await inject({
        method: 'POST',
        url: '/shadow/feeds',
        headers: h(accountant),
        json: { kind: 'receipts', source: 'upload:apr.csv', fileName: 'apr.csv', csv },
      });
      expect(feed.statusCode).toBe(201);
      expect(feed.json()).toMatchObject({ rows: 3, accepted: 2, posted: 1, rejected: 2 });
      expect(
        (feed.json().rejects as Array<{ reason: string }>).map((r) => r.reason).sort(),
      ).toEqual(['fee_receipt.date_missing', 'shadow.student_unknown']);
    });

    it('the daily reconciliation reports zero for matching days and every kind of variance otherwise', async () => {
      const clean = await inject({
        method: 'POST',
        url: '/shadow/reconcile',
        headers: h(accountant),
        json: { from: '2026-04-01', to: '2026-04-07' },
      });
      expect(clean.statusCode).toBe(201);
      expect(clean.json()).toMatchObject({
        fromDate: '2026-04-01',
        toDate: '2026-04-07',
        legacyReceipts: 1,
        newReceipts: 1,
        matched: 1,
        variances: 0,
        status: 'zero',
      });
      // a counter receipt the legacy system never saw, and a balance snapshot that disagrees
      const counter = await inject({
        method: 'POST',
        url: '/payments/receipts',
        headers: h(),
        json: { studentId: students[1], amount: 500, mode: 'cash', receivedOn: '2026-04-20' },
      });
      expect(counter.statusCode).toBe(201);
      const balances = await inject({
        method: 'POST',
        url: '/shadow/feeds',
        headers: h(accountant),
        json: {
          kind: 'balances',
          source: 'legacy-cron',
          rows: [
            { sadmission: admissions[0], as_of: '2026-04-30', balance: '0' },
            { sadmission: admissions[1], as_of: '2026-04-30', balance: '6000' },
            { sadmission: 'NOPE-2', as_of: '2026-04-30', balance: '10' },
          ],
        },
      });
      expect(balances.json()).toMatchObject({ accepted: 3 });
      const run = await inject({
        method: 'POST',
        url: '/shadow/reconcile',
        headers: h(accountant),
        json: { from: '2026-04-01', to: '2026-04-30' },
      });
      expect(run.statusCode).toBe(201);
      expect(run.json()).toMatchObject({
        status: 'variance',
        legacyReceipts: 3, // TF1001, TF1003 and the unpostable TF1004; the cancelled TF1002 is out
        balancesCompared: 3,
      });
      const v = await inject({
        method: 'GET',
        url: `/shadow/variances?runId=${run.json().id}`,
        headers: h(accountant),
      });
      const kinds = (v.json().data as Array<{ kind: string; ref: string; delta: string }>)
        .map((x) => `${x.kind}:${x.ref}`)
        .sort();
      expect(kinds).toEqual(
        [
          `balance:${admissions[1]}`,
          'balance:NOPE-2',
          'missing_in_legacy:' +
            kinds.find((k) => k.startsWith('missing_in_legacy'))!.split(':')[1],
          'missing_in_new:TF1004',
        ].sort(),
      );
      expect(
        (v.json().data as Array<{ kind: string; delta: string }>).find(
          (x) => x.kind === 'missing_in_new',
        )!.delta,
      ).toBe('1500.00');
      const bal = (
        v.json().data as Array<{ kind: string; ref: string; delta: string; id: string }>
      ).find((x) => x.kind === 'balance' && x.ref === admissions[1]);
      expect(bal!.delta).toBe('500.00'); // legacy 6000 vs new 5500 after the counter receipt
      const explain = await inject({
        method: 'POST',
        url: `/shadow/variances/${bal!.id}`,
        headers: h(accountant),
        json: {
          status: 'explained',
          explanation: 'Counter receipt of 20 April not yet keyed in legacy',
        },
      });
      expect(explain.statusCode).toBe(201);
      const runs = await inject({ method: 'GET', url: '/shadow/runs', headers: h(accountant) });
      const latest = (
        runs.json().data as Array<{ toDate: string; openVariances: number; variances: number }>
      ).find((r) => r.toDate === '2026-04-30')!;
      expect(latest.openVariances).toBe(latest.variances - 1);
      const rerun = await inject({
        method: 'POST',
        url: '/shadow/reconcile',
        headers: h(accountant),
        json: { from: '2026-04-01', to: '2026-04-30' },
      });
      expect(rerun.json().openVariances).toBe(latest.openVariances); // the explanation survives a re-run
      const noExplanation = await inject({
        method: 'POST',
        url: `/shadow/variances/${bal!.id}`,
        headers: h(accountant),
        json: { status: 'resolved' },
      });
      expect(noExplanation.statusCode).toBe(400);
      const teacherRun = await inject({
        method: 'POST',
        url: '/shadow/reconcile',
        headers: h(teacher),
        json: {},
      });
      expect(teacherRun.statusCode).toBe(403);
    });
  });

  // ---- exam results ------------------------------------------------------------------------------
  describe('exam results', () => {
    it('computes results, serves the register sheet with grades and ranks, the analysis and promotion proposals', async () => {
      for (const [subjectId, rows] of [
        [
          mat,
          [
            { studentId: students[0], marks: 36 },
            { studentId: students[1], marks: 10 },
            { studentId: students[2], absent: true },
          ],
        ],
        [
          eng,
          [
            { studentId: students[0], marks: 30 },
            { studentId: students[1], marks: 20 },
            { studentId: students[2], marks: 25 },
          ],
        ],
      ] as const) {
        const put = await inject({
          method: 'PUT',
          url: `/exams/${examId}/marks`,
          headers: h(teacher),
          json: { classSectionId: sectionA, subjectId, rows },
        });
        expect(put.statusCode).toBe(200);
      }
      const compute = await inject({
        method: 'POST',
        url: `/exams/${examId}/results/compute`,
        headers: h(),
      });
      expect(compute.statusCode).toBe(201);
      expect(compute.json()).toEqual({ results: 3 });
      const sheet = await inject({
        method: 'GET',
        url: `/exams/${examId}/register-sheet?classSectionId=${sectionA}`,
        headers: h(teacher),
      });
      expect(sheet.statusCode).toBe(200);
      expect(sheet.json().subjects.map((x: { code: string }) => x.code)).toEqual(['ENG', 'MAT']);
      const rows = sheet.json().rows as Array<Record<string, unknown>>;
      expect(rows[0]).toMatchObject({
        name: 'Asha Sixteen',
        total: '66.00',
        maxTotal: '80.00',
        pct: '82.50',
        grade: 'A2',
        result: 'pass',
        rankInSection: 1,
        failedSubjects: 0,
      });
      expect(rows[1]).toMatchObject({
        total: '30.00',
        pct: '37.50',
        grade: 'D',
        result: 'fail',
        rankInSection: 2,
        failedSubjects: 1,
      });
      expect(rows[2]).toMatchObject({
        total: '25.00',
        pct: '31.25',
        grade: 'E',
        result: 'fail',
        rankInSection: 3,
        failedSubjects: 1,
      });
      const analysis = await inject({
        method: 'GET',
        url: `/exams/${examId}/analysis`,
        headers: h(),
      });
      expect(analysis.statusCode).toBe(200);
      expect(analysis.json().totals).toMatchObject({
        pupils: 3,
        complete: 3,
        pass: 1,
        fail: 2,
        incomplete: 0,
        passPct: 33.3,
      });
      const matRow = (analysis.json().subjects as Array<Record<string, unknown>>).find(
        (x) => x.code === 'MAT',
      )!;
      expect(matRow).toMatchObject({
        pupils: 3,
        entered: 2,
        absent: 1,
        mean: '23.00',
        highest: '36.00',
        lowest: '10.00',
        passPct: 33.3,
      });
      expect(analysis.json().grades).toEqual([
        { grade: 'A2', pupils: 1 },
        { grade: 'D', pupils: 1 },
        { grade: 'E', pupils: 1 },
      ]);
      expect(analysis.json().toppers[0]).toMatchObject({ name: 'Asha Sixteen', pct: '82.50' });
      const strict = await inject({
        method: 'GET',
        url: `/exams/${examId}/promotion-proposals?classId=${classId}`,
        headers: h(),
      });
      expect(strict.statusCode).toBe(200);
      expect(strict.json().totals).toEqual({ promote: 1, retain: 2, review: 0 });
      const lenient = await inject({
        method: 'GET',
        url: `/exams/${examId}/promotion-proposals?classId=${classId}&maxFailed=1&minPct=30`,
        headers: h(),
      });
      expect(lenient.json().totals).toEqual({ promote: 3, retain: 0, review: 0 });
      expect((lenient.json().proposals as Array<{ reason: string }>)[1]!.reason).toContain(
        'within the allowance',
      );
      const teacherProposals = await inject({
        method: 'GET',
        url: `/exams/${examId}/promotion-proposals`,
        headers: h(teacher),
      });
      expect(teacherProposals.statusCode).toBe(403);
      const parentSheet = await inject({
        method: 'GET',
        url: `/exams/${examId}/register-sheet?classSectionId=${sectionA}`,
        headers: h(parent),
      });
      expect(parentSheet.statusCode).toBe(403);
    });
  });

  // ---- AI reports and costs ----------------------------------------------------------------------
  describe('AI reports v1', () => {
    it('writes the Monday brief from cited facts, queues its PDF and lists it; the cost dashboard adds up', async () => {
      const refresh = await inject({
        method: 'POST',
        url: '/insights/marts/refresh',
        headers: h(),
      });
      expect(refresh.statusCode).toBe(201);
      const run = await inject({
        method: 'POST',
        url: '/insights/reports/run',
        headers: h(),
        json: { kind: 'principal_brief', periodTo: '2026-04-30' },
      });
      expect(run.statusCode).toBe(201);
      const rep = run.json() as {
        id: string;
        narrative: string;
        citations: string[];
        facts: unknown[];
        exportId: string | null;
        exportStatus: string | null;
        provider: string;
        periodFrom: string;
      };
      expect(rep.periodFrom).toBe('2026-04-24');
      expect(rep.provider).toBe('mock');
      expect(rep.narrative).toContain('[fees.collected]');
      expect(rep.narrative).toContain('[attendance.pct]');
      expect(rep.citations).toEqual(
        expect.arrayContaining(['fees.collected', 'attendance.pct', 'school.open_alerts']),
      );
      expect(rep.facts.length).toBeGreaterThanOrEqual(12);
      expect(rep.exportId).toBeTruthy();
      expect(rep.exportStatus).toBe('queued');
      const fees = await inject({
        method: 'POST',
        url: '/insights/reports/run',
        headers: h(),
        json: {
          kind: 'department_weekly',
          department: 'fees',
          periodTo: '2026-04-30',
          language: 'hi',
        },
      });
      expect(fees.statusCode).toBe(201);
      expect(fees.json().title).toBe('शुल्क साप्ताहिक');
      expect(fees.json().narrative).toMatch(/[ऀ-ॿ]/);
      const bad = await inject({
        method: 'POST',
        url: '/insights/reports/run',
        headers: h(),
        json: { kind: 'department_weekly', periodTo: '2026-04-30' },
      });
      expect(bad.statusCode).toBe(400);
      const list = await inject({
        method: 'GET',
        url: '/insights/reports',
        headers: h(accountant),
      });
      expect(list.statusCode).toBe(200);
      expect((list.json().data as Array<{ kind: string }>).map((r) => r.kind).sort()).toEqual([
        'department_weekly',
        'principal_brief',
      ]);
      const one = await inject({ method: 'GET', url: `/insights/reports/${rep.id}`, headers: h() });
      expect(one.json().facts.length).toBe(rep.facts.length);
      const teacherRun = await inject({
        method: 'POST',
        url: '/insights/reports/run',
        headers: h(teacher),
        json: { kind: 'principal_brief' },
      });
      expect(teacherRun.statusCode).toBe(403);
      // an assistant question so the cost dashboard has a prompt
      const ask = await inject({
        method: 'POST',
        url: '/insights/assistant',
        headers: h(),
        json: { question: 'attendance today by class' },
      });
      expect(ask.statusCode).toBe(201);
      const costs = await inject({
        method: 'GET',
        url: '/insights/assistant/costs?days=1',
        headers: h(),
      });
      expect(costs.statusCode).toBe(200);
      expect(costs.json().totals.prompts).toBeGreaterThanOrEqual(1);
      expect(costs.json().bySurface[0]).toMatchObject({ surface: 'admin' });
      expect(costs.json().reports.count).toBe(2);
      expect(costs.json().budget.perUserDailyTokens).toBeGreaterThan(0);
      const denied = await inject({
        method: 'GET',
        url: '/insights/assistant/costs',
        headers: h(accountant),
      });
      expect(denied.statusCode).toBe(403);
    });
  });
});
