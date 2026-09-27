/**
 * Sprint 8 admissions: cycles with criteria and scoring, the public surface (proof of work, OTP, applicant
 * tokens, throttling), applications with age criteria, passcodes, duplicates and scoring, intake desk.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import IORedis from 'ioredis';
import { PowService } from '../src/modules/admissions/public/pow.service';
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

describe('admissions (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let planYear: string;
  let classI: string;
  let classVI: string;
  let cycleId: string;
  let token = '';
  let firstApplication: string;
  const mobile = '9876512345'; // also the guardian mobile of the seeded sibling
  const h = () => headersFor(admin.sub, school.id);
  const applicantHeaders = (t = token) => ({ authorization: `Bearer ${t}` });
  const validData = {
    fatherName: 'Rohan Verma',
    motherName: 'Isha Verma',
    email: 'rohan@example.test',
    address: '12 Lake Road',
    city: 'Pune',
    pin: '411045',
    category: 'GEN',
    distanceKm: 3,
    alumniParent: true,
  };

  const solvedOtp = async (mob: string) => {
    const ch = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
    expect(ch.statusCode).toBe(201);
    const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
    const otp = await inject({
      method: 'POST',
      url: '/public/admissions/otp',
      headers: {},
      json: { schoolCode: school.code, mobile: mob, challenge: ch.json().challenge, nonce },
    });
    expect(otp.statusCode).toBe(201);
    return { challenge: ch.json().challenge as string, nonce, code: otp.json().devCode as string };
  };

  /** Per-IP throttle counters live in Redis for a minute; clear them so repeated runs start clean. */
  const resetThrottle = async () => {
    const redis = new IORedis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
      lazyConnect: true,
    });
    try {
      await redis.connect();
      const keys = await redis.keys('edupro:throttle:*');
      if (keys.length) await redis.del(...keys);
    } finally {
      redis.disconnect();
    }
  };

  beforeAll(async () => {
    process.env.PUBLIC_POW_DIFFICULTY = '1';
    await resetThrottle();
    const s = stamp('A8');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      const y = await c.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status) VALUES ($1, '2027-28', 'Session 2027-28', '2027-04-01', '2028-03-31', 'planned') RETURNING id::text`,
        [school.id],
      );
      planYear = y.rows[0]!.id;
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
    const c6 = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    classVI = c6.json().id;
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${classI}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    // an existing student whose guardian has the applicant's mobile: the sibling rule must fire
    const sib = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: {
        admissionNo: 'SIB1',
        firstName: 'Elder',
        lastName: 'Verma',
        guardians: [
          {
            guardian: { firstName: 'Rohan', lastName: 'Verma', mobile },
            relation: 'father',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sec.json().id, rollNo: 1 },
      },
    });
    expect(sib.statusCode).toBe(201);
  });

  afterAll(async () => {
    // close the cycle so the public school list of the shared local database stays tidy
    if (app && cycleId)
      await inject({
        method: 'PATCH',
        url: `/admissions/cycles/${cycleId}`,
        headers: h(),
        json: { status: 'closed' },
      });
    if (app) await app.close();
  });

  it('admin creates a cycle with criteria and scoring masters; it is public only once open', async () => {
    const res = await inject({
      method: 'POST',
      url: '/admissions/cycles',
      headers: h(),
      json: {
        academicYearId: planYear,
        code: 'ADM-2027',
        name: 'Admissions 2027-28',
        nameHi: 'प्रवेश 2027-28',
        opensAt: new Date(Date.now() - 86_400_000).toISOString(),
        closesAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        applicationFee: 500,
        criteria: [
          { classId: classI, seats: 40, dobFrom: '2020-04-01', dobTo: '2021-03-31' },
          { classId: classVI, seats: 10, passcode: 'VI-2027' },
        ],
        scoreCriteria: [
          { code: 'sibling', name: 'Sibling in school', points: 20, autoRule: 'sibling' },
          { code: 'alumni', name: 'Alumni parent', points: 10, autoRule: 'alumni' },
          { code: 'distance', name: 'Within 5 km', points: 15, autoRule: 'distance_within:5' },
          { code: 'interview', name: 'Interaction', points: 25 },
        ],
      },
    });
    expect(res.statusCode).toBe(201);
    cycleId = res.json().id;
    expect(res.json().formSchema.length).toBeGreaterThan(5);
    expect(res.json().criteria).toHaveLength(2);
    const hidden = await inject({
      method: 'GET',
      url: `/public/admissions/${school.code}/cycles`,
      headers: {},
    });
    expect(hidden.json().data).toEqual([]);
    const open = await inject({
      method: 'PATCH',
      url: `/admissions/cycles/${cycleId}`,
      headers: h(),
      json: { status: 'open' },
    });
    expect(open.statusCode).toBe(200);
    const schools = await inject({ method: 'GET', url: '/public/admissions/schools', headers: {} });
    expect(schools.json().data.find((x: { code: string }) => x.code === school.code)).toMatchObject(
      { openCycles: 1 },
    );
    const visible = await inject({
      method: 'GET',
      url: `/public/admissions/${school.code}/cycles`,
      headers: {},
    });
    expect(visible.json().data).toHaveLength(1);
    expect(
      visible.json().data[0].criteria.find((k: { classCode: string }) => k.classCode === 'VI')
        .passcode,
    ).toBe('***');
    expect(visible.json().data[0].scoreCriteria).toEqual([]);
  });

  it('proof of work gates the OTP; wrong codes lock the mobile; a correct code issues a token', async () => {
    const ch = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
    expect(ch.statusCode).toBe(201);
    expect(ch.json().difficulty).toBe(1);
    const unsolved = await inject({
      method: 'POST',
      url: '/public/admissions/otp',
      headers: {},
      json: { schoolCode: school.code, mobile, challenge: ch.json().challenge, nonce: 'nope' },
    });
    expect(unsolved.statusCode).toBe(400);
    expect(unsolved.json()).toMatchObject({ type: 'pow.unsolved' });
    const first = await solvedOtp(mobile);
    expect(first.code).toMatch(/^\d{6}$/);
    const reused = await inject({
      method: 'POST',
      url: '/public/admissions/otp',
      headers: {},
      json: { schoolCode: school.code, mobile, challenge: first.challenge, nonce: first.nonce },
    });
    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toMatchObject({ type: 'pow.reused' });
    const wrong = first.code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i += 1) {
      const bad = await inject({
        method: 'POST',
        url: '/public/admissions/otp/verify',
        headers: {},
        json: { schoolCode: school.code, mobile, code: wrong },
      });
      expect(bad.statusCode).toBe(401);
      expect(bad.json()).toMatchObject({ type: 'otp.invalid' });
    }
    const locked = await inject({
      method: 'POST',
      url: '/public/admissions/otp/verify',
      headers: {},
      json: { schoolCode: school.code, mobile, code: first.code },
    });
    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ type: 'otp.locked' });
    const second = await solvedOtp(mobile);
    const ok = await inject({
      method: 'POST',
      url: '/public/admissions/otp/verify',
      headers: {},
      json: { schoolCode: school.code, mobile, code: second.code, name: 'Rohan Verma' },
    });
    expect(ok.statusCode).toBe(201);
    token = ok.json().token;
    expect(token.startsWith('app.')).toBe(true);
    const me = await inject({
      method: 'GET',
      url: '/public/admissions/me',
      headers: applicantHeaders(),
    });
    expect(me.json()).toMatchObject({ mobile, name: 'Rohan Verma' });
    const anon = await inject({ method: 'GET', url: '/public/admissions/me', headers: {} });
    expect(anon.statusCode).toBe(401);
    expect(anon.json()).toMatchObject({ type: 'applicant-unauthenticated' });
  });

  it('applications respect age criteria, passcodes, the form schema and duplicates; scoring is automatic', async () => {
    const tooOld = await inject({
      method: 'POST',
      url: '/public/admissions/applications',
      headers: applicantHeaders(),
      json: {
        cycleId,
        classId: classI,
        childFirstName: 'Anya',
        childLastName: 'Verma',
        childDob: '2018-06-01',
        childGender: 'female',
        data: validData,
        submit: true,
      },
    });
    expect(tooOld.statusCode).toBe(422);
    expect(tooOld.json()).toMatchObject({ type: 'admission.age_criteria' });
    const unknown = await inject({
      method: 'POST',
      url: '/public/admissions/applications',
      headers: applicantHeaders(),
      json: {
        cycleId,
        classId: classI,
        childFirstName: 'Anya',
        childDob: '2020-06-01',
        data: { ...validData, hacker: '<script>' },
      },
    });
    expect(unknown.statusCode).toBe(400);
    expect(unknown.json().problems).toEqual([{ field: 'hacker', message: 'unknown field' }]);
    const missing = await inject({
      method: 'POST',
      url: '/public/admissions/applications',
      headers: applicantHeaders(),
      json: {
        cycleId,
        classId: classI,
        childFirstName: 'Anya',
        childDob: '2020-06-01',
        data: { fatherName: 'x' },
      },
    });
    expect(missing.statusCode).toBe(400);

    const ok = await inject({
      method: 'POST',
      url: '/public/admissions/applications',
      headers: applicantHeaders(),
      json: {
        cycleId,
        classId: classI,
        childFirstName: 'Anya',
        childLastName: 'Verma',
        childDob: '2020-06-01',
        childGender: 'female',
        data: validData,
        submit: true,
      },
    });
    expect(ok.statusCode).toBe(201);
    firstApplication = ok.json().id;
    expect(ok.json()).toMatchObject({
      status: 'submitted',
      applicationNo: 'APP/ADM-2027/00001',
      score: '45.00',
    });
    expect((ok.json().scoreBreakdown as Array<{ code: string }>).map((b) => b.code).sort()).toEqual(
      ['alumni', 'distance', 'sibling'],
    );

    const dup = await inject({
      method: 'POST',
      url: '/public/admissions/applications',
      headers: applicantHeaders(),
      json: {
        cycleId,
        classId: classI,
        childFirstName: 'anya',
        childDob: '2020-06-01',
        data: validData,
      },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json()).toMatchObject({ type: 'admission.duplicate_application' });

    const noPass = await inject({
      method: 'POST',
      url: '/public/admissions/applications',
      headers: applicantHeaders(),
      json: {
        cycleId,
        classId: classVI,
        childFirstName: 'Vivaan',
        childDob: '2015-06-01',
        data: validData,
      },
    });
    expect(noPass.statusCode).toBe(422);
    expect(noPass.json()).toMatchObject({ type: 'admission.passcode_invalid' });
    const draft = await inject({
      method: 'POST',
      url: '/public/admissions/applications',
      headers: applicantHeaders(),
      json: {
        cycleId,
        classId: classVI,
        childFirstName: 'Vivaan',
        childDob: '2015-06-01',
        passcode: 'VI-2027',
        data: validData,
      },
    });
    expect(draft.statusCode).toBe(201);
    expect(draft.json().status).toBe('draft');
    const edited = await inject({
      method: 'PATCH',
      url: `/public/admissions/applications/${draft.json().id}`,
      headers: applicantHeaders(),
      json: { data: { ...validData, city: 'Mumbai' } },
    });
    expect(edited.json().data.city).toBe('Mumbai');
    const submitted = await inject({
      method: 'POST',
      url: `/public/admissions/applications/${draft.json().id}/submit`,
      headers: applicantHeaders(),
    });
    if (submitted.statusCode !== 201)
      throw new Error(`submit: ${submitted.statusCode} ${submitted.body}`);
    expect(submitted.json()).toMatchObject({
      status: 'submitted',
      applicationNo: 'APP/ADM-2027/00002',
    });
    const mine = await inject({
      method: 'GET',
      url: '/public/admissions/me/applications',
      headers: applicantHeaders(),
    });
    expect(mine.json().data).toHaveLength(2);
  });

  it('another applicant applying for the same child is flagged as a possible duplicate and cannot see the first', async () => {
    const other = await solvedOtp('9811100000');
    const ok = await inject({
      method: 'POST',
      url: '/public/admissions/otp/verify',
      headers: {},
      json: { schoolCode: school.code, mobile: '9811100000', code: other.code },
    });
    const t2 = ok.json().token as string;
    const flagged = await inject({
      method: 'POST',
      url: '/public/admissions/applications',
      headers: applicantHeaders(t2),
      json: {
        cycleId,
        classId: classI,
        childFirstName: 'Anya',
        childLastName: 'Verma',
        childDob: '2020-06-01',
        data: { ...validData, alumniParent: false },
        submit: true,
      },
    });
    expect(flagged.statusCode).toBe(201);
    expect(flagged.json().possibleDuplicateOf).toBe(firstApplication);
    expect(flagged.json().score).toBe('15.00'); // distance only: no sibling for this mobile, not alumni
    const peek = await inject({
      method: 'GET',
      url: `/public/admissions/applications/${firstApplication}`,
      headers: applicantHeaders(t2),
    });
    expect(peek.statusCode).toBe(404);
  });

  it('the intake desk lists, reviews, scores and sees the dashboard', async () => {
    const list = await inject({
      method: 'GET',
      url: `/admissions/applications?cycleId=${cycleId}`,
      headers: h(),
    });
    expect(list.json().page.total).toBe(3);
    const dups = await inject({
      method: 'GET',
      url: `/admissions/applications?cycleId=${cycleId}&duplicates=true`,
      headers: h(),
    });
    expect(dups.json().page.total).toBe(1);
    const review = await inject({
      method: 'POST',
      url: `/admissions/applications/${firstApplication}/status`,
      headers: h(),
      json: { status: 'shortlisted', note: 'Interaction on 12 Jan' },
    });
    expect(review.statusCode).toBe(201);
    expect(review.json().status).toBe('shortlisted');
    expect(review.json().events.map((e: { toStatus: string }) => e.toStatus)).toEqual([
      'draft',
      'submitted',
      'shortlisted',
    ]);
    const scored = await inject({
      method: 'POST',
      url: `/admissions/applications/${firstApplication}/score`,
      headers: h(),
      json: { award: ['interview'] },
    });
    expect(scored.json().score).toBe('70.00');
    const dash = await inject({
      method: 'GET',
      url: `/admissions/dashboard?cycleId=${cycleId}`,
      headers: h(),
    });
    expect(dash.json().possibleDuplicates).toBe(1);
    expect(
      dash.json().byClass.find((x: { classCode: string }) => x.classCode === 'I'),
    ).toMatchObject({ seats: 40, applications: 2, shortlisted: 1 });
    const denied = await inject({
      method: 'GET',
      url: '/admissions/applications',
      headers: headersFor(`${admin.sub}-nobody`, school.id),
    });
    expect([401, 403]).toContain(denied.statusCode);
  });

  it('throttles anonymous callers per IP', async () => {
    let limited = 0;
    for (let i = 0; i < 32; i += 1) {
      const r = await inject({ method: 'POST', url: '/public/admissions/challenge', headers: {} });
      if (r.statusCode === 429) {
        limited += 1;
        expect(r.json()).toMatchObject({ type: 'rate-limited' });
      }
    }
    expect(limited).toBeGreaterThan(0);
  });
});
