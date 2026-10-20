/**
 * Recruitment, part 3 (0199, docs/design/34-recruitment.md): candidates and screening. Walk-in candidates
 * checked as the employee master checks; stages in the vacancy's order; bulk shortlisting; a schedule that
 * tells the candidate; marks within the stage's maximum; pass, fail, hold and resume; the last stage
 * selects; the office's rights; the notice settings.
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

describe('recruitment: candidates and screening (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let hod: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const call = (u: SeededUser, method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({ method, url, headers: h(u), ...(json === undefined ? {} : { json }) });
  const R = '/people/recruitment';
  let vacancyId = '';
  let draftId = '';
  const stage: Record<string, string> = {};
  const app_: Record<string, string> = {};
  /** A date-and-time box's value (India time), `ms` from now. */
  const ist = (ms: number) => new Date(Date.now() + 330 * 60_000 + ms).toISOString().slice(0, 16);
  const empMobile = `9${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;

  beforeAll(async () => {
    const s = stamp('RCS');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      hod = await seedUser(c, school, `${s}-hod`, 'academic_coordinator');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, designation, employee_type, mobile)
         VALUES ($1, 'EX9', 'Existing', 'TGT', 'teaching', $2)`,
        [school.id, empMobile],
      );
    });
    app = await createApp();
    inject = injector(app);
    const setup = (await call(admin, 'GET', `${R}/setup`)).json();
    for (const st of setup.stages as Array<{ id: string; name: string }>) stage[st.name] = st.id;
    const make = async (title: string) =>
      (
        await call(admin, 'POST', `${R}/vacancies`, {
          title,
          posts: 1,
          stageIds: [stage.Shortlisting, stage.Interview, stage['Final round']],
        })
      ).json().id as string;
    vacancyId = await make('TGT English');
    draftId = await make('Driver');
    // raised by the school admin, the approver: approved as it is sent
    expect((await call(admin, 'POST', `${R}/vacancies/${vacancyId}/submit`)).json().status).toBe(
      'approved',
    );
    await call(admin, 'POST', `${R}/vacancies/${vacancyId}/publish`, {
      opensAt: ist(0),
      closesAt: ist(300 * 86_400_000),
    });
  });
  afterAll(async () => app.close());

  it('the office adds walk-in candidates, checked as the employee master checks; once per post; only to an approved vacancy', async () => {
    const walk = (u: SeededUser, body: Record<string, unknown>) =>
      call(u, 'POST', `${R}/applications`, body);
    const base = { vacancyId, gender: 'Female', dob: '1990-01-01' };
    const bad = await walk(admin, {
      ...base,
      firstName: 'Asha',
      gender: 'Robot',
      mobile: '9811111111',
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toMatch(/Gender/);
    expect((await walk(hod, { ...base, firstName: 'Asha', mobile: '9811111111' })).statusCode).toBe(
      403,
    );
    expect(
      (await walk(admin, { ...base, vacancyId: draftId, firstName: 'Asha', mobile: '9811111111' }))
        .statusCode,
    ).toBe(409);
    for (const [k, first, mobile, email] of [
      ['A', 'Asha', '9811111111', 'asha@example.invalid'],
      ['B', 'Bina', '9822222222', undefined],
      ['C', 'Chitra', empMobile, undefined],
    ] as const) {
      const r = await walk(admin, {
        ...base,
        firstName: first,
        mobile,
        ...(email ? { email } : {}),
      });
      expect(r.statusCode).toBe(201);
      app_[k] = r.json().id as string;
    }
    expect(
      (await walk(admin, { ...base, firstName: 'Asha', mobile: '9811111111' })).statusCode,
    ).toBe(409);
    const list = (await call(hod, 'GET', `${R}/applications?vacancy=${vacancyId}`)).json();
    expect(list.data).toHaveLength(3);
    expect(
      list.data.every(
        (x: { stage: string; status: string }) =>
          x.stage === 'Shortlisting' && x.status === 'submitted',
      ),
    ).toBe(true);
    expect(list.data.find((x: { id: string }) => x.id === app_.C).match).toBe(true);
    expect(
      (await call(hod, 'GET', `${R}/applications?match=1`))
        .json()
        .data.map((x: { id: string }) => x.id),
    ).toEqual([app_.C]);
    const view = (await call(hod, 'GET', `${R}/applications/${app_.A}`)).json();
    expect(view.source).toBe('office');
    expect(view.sections[0].fields).toEqual(
      expect.arrayContaining([expect.objectContaining({ label: 'First name', value: 'ASHA' })]),
    );
    expect(view.stages.map((s: { name: string; current: boolean }) => [s.name, s.current])).toEqual(
      [
        ['Shortlisting', true],
        ['Interview', false],
        ['Final round', false],
      ],
    );
    expect(view.can).toMatchObject({ record: false, reject: false });
  });

  it('shortlisting in bulk moves the ticked ones on; a candidate at another stage is skipped; one is not taken forward', async () => {
    expect(
      (
        await call(hod, 'POST', `${R}/applications/bulk`, {
          ids: [app_.A],
          stageId: stage.Shortlisting,
          result: 'pass',
        })
      ).statusCode,
    ).toBe(403);
    const b = await call(admin, 'POST', `${R}/applications/bulk`, {
      ids: [app_.A, app_.B],
      stageId: stage.Shortlisting,
      result: 'pass',
    });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual({ done: 2, skipped: [] });
    const again = await call(admin, 'POST', `${R}/applications/bulk`, {
      ids: [app_.A, app_.C],
      stageId: stage.Interview,
      result: 'pass',
      remarks: 'x',
    });
    // C is still at shortlisting: skipped; A at the interview passes it
    expect(again.json().done).toBe(1);
    expect(again.json().skipped).toHaveLength(1);
    const rej = await call(admin, 'POST', `${R}/applications/${app_.C}/reject`, {
      note: 'Already on the staff',
    });
    expect(rej.statusCode).toBe(200);
    expect((await call(admin, 'GET', `${R}/applications/${app_.C}`)).json()).toMatchObject({
      status: 'rejected',
      decisionNote: 'Already on the staff',
    });
    expect((await call(admin, 'POST', `${R}/applications/${app_.C}/reject`, {})).statusCode).toBe(
      409,
    );
  });

  it('a stage is scheduled (the candidate is told), marks stay within the maximum, hold and resume; passing the last stage selects', async () => {
    // B is at the interview: scheduled with venue and panel; a notice by email goes when there is an email
    const sched = await call(
      admin,
      'POST',
      `${R}/applications/${app_.B}/stages/${stage.Interview}`,
      {
        scheduledAt: '2099-01-10T10:30',
        venue: 'Room 4',
        panel: 'Principal, HOD',
      },
    );
    expect(sched.statusCode).toBe(200);
    const vb = (await call(admin, 'GET', `${R}/applications/${app_.B}`)).json();
    const iv = vb.stages.find((s: { name: string }) => s.name === 'Interview');
    expect(iv).toMatchObject({
      venue: 'Room 4',
      panel: 'Principal, HOD',
      current: true,
      result: null,
    });
    expect(iv.scheduledAt).toBe('2099-01-10T05:00:00.000Z');
    expect(vb.events.map((e: { what: string }) => e.what)).toEqual([
      'added',
      'passed',
      'scheduled',
    ]);
    // not at this stage; marks over the stage's 30
    expect(
      (
        await call(admin, 'POST', `${R}/applications/${app_.B}/stages/${stage['Final round']}`, {
          result: 'pass',
        })
      ).statusCode,
    ).toBe(409);
    expect(
      (
        await call(admin, 'POST', `${R}/applications/${app_.B}/stages/${stage.Interview}`, {
          marks: 31,
          result: 'pass',
        })
      ).statusCode,
    ).toBe(400);
    const hold = await call(
      admin,
      'POST',
      `${R}/applications/${app_.B}/stages/${stage.Interview}`,
      {
        marks: 22,
        result: 'hold',
        remarks: 'Second opinion',
      },
    );
    expect(hold.json()).toMatchObject({ status: 'on_hold', stageId: stage.Interview });
    expect((await call(admin, 'POST', `${R}/applications/${app_.B}/resume`)).json()).toEqual({
      status: 'screening',
    });
    // A passed the interview in bulk: now the final round; passing it selects
    const fin = await call(
      admin,
      'POST',
      `${R}/applications/${app_.A}/stages/${stage['Final round']}`,
      {
        result: 'pass',
        remarks: 'Offer to be made',
      },
    );
    expect(fin.json()).toMatchObject({ status: 'selected' });
    expect(
      (
        await call(admin, 'POST', `${R}/applications/${app_.A}/stages/${stage['Final round']}`, {
          result: 'fail',
        })
      ).statusCode,
    ).toBe(409);
    const pipe = (await call(hod, 'GET', `${R}/vacancies/${vacancyId}/pipeline`)).json();
    expect(pipe).toMatchObject({ posts: 1, total: 3, selected: 1, rejected: 1 });
    expect(pipe.stages.map((s: { name: string; open: number }) => [s.name, s.open])).toEqual([
      ['Shortlisting', 0],
      ['Interview', 1],
      ['Final round', 0],
    ]);
    // the notices that had an address were queued through the school's templates (email; SMS needs DLT ids)
    const sent = await withMigrator((c) =>
      c.query<{ code: string }>(
        `SELECT t.code FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
          WHERE m.school_id = $1 AND t.code LIKE 'recruitment_%' ORDER BY m.id`,
        [school.id],
      ),
    );
    expect(sent.rows.map((x) => x.code)).toEqual(['recruitment_applied', 'recruitment_selected']);
  });

  it('the notices are the school’s to set; rejection notices start off', async () => {
    const n = (await call(hod, 'GET', `${R}/setup/notices`)).json();
    expect(n).toEqual({
      applied: true,
      scheduled: true,
      selected: true,
      rejected: false,
      sms: true,
      whatsapp: false,
      email: true,
    });
    expect(
      (await call(hod, 'PUT', `${R}/setup/notices`, { ...n, rejected: true })).statusCode,
    ).toBe(403);
    expect(
      (await call(admin, 'PUT', `${R}/setup/notices`, { ...n, rejected: true })).statusCode,
    ).toBe(200);
    expect((await call(admin, 'GET', `${R}/setup/notices`)).json().rejected).toBe(true);
  });
});
