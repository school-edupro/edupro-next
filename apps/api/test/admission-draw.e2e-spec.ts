/**
 * Draw of lots (docs/design/60, parts 2-3; 62): the totals of the form's merit points of a class's registered
 * candidates (test marks not added; Document check need not have approved them); a total's slips (twins on one slip, found by the same date of birth and family mobile,
 * confirmed or split); the slips' settings per session with a class's own; the hand draw recorded in
 * drawn order: the first seats offered (a twin slip both), the rest wait-listed in order.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PDFDocument } from 'pdf-lib';
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

describe('admission draw of lots slips (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const s = stamp('ADL');
  const ids: Record<string, string> = {};
  const apps: Record<string, string> = {};
  const nos: Record<string, string> = {};
  const call = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(admin.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  const qs = (x: Record<string, string> = {}) =>
    new URLSearchParams({ cycleId: ids.cycle!, classId: ids.cls!, ...x }).toString();
  const pages = async (x: { base64: string }) =>
    (await PDFDocument.load(Buffer.from(x.base64, 'base64'))).getPageCount();
  const stateOf = (id: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{ status: string; wait_rank: number | null }>(
        `SELECT status::text, wait_rank FROM applications WHERE id = $1`,
        [id],
      );
      return r.rows[0]!;
    });
  // name, points, confirmed, date of birth, mobile (CHINU and DINU are twins)
  const people: Array<[string, number, boolean, string, string]> = [
    ['ANU', 70, true, '2022-01-10', '9000000001'],
    ['BINU', 70, true, '2022-02-11', '9000000002'],
    ['CHINU', 70, true, '2022-03-12', '9000000003'],
    ['DINU', 70, true, '2022-03-12', '+91 90000 00003'],
    ['ESHU', 70, true, '2022-05-14', '9000000005'],
    ['FIZA', 70, false, '2022-06-15', '9000000006'],
    ['GUNU', 80, true, '2022-07-16', '9000000007'],
  ];

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
    ids.cls = (
      await call('POST', '/academics/classes', { code: 'NUR', name: 'Nursery', displayOrder: 1 })
    ).json().id as string;
    const setup = (await call('GET', '/admissions/process-setup')).json();
    for (const st of setup.stages as Array<{ id: string; kind: string }>) ids[st.kind] = st.id;
    const proc = await call('POST', '/admissions/processes', {
      name: 'Nursery process',
      steps: [
        { stageId: ids.document_check, levels: [{ name: 'Office', by: 'anyone' }] },
        { stageId: ids.selection, levels: [{ name: 'Committee', by: 'anyone' }] },
      ],
      classIds: [ids.cls],
    });
    expect(proc.statusCode).toBe(201);
    await withMigrator(async (c) => {
      const def = JSON.stringify({
        fields: [
          { key: 'father_name', label: "Father's name", type: 'text', maps: 'father_name' },
          { key: 'mother_name', label: "Mother's name", type: 'text', maps: 'mother_name' },
        ],
      });
      ids.form = (
        await c.query<{ id: string }>(
          `INSERT INTO admission_forms (school_id, name, def) VALUES ($1, 'Nursery form', $2::jsonb) RETURNING id::text`,
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
      await c.query(
        `INSERT INTO admission_class_criteria (school_id, cycle_id, class_id, seats, form_id) VALUES ($1, $2, $3, 10, $4)`,
        [school.id, ids.cycle, ids.cls, ids.form],
      );
      ids.general = (
        await c.query<{ id: string }>(
          `INSERT INTO admission_fee_categories (school_id, code, name, is_default) VALUES ($1, 'general_${s.toLowerCase().replace(/[^a-z0-9]/g, '')}', 'General', true)
           ON CONFLICT (school_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id::text`,
          [school.id],
        )
      ).rows[0]!.id;
      for (const [i, [name, , , dob, mobile]] of people.entries()) {
        const ap = await c.query<{ id: string }>(
          `INSERT INTO applicants (school_id) VALUES ($1) RETURNING id::text`,
          [school.id],
        );
        nos[name] = `${s}/${String(i + 1).padStart(2, '0')}`;
        const a = await c.query<{ id: string }>(
          `INSERT INTO applications (school_id, cycle_id, class_id, applicant_id, child_first_name, candidate_name, application_no,
                                     status, form_id, form_snapshot, data, submitted_at, child_dob, contact_mobile, category_id)
           VALUES ($1, $2, $3, $4, $5, $5, $6, 'registered', $7, $8::jsonb, $9::jsonb, now(), $10, $11, $12) RETURNING id::text`,
          [
            school.id,
            ids.cycle,
            ids.cls,
            ap.rows[0]!.id,
            name,
            nos[name],
            ids.form,
            def,
            JSON.stringify({ father_name: `FATHER ${name}`, mother_name: `MOTHER ${name}` }),
            dob,
            mobile,
            ids.general,
          ],
        );
        apps[name] = a.rows[0]!.id;
      }
    });
    // the process starts; those confirmed pass Document check to Selection
    for (const [name, , confirmed] of people) {
      expect((await call('GET', `/admissions/registrations/${apps[name]!}`)).statusCode).toBe(200);
      if (confirmed)
        expect(
          (
            await call('POST', `/admissions/registrations/${apps[name]!}/decide`, {
              decision: 'approve',
            })
          ).statusCode,
        ).toBe(201);
    }
    // the form's points; ESHU's merit as if 15 test marks were added (the draw does not use them)
    await withMigrator(async (c) => {
      for (const [name, points] of people)
        await c.query(`UPDATE applications SET form_points = $2, merit = $3 WHERE id = $1`, [
          apps[name],
          points,
          name === 'ESHU' ? points + 15 : points,
        ]);
    });
  });
  afterAll(async () => app.close());

  it('lists each points total with its registered candidates and how many are confirmed', async () => {
    const o = (await call('GET', '/admissions/draw/options')).json();
    expect(o.cycles).toEqual([
      expect.objectContaining({
        id: ids.cycle,
        classes: [{ id: ids.cls, name: 'Nursery', withPoints: 7 }],
      }),
    ]);
    expect(o.categories).toEqual(expect.arrayContaining([{ id: ids.general, name: 'General' }]));
    const t = (await call('GET', `/admissions/draw/totals?${qs()}`)).json();
    expect(t.totals).toEqual([
      { points: '80', candidates: 1, confirmed: 1 },
      { points: '70', candidates: 6, confirmed: 5 },
    ]);
    expect(
      (await call('GET', `/admissions/draw/totals?${qs({ categoryId: ids.general! })}`)).json()
        .totals,
    ).toHaveLength(2);
  });

  it('a total: every registered candidate on a slip (confirmed or not), twins on one; marks not added', async () => {
    const g = (await call('GET', `/admissions/draw/group?${qs({ points: '70' })}`)).json();
    expect(g.candidates.map((x: { candidate: string }) => x.candidate)).toEqual([
      'ANU',
      'BINU',
      'CHINU',
      'DINU',
      'ESHU',
      'FIZA',
    ]);
    expect(g.candidates[0]).toMatchObject({
      father: 'FATHER ANU',
      category: 'General',
      points: '70',
      meritNo: expect.stringMatching(/^[2-6]$/),
    });
    expect(g.candidates.find((x: { candidate: string }) => x.candidate === 'FIZA')).toMatchObject({
      confirmed: false,
    });
    expect(g.candidates.find((x: { candidate: string }) => x.candidate === 'ESHU')).toMatchObject({
      points: '70',
      merit: '85',
    });
    expect(g.twins).toEqual([{ ids: [apps.CHINU, apps.DINU], state: 'found' }]);
    expect(g.slips).toBe(5);
    // the default slips: 4 a page
    const p = (await call('GET', `/admissions/draw/slips?${qs({ points: '70' })}`)).json();
    expect(p).toMatchObject({ slips: 5, contentType: 'application/pdf' });
    expect(p.filename).toBe('draw-slips-nursery-70-points.pdf');
    expect(await pages(p)).toBe(2);
    // nobody at 60
    expect((await call('GET', `/admissions/draw/slips?${qs({ points: '60' })}`)).statusCode).toBe(
      409,
    );
  });

  it("the session's settings, a class's own over them, and back", async () => {
    const get = async () =>
      (await call('GET', `/admissions/draw/settings?${qs()}`)).json() as {
        from: string;
        settings: { perPage: number; heading: string };
      };
    expect((await get()).from).toBe('defaults');
    const base = {
      heading: 'General category draw slip - {class} ({points} points)',
      fields: ['photo', 'name', 'father', 'mother', 'number', 'sno', 'points', 'session', 'draw'],
      drawAt: '2027-01-15T11:00:00+05:30',
      venue: 'School auditorium',
      footer: '*Admission subject to verification of documents.',
      showLogo: true,
    };
    const session = await call('PUT', '/admissions/draw/settings', {
      cycleId: ids.cycle,
      ...base,
      perPage: 2,
    });
    expect(session.statusCode).toBe(200);
    expect(await get()).toMatchObject({ from: 'session', settings: { perPage: 2 } });
    const slips = async () =>
      pages((await call('GET', `/admissions/draw/slips?${qs({ points: '70' })}`)).json());
    expect(await slips()).toBe(3);
    expect(
      (
        await call('PUT', '/admissions/draw/settings', {
          cycleId: ids.cycle,
          classId: ids.cls,
          ...base,
          perPage: 8,
        })
      ).statusCode,
    ).toBe(200);
    expect(await get()).toMatchObject({ from: 'class', settings: { perPage: 8 } });
    expect(await slips()).toBe(1);
    expect((await call('DELETE', `/admissions/draw/settings?${qs()}`)).json()).toMatchObject({
      from: 'session',
      settings: { perPage: 2 },
    });
    // an unknown detail is refused
    expect(
      (
        await call('PUT', '/admissions/draw/settings', {
          cycleId: ids.cycle,
          ...base,
          fields: ['name', 'shoe size'],
          perPage: 4,
        })
      ).statusCode,
    ).toBe(400);
  });

  it('twins split onto a slip each, and paired again', async () => {
    const twins = (state: string) =>
      call('PUT', '/admissions/draw/twins', {
        cycleId: ids.cycle,
        classId: ids.cls,
        ids: [apps.DINU, apps.CHINU],
        state,
      });
    expect((await twins('split')).statusCode).toBe(200);
    let g = (await call('GET', `/admissions/draw/group?${qs({ points: '70' })}`)).json();
    expect(g.twins).toEqual([{ ids: [apps.CHINU, apps.DINU], state: 'split' }]);
    expect(g.slips).toBe(6);
    await twins('paired');
    g = (await call('GET', `/admissions/draw/group?${qs({ points: '70' })}`)).json();
    expect(g.twins).toEqual([{ ids: [apps.CHINU, apps.DINU], state: 'paired' }]);
    expect(g.slips).toBe(5);
  });

  it('the drawn order is checked: unknown or repeated numbers named; seats beyond those left refused', async () => {
    const r = await call('POST', '/admissions/draw/check', {
      cycleId: ids.cycle,
      classId: ids.cls,
      points: '70',
      seats: 2,
      numbers: [nos.ESHU, 'NOPE/1', nos.ESHU, '  ', nos.GUNU],
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().errors).toEqual([
      'NOPE/1: not a slip of 70 points here',
      `${nos.ESHU!}: drawn twice`,
      `${nos.GUNU!}: not a slip of 70 points here`,
    ]);
    expect(r.json().seatsLeft).toBe(10);
    const many = await call('POST', '/admissions/draw/check', {
      cycleId: ids.cycle,
      classId: ids.cls,
      points: '70',
      seats: 11,
      numbers: [nos.ESHU],
    });
    expect(many.json().errors).toEqual(['Only 10 seats are left in this class']);
  });

  it('the draw recorded: the first seats offered (the twins both), the rest wait-listed in drawn order', async () => {
    const body = {
      cycleId: ids.cycle,
      classId: ids.cls,
      points: '70',
      seats: 2,
      // a twin slip drawn by the second twin's number
      numbers: [nos.ESHU, nos.DINU, nos.ANU],
    };
    const check = (await call('POST', '/admissions/draw/check', body)).json();
    expect(check.errors).toEqual([]);
    expect(
      check.order.map((x: { rank: number; names: string[]; outcome: string }) => [
        x.rank,
        x.names.join(' & '),
        x.outcome,
      ]),
    ).toEqual([
      [1, 'ESHU', 'offered'],
      [2, 'CHINU & DINU', 'offered'],
      [3, 'ANU', 'waitlisted'],
    ]);
    expect(check.extraSeats).toBe(1);
    expect(check.notDrawn).toEqual([
      { numbers: [nos.BINU], names: ['BINU'] },
      { numbers: [nos.FIZA], names: ['FIZA'] },
    ]);
    const rec = await call('POST', '/admissions/draw/record', body);
    expect(rec.statusCode).toBe(201);
    for (const n of ['ESHU', 'CHINU', 'DINU'])
      expect((await stateOf(apps[n]!)).status).toBe('offered');
    expect(await stateOf(apps.ANU!)).toEqual({ status: 'waitlisted', wait_rank: 1 });
    expect((await stateOf(apps.BINU!)).status).toBe('under_review');
    const list = (await call('GET', `/admissions/draw/records?${qs()}`)).json();
    expect(list).toEqual([
      expect.objectContaining({
        id: rec.json().id,
        points: '70',
        seats: 2,
        offered: 3,
        waitlisted: 1,
        extraSeats: 1,
      }),
    ]);
    const pdf = (
      await call('GET', `/admissions/draw/records/${rec.json().id as string}/pdf`)
    ).json();
    expect(pdf.filename).toBe('draw-result-nursery-70-points.pdf');
    expect(await pages(pdf)).toBe(1);
    // the history says how the seat came
    const reg = (await call('GET', `/admissions/registrations/${apps.DINU!}`)).json();
    expect(
      (reg.events as Array<{ note: string }>).some((e) =>
        e.note.includes('Draw of lots by slips (70 points), slip 2 drawn'),
      ),
    ).toBe(true);
    // drawn again: those offered or wait-listed are no longer slips
    const again = await call('POST', '/admissions/draw/record', body);
    expect(again.statusCode).toBe(400);
  });

  // ---- docs/design/62, part 2 ------------------------------------------------------------------------
  it("Document check's first approval confirms the points; undoing it clears them", async () => {
    const totals = async () =>
      (await call('GET', `/admissions/draw/totals?${qs()}`)).json().totals as Array<{
        points: string;
        candidates: number;
        confirmed: number;
      }>;
    expect((await totals()).find((x) => x.points === '80')).toEqual({
      points: '80',
      candidates: 1,
      confirmed: 1,
    });
    const undo = await call('POST', `/admissions/registrations/${apps.GUNU!}/undo`, {
      reason: 'Approved by mistake',
    });
    expect(undo.statusCode).toBe(201);
    expect((await totals()).find((x) => x.points === '80')).toEqual({
      points: '80',
      candidates: 1,
      confirmed: 0,
    });
    await call('POST', `/admissions/registrations/${apps.GUNU!}/decide`, { decision: 'approve' });
    expect((await totals()).find((x) => x.points === '80')!.confirmed).toBe(1);
  });

  it('blank slips print in the layout; merit no. and merit total are details a slip may show', async () => {
    const blank = (await call('GET', `/admissions/draw/blank?${qs({ pages: '3' })}`)).json();
    expect(blank.filename).toBe('blank-draw-slips-nursery.pdf');
    expect(await pages(blank)).toBe(3);
    expect((await call('GET', `/admissions/draw/blank?${qs({ pages: '21' })}`)).statusCode).toBe(
      400,
    );
    expect(
      (
        await call('PUT', '/admissions/draw/settings', {
          cycleId: ids.cycle,
          heading: 'Draw slip - {class} (merit {merit})',
          fields: ['name', 'number', 'merit', 'merit_no'],
          drawAt: null,
          venue: null,
          footer: null,
          perPage: 4,
          showLogo: false,
        })
      ).statusCode,
    ).toBe(200);
    // BINU and FIZA remain at 70 points (the rest were drawn); FIZA's points not yet confirmed
    const p = (await call('GET', `/admissions/draw/slips?${qs({ points: '70' })}`)).json();
    expect(p.slips).toBe(2);
  });
});
