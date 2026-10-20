/**
 * Recruitment, part 4 (0200, docs/design/34-recruitment.md): a selected candidate becomes an employee through
 * the employee master's onboarding. The answers in the master's fields, the qualifications, experience and
 * training and the documents the office picks carry over; the application records the employee; a
 * candidate with the same PAN as an active employee is held back until the office confirms.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import IORedis from 'ioredis';
import { encryptField } from '@edupro/db';
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

describe('recruitment: from selected candidate to employee (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const pub = (method: 'GET' | 'POST' | 'PUT', url: string, token?: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(json === undefined ? {} : { json }),
    });
  const R = '/people/recruitment';
  const today = new Date().toISOString().slice(0, 10);
  /** A date-and-time box's value (India time), `ms` from now. */
  const ist = (ms: number) => new Date(Date.now() + 330 * 60_000 + ms).toISOString().slice(0, 16);
  let vacancyId = '';
  const stage: Record<string, string> = {};
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );

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

  /** A candidate made through the careers page: signed in by email, the form filled, a photo and a CV, applied. */
  const candidate = async (email: string, first: string, mobile: string, pan: string) => {
    const ch = await pub('POST', '/public/admissions/challenge');
    const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
    const otp = await pub('POST', '/public/careers/otp', undefined, {
      schoolCode: school.code,
      channel: 'email',
      to: email,
      challenge: ch.json().challenge,
      nonce,
    });
    const token = (
      await pub('POST', '/public/careers/otp/verify', undefined, {
        schoolCode: school.code,
        channel: 'email',
        to: email,
        code: otp.json().devCode,
      })
    ).json().token as string;
    const saved = await pub('PUT', '/public/careers/me/profile', token, {
      values: {
        first_name: first,
        last_name: 'Iyer',
        gender: 'Female',
        dob: '1991-02-03',
        marital_status: 'Single',
        father_name: 'Raman Iyer',
        mobile,
        email,
        present_line1: '4 Lake Road',
        present_city: 'Noida',
        present_state: 'Uttar Pradesh',
        aadhaar: `2345678901${mobile.slice(-2)}`,
        pan,
        current_basic: 30000,
      },
      rows: {
        education: [
          {
            qualification: 'M.Sc. Physics',
            passingYear: '2014',
            score: '72%',
            division: 'First',
            institution: 'Govt College',
            university: 'MDU Rohtak',
            mode: 'Regular',
            specialisation: 'Physics',
          },
        ],
        experience: [
          {
            organisation: 'City School',
            designation: 'TGT Science',
            fromOn: '2016-04-01',
            toOn: '2026-03-31',
          },
        ],
        training: [{ topic: 'Lab safety', organisation: 'CBSE', year: '2025', duration: '2 days' }],
        children: [{ name: 'Child One', class: 'II' }],
      },
    });
    expect(saved.json().refused).toEqual([]);
    for (const [kind, type, name] of [
      ['photo', 'image/png', 'me.png'],
      ['resume', 'image/png', 'cv.png'],
    ] as const) {
      const slot = await pub('POST', '/public/careers/me/files/slot', token, {
        kind,
        fileName: name,
        contentType: type,
        sizeBytes: png.length,
      });
      await inject({
        method: 'PUT',
        url: slot.json().upload.url,
        headers: {},
        raw: { body: png, contentType: type },
      } as never);
      await pub('POST', '/public/careers/me/files', token, { kind, fileId: slot.json().file.id });
    }
    const applied = await pub('POST', `/public/careers/vacancies/${vacancyId}/apply`, token, {
      declaration: true,
    });
    expect(applied.statusCode).toBe(201);
    return applied.json().id as string;
  };
  /** Through every stage: selected. */
  const select = async (appId: string) => {
    for (const s of [stage.Shortlisting, stage['Final round']])
      expect(
        (await call(admin, 'POST', `${R}/applications/${appId}/stages/${s}`, { result: 'pass' }))
          .statusCode,
      ).toBe(200);
  };

  let x = '';
  let y = '';

  beforeAll(async () => {
    process.env.PUBLIC_POW_DIFFICULTY = '1';
    await resetThrottle();
    const s = stamp('RCJ');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      await c.query(`SELECT app.staff_masters_seed($1)`, [school.id]);
      // an employee already on the staff with the PAN the second candidate gives
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, designation, employee_type, secure)
         VALUES ($1, 'T100', 'Existing', 'TGT', 'teaching', $2::jsonb)`,
        [school.id, JSON.stringify({ pan: encryptField('ABCDE1234F') })],
      );
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call(admin, 'GET', `${R}/setup`)).json();
    for (const st of setup.stages as Array<{ id: string; name: string }>) stage[st.name] = st.id;
    vacancyId = (
      await call(admin, 'POST', `${R}/vacancies`, {
        title: 'PGT Physics',
        designation: 'PGT',
        department: 'Teaching Senior',
        employeeType: 'Teaching Regular',
        posts: 2,
        stageIds: [stage.Shortlisting, stage['Final round']],
      })
    ).json().id as string;
    // raised by the school admin, the approver: approved as it is sent
    await call(admin, 'POST', `${R}/vacancies/${vacancyId}/submit`);
    await call(admin, 'POST', `${R}/vacancies/${vacancyId}/publish`, {
      opensAt: ist(0),
      closesAt: ist(300 * 86_400_000),
    });
    x = await candidate('kavya@example.invalid', 'Kavya', '9833333331', 'PQRSX5678K');
    y = await candidate('lata@example.invalid', 'Lata', '9833333332', 'ABCDE1234F');
  });
  afterAll(async () => app.close());

  it('only a selected candidate moves; the preview says what carries over and what stays', async () => {
    const early = await call(admin, 'POST', `${R}/applications/${x}/join`, { joinedOn: today });
    expect(early.statusCode).toBe(409);
    expect(early.json().type).toBe('recruitment.not_selected');
    await select(x);
    const p = (await call(admin, 'GET', `${R}/applications/${x}/join`)).json();
    expect(p.copies.fields).toEqual(
      expect.arrayContaining(['First name', 'Aadhaar number', 'PAN']),
    );
    expect(p.copies).toMatchObject({ education: 1, experience: 1, training: 1 });
    expect(p.stays).toEqual(expect.arrayContaining(['Children', 'References']));
    expect(p.defaults).toMatchObject({
      department: 'Teaching Senior',
      designation: 'PGT',
      employeeType: 'Teaching Regular',
    });
    expect(p.matches).toEqual([]);
    const photo = p.documents.find((d: { kind: string }) => d.kind === 'photo');
    expect(photo.suggestedTypeId).toBeTruthy();
    expect(p.nextCode).toMatch(/\d+$/);
    expect((await call(admin, 'GET', `${R}/applications/${x}`)).json().can.join).toBe(true);
  });

  it('the candidate becomes an employee: the master’s fields, the rows, the documents picked, the photo; once', async () => {
    const p = (await call(admin, 'GET', `${R}/applications/${x}/join`)).json();
    const docs = (
      p.documents as Array<{ id: string; kind: string; suggestedTypeId: string | null }>
    ).map((d) => ({
      id: d.id,
      typeId: d.suggestedTypeId,
    }));
    const used = await call(admin, 'POST', `${R}/applications/${x}/join`, {
      joinedOn: today,
      employeeCode: 'T100',
      documents: docs,
    });
    expect(used.statusCode).toBe(400);
    const j = await call(admin, 'POST', `${R}/applications/${x}/join`, {
      joinedOn: today,
      documents: docs,
      createLogin: false,
    });
    expect(j.statusCode).toBe(201);
    const emp = j.json().employeeId as string;
    expect(j.json()).toMatchObject({ rows: 3, documents: 2 });
    const prof = (await call(admin, 'GET', `/people/staff/${emp}/profile`)).json();
    expect(prof.values).toMatchObject({
      first_name: 'KAVYA',
      department: 'Teaching Senior',
      designation: 'PGT',
      designation_at_joining: 'PGT',
      staff_type: 'Teaching Regular',
      joined_on: today,
      mobile: '9833333331',
    });
    expect(String(prof.values.aadhaar)).toMatch(/0131$/);
    expect(prof.photoFileId).toBeTruthy();
    expect(prof.rows.education).toEqual([
      expect.objectContaining({
        qualification: 'M.Sc. Physics',
        institution: 'Govt College, MDU Rohtak',
        score: '72% First',
      }),
    ]);
    expect(prof.rows.experience).toEqual([
      expect.objectContaining({ organisation: 'City School', designation: 'TGT Science' }),
    ]);
    expect(prof.rows.training).toEqual([
      expect.objectContaining({ topic: 'Lab safety', trainedOn: '2025-01-01' }),
    ]);
    const v = (await call(admin, 'GET', `${R}/applications/${x}`)).json();
    expect(v.status).toBe('joined');
    expect(v.employee).toMatchObject({ id: emp });
    expect(v.can.join).toBe(false);
    expect(v.events.map((e: { what: string }) => e.what)).toContain('joined');
    expect(
      (await call(admin, 'POST', `${R}/applications/${x}/join`, { joinedOn: today })).statusCode,
    ).toBe(409);
  });

  it('the same PAN as an active employee holds the move back until the office confirms a different person', async () => {
    await select(y);
    const p = (await call(admin, 'GET', `${R}/applications/${y}/join`)).json();
    expect(p.matches).toEqual([expect.objectContaining({ code: 'T100', why: ['PAN'] })]);
    const held = await call(admin, 'POST', `${R}/applications/${y}/join`, {
      joinedOn: today,
      createLogin: false,
    });
    expect(held.statusCode).toBe(409);
    expect(held.json().detail).toMatch(/PAN/);
    const ok = await call(admin, 'POST', `${R}/applications/${y}/join`, {
      joinedOn: today,
      createLogin: false,
      confirmMatch: true,
    });
    expect(ok.statusCode).toBe(201);
  });
});
