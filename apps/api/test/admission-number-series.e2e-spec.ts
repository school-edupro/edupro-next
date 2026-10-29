/**
 * Number series made easy (docs/design/63): placeholders in the prefix ({SESSION}, {YYYY}, {YY},
 * {CLASS}) filled per session and class; Test a series gives the series and number without using it;
 * registrations already made renumbered from their series (old numbers kept and still found; admitted
 * ones and admission series left alone).
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { seriesNumber } from '../src/modules/admissions/number-series';
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

describe('admission number series made easy (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const s = stamp('ANS');
  const ids: Record<string, string> = {};
  const apps: Record<string, string> = {};
  let session = '';
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(admin.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const series = (body: Record<string, unknown>) =>
    call('POST', '/admissions/number-series', {
      kind: 'registration',
      cycleId: ids.cycle,
      name: 'Registrations',
      nextNo: 1,
      digits: 4,
      ...body,
    });
  const numberOf = (id: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{ no: string; previous: string[] }>(
        `SELECT application_no AS no, previous_numbers AS previous FROM applications WHERE id = $1`,
        [id],
      );
      return r.rows[0]!;
    });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
    ids.one = (
      await call('POST', '/academics/classes', { code: 'I', name: 'Class I', displayOrder: 1 })
    ).json().id as string;
    ids.six = (
      await call('POST', '/academics/classes', { code: 'VI', name: 'Class VI', displayOrder: 6 })
    ).json().id as string;
    await withMigrator(async (c) => {
      session = (
        await c.query<{ name: string }>(`SELECT name FROM academic_years WHERE id = $1`, [
          school.yearId,
        ])
      ).rows[0]!.name.replace(/^Session\s+/i, '');
      const def = JSON.stringify({ fields: [] });
      ids.form = (
        await c.query<{ id: string }>(
          `INSERT INTO admission_forms (school_id, name, def) VALUES ($1, 'Mini form', $2::jsonb) RETURNING id::text`,
          [school.id, def],
        )
      ).rows[0]!.id;
      ids.cycle = (
        await c.query<{ id: string }>(
          `INSERT INTO admission_cycles (school_id, academic_year_id, code, name, opens_at, closes_at)
           VALUES ($1, $2, 'ADM27', 'Admissions 2027-28', now() - interval '10 days', now() + interval '20 days') RETURNING id::text`,
          [school.id, school.yearId],
        )
      ).rows[0]!.id;
      for (const k of [ids.one, ids.six])
        await c.query(
          `INSERT INTO admission_class_criteria (school_id, cycle_id, class_id, seats, form_id) VALUES ($1, $2, $3, 10, $4)`,
          [school.id, ids.cycle, k, ids.form],
        );
      // registrations already made with the default numbers; DEV was admitted
      for (const [i, [name, cls, status]] of (
        [
          ['ASHA', ids.one, 'registered'],
          ['BALU', ids.six, 'under_review'],
          ['CHITRA', ids.one, 'registered'],
          ['DEV', ids.one, 'admitted'],
        ] as const
      ).entries()) {
        const ap = await c.query<{ id: string }>(
          `INSERT INTO applicants (school_id) VALUES ($1) RETURNING id::text`,
          [school.id],
        );
        const a = await c.query<{ id: string }>(
          `INSERT INTO applications (school_id, cycle_id, class_id, applicant_id, child_first_name, candidate_name, application_no,
                                     status, form_id, form_snapshot, data, submitted_at, registered_at)
           VALUES ($1, $2, $3, $4, $5, $5, $6, $7, $8, $9::jsonb, '{}'::jsonb, now(), now() + $10 * interval '1 second')
           RETURNING id::text`,
          [
            school.id,
            ids.cycle,
            cls,
            ap.rows[0]!.id,
            name,
            `APP/${s}/${String(i + 1).padStart(5, '0')}`,
            status,
            ids.form,
            def,
            i,
          ],
        );
        apps[name] = a.rows[0]!.id;
      }
    });
  });
  afterAll(async () => app.close());

  it('fills the placeholders per session and class; an unknown one is refused', async () => {
    const bad = await series({ prefix: 'REG/{SESION}/' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().detail).toContain('{SESION} is not a placeholder');
    const ok = await series({ prefix: 'REG/{SESSION}/{CLASS}/' });
    expect(ok.statusCode).toBe(201);
    const made = (
      ok.json().series as Array<{ id: string; next: string; perClass: boolean; name: string }>
    ).find((x) => x.name === 'Registrations')!;
    ids.series = made.id;
    // a series for every class: the sample is the first class's, each class gets its own code
    expect(made).toMatchObject({ next: `REG/${session}/I/0001`, perClass: true });
    const list = (await call('GET', '/admissions/number-series')).json();
    expect(list.cycles[0]).toMatchObject({
      id: ids.cycle,
      session,
      registrations: 4,
      classes: [
        { id: ids.one, name: 'Class I', code: 'I' },
        { id: ids.six, name: 'Class VI', code: 'VI' },
      ],
    });
  });

  it('Test a series shows the series and number without using it; a real registration then takes it', async () => {
    const t = await call('POST', '/admissions/number-series/test', {
      kind: 'registration',
      cycleId: ids.cycle,
      classId: ids.six,
      answers: {},
    });
    expect(t.statusCode).toBe(201);
    expect(t.json()).toEqual({
      series: { id: ids.series, name: 'Registrations' },
      number: `REG/${session}/VI/0001`,
      usual: null,
    });
    // nothing used: the same answer again
    expect(
      (
        await call('POST', '/admissions/number-series/test', {
          kind: 'registration',
          cycleId: ids.cycle,
          classId: ids.six,
        })
      ).json().number,
    ).toBe(`REG/${session}/VI/0001`);
    expect(
      await withMigrator((c) =>
        seriesNumber(c as never, 'registration', {
          cycle_id: ids.cycle!,
          class_id: ids.six!,
          data: {},
        }),
      ),
    ).toBe(`REG/${session}/VI/0001`);
    // no admission series: the default
    expect(
      (
        await call('POST', '/admissions/number-series/test', {
          kind: 'admission',
          cycleId: ids.cycle,
          classId: ids.one,
        })
      ).json(),
    ).toMatchObject({ series: null, number: null });
  });

  it('renumbers registrations already made: preview, reason, old numbers kept and found; admitted left alone', async () => {
    const url = `/admissions/number-series/${ids.series!}/renumber`;
    const preview = (await call('POST', url, {})).json();
    expect(preview.applied).toBe(false);
    expect(preview.rows.map((x: { candidate: string; to: string }) => [x.candidate, x.to])).toEqual(
      [
        ['ASHA', `REG/${session}/I/0002`],
        ['BALU', `REG/${session}/VI/0003`],
        ['CHITRA', `REG/${session}/I/0004`],
      ],
    );
    expect((await numberOf(apps.ASHA!)).no).toBe(`APP/${s}/00001`);
    expect((await call('POST', url, { apply: true })).statusCode).toBe(400);
    const done = await call('POST', url, {
      apply: true,
      reason: 'Numbers by class from this session',
    });
    expect(done.statusCode).toBe(201);
    expect(done.json().applied).toBe(true);
    expect(await numberOf(apps.ASHA!)).toEqual({
      no: `REG/${session}/I/0002`,
      previous: [`APP/${s}/00001`],
    });
    expect((await numberOf(apps.DEV!)).no).toBe(`APP/${s}/00004`);
    const made = (
      done.json().series as Array<{ id: string; given: number; lastGiven: string }>
    ).find((x) => x.id === ids.series)!;
    expect(made).toMatchObject({ given: 4, lastGiven: `REG/${session}/I/0004` });
    // found by the old number, with a line in the history
    const found = (
      await call('GET', `/admissions/registrations?q=${encodeURIComponent(`APP/${s}/00002`)}`)
    ).json();
    expect(found.data.map((x: { id: string }) => x.id)).toEqual([apps.BALU]);
    const reg = (await call('GET', `/admissions/registrations/${apps.BALU!}`)).json();
    expect(
      (reg.events as Array<{ note: string }>).some((e) =>
        e.note.startsWith(`Registration no. APP/${s}/00002 → REG/${session}/VI/0003`),
      ),
    ).toBe(true);
    // again: they are in the series already
    const again = (await call('POST', url, {})).json();
    expect(again).toMatchObject({ rows: [], skipped: 3 });
  });

  it('admission numbers are never renumbered', async () => {
    const adm = await call('POST', '/admissions/number-series', {
      kind: 'admission',
      cycleId: ids.cycle,
      name: 'Admissions',
      prefix: 'ADM/{YY}/',
      nextNo: 1,
      digits: 4,
    });
    expect(adm.statusCode).toBe(201);
    const id = (adm.json().series as Array<{ id: string; name: string }>).find(
      (x) => x.name === 'Admissions',
    )!.id;
    const r = await call('POST', `/admissions/number-series/${id}/renumber`, {});
    expect(r.statusCode).toBe(400);
  });
});
