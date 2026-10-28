/**
 * Slots given automatically (docs/design/59, part 2): a candidate come to a Written test, Interview or
 * Interaction stage goes into the earliest slot of their class (or for every class) dated today or
 * later, India date, with room: the class's own slot first at the same time; past days and full slots
 * skipped; none with room leaves them waiting. No schedule message: the office mails it from the slot,
 * once per candidate.
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

describe('admission slots given automatically (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const s = stamp('AAS');
  const ids: Record<string, string> = {};
  const apps: string[] = [];
  const call = (method: 'GET' | 'POST' | 'PUT', url: string, json?: unknown) =>
    inject({
      method,
      url,
      headers: headersFor(admin.sub, school.id),
      ...(json === undefined ? {} : { json }),
    });
  // the India date of today and tomorrow, as ISO times at a given India clock time
  const istDay = (plus: number) =>
    new Date(Date.now() + 5.5 * 3_600_000 + plus * 86_400_000).toISOString().slice(0, 10);
  const at = (plus: number, hm: string) => `${istDay(plus)}T${hm}:00+05:30`;
  const slot = async (startsAt: string, capacity: number, classId: string | null) => {
    const r = await call('POST', `/admissions/cycles/${ids.cycle!}/slots`, {
      stageId: ids.interview,
      classId,
      startsAt,
      venue: `Room ${startsAt.slice(5, 16)}`,
      capacity,
    });
    expect(r.statusCode).toBe(201);
    return r.json().id as string;
  };
  const allotted = (appId: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{ slot_id: string; roll_no: number; notified_at: Date | null }>(
        `SELECT slot_id::text, roll_no, notified_at FROM admission_slot_allotments WHERE application_id = $1`,
        [appId],
      );
      return r.rows[0] ?? null;
    });
  const scheduleMails = (appId: string) =>
    withMigrator(async (c) => {
      const r = await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM comms_messages m JOIN comms_templates t ON t.id = m.template_id
          WHERE m.school_id = $1 AND t.code = 'admission_schedule' AND m.variables ->> '_app' = $2`,
        [school.id, appId],
      );
      return r.rows[0]!.n;
    });
  const pass = (appId: string) =>
    call('POST', `/admissions/registrations/${appId}/decide`, { decision: 'approve' });

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
    ids.cls = (
      await call('POST', '/academics/classes', { code: 'VI', name: 'Class VI', displayOrder: 6 })
    ).json().id as string;
    ids.other = (
      await call('POST', '/academics/classes', { code: 'VII', name: 'Class VII', displayOrder: 7 })
    ).json().id as string;
    const setup = (await call('GET', '/admissions/process-setup')).json();
    for (const st of setup.stages as Array<{ id: string; kind: string }>) ids[st.kind] = st.id;
    const proc = await call('POST', '/admissions/processes', {
      name: 'Class VI process',
      steps: [
        { stageId: ids.document_check, levels: [{ name: 'Office', by: 'anyone' }] },
        { stageId: ids.interview, levels: [{ name: 'Panel', by: 'anyone' }] },
        { stageId: ids.selection, levels: [{ name: 'Committee', by: 'anyone' }] },
      ],
      classIds: [ids.cls],
    });
    expect(proc.statusCode).toBe(201);
    await withMigrator(async (c) => {
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
      for (const k of [ids.cls, ids.other])
        await c.query(
          `INSERT INTO admission_class_criteria (school_id, cycle_id, class_id, seats, form_id) VALUES ($1, $2, $3, 10, $4)`,
          [school.id, ids.cycle, k, ids.form],
        );
      for (const [i, name] of ['ANU', 'BINU', 'CHINU', 'DINU', 'ESHU'].entries()) {
        const ap = await c.query<{ id: string }>(
          `INSERT INTO applicants (school_id) VALUES ($1) RETURNING id::text`,
          [school.id],
        );
        const a = await c.query<{ id: string }>(
          `INSERT INTO applications (school_id, cycle_id, class_id, applicant_id, child_first_name, candidate_name, application_no,
                                     status, form_id, form_snapshot, data, submitted_at, contact_email, registered_at)
           VALUES ($1, $2, $3, $4, $5, $5, $6, 'registered', $7, $8::jsonb, '{}'::jsonb, now(), $9, now() + $10 * interval '1 second')
           RETURNING id::text`,
          [
            school.id,
            ids.cycle,
            ids.cls,
            ap.rows[0]!.id,
            name,
            `${s}/${String(i + 1)}`,
            ids.form,
            def,
            `${name.toLowerCase()}.family@example.invalid`,
            i,
          ],
        );
        apps.push(a.rows[0]!.id);
      }
    });
    // opening a registration starts its class's process: Document check first, no slot there
    for (const id of apps)
      expect((await call('GET', `/admissions/registrations/${id}`)).statusCode).toBe(200);
  });
  afterAll(async () => app.close());

  it('a candidate passing Document check takes the earliest slot with room, today included; no message', async () => {
    // yesterday's slot has room but is over; Class VII's slot is not theirs
    ids.past = await slot(at(-1, '10:00'), 10, ids.cls!);
    ids.seventh = await slot(at(0, '00:01'), 10, ids.other!);
    // today's slot (already under way) holds one
    ids.today = await slot(at(0, '00:01'), 1, ids.cls!);
    // tomorrow at ten: the class's own slot before the every-class one
    ids.every = await slot(at(1, '10:00'), 1, null);
    ids.own = await slot(at(1, '10:00'), 1, ids.cls!);
    expect(await allotted(apps[0]!)).toBeNull();

    expect((await pass(apps[0]!)).statusCode).toBe(201);
    expect(await allotted(apps[0]!)).toMatchObject({
      slot_id: ids.today,
      roll_no: 1,
      notified_at: null,
    });
    expect(await scheduleMails(apps[0]!)).toBe(0);
    const reg = (await call('GET', `/admissions/registrations/${apps[0]!}`)).json();
    const notes = (reg.events as Array<{ note: string }>).map((e) => e.note);
    const auto = notes.findIndex((n) => /roll no\. 1\) · given automatically$/.test(n));
    const passed = notes.findIndex((n) => n.startsWith('Document check: approved'));
    expect(auto).toBeGreaterThanOrEqual(0);
    expect(passed).toBeGreaterThanOrEqual(0);

    // today's slot is full: the class's own slot tomorrow, then the every-class one
    await pass(apps[1]!);
    expect(await allotted(apps[1]!)).toMatchObject({ slot_id: ids.own, roll_no: 2 });
    await pass(apps[2]!);
    expect(await allotted(apps[2]!)).toMatchObject({ slot_id: ids.every, roll_no: 3 });
    // no slot with room: waits, listed by name on the slot
    await pass(apps[3]!);
    expect(await allotted(apps[3]!)).toBeNull();
    const own = (await call('GET', `/admissions/slots/${ids.own}`)).json();
    expect(own.waiting).toBe(1);
    expect(own.waitingList).toEqual([
      { applicationId: apps[3], number: `${s}/4`, candidate: 'DINU', className: 'Class VI' },
    ]);
    expect(own.candidates).toEqual([
      expect.objectContaining({ applicationId: apps[1], rollNo: 2, notified: false }),
    ]);
    // the past slot and Class VII's slot took nobody
    for (const id of [ids.past, ids.seventh])
      expect((await call('GET', `/admissions/slots/${id!}`)).json().candidates).toEqual([]);
  });

  it('a rejected candidate takes no slot; Allot still places the one waiting', async () => {
    expect(
      (
        await call('POST', `/admissions/registrations/${apps[4]!}/decide`, {
          decision: 'reject',
          remarks: 'Documents missing',
        })
      ).statusCode,
    ).toBe(201);
    expect(await allotted(apps[4]!)).toBeNull();
    // more room: the office allots the one waiting (without the mail tick)
    expect(
      (
        await call('PUT', `/admissions/slots/${ids.own!}`, {
          stageId: ids.interview,
          classId: ids.cls,
          startsAt: at(1, '10:00'),
          venue: 'Room tomorrow',
          capacity: 2,
        })
      ).statusCode,
    ).toBe(200);
    const r = await call('POST', `/admissions/slots/${ids.own!}/allot`, { notify: false });
    expect(r.statusCode).toBe(201);
    expect(await allotted(apps[3]!)).toMatchObject({ slot_id: ids.own, roll_no: 4 });
  });

  it('Mail the schedule sends to those not yet told, once each', async () => {
    const first = await call('POST', `/admissions/slots/${ids.own!}/notify`);
    expect(first.statusCode).toBe(201);
    expect(first.json().mailed).toBe(2);
    expect(first.json().slot.candidates.every((x: { notified: boolean }) => x.notified)).toBe(true);
    expect(await scheduleMails(apps[1]!)).toBeGreaterThan(0);
    expect(await scheduleMails(apps[3]!)).toBeGreaterThan(0);
    const again = await call('POST', `/admissions/slots/${ids.own!}/notify`);
    expect(again.json().mailed).toBe(0);
    // the other slots are untouched
    expect(await scheduleMails(apps[0]!)).toBe(0);
  });
});
