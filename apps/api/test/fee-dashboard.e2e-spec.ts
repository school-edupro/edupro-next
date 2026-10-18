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
});
