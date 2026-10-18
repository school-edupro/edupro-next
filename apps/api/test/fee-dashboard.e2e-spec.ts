/**
 * The fee dashboard (docs/design/29-fee-and-consent-dashboards.md): school, hostel and misc together
 * or one at a time, live from the ledgers. A reversed or bounced receipt is not money in; an opening
 * credit (a negative demand) does not lower what is due; a cheque not yet cleared is waiting; cash
 * without a deposit slip is still to deposit; who owes most, by age.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  injector,
  seedSchool,
  seedUser,
  stamp,
  type SeededSchool,
  type SeededUser,
  withMigrator,
} from './helpers';

describe('fee dashboard (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  const ids: Record<string, string> = {};
  const get = (url: string, u: SeededUser = admin) =>
    inject({ method: 'GET', url, headers: headersFor(u.sub, school.id) });

  beforeAll(async () => {
    const s = stamp('fdash');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}F`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
    });
    app = await createApp();
    inject = injector(app);
    const post = (url: string, json: unknown) =>
      inject({ method: 'POST', url, headers: headersFor(admin.sub, school.id), json });
    const cls = await post('/academics/classes', { code: 'V', name: 'Class V', displayOrder: 5 });
    const sec = (await post(`/academics/classes/${cls.json().id}/sections`, { name: 'A' })).json()
      .id;
    for (const [key, n] of [
      ['ana', 1],
      ['bo', 2],
    ] as const) {
      const st = await post('/people/students', {
        admissionNo: `${s}-${n}`,
        firstName: key,
        lastName: 'Pupil',
        guardians: [
          {
            guardian: { firstName: 'G', lastName: key, mobile: `98765432${n}0` },
            relation: 'mother',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: sec, rollNo: n },
      });
      expect(st.statusCode).toBe(201);
      ids[key] = st.json().id;
    }
    await withMigrator(async (c) => {
      const sid = school.id;
      const y = school.yearId;
      const per = await c.query<{ id: string }>(
        `INSERT INTO fee_periods (school_id, academic_year_id, sequence, name, month, year, instalment, due_on)
         VALUES ($1, $2, 1, 'Term 1', 4, 2026, 1, '2026-04-10') RETURNING id::text`,
        [sid, y],
      );
      const per2 = await c.query<{ id: string }>(
        `INSERT INTO fee_periods (school_id, academic_year_id, sequence, name, month, year, instalment, due_on)
         VALUES ($1, $2, 2, 'Term 2', 10, 2026, 2, '2026-10-10') RETURNING id::text`,
        [sid, y],
      );
      const head = async (code: string, ledger: string) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO fee_heads (school_id, code, name, ledger) VALUES ($1, $2, $2, $3::ledger_type) RETURNING id::text`,
            [sid, code, ledger],
          )
        ).rows[0]!.id;
      const tuition = await head('TUI', 'school');
      const hostel = await head('HOS', 'hostel');
      const miscHead = await head('MSC', 'misc');
      const today = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
      const demand = (
        student: string,
        h: string,
        ledger: string,
        net: number,
        paid: number,
        due: string,
        status: string,
        period?: string,
      ) =>
        c.query(
          `INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, net, paid, status, due_on, ledger)
           VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8::fee_demand_status, ${due}, $9::ledger_type)`,
          [sid, student, y, period ?? per.rows[0]!.id, h, net, paid, status, ledger],
        );
      // school: 1000 due 40 days ago (400 paid), 500 due in 20 days; an opening credit of 300
      await demand(ids.ana!, tuition, 'school', 1000, 400, `${today} - 40`, 'partial');
      await demand(
        ids.ana!,
        tuition,
        'school',
        500,
        0,
        `${today} + 20`,
        'pending',
        per2.rows[0]!.id,
      );
      await demand(ids.bo!, tuition, 'school', -300, 0, `${today} - 40`, 'pending');
      // hostel: 2000 due 100 days ago, nothing paid
      await demand(ids.bo!, hostel, 'hostel', 2000, 0, `${today} - 100`, 'pending');
      const pay = (
        student: string,
        ledger: string,
        amount: number,
        mode: string,
        status: string,
        cleared: boolean,
      ) =>
        c.query(
          `INSERT INTO fee_payments (school_id, student_id, academic_year_id, amount, received_on, mode, status, ledger, received_by, cleared_on)
           VALUES ($1, $2, $3, $4, ${today}, $5, $6, $7::ledger_type, $8, CASE WHEN $9 THEN ${today} END)`,
          [sid, student, y, amount, mode, status, ledger, admin.id, cleared],
        );
      await pay(ids.ana!, 'school', 400, 'cash', 'posted', true);
      await pay(ids.ana!, 'school', 250, 'cheque', 'posted', false); // waiting to clear
      await pay(ids.bo!, 'school', 700, 'cheque', 'bounced', false);
      await pay(ids.bo!, 'hostel', 900, 'upi', 'reversed', true);
      // misc: a fee of 150 due 5 days ago, 50 received in cash today
      const mf = await c.query<{ id: string }>(
        `INSERT INTO misc_fees (school_id, academic_year_id, head_id, title, amount, last_date, status)
         VALUES ($1, $2, $3, 'Trip', 150, ${today} - 5, 'announced') RETURNING id::text`,
        [sid, y, miscHead],
      );
      await c.query(
        `INSERT INTO misc_fee_students (school_id, misc_fee_id, student_id, amount, paid) VALUES ($1, $2, $3, 150, 50)`,
        [sid, mf.rows[0]!.id, ids.ana],
      );
      await c.query(
        `INSERT INTO misc_receipts (school_id, academic_year_id, financial_year_id, receipt_no, payer_kind, student_id, payer_name, head_id, amount, received_on, mode, received_by)
         VALUES ($1, $2, $3, 'M1', 'student', $4, 'ana', $5, 50, ${today}, 'cash', $6)`,
        [sid, y, school.fyId, ids.ana, miscHead, admin.id],
      );
    });
  });
  afterAll(async () => app.close());

  it('needs the fee ledger permission', async () => {
    expect((await get('/fees/dashboard', teacher)).statusCode).toBe(403);
  });

  it('all ledgers: money in, due, overdue, ageing, modes, cheques, cash, defaulters, counters', async () => {
    const r = await get('/fees/dashboard');
    expect(r.statusCode).toBe(200);
    const d = r.json();
    // in: 400 cash + 250 cheque (school) + 50 misc; the bounced 700 and reversed 900 are not
    expect(d.totals).toMatchObject({ collectedToday: 700, collectedYear: 700, receiptsToday: 3 });
    // due till today: 1000 + 2000 + 150 (the credit does not lower it, the 500 is not due yet)
    expect(d.totals).toMatchObject({ dueTillDate: 3150, paidOfDue: 450, demand: 3650 });
    expect(d.totals.overdue).toBe(600 + 2000 + 100);
    expect(d.totals.defaulters).toBe(2);
    expect(d.split.map((x: { ledger: string }) => x.ledger)).toEqual(['school', 'hostel', 'misc']);
    const age = Object.fromEntries(
      d.ageing.map((a: { bucket: string; amount: number }) => [a.bucket, a.amount]),
    );
    expect(age).toMatchObject({ current: 500, '1-30': 100, '31-60': 600, '90+': 2000 });
    expect(d.instruments).toMatchObject({
      chequesWaiting: 1,
      chequesWaitingAmount: 250,
      bounced: 1,
      bouncedAmount: 700,
      cashToDeposit: 450,
    });
    expect(d.modes.find((m: { mode: string }) => m.mode === 'cash').year).toBe(450);
    expect(d.defaulters[0]).toMatchObject({
      studentId: ids.bo,
      balance: 2000,
      ledgers: ['hostel'],
    });
    expect(d.cashiers).toEqual([
      expect.objectContaining({ userId: admin.id, amount: 700, cash: 450 }),
    ]);
    expect(d.byClass[0]).toMatchObject({ name: 'Class V', due: 3150, paid: 450 });
    expect(d.daily.at(-1).amount).toBe(700);
  });

  it('one ledger at a time', async () => {
    const hostel = (await get('/fees/dashboard?ledger=hostel')).json();
    expect(hostel.split.map((x: { ledger: string }) => x.ledger)).toEqual(['hostel']);
    expect(hostel.totals).toMatchObject({ collectedYear: 0, dueTillDate: 2000, overdue: 2000 });
    const misc = (await get('/fees/dashboard?ledger=misc')).json();
    expect(misc.totals).toMatchObject({ collectedToday: 50, dueTillDate: 150, overdue: 100 });
    expect(misc.instruments.cashToDeposit).toBe(50);
    const school = (await get('/fees/dashboard?ledger=school')).json();
    expect(school.totals).toMatchObject({ collectedYear: 650, dueTillDate: 1000, paidOfDue: 400 });
    expect((await get('/fees/dashboard?ledger=bus')).statusCode).toBe(400);
  });

  it('projection vs collection by quarter, month or fee term: due, realised of it, received in it', async () => {
    const q = (await get('/fees/dashboard')).json();
    expect(q.by).toBe('quarter');
    expect(q.periods.map((p: { key: string }) => p.key)).toEqual(['q1', 'q2', 'q3', 'q4']);
    expect(q.periods[0]).toMatchObject({
      label: 'Q1 Apr–Jun 26',
      start: '2026-04-01',
      end: '2026-06-30',
    });
    const sum = (k: string, ps: Array<Record<string, number>>) => ps.reduce((n, p) => n + p[k]!, 0);
    // the whole year: every due (the credit not counted), paid of it, and the 700 received today
    expect(sum('projection', q.periods)).toBe(3650);
    expect(sum('realised', q.periods)).toBe(450);
    expect(sum('received', q.periods)).toBe(700);
    expect(q.periods.filter((p: { current: boolean }) => p.current)).toHaveLength(1);
    const m = (await get('/fees/dashboard?by=month&ledger=school')).json();
    expect(m.periods).toHaveLength(12);
    expect(m.periods[0].label).toBe('Apr 26');
    expect(sum('projection', m.periods)).toBe(1500);
    // two fee terms (April and October): the first runs until October begins
    const t = (await get('/fees/dashboard?by=term')).json();
    expect(
      t.periods.map((p: { label: string; start: string; end: string }) => [
        p.label,
        p.start,
        p.end,
      ]),
    ).toEqual([
      ['Term 1 (Apr–Sep 26)', '2026-04-01', '2026-09-30'],
      ['Term 2 (Oct–Mar 27)', '2026-10-01', '2026-03-31'.replace('2026', '2027')],
    ]);
    expect(sum('projection', t.periods)).toBe(3650);
    expect((await get('/fees/dashboard?by=week')).statusCode).toBe(400);
  });

  it('transport: the transport heads only, received through the split of receipts, bus list vs billed', async () => {
    await withMigrator(async (c) => {
      const today = `(now() AT TIME ZONE 'Asia/Kolkata')::date`;
      const h = await c.query<{ id: string }>(
        `INSERT INTO fee_heads (school_id, code, name, kind) VALUES ($1, 'TRN', 'Transport', 'transport') RETURNING id::text`,
        [school.id],
      );
      const per = await c.query<{ id: string }>(
        `SELECT id::text FROM fee_periods WHERE academic_year_id = $1 ORDER BY sequence LIMIT 1`,
        [school.yearId],
      );
      // ana: 600 of transport fee due 10 days ago, 250 of it paid through a receipt today
      const d = await c.query<{ id: string }>(
        `INSERT INTO fee_demands (school_id, student_id, academic_year_id, period_id, head_id, gross, net, paid, status, due_on)
         VALUES ($1, $2, $3, $4, $5, 600, 600, 250, 'partial', ${today} - 10) RETURNING id::text`,
        [school.id, ids.ana, school.yearId, per.rows[0]!.id, h.rows[0]!.id],
      );
      const p = await c.query<{ id: string }>(
        `INSERT INTO fee_payments (school_id, student_id, academic_year_id, amount, received_on, mode, ledger)
         VALUES ($1, $2, $3, 250, ${today}, 'cash', 'school') RETURNING id::text`,
        [school.id, ids.ana, school.yearId],
      );
      await c.query(
        `INSERT INTO fee_payment_allocations (school_id, payment_id, demand_id, amount) VALUES ($1, $2, $3, 250)`,
        [school.id, p.rows[0]!.id, d.rows[0]!.id],
      );
      // both ride all year at 100 a month; bo is never billed
      for (const st of [ids.ana, ids.bo])
        await c.query(
          `INSERT INTO student_transport (school_id, student_id, academic_year_id, service, monthly_amount, from_month, to_month, status)
           VALUES ($1, $2, $3, 'both', 100, '2026-04-01', '2027-03-01', 'active')`,
          [school.id, st, school.yearId],
        );
    });
    expect((await get('/fees/dashboard/transport', teacher)).statusCode).toBe(403);
    const r = (await get('/fees/dashboard/transport')).json();
    const sum = (k: string) =>
      r.periods.reduce((n: number, p: Record<string, number>) => n + p[k]!, 0);
    expect(sum('projection')).toBe(600);
    expect(sum('realised')).toBe(250);
    expect(sum('received')).toBe(250);
    expect(sum('expected')).toBe(2 * 12 * 100);
    const cur = r.periods.find((p: { current: boolean }) => p.current);
    expect(cur.riders).toBe(2);
    expect(cur.unbilled).toBeGreaterThanOrEqual(1);
    expect(r.routes).toEqual([expect.objectContaining({ route: 'No route' })]);
    expect(r.defaulters).toEqual([expect.objectContaining({ studentId: ids.ana, balance: 350 })]);
  });
});
