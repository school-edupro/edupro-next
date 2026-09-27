/**
 * Sprint 9: the whole admission journey (apply → shortlist → draw → L1/L2 approvals on the workflow engine →
 * offer → admission fee through payments v0 with a signed, idempotent webhook → admission with number,
 * student, guardian and enrolment), plus payment replay and tamper tests and offline fee allocation.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import IORedis from 'ioredis';
import { PowService } from '../src/modules/admissions/public/pow.service';
import { mockResponse, responseHash } from '../src/modules/payments/payu';
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

describe('admission to enrolment (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let coordinator: SeededUser;
  let accountant: SeededUser;
  let planYear: string;
  let classI: string;
  let cycleId: string;
  const applicants: Array<{ mobile: string; token: string; applicationId: string }> = [];
  const h = () => headersFor(admin.sub, school.id);

  const signIn = async (mobile: string) => {
    const ch = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
    const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
    const otp = await inject({
      method: 'POST',
      url: '/public/admissions/otp',
      headers: {},
      json: { schoolCode: school.code, mobile, challenge: ch.json().challenge, nonce },
    });
    const ok = await inject({
      method: 'POST',
      url: '/public/admissions/otp/verify',
      headers: {},
      json: {
        schoolCode: school.code,
        mobile,
        code: otp.json().devCode,
        name: `Parent ${mobile.slice(-2)}`,
      },
    });
    return ok.json().token as string;
  };

  beforeAll(async () => {
    process.env.PUBLIC_POW_DIFFICULTY = '1';
    process.env.PAYU_MODE = 'mock';
    const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
    });
    await redis.connect();
    const keys = await redis.keys('edupro:throttle:*');
    if (keys.length) await redis.del(...keys);
    redis.disconnect();
    const s = stamp('A9');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      coordinator = await seedUser(c, school, `${s}-coord`, 'academic_coordinator');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      const y = await c.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status) VALUES ($1, '2027-28', 'Session 2027-28', '2027-04-01', '2028-03-31', 'planned') RETURNING id::text`,
        [school.id],
      );
      planYear = y.rows[0]!.id;
      await c.query(
        `INSERT INTO school_settings (school_id, key, value) VALUES ($1, 'admissions.admission_fee', '2500'::jsonb)`,
        [school.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const c1 = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'I', name: 'Class I', displayOrder: 1 },
    });
    classI = c1.json().id;
    await withMigrator((c) =>
      c.query(
        `INSERT INTO class_sections (school_id, academic_year_id, class_id, name, capacity) VALUES ($1, $2, $3, 'A', 2)`,
        [school.id, planYear, classI],
      ),
    );
    await inject({ method: 'POST', url: '/workflow/definitions/defaults', headers: h() });
    const cycle = await inject({
      method: 'POST',
      url: '/admissions/cycles',
      headers: h(),
      json: {
        academicYearId: planYear,
        code: 'ADM-2027',
        name: 'Admissions 2027-28',
        opensAt: new Date(Date.now() - 86_400_000).toISOString(),
        closesAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        criteria: [{ classId: classI, seats: 2, dobFrom: '2020-04-01', dobTo: '2021-03-31' }],
        scoreCriteria: [
          { code: 'distance', name: 'Within 5 km', points: 15, autoRule: 'distance_within:5' },
          { code: 'alumni', name: 'Alumni', points: 10, autoRule: 'alumni' },
        ],
      },
    });
    cycleId = cycle.json().id;
    await inject({
      method: 'PATCH',
      url: `/admissions/cycles/${cycleId}`,
      headers: h(),
      json: { status: 'open' },
    });
    for (const [i, mobile] of ['9822200001', '9822200002', '9822200003', '9822200004'].entries()) {
      const token = await signIn(mobile);
      const res = await inject({
        method: 'POST',
        url: '/public/admissions/applications',
        headers: { authorization: `Bearer ${token}` },
        json: {
          cycleId,
          classId: classI,
          childFirstName: `Child${i + 1}`,
          childLastName: 'Nine',
          childDob: '2020-08-01',
          data: {
            fatherName: `Father ${i + 1}`,
            motherName: `Mother ${i + 1}`,
            email: `p${i + 1}@example.test`,
            address: 'x',
            city: 'Pune',
            pin: '411001',
            category: 'GEN',
            distanceKm: i < 3 ? 2 : 9,
            alumniParent: i === 0,
          },
          submit: true,
        },
      });
      expect(res.statusCode).toBe(201);
      applicants.push({ mobile, token, applicationId: res.json().id });
    }
  });

  afterAll(async () => {
    if (app && cycleId)
      await inject({
        method: 'PATCH',
        url: `/admissions/cycles/${cycleId}`,
        headers: h(),
        json: { status: 'closed' },
      });
    if (app) await app.close();
  });

  it('shortlists by score and draws for the seats left with a recorded seed', async () => {
    const short = await inject({
      method: 'POST',
      url: `/admissions/cycles/${cycleId}/shortlist`,
      headers: h(),
      json: { classId: classI, minScore: 15 },
    });
    expect(short.statusCode).toBe(201);
    expect(short.json()).toEqual({ shortlisted: 3 });
    const draw = await inject({
      method: 'POST',
      url: `/admissions/cycles/${cycleId}/draw`,
      headers: h(),
      json: { classId: classI, seed: 'demo-seed' },
    });
    expect(draw.statusCode).toBe(201);
    expect(draw.json()).toMatchObject({ seed: 'demo-seed', candidates: 3, seats: 2 });
    expect(draw.json().picked).toHaveLength(2);
    const again = await inject({
      method: 'POST',
      url: `/admissions/cycles/${cycleId}/draw`,
      headers: h(),
      json: { classId: classI, seed: 'demo-seed', seats: 2 },
    });
    expect([...again.json().picked].sort()).toEqual([...draw.json().picked].sort()); // the pool is now the two shortlisted; the seed keeps them
    const list = await inject({
      method: 'GET',
      url: `/admissions/applications?cycleId=${cycleId}&status=waitlisted`,
      headers: h(),
    });
    expect(list.json().page.total).toBe(1);
  });

  it('runs the L1/L2 approval on the workflow engine and issues offers with a fee intent', async () => {
    const started = await inject({
      method: 'POST',
      url: `/admissions/cycles/${cycleId}/request-approvals`,
      headers: h(),
      json: {},
    });
    expect(started.json()).toEqual({ started: 2 });
    const adminInbox = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    expect(adminInbox.json().data).toEqual([]); // level 1 belongs to the coordinator
    const inbox = await inject({
      method: 'GET',
      url: '/workflow/inbox',
      headers: headersFor(coordinator.sub, school.id),
    });
    expect(inbox.json().data).toHaveLength(2);
    expect(inbox.json().data[0]).toMatchObject({ level: 1, name: 'Academic Coordinator review' });
    const wrongUser = await inject({
      method: 'POST',
      url: `/workflow/steps/${inbox.json().data[0].id}/approve`,
      headers: h(),
      json: {},
    });
    expect(wrongUser.statusCode).toBe(403);
    expect(wrongUser.json()).toMatchObject({ type: 'workflow.not_assignee' });
    for (const step of inbox.json().data as Array<{ id: string }>) {
      const r = await inject({
        method: 'POST',
        url: `/workflow/steps/${step.id}/approve`,
        headers: headersFor(coordinator.sub, school.id),
        json: { note: 'Documents verified' },
      });
      expect(r.statusCode).toBe(201);
      expect(r.json()).toMatchObject({ status: 'pending', currentLevel: 2 });
    }
    const l2 = await inject({ method: 'GET', url: '/workflow/inbox', headers: h() });
    expect(l2.json().data).toHaveLength(2);
    const approved = await inject({
      method: 'POST',
      url: `/workflow/steps/${l2.json().data[0].id}/approve`,
      headers: h(),
      json: {},
    });
    expect(approved.json().status).toBe('approved');
    const rejected = await inject({
      method: 'POST',
      url: `/workflow/steps/${l2.json().data[1].id}/reject`,
      headers: h(),
      json: { note: 'Seat withheld' },
    });
    expect(rejected.json().status).toBe('rejected');
    const selected = await inject({
      method: 'GET',
      url: `/admissions/applications?cycleId=${cycleId}&status=selected`,
      headers: h(),
    });
    expect(selected.json().page.total).toBe(1);
    const rej = await inject({
      method: 'GET',
      url: `/admissions/applications?cycleId=${cycleId}&status=rejected`,
      headers: h(),
    });
    expect(rej.json().page.total).toBe(1);
    const instances = await inject({
      method: 'GET',
      url: `/workflow/instances?entityType=application`,
      headers: h(),
    });
    expect(instances.json().page.total).toBe(2);
  });

  it('the applicant sees the offer and pays through the mock gateway; replays and tampering are refused', async () => {
    const selected = await inject({
      method: 'GET',
      url: `/admissions/applications?cycleId=${cycleId}&status=selected`,
      headers: h(),
    });
    const application = selected.json().data[0] as { id: string; applicantMobile: string };
    const applicant = applicants.find((a) => a.mobile === application.applicantMobile)!;
    const mine = await inject({
      method: 'GET',
      url: `/public/admissions/applications/${application.id}`,
      headers: { authorization: `Bearer ${applicant.token}` },
    });
    expect(mine.json().offer).toMatchObject({ status: 'offered', admissionFee: '2500.00' });
    expect(mine.json().offer.payment).toMatchObject({ status: 'created' });
    const form = mine.json().offer.payment.form as {
      action: string;
      fields: Record<string, string>;
    };
    expect(form.action).toBe('/api/v1/payments/payu/mock');
    expect(form.fields.amount).toBe('2500.00');

    const early = await inject({
      method: 'POST',
      url: `/admissions/applications/${application.id}/admit`,
      headers: h(),
      json: {},
    });
    expect(early.statusCode).toBe(409);
    expect(early.json()).toMatchObject({ type: 'admission.fee_pending' });

    // a forged notification with a wrong signature is recorded (its id is remembered, so a repeat is a duplicate) and rejected
    const forged = mockResponse(
      form.fields as never,
      'success',
      'wrong-key',
      'wrong-salt',
      `FORGED-${Date.now()}`,
    );
    const bad = await inject({
      method: 'POST',
      url: '/payments/payu/webhook',
      headers: {},
      json: forged,
    });
    expect(bad.statusCode).toBe(201);
    expect(bad.json()).toMatchObject({ outcome: 'rejected' });
    // a tampered amount with a valid signature over the tampered value is refused as a mismatch
    const tampered = {
      ...mockResponse(
        form.fields as never,
        'success',
        process.env.PAYU_KEY ?? 'dev-payu-key',
        process.env.PAYU_SALT ?? 'dev-payu-salt-change-me',
        `TAMPER-${Date.now()}`,
      ),
      amount: '1.00',
    };
    tampered.hash = responseHash(
      tampered,
      process.env.PAYU_KEY ?? 'dev-payu-key',
      process.env.PAYU_SALT ?? 'dev-payu-salt-change-me',
    );
    const mismatch = await inject({
      method: 'POST',
      url: '/payments/payu/webhook',
      headers: {},
      json: tampered,
    });
    expect(mismatch.json()).toMatchObject({ outcome: 'mismatch' });

    const paid = await inject({
      method: 'POST',
      url: '/payments/payu/mock',
      headers: {},
      json: { txnid: form.fields.txnid, outcome: 'success' },
    });
    expect(paid.statusCode).toBe(201);
    expect(paid.json()).toMatchObject({ outcome: 'applied', status: 'succeeded' });
    const replay = await inject({
      method: 'POST',
      url: '/payments/payu/webhook',
      headers: {},
      json: paid.json().response,
    });
    expect(replay.json()).toMatchObject({ outcome: 'duplicate' });
    const after = await inject({
      method: 'GET',
      url: `/public/admissions/applications/${application.id}`,
      headers: { authorization: `Bearer ${applicant.token}` },
    });
    expect(after.json().offer).toMatchObject({ status: 'accepted' });
    expect(after.json().feePaidAt).not.toBeNull();
    const intents = await inject({
      method: 'GET',
      url: '/payments/intents?status=succeeded',
      headers: headersFor(accountant.sub, school.id),
    });
    expect(intents.json().page.total).toBe(1);
    const detail = await inject({
      method: 'GET',
      url: `/payments/intents/${intents.json().data[0].id}`,
      headers: headersFor(accountant.sub, school.id),
    });
    expect(detail.json().events.map((e: { kind: string }) => e.kind)).toEqual([
      'created',
      'webhook_rejected',
      'webhook_mismatch',
      'webhook',
      'replay',
    ]);
  });

  it('admits: admission number, student, guardian and enrolment in the cycle year', async () => {
    const selected = await inject({
      method: 'GET',
      url: `/admissions/applications?cycleId=${cycleId}&status=selected`,
      headers: h(),
    });
    const application = selected.json().data[0] as { id: string };
    const denied = await inject({
      method: 'POST',
      url: `/admissions/applications/${application.id}/admit`,
      headers: headersFor(coordinator.sub, school.id),
      json: {},
    });
    expect(denied.statusCode).toBe(403);
    const admitted = await inject({
      method: 'POST',
      url: `/admissions/applications/${application.id}/admit`,
      headers: h(),
      json: { rollNo: 1 },
    });
    expect(admitted.statusCode).toBe(201);
    expect(admitted.json().admissionNo).toBe('A0001');
    const student = await inject({
      method: 'GET',
      url: `/people/students/${admitted.json().studentId}`,
      headers: h(),
    });
    expect(student.json()).toMatchObject({
      admissionNo: 'A0001',
      firstName: expect.stringMatching(/^Child/),
    });
    expect(student.json().enrolments[0]).toMatchObject({
      academicYear: '2027-28',
      section: 'A',
      status: 'active',
    });
    expect(student.json().guardians[0]).toMatchObject({ mobile: expect.stringMatching(/^98222/) });
    const app2 = await inject({
      method: 'GET',
      url: `/admissions/applications/${application.id}`,
      headers: h(),
    });
    expect(app2.json()).toMatchObject({ status: 'admitted', studentId: admitted.json().studentId });
    const twice = await inject({
      method: 'POST',
      url: `/admissions/applications/${application.id}/admit`,
      headers: h(),
      json: {},
    });
    expect(twice.statusCode).toBe(409);
  });

  it('records an offline fee payment and allocates it to the oldest dues', async () => {
    // a student of the working year with a small demand
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'V', name: 'Class V', displayOrder: 5 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'F9-1',
        firstName: 'Payer',
        enrolment: { classSectionId: sec.json().id },
      },
    });
    const head = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition' },
    });
    await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { monthsPerInstalment: 3 },
    });
    await inject({
      method: 'PUT',
      url: `/fees/structures/${cls.json().id}`,
      headers: h(),
      json: { entries: [{ headId: head.json().id, amount: 1000, frequency: 'monthly' }] },
    });
    const gen = await inject({
      method: 'POST',
      url: `/fees/students/${st.json().id}/demands/generate`,
      headers: h(),
    });
    expect(Number(gen.json().total)).toBe(12000);
    const paid = await inject({
      method: 'POST',
      url: '/payments/offline',
      headers: headersFor(accountant.sub, school.id),
      json: { studentId: st.json().id, amount: 2500, mode: 'cash', reference: 'R-1' },
    });
    expect(paid.statusCode).toBe(201);
    expect(paid.json().unallocated).toBe('0.00');
    const demands = await inject({
      method: 'GET',
      url: `/fees/students/${st.json().id}/demands`,
      headers: h(),
    });
    expect(demands.json().total).toMatchObject({
      net: '12000.00',
      paid: '2500.00',
      balance: '9500.00',
    });
    const rows = demands.json().rows as Array<{ sequence: number; status: string; paid: string }>;
    expect(rows.find((r) => r.sequence === 1)).toMatchObject({ status: 'paid', paid: '1000.00' });
    expect(rows.find((r) => r.sequence === 3)).toMatchObject({ status: 'partial', paid: '500.00' });
    const online = await inject({
      method: 'POST',
      url: '/payments/intents/fee',
      headers: headersFor(accountant.sub, school.id),
      json: {
        studentId: st.json().id,
        amount: 500,
        payerName: 'Payer Parent',
        payerEmail: 'pp@example.test',
        payerMobile: '9822200009',
      },
    });
    expect(online.statusCode).toBe(201);
    const settled = await inject({
      method: 'POST',
      url: '/payments/payu/mock',
      headers: {},
      json: { txnid: online.json().intent.txnId },
    });
    expect(settled.json().status).toBe('succeeded');
    const afterOnline = await inject({
      method: 'GET',
      url: `/fees/students/${st.json().id}/demands`,
      headers: h(),
    });
    expect(afterOnline.json().total.paid).toBe('3000.00');
  });
});
