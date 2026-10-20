/**
 * Recruitment, part 2 (0198, docs/design/34-recruitment.md): the public careers page. Open vacancies only;
 * a candidate signs in with a code to the mobile or the email; the form checks the employee master's
 * fields as the master does and keeps Aadhaar encrypted; documents are the candidate's own uploads;
 * applying needs everything required and keeps a copy; an employee with the same mobile is noted.
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

describe('recruitment: the public careers page (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const pub = (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    token?: string,
    json?: unknown,
  ) =>
    inject({
      method,
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      ...(json === undefined ? {} : { json }),
    });

  /** Per-IP throttle counters live in Redis for a minute; clear them so a run after other suites starts clean. */
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
  const today = new Date().toISOString().slice(0, 10);
  let openId = '';
  let draftId = '';
  const employeeMobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  /** A vacancy raised, approved and (when asked) published from today. */
  const vacancy = async (title: string, publish: boolean) => {
    const setup = (await call(admin, 'GET', '/people/recruitment/setup')).json();
    const r = await call(admin, 'POST', '/people/recruitment/vacancies', {
      title,
      department: 'Science',
      stageIds: setup.stages.map((s: { id: string }) => s.id),
    });
    const id = r.json().id as string;
    await call(admin, 'POST', `/people/recruitment/vacancies/${id}/submit`);
    const inbox = (await call(admin, 'GET', '/workflow/inbox')).json().data as Array<{
      id: string;
      instance: { entityType: string; entityId: string };
    }>;
    const step = inbox.find(
      (x) => x.instance.entityType === 'vacancy' && x.instance.entityId === id,
    )!;
    await call(admin, 'POST', `/workflow/steps/${step.id}/approve`, {});
    if (publish)
      await call(admin, 'POST', `/people/recruitment/vacancies/${id}/publish`, {
        opensOn: today,
        closesOn: '2099-12-31',
      });
    return id;
  };

  /** A code by the channel chosen, exchanged for a candidate token. */
  const signIn = async (channel: 'mobile' | 'email', to: string, name?: string) => {
    const ch = await pub('POST', '/public/admissions/challenge');
    const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
    const otp = await pub('POST', '/public/careers/otp', undefined, {
      schoolCode: school.code,
      channel,
      to,
      challenge: ch.json().challenge,
      nonce,
    });
    expect(otp.statusCode).toBe(201);
    const v = await pub('POST', '/public/careers/otp/verify', undefined, {
      schoolCode: school.code,
      channel,
      to,
      code: otp.json().devCode,
      name,
    });
    expect(v.statusCode).toBe(201);
    return v.json().token as string;
  };

  beforeAll(async () => {
    process.env.PUBLIC_POW_DIFFICULTY = '1';
    await resetThrottle();
    const s = stamp('RCP');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, designation, employee_type, mobile)
         VALUES ($1, 'EX1', 'Existing', 'TGT', 'teaching', $2)`,
        [school.id, employeeMobile],
      );
    });
    app = await createApp();
    inject = injector(app);
    openId = await vacancy('PGT Physics', true);
    draftId = await vacancy('Accountant', false);
  });
  afterAll(async () => app.close());

  it('only published vacancies inside their dates show; the form takes the employee master’s labels and lists', async () => {
    const list = await pub('GET', `/public/careers/${school.code}`);
    expect(list.statusCode).toBe(200);
    expect(list.json().data.map((v: { id: string }) => v.id)).toEqual([openId]);
    expect(
      (await pub('GET', `/public/careers/${school.code}/vacancies/${openId}`)).json(),
    ).toMatchObject({
      title: 'PGT Physics',
      department: 'Science',
    });
    expect(
      (await pub('GET', `/public/careers/${school.code}/vacancies/${draftId}`)).statusCode,
    ).toBe(404);
    expect((await pub('GET', '/public/careers/NOSUCHSCHOOL')).statusCode).toBe(404);
    const form = (await pub('GET', `/public/careers/${school.code}/form`)).json();
    const byKey = new Map(
      (
        form.fields as Array<{
          key: string;
          label: string;
          options: string[] | null;
          sensitive: boolean;
        }>
      ).map((f) => [f.key, f]),
    );
    expect(byKey.get('first_name')!.label).toBe('First name');
    expect(byKey.get('gender')!.options).toEqual(['Male', 'Female', 'Other']);
    expect(byKey.get('aadhaar')!.sensitive).toBe(true);
    expect(form.documents.find((d: { kind: string }) => d.kind === 'photo')).toMatchObject({
      required: true,
    });
  });

  let token = '';

  it('a candidate signs in with a code to the email; a wrong code and an admissions token are refused', async () => {
    const ch = await pub('POST', '/public/admissions/challenge');
    const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
    const badTo = await pub('POST', '/public/careers/otp', undefined, {
      schoolCode: school.code,
      channel: 'email',
      to: '9876543210',
      challenge: ch.json().challenge,
      nonce,
    });
    expect(badTo.statusCode).toBe(400);
    const wrong = await pub('POST', '/public/careers/otp/verify', undefined, {
      schoolCode: school.code,
      channel: 'email',
      to: 'meera.rao@example.invalid',
      code: '000000',
    });
    expect(wrong.statusCode).toBe(401);
    token = await signIn('email', 'meera.rao@example.invalid', 'Meera Rao');
    expect(token.startsWith('cand.')).toBe(true);
    const me = await pub('GET', '/public/careers/me', token);
    expect(me.statusCode).toBe(200);
    expect(me.json().candidate).toMatchObject({
      email: 'meera.rao@example.invalid',
      name: 'Meera Rao',
    });
    expect(me.json().missing).toEqual(expect.arrayContaining(['First name', 'Your photo']));
    expect((await pub('GET', '/public/careers/me', 'app.not-a-candidate')).statusCode).toBe(401);
    // the mobile works the same way, for another candidate
    const t2 = await signIn('mobile', '9123456780');
    expect((await pub('GET', '/public/careers/me', t2)).json().candidate.mobile).toBe('9123456780');
  });

  it('the form is checked as the employee master checks it; Aadhaar is kept encrypted and shown masked', async () => {
    // every answer accepted is kept; the refused ones are listed and not saved
    const bad = await pub('PUT', '/public/careers/me/profile', token, {
      values: { pan: 'NOTAPAN', gender: 'Robot', last_name: 'Rao' },
      rows: {
        education: [{ qualification: 'M.Sc.', passingYear: 'abcd' }, { passingYear: '2010' }],
      },
    });
    expect(bad.statusCode).toBe(200);
    const refused = (bad.json().refused as string[]).join('; ');
    expect(refused).toMatch(/PAN/);
    expect(refused).toMatch(/Gender/);
    expect(refused).toMatch(/Qualifications row 1, Year/);
    expect(refused).toMatch(/Qualifications row 2: Qualification is needed/);
    const kept = (await pub('GET', '/public/careers/me', token)).json();
    expect(kept.values).toMatchObject({ last_name: 'RAO' });
    expect(kept.values.pan ?? null).toBeNull();
    expect(kept.rows.education).toEqual([
      expect.objectContaining({ qualification: 'M.Sc.', passingYear: null }),
    ]);
    const ok = await pub('PUT', '/public/careers/me/profile', token, {
      values: {
        first_name: 'Meera',
        last_name: 'Rao',
        gender: 'Female',
        dob: '1990-05-12',
        father_name: 'Ramesh Rao',
        mobile: employeeMobile,
        email: 'meera.rao@example.invalid',
        present_line1: '12 Park Street',
        present_city: 'Noida',
        present_state: 'Uttar Pradesh',
        aadhaar: '123456789012',
        current_basic: '31400',
        notice_period: 'One month',
      },
      rows: {
        education: [
          {
            qualification: 'M.Sc. Physics',
            passingYear: '2012',
            division: 'First',
            mode: 'Regular',
          },
          { qualification: '', passingYear: '' },
        ],
        references: [{ name: 'A. Sharma', phone: '9810000000' }],
      },
      activities: ['Music', 'Quiz', 'Juggling'],
    });
    expect(ok.statusCode).toBe(200);
    const me = (await pub('GET', '/public/careers/me', token)).json();
    expect(me.values).toMatchObject({
      first_name: 'MEERA',
      aadhaar: 'XXXX-XXXX-9012',
      current_basic: 31400,
    });
    expect(me.rows.education).toHaveLength(1);
    expect(me.activities).toEqual(['Music', 'Quiz']);
    expect(me.missing).toEqual(['Your photo']);
    const stored = await withMigrator((c) =>
      c.query<{ secure: Record<string, string> }>(
        `SELECT secure FROM candidates WHERE school_id = $1 AND email = 'meera.rao@example.invalid'`,
        [school.id],
      ),
    );
    expect(JSON.stringify(stored.rows[0]!.secure)).not.toContain('123456789012');
    // the masked value sent back keeps the one on file
    await pub('PUT', '/public/careers/me/profile', token, {
      values: { aadhaar: 'XXXX-XXXX-9012' },
    });
    expect((await pub('GET', '/public/careers/me', token)).json().values.aadhaar).toBe(
      'XXXX-XXXX-9012',
    );
  });

  let photoId = '';

  it('documents are the candidate’s own uploads; the photo must be an image; applying needs everything and is kept as submitted', async () => {
    const noPhoto = await pub('POST', `/public/careers/vacancies/${openId}/apply`, token, {
      declaration: true,
    });
    expect(noPhoto.statusCode).toBe(400);
    expect(noPhoto.json().detail).toMatch(/Your photo/);
    const pdfAsPhoto = await pub('POST', '/public/careers/me/files/slot', token, {
      kind: 'photo',
      fileName: 'me.pdf',
      contentType: 'application/pdf',
      sizeBytes: 100,
    });
    expect(pdfAsPhoto.statusCode).toBe(400);
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64',
    );
    const slot = await pub('POST', '/public/careers/me/files/slot', token, {
      kind: 'photo',
      fileName: 'me.png',
      contentType: 'image/png',
      sizeBytes: png.length,
    });
    expect(slot.statusCode).toBe(201);
    const putr = await inject({
      method: 'PUT',
      url: slot.json().upload.url,
      headers: {},
      raw: { body: png, contentType: 'image/png' },
    } as never);
    expect(putr.statusCode).toBe(200);
    photoId = slot.json().file.id as string;
    expect(
      (await pub('POST', '/public/careers/me/files', token, { kind: 'photo', fileId: photoId }))
        .statusCode,
    ).toBe(201);
    expect((await pub('GET', `/public/careers/me/files/${photoId}`, token)).statusCode).toBe(200);
    // another candidate cannot use or open it
    const other = await signIn('mobile', '9123456781');
    expect(
      (await pub('POST', '/public/careers/me/files', other, { kind: 'photo', fileId: photoId }))
        .statusCode,
    ).toBe(404);
    expect((await pub('GET', `/public/careers/me/files/${photoId}`, other)).statusCode).toBe(404);
    // the declaration is needed; the vacancy must be open
    expect(
      (
        await pub('POST', `/public/careers/vacancies/${openId}/apply`, token, {
          declaration: false,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await pub('POST', `/public/careers/vacancies/${draftId}/apply`, token, {
          declaration: true,
        })
      ).statusCode,
    ).toBe(409);
    const applied = await pub('POST', `/public/careers/vacancies/${openId}/apply`, token, {
      declaration: true,
    });
    expect(applied.statusCode).toBe(201);
    expect(applied.json().number).toMatch(/^APP-\d{4}-0001$/);
    expect(
      (await pub('POST', `/public/careers/vacancies/${openId}/apply`, token, { declaration: true }))
        .statusCode,
    ).toBe(409);
    const me = (await pub('GET', '/public/careers/me', token)).json();
    expect(me.applications).toEqual([
      expect.objectContaining({ vacancyId: openId, title: 'PGT Physics', status: 'submitted' }),
    ]);
    const row = await withMigrator((c) =>
      c.query<{
        snapshot: { values: Record<string, unknown>; files: Array<{ kind: string }> };
        employee_match: unknown;
      }>(`SELECT snapshot, employee_match FROM job_applications WHERE id = $1`, [
        applied.json().id,
      ]),
    );
    expect(row.rows[0]!.snapshot.values.first_name).toBe('MEERA');
    expect(row.rows[0]!.snapshot.files.map((f) => f.kind)).toEqual(['photo']);
    // an active employee has the same mobile: noted for the office
    expect(row.rows[0]!.employee_match).toEqual([expect.objectContaining({ code: 'EX1' })]);
  });
});
