/**
 * Hostel fee by months and by its own calendar (0134): a stay from a month, the hostel's own pay plan,
 * last dates and late fee, a pupil's own hostel plan, hostel paid apart from school and in parts, and
 * leaving the hostel with paid months carried forward.
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

interface Instalment {
  dueOn: string;
  ledger: string;
  net: string;
  balance: string;
  status: string;
  sequences: number[];
  lateFee: { amount: string };
}
describe('hostel fee (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let periods: Array<{ id: string; sequence: number; dueOn: string }>;
  const pupils: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const ledger = async (id: string) =>
    (await inject({ method: 'GET', url: `/fees/students/${id}/ledger`, headers: h() })).json() as {
      fee: {
        hosteller: boolean;
        hostelFrom: string | null;
        hostelTo: string | null;
        hostelPayPlan: string;
      };
      instalments: Instalment[];
    };
  const hostel = async (id: string) =>
    (await ledger(id)).instalments.filter((i) => i.ledger === 'hostel');
  const change = async (id: string, json: Record<string, unknown>) => {
    const r = await inject({
      method: 'POST',
      url: `/fees/students/${id}/profile-changes`,
      headers: h(accountant),
      json,
    });
    expect(r.statusCode).toBe(201);
    const d = await inject({
      method: 'POST',
      url: `/fees/profile-changes/${r.json().id as string}/decide`,
      headers: h(),
      json: { outcome: 'approved', note: 'ok' },
    });
    expect([200, 201]).toContain(d.statusCode);
    return d.json() as { decisionNote: string | null };
  };
  const seq = (n: number) => periods.find((p) => p.sequence === n)!;

  beforeAll(async () => {
    const s = stamp('HST');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
    });
    app = await createApp();
    inject = injector(app);
    const tui = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition', sortOrder: 1 },
    });
    const hos = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'HOS', name: 'Hostel', ledger: 'hostel', sortOrder: 2 },
    });
    expect(hos.statusCode).toBe(201);
    await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 1 },
    });
    periods = (await inject({ method: 'GET', url: '/fees/periods', headers: h() })).json().data;
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'IX', name: 'Class IX', displayOrder: 9 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id as string}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    const st = await inject({
      method: 'PUT',
      url: `/fees/structures/${cls.json().id as string}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: [
          { headId: tui.json().id, amount: 1000, frequency: 'monthly' },
          { headId: hos.json().id, amount: 3000, frequency: 'monthly' },
        ],
      },
    });
    expect(st.statusCode).toBe(200);
    let roll = 1;
    for (const id of ['joins', 'whole', 'leaves']) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `HST-${id}`,
          firstName: id,
          lastName: 'Hostel',
          dob: '2012-01-01',
          admittedOn: '2019-04-05',
          enrolment: { classSectionId: sec.json().id, rollNo: roll++ },
        },
      });
      pupils[id] = r.json().id as string;
      await inject({
        method: 'POST',
        url: `/fees/students/${pupils[id]}/demands/generate`,
        headers: h(),
      });
    }
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('a day scholar who joins the hostel in July is charged hostel from July only', async () => {
    expect(await hostel(pupils.joins!)).toHaveLength(0);
    await change(pupils.joins!, { hostelFrom: '2026-07-01', reason: 'Joined the hostel' });
    const l = await ledger(pupils.joins!);
    expect(l.fee).toMatchObject({ hosteller: true, hostelFrom: '2026-07-01', hostelTo: null });
    const rows = l.instalments.filter((i) => i.ledger === 'hostel');
    expect(rows.flatMap((i) => i.sequences)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12]);
    // school fee is untouched: all twelve months
    expect(l.instalments.filter((i) => i.ledger === 'school')).toHaveLength(12);
  });

  it("the hostel's own calendar: quarterly, its own last dates and late fee, school stays monthly", async () => {
    await change(pupils.whole!, { hosteller: true, reason: 'Hosteller all session' });
    const cal = await inject({
      method: 'PUT',
      url: '/fees/hostel-calendar',
      headers: h(),
      json: {
        mode: 'own',
        payPlan: 'quarterly',
        lateMode: 'slab',
        periods: [
          { periodId: seq(1).id, dueOn: '2026-04-20', lateFeeAmount: 300 },
          { periodId: seq(4).id, dueOn: '2026-07-20', lateFeeAmount: 500 },
        ],
      },
    });
    expect(cal.statusCode).toBe(200);
    expect(cal.json()).toMatchObject({ mode: 'own', payPlan: 'quarterly', hostellers: 2 });
    const rows = await hostel(pupils.whole!);
    expect(rows.map((i) => [i.dueOn, i.net])).toEqual([
      ['2026-04-20', '9000.00'],
      ['2026-07-20', '9000.00'],
      [seq(7).dueOn, '9000.00'],
      [seq(10).dueOn, '9000.00'],
    ]);
    // overdue hostel instalments carry the hostel's late fee, not the school's
    expect(rows[1]!.lateFee.amount).toBe('500.00');
    const school = (await ledger(pupils.whole!)).instalments.filter((i) => i.ledger === 'school');
    expect(school).toHaveLength(12);
    // the pupil who joined in July: July to September is one quarter
    expect((await hostel(pupils.joins!)).map((i) => i.sequences)).toEqual([
      [4, 5, 6],
      [7, 8, 9],
      [10, 11, 12],
    ]);
  });

  it('hostel is paid apart from school, and in parts; a pupil can get an own monthly hostel plan', async () => {
    const part = await inject({
      method: 'POST',
      url: '/payments/receipts',
      headers: h(accountant),
      json: {
        studentId: pupils.whole,
        amount: 4000,
        mode: 'cash',
        receivedOn: '2026-04-15',
        ledger: 'hostel',
      },
    });
    expect(part.statusCode).toBe(201);
    const after = await ledger(pupils.whole!);
    expect(
      after.instalments.find((i) => i.ledger === 'hostel' && i.dueOn === '2026-04-20'),
    ).toMatchObject({
      balance: '5000.00',
      status: 'overdue', // part paid and past its last date
    });
    expect(
      after.instalments.find((i) => i.ledger === 'school' && i.sequences[0] === 1),
    ).toMatchObject({
      balance: '1000.00',
    });
    await change(pupils.whole!, {
      hostelPayPlan: 'monthly',
      reason: 'Cannot pay the quarter at once',
    });
    const own = await ledger(pupils.whole!);
    expect(own.fee.hostelPayPlan).toBe('monthly');
    // unpaid months now fall due month by month; the part-paid quarter keeps its date
    expect(own.instalments.filter((i) => i.ledger === 'hostel').length).toBeGreaterThan(4);
  });

  it('defaulters show school and hostel balances apart; online payment is per fee type', async () => {
    const rep = await inject({
      method: 'GET',
      url: '/fees/mis/defaulters?asOf=2026-10-14',
      headers: h(),
    });
    const row = (
      rep.json().rows as Array<{ kind: string; cells: Record<string, number | string> }>
    ).find((r) => r.kind === 'row' && r.cells.student_id === pupils.whole)!;
    expect(Number(row.cells.school_balance) + Number(row.cells.hostel_balance)).toBe(
      Number(row.cells.balance),
    );
    expect(Number(row.cells.hostel_balance)).toBeGreaterThan(0);
    const hostelOnly = await inject({
      method: 'GET',
      url: '/fees/mis/defaulters?asOf=2026-10-14&ledger=hostel',
      headers: h(),
    });
    const only = (
      hostelOnly.json().rows as Array<{ kind: string; cells: Record<string, number | string> }>
    ).find((r) => r.kind === 'row' && r.cells.student_id === pupils.whole)!;
    expect(Number(only.cells.balance)).toBe(Number(only.cells.hostel_balance));
    expect(Number(only.cells.school_balance)).toBe(0);
  });

  it('leaving the hostel: later months go, and what was paid for them is carried forward', async () => {
    await change(pupils.leaves!, { hosteller: true, reason: 'Hosteller' });
    const pay = await inject({
      method: 'POST',
      url: '/payments/receipts',
      headers: h(accountant),
      json: {
        studentId: pupils.leaves,
        amount: 9000,
        mode: 'cash',
        receivedOn: '2026-04-10',
        ledger: 'hostel',
      },
    });
    expect(pay.statusCode).toBe(201);
    const done = await change(pupils.leaves!, {
      hostelTo: '2026-05-01',
      reason: 'Left the hostel in May',
    });
    expect(done.decisionNote).toContain('carried forward');
    const rows = await hostel(pupils.leaves!);
    expect(rows.flatMap((i) => i.sequences).sort((a, b) => a - b)).toEqual([1, 2]);
    expect(rows.reduce((a, i) => a + Number(i.net), 0)).toBe(6000);
  });
});
