/**
 * Pay plan and system-decided student type (0114, 0115): the school's plan, a class's own, a pupil's
 * own through approval; the months of one instalment share the last date of its first month, so the
 * ledger shows one instalment per quarter / half-year / year. Old or new comes from the admission date.
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

interface Ledger {
  fee: { payPlan: string; studentType: string; feeGroup: string };
  student: { status: string };
  instalments: Array<{ dueOn: string; net: string; label: string; sequences: number[] }>;
}

describe('fee pay plan and student type (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let classId: string;
  let otherClassId: string;
  let yearStart: string;
  const students: Record<string, string> = {};
  let periods: Array<{ id: string; sequence: number; dueOn: string }>;

  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const ledgerOf = async (id: string) =>
    (
      await inject({ method: 'GET', url: `/fees/students/${id}/ledger`, headers: h() })
    ).json() as Ledger;
  const profileOf = async (id: string) =>
    (await inject({ method: 'GET', url: `/fees/students/${id}/profile`, headers: h() })).json() as {
      studentType: string;
      payPlan: string | null;
      payPlanInForce: string;
    };

  beforeAll(async () => {
    const s = stamp('FPP');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      const y = await c.query<{ d: string }>(
        `SELECT start_date::text AS d FROM academic_years WHERE id = $1`,
        [school.yearId],
      );
      yearStart = y.rows[0]!.d;
    });
    app = await createApp();
    inject = injector(app);
    const head = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition fee', sortOrder: 1 },
    });
    expect(head.statusCode).toBe(201);
    const gen = await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 1 },
    });
    expect(gen.statusCode).toBe(201);
    periods = (await inject({ method: 'GET', url: '/fees/periods', headers: h() })).json().data;
    const mk = async (code: string, order: number) => {
      const cls = await inject({
        method: 'POST',
        url: '/academics/classes',
        headers: h(),
        json: { code, name: `Class ${code}`, displayOrder: order },
      });
      const sec = await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(),
        json: { name: 'A' },
      });
      const st = await inject({
        method: 'PUT',
        url: `/fees/structures/${cls.json().id}`,
        headers: h(),
        json: {
          feeGroup: 'general',
          entries: [{ headId: head.json().id, amount: 1000, frequency: 'monthly' }],
        },
      });
      expect(st.statusCode).toBe(200);
      return [cls.json().id as string, sec.json().id as string] as const;
    };
    const [c1, s1] = await mk('VI', 6);
    const [c2, s2] = await mk('VII', 7);
    classId = c1;
    otherClassId = c2;
    let roll = 1;
    for (const [id, sec, admittedOn] of [
      ['classPlan', s1, '2019-04-05'],
      ['ownPlan', s1, '2019-04-05'],
      ['other', s2, '2019-04-05'],
      ['fresh', s2, yearStart],
    ] as const) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `FPP-${id}`,
          firstName: id,
          lastName: 'Plan',
          dob: '2012-01-01',
          admittedOn,
          enrolment: { classSectionId: sec, rollNo: roll },
        },
      });
      expect(r.statusCode).toBe(201);
      students[id] = r.json().id;
      roll += 1;
      const g = await inject({
        method: 'POST',
        url: `/fees/students/${students[id]}/demands/generate`,
        headers: h(),
      });
      expect(g.statusCode).toBe(201);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('without any plan every month is its own instalment', async () => {
    const l = await ledgerOf(students.classPlan!);
    expect(l.fee.payPlan).toBe('monthly');
    expect(l.instalments).toHaveLength(12);
    expect(l.student.status).toBe('active');
  });

  it("a class's quarterly plan makes four instalments due on the first month's last date", async () => {
    const r = await inject({
      method: 'PUT',
      url: `/fees/class-rules/${classId}`,
      headers: h(),
      json: { payPlan: 'quarterly', periods: [] },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().data).toMatchObject({ classPayPlan: 'quarterly', schoolPayPlan: 'monthly' });
    // bills not yet paid follow at once, without generating again
    const l = await ledgerOf(students.classPlan!);
    expect(l.fee.payPlan).toBe('quarterly');
    expect(l.instalments).toHaveLength(4);
    expect(l.instalments.map((i) => i.net)).toEqual(['3000.00', '3000.00', '3000.00', '3000.00']);
    expect(l.instalments.map((i) => i.sequences)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
      [10, 11, 12],
    ]);
    const due = (seq: number) => periods.find((p) => p.sequence === seq)!.dueOn;
    expect(l.instalments.map((i) => i.dueOn)).toEqual([due(1), due(4), due(7), due(10)]);
    // the other class stays monthly
    expect((await ledgerOf(students.other!)).instalments).toHaveLength(12);
  });

  it("a pupil's own plan needs approval and then overrides the class's", async () => {
    const direct = await inject({
      method: 'PUT',
      url: `/fees/students/${students.ownPlan}/profile`,
      headers: h(accountant),
      json: { feeGroup: 'general', payPlan: 'half_yearly' },
    });
    expect(direct.statusCode).toBe(403);
    const req = await inject({
      method: 'POST',
      url: `/fees/students/${students.ownPlan}/profile-changes`,
      headers: h(accountant),
      json: { payPlan: 'half_yearly', reason: 'Parent asked to pay twice a year' },
    });
    expect(req.statusCode).toBe(201);
    // nothing changes while it waits
    expect((await ledgerOf(students.ownPlan!)).instalments).toHaveLength(4);
    const ok = await inject({
      method: 'POST',
      url: `/fees/profile-changes/${req.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect(ok.statusCode).toBe(201);
    const l = await ledgerOf(students.ownPlan!);
    expect(l.fee.payPlan).toBe('half_yearly');
    expect(l.instalments.map((i) => i.net)).toEqual(['6000.00', '6000.00']);
    expect(await profileOf(students.ownPlan!)).toMatchObject({
      payPlan: 'half_yearly',
      payPlanInForce: 'half_yearly',
    });
    // back to the class's plan, again through approval
    const back = await inject({
      method: 'POST',
      url: `/fees/students/${students.ownPlan}/profile-changes`,
      headers: h(accountant),
      json: { payPlan: null, reason: 'Back to the class plan' },
    });
    expect(back.statusCode).toBe(201);
    await inject({
      method: 'POST',
      url: `/fees/profile-changes/${back.json().id}/decide`,
      headers: h(),
      json: { outcome: 'approved' },
    });
    expect((await ledgerOf(students.ownPlan!)).instalments).toHaveLength(4);
  });

  it("the school's plan applies where the class has none; a paid month keeps its date", async () => {
    const pay = await inject({
      method: 'POST',
      url: '/payments/receipts',
      headers: h(accountant),
      json: { studentId: students.other, amount: 1000, mode: 'cash' },
    });
    expect(pay.statusCode).toBe(201);
    const set = await inject({
      method: 'PUT',
      url: '/fees/pay-plan',
      headers: h(),
      json: { payPlan: 'yearly' },
    });
    expect(set.statusCode).toBe(200);
    expect((await inject({ method: 'GET', url: '/fees/pay-plan', headers: h() })).json()).toEqual({
      payPlan: 'yearly',
    });
    const l = await ledgerOf(students.other!);
    expect(l.fee.payPlan).toBe('yearly');
    // month 1 was paid before the change and keeps its own date; in a yearly plan that is the same date
    expect(l.instalments).toHaveLength(1);
    expect(l.instalments[0]!.net).toBe('12000.00');
    // the class with its own plan is not touched
    expect((await ledgerOf(students.classPlan!)).instalments).toHaveLength(4);
    void otherClassId;
  });

  it('old or new comes from the admission date and cannot be typed', async () => {
    expect((await profileOf(students.fresh!)).studentType).toBe('new');
    expect((await profileOf(students.other!)).studentType).toBe('old');
    const typed = await inject({
      method: 'PUT',
      url: `/fees/students/${students.fresh}/profile`,
      headers: h(),
      json: { feeGroup: 'general', studentType: 'old' },
    });
    expect(typed.statusCode).toBe(200);
    expect(typed.json().studentType).toBe('new');
    const stored = await withMigrator(async (c) => {
      const r = await c.query<{ t: string }>(
        `SELECT student_type AS t FROM student_fee_profiles WHERE student_id = $1`,
        [students.fresh],
      );
      return r.rows[0]?.t;
    });
    expect(stored).toBe('new');
    expect((await ledgerOf(students.fresh!)).fee.studentType).toBe('new');
  });
});
