/**
 * Recruitment, part 8 (0203, docs/design/34-recruitment.md): putting an application right. Who may undo a
 * decision and change a stage comes from Recruitment set-up (the recorder within the hours set; the roles
 * and employees named, any time). Undo takes the application back to where it was and tells a candidate
 * who was told otherwise; a stage change skips forward or opens an earlier stage again, and can itself be
 * undone. Sent back for correction, the candidate corrects only the parts marked and sends it again; a
 * reminder goes a day before the last date.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import IORedis from 'ioredis';
import { PowService } from '../src/modules/admissions/public/pow.service';
import { aadhaarOk } from '../src/modules/people/candidate-checks';
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

describe('recruitment: undo, stage changes and corrections (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let hod: SeededUser;
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
  const ist = (ms: number) => new Date(Date.now() + 330 * 60_000 + ms).toISOString().slice(0, 16);
  const day = (n: number) =>
    new Date(Date.now() + 330 * 60_000 + n * 86_400_000).toISOString().slice(0, 10);
  const stage: Record<string, string> = {};
  let vacancyId = '';
  let token = '';
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );
  const view = async (id: string) => (await call(admin, 'GET', `${R}/applications/${id}`)).json();
  const sent = (code: string) =>
    withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
          WHERE m.school_id = $1 AND t.code = $2 AND m.channel = 'email'`,
        [school.id, code],
      ),
    ).then((r) => r.rows[0]!.n);
  /** A walk-in candidate at the first stage. */
  const walkIn = async (first: string, mobile: string) => {
    const r = await call(admin, 'POST', `${R}/applications`, {
      vacancyId,
      firstName: first,
      gender: 'Female',
      dob: '1990-01-01',
      mobile,
      email: `${first.toLowerCase()}@example.invalid`,
    });
    expect(r.statusCode).toBe(201);
    return r.json().id as string;
  };
  const record = (id: string, st: string, result: string) =>
    call(admin, 'POST', `${R}/applications/${id}/stages/${stage[st]}`, { result });
  const settings = (patch: Record<string, unknown>) =>
    call(admin, 'PUT', `${R}/setup/corrections`, {
      undoHours: 24,
      undoRoles: ['school_admin'],
      undoEmployeeIds: [],
      correctionDays: 7,
      ...patch,
    });

  beforeAll(async () => {
    process.env.PUBLIC_POW_DIFFICULTY = '1';
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
    const s = stamp('RCC');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      hod = await seedUser(c, school, `${s}-hod`, 'academic_coordinator');
      // the notices of a decision go by email (so a correction of one is needed)
      await c.query(
        `INSERT INTO recruitment_settings (school_id, notify_rejected) VALUES ($1, true)
         ON CONFLICT (school_id) DO UPDATE SET notify_rejected = true`,
        [school.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call(admin, 'GET', `${R}/setup`)).json();
    for (const st of setup.stages as Array<{ id: string; name: string }>) stage[st.name] = st.id;
    vacancyId = (
      await call(admin, 'POST', `${R}/vacancies`, {
        title: 'TGT Maths',
        department: 'Teaching Senior',
        stageIds: [
          stage.Shortlisting,
          stage['Written test'],
          stage.Interview,
          stage['Final round'],
        ],
      })
    ).json().id as string;
    await call(admin, 'POST', `${R}/vacancies/${vacancyId}/submit`);
    await call(admin, 'POST', `${R}/vacancies/${vacancyId}/publish`, {
      opensAt: ist(0),
      closesAt: ist(300 * 86_400_000),
    });
  });
  afterAll(async () => app.close());

  it('who may put things right comes from the set-up', async () => {
    const s = (await call(hod, 'GET', `${R}/setup/corrections`)).json();
    expect(s).toMatchObject({
      undoHours: 24,
      undoRoles: ['school_admin'],
      undoEmployeeIds: [],
      correctionDays: 7,
    });
    expect((await call(hod, 'PUT', `${R}/setup/corrections`, s)).statusCode).toBe(403);
    expect((await settings({ undoHours: 48 })).statusCode).toBe(200);
    expect((await call(admin, 'GET', `${R}/setup/corrections`)).json().undoHours).toBe(48);
  });

  it('a wrong "not through" is undone: back at the stage, the candidate told; a pass undone goes back a stage', async () => {
    const a = await walkIn('Asha', '9840000001');
    await record(a, 'Shortlisting', 'fail');
    let v = await view(a);
    expect(v.status).toBe('rejected');
    expect(v.corrections).toMatchObject({ undo: true, move: true });
    expect(v.corrections.last.what).toBe('not_taken_forward');
    expect(
      (await call(admin, 'POST', `${R}/applications/${a}/undo`, { reason: '' })).statusCode,
    ).toBe(400);
    const u = await call(admin, 'POST', `${R}/applications/${a}/undo`, {
      reason: 'Wrong candidate ticked',
    });
    expect(u.json()).toMatchObject({
      status: 'screening',
      stageId: stage.Shortlisting,
      told: true,
    });
    v = await view(a);
    expect(v.stages[0]).toMatchObject({ result: null, current: true });
    expect(v.events.map((e: { what: string }) => e.what)).toContain('revoked');
    expect(await sent('recruitment_reopened')).toBe(1);
    // a pass undone: back at shortlisting
    await record(a, 'Shortlisting', 'pass');
    expect((await view(a)).stageId).toBe(stage['Written test']);
    await call(admin, 'POST', `${R}/applications/${a}/undo`, { reason: 'Marks not in yet' });
    v = await view(a);
    expect(v.stageId).toBe(stage.Shortlisting);
    expect(v.stages[0].result).toBeNull();
    // nothing left to undo once everything is undone
    expect(v.corrections.last).toBeNull();
  });

  it('the recorder may undo within the hours set; with none, only those named; a stage change needs a name', async () => {
    await settings({ undoRoles: [], undoHours: 24 });
    const b = await walkIn('Bina', '9840000002');
    await record(b, 'Shortlisting', 'hold');
    let v = await view(b);
    expect(v.corrections).toMatchObject({ undo: true, move: false });
    expect(
      (
        await call(admin, 'POST', `${R}/applications/${b}/move`, {
          stageId: stage.Interview,
          reason: 'Fast track',
        })
      ).statusCode,
    ).toBe(403);
    await settings({ undoRoles: [], undoHours: 0 });
    v = await view(b);
    expect(v.corrections.undo).toBe(false);
    const no = await call(admin, 'POST', `${R}/applications/${b}/undo`, { reason: 'Not on hold' });
    expect(no.statusCode).toBe(403);
    expect(no.json().type).toBe('recruitment.undo_not_allowed');
    await settings({});
    expect(
      (await call(admin, 'POST', `${R}/applications/${b}/undo`, { reason: 'Not on hold' })).json()
        .status,
    ).toBe('screening');
  });

  it('a stage change skips forward (the stages between marked skipped), opens an earlier stage again, and is undone', async () => {
    const c = await walkIn('Chitra', '9840000003');
    const fwd = await call(admin, 'POST', `${R}/applications/${c}/move`, {
      stageId: stage.Interview,
      reason: 'Experienced: straight to interview',
    });
    expect(fwd.json()).toMatchObject({ status: 'screening', stageId: stage.Interview, skipped: 2 });
    let v = await view(c);
    expect(v.stages.map((s: { result: string | null }) => s.result)).toEqual([
      'skipped',
      'skipped',
      null,
      null,
    ]);
    expect(v.stages[2].current).toBe(true);
    // undo the move: back where it was, the skipped stages as they were
    await call(admin, 'POST', `${R}/applications/${c}/undo`, {
      reason: 'Policy: everyone sits the test',
    });
    v = await view(c);
    expect(v.stageId).toBe(stage.Shortlisting);
    expect(v.stages.map((s: { result: string | null }) => s.result)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    // not through at the written test, then opened again at shortlisting: the candidate hears it is reopened
    await record(c, 'Shortlisting', 'pass');
    await record(c, 'Written test', 'fail');
    const before = await sent('recruitment_reopened');
    const back = await call(admin, 'POST', `${R}/applications/${c}/move`, {
      stageId: stage.Shortlisting,
      reason: 'Paper marked wrongly',
    });
    expect(back.json()).toMatchObject({
      status: 'screening',
      stageId: stage.Shortlisting,
      told: true,
    });
    v = await view(c);
    expect(v.stages.map((s: { result: string | null }) => s.result)).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(await sent('recruitment_reopened')).toBe(before + 1);
  });

  it('sent back for correction: screening pauses, the candidate corrects only the parts marked and sends it again; reminded a day before; the office may take the request back', async () => {
    // an online candidate
    const ch = await pub('POST', '/public/admissions/challenge');
    const nonce = PowService.solve(ch.json().challenge, ch.json().difficulty);
    const otp = await pub('POST', '/public/careers/otp', undefined, {
      schoolCode: school.code,
      channel: 'email',
      to: 'devi@example.invalid',
      challenge: ch.json().challenge,
      nonce,
    });
    token = (
      await pub('POST', '/public/careers/otp/verify', undefined, {
        schoolCode: school.code,
        channel: 'email',
        to: 'devi@example.invalid',
        code: otp.json().devCode,
      })
    ).json().token as string;
    const base = '23456789014';
    const aadhaar = base + [...'0123456789'].find((d) => aadhaarOk(base + d))!;
    await pub('PUT', '/public/careers/me/profile', token, {
      values: {
        first_name: 'Devi',
        gender: 'Female',
        dob: '1992-03-04',
        father_name: 'Ravi',
        mobile: '9840000004',
        email: 'devi@example.invalid',
        present_line1: '1 Lake Road',
        present_state: 'Uttar Pradesh',
        present_city: 'Noida',
        present_pin: '201301',
        aadhaar,
      },
      rows: { education: [{ qualification: 'M.Sc. Maths', passingYear: '2015' }] },
    });
    const slot = await pub('POST', '/public/careers/me/files/slot', token, {
      kind: 'photo',
      fileName: 'me.png',
      contentType: 'image/png',
      sizeBytes: png.length,
    });
    await inject({
      method: 'PUT',
      url: slot.json().upload.url,
      headers: {},
      raw: { body: png, contentType: 'image/png' },
    } as never);
    await pub('POST', '/public/careers/me/files', token, {
      kind: 'photo',
      fileId: slot.json().file.id,
    });
    const d = (
      await pub('POST', `/public/careers/vacancies/${vacancyId}/apply`, token, {
        declaration: true,
      })
    ).json().id as string;
    // the office sends it back: contact details, by tomorrow
    expect(
      (
        await call(admin, 'POST', `${R}/applications/${d}/send-back`, {
          remark: 'x',
          steps: [],
          dueOn: day(1),
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await call(admin, 'POST', `${R}/applications/${d}/send-back`, {
          remark: 'Mobile number is wrong',
          steps: ['contact'],
          dueOn: day(0),
        })
      ).statusCode,
    ).toBe(400);
    const sb = await call(admin, 'POST', `${R}/applications/${d}/send-back`, {
      remark: 'Mobile number is wrong',
      steps: ['contact'],
      dueOn: day(1),
    });
    expect(sb.json()).toMatchObject({ status: 'returned' });
    expect(await sent('recruitment_returned')).toBe(1);
    const mail = await withMigrator((c) =>
      c.query<{ body: string }>(
        `SELECT m.body FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
          WHERE m.school_id = $1 AND t.code = 'recruitment_returned' AND m.channel = 'email'`,
        [school.id],
      ),
    );
    expect(mail.rows[0]!.body).toContain('Mobile number is wrong');
    expect(mail.rows[0]!.body).toContain('/careers/mine');
    // screening waits
    expect((await record(d, 'Shortlisting', 'pass')).statusCode).toBe(409);
    const mine = (await pub('GET', '/public/careers/me', token)).json().applications[0];
    expect(mine).toMatchObject({
      status: 'returned',
      correction: {
        remark: 'Mobile number is wrong',
        steps: ['contact'],
        parts: 'Contact and address',
        overdue: false,
      },
    });
    // reminded a day before the last date, once
    const tick = () =>
      withMigrator(async (c) => {
        await c.query(`SELECT set_config('app.school_id', $1, false)`, [school.id]);
        return (
          await c.query<{ n: number }>(`SELECT app.recruitment_tick('http://localhost:3003') AS n`)
        ).rows[0]!.n;
      });
    expect(await tick()).toBe(1);
    expect(await tick()).toBe(0);
    expect(await sent('recruitment_reminder')).toBe(1);
    // the candidate changes the mobile (asked) and the first name (not asked): only the mobile is taken
    await pub('PUT', '/public/careers/me/profile', token, {
      values: { mobile: '9840000044', first_name: 'Devika' },
    });
    expect(
      (
        await pub('POST', `/public/careers/me/applications/${d}/resend`, token, {
          declaration: false,
        })
      ).statusCode,
    ).toBe(400);
    const rs = await pub('POST', `/public/careers/me/applications/${d}/resend`, token, {
      declaration: true,
    });
    expect(rs.json()).toEqual({ status: 'submitted', changed: ['Mobile'] });
    const v = await view(d);
    expect(v.status).toBe('submitted');
    expect(v.sections[0].fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'First name', value: 'DEVI' })]),
    );
    expect(v.correction).toMatchObject({ changed: ['Mobile'] });
    expect(v.events.map((e: { what: string }) => e.what)).toEqual(
      expect.arrayContaining(['returned', 'reminded', 'corrected']),
    );
    expect(await sent('recruitment_corrected')).toBe(1);
    // sent back again and taken back by the office: it goes on as it was
    await call(admin, 'POST', `${R}/applications/${d}/send-back`, {
      remark: 'Photo is blurred',
      steps: ['documents'],
      dueOn: day(3),
    });
    expect(
      (await call(admin, 'POST', `${R}/applications/${d}/send-back/cancel`, {})).json(),
    ).toEqual({
      status: 'submitted',
    });
    expect((await view(d)).status).toBe('submitted');
    expect(
      (
        await pub('POST', `/public/careers/me/applications/${d}/resend`, token, {
          declaration: true,
        })
      ).statusCode,
    ).toBe(409);
  });
});
