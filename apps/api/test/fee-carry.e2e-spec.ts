/**
 * Year-end carry-forward (0099): preview of unpaid fee, late fine and advance, the run that opens the
 * new year with Previous dues / Previous late fine / Advance, no double counting in the old year, and
 * the undo.
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

interface Row {
  studentId: string;
  dueSchool: string;
  lateFee: string;
  advance: string;
  net: string;
  enrolled: boolean;
  carried: boolean;
}
interface Demand {
  head: string;
  headCode?: string;
  net: string;
  source: string;
}

describe('fee carry-forward to the new year (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let teacher: SeededUser;
  let nextYearId: string;
  let sectionId: string;
  const students: Record<'due' | 'advance' | 'clear' | 'left', string> = {} as never;

  const h = (u: SeededUser = admin, year?: string) => ({
    ...headersFor(u.sub, school.id),
    ...(year ? { 'x-academic-year-id': year } : {}),
  });
  const preview = async (u: SeededUser = accountant) =>
    inject({
      method: 'GET',
      url: `/fees/carry-forward?toYearId=${nextYearId}&fromYearId=${school.yearId}`,
      headers: h(u),
    });
  const rowOf = async (id: string) =>
    ((await preview()).json().data.rows as Row[]).find((r) => r.studentId === id);

  beforeAll(async () => {
    const s = stamp('FCF');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      const y = await c.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status)
         VALUES ($1, '2027-28', 'Session 2027-28', '2027-04-01', '2028-03-31', 'planned') RETURNING id::text`,
        [school.id],
      );
      nextYearId = y.rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
    const head = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'Tuition fee', sortOrder: 1 },
    });
    expect(head.statusCode).toBe(201);
    const p = await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 3 },
    });
    expect(p.statusCode).toBe(201);
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
    await inject({
      method: 'PUT',
      url: '/platform/settings/fees.late_fee_mode',
      headers: h(),
      json: { value: 'slab' },
    });
    const periods = (await inject({ method: 'GET', url: '/fees/periods', headers: h() })).json()
      .data as Array<{ id: string; sequence: number }>;
    await inject({
      method: 'PUT',
      url: `/fees/periods/${periods.find((p) => p.sequence === 1)!.id}/late-fee`,
      headers: h(),
      json: { lateFeeAmount: 200, slabs: [] },
    });
    let roll = 1;
    for (const id of ['due', 'advance', 'clear', 'left'] as const) {
      const r = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `FCF-${id}`,
          firstName: id,
          lastName: 'Carry',
          dob: '2015-01-01',
          admittedOn: '2025-04-05',
          enrolment: { classSectionId: sectionId, rollNo: roll },
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
    const receipt = (json: Record<string, unknown>) =>
      inject({ method: 'POST', url: '/payments/receipts', headers: h(accountant), json });
    // "due": pays 5 000 of 12 000 on time for the first quarter only; later quarters stay unpaid
    expect(
      (
        await receipt({
          studentId: students.due,
          amount: 2000,
          mode: 'cash',
          receivedOn: '2026-04-05',
        })
      ).statusCode,
    ).toBe(201);
    // "advance": pays the whole year and 1 500 more, on the first day
    expect(
      (
        await receipt({
          studentId: students.advance,
          amount: 13500,
          mode: 'cash',
          receivedOn: '2026-04-05',
        })
      ).statusCode,
    ).toBe(201);
    // "clear": pays exactly the year
    expect(
      (
        await receipt({
          studentId: students.clear,
          amount: 12000,
          mode: 'cash',
          receivedOn: '2026-04-05',
        })
      ).statusCode,
    ).toBe(201);
    // everyone but "left" is promoted to the new year
    await withMigrator(async (c) => {
      for (const id of ['due', 'advance', 'clear'] as const)
        await c.query(
          `INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, status) VALUES ($1, $2, $3, $4, 'active')`,
          [school.id, students[id], nextYearId, sectionId],
        );
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('previews dues, late fine and advance, and says why it cannot run yet', async () => {
    expect((await preview(teacher)).statusCode).toBe(403);
    const p = await preview();
    expect(p.statusCode).toBe(200);
    const data = p.json().data;
    expect(data.ready).toBe(false);
    expect(data.blocked).toContain('fee calendar');
    const rows = data.rows as Row[];
    const due = rows.find((r) => r.studentId === students.due)!;
    expect(due.dueSchool).toBe('10000.00');
    expect(Number(due.lateFee)).toBeGreaterThanOrEqual(200); // first quarter was short on its last date
    expect(due.enrolled).toBe(true);
    expect(rows.find((r) => r.studentId === students.advance)).toMatchObject({
      dueSchool: '0.00',
      advance: '1500.00',
      net: '-1500.00',
    });
    expect(rows.find((r) => r.studentId === students.clear)).toBeUndefined();
    expect(rows.find((r) => r.studentId === students.left)).toMatchObject({ enrolled: false });
    expect(data.totals.pending).toBe(1);
    const run = await inject({
      method: 'POST',
      url: '/fees/carry-forward',
      headers: h(accountant),
      json: { toYearId: nextYearId, fromYearId: school.yearId },
    });
    expect(run.statusCode).toBe(409);
  });

  it('carries to the new year as separate lines and closes the old bills', async () => {
    // the session turns over: the new year is the working year, the old one is locked
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE academic_years SET status = 'locked', locks = '{"attendance": true, "exams": true, "fees": true, "academics": true}'::jsonb WHERE id = $1`,
        [school.yearId],
      );
      await c.query(`UPDATE academic_years SET status = 'active' WHERE id = $1`, [nextYearId]);
    });
    const cal = await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 3 },
    });
    expect(cal.statusCode).toBe(201);
    const before = (await rowOf(students.due))!;
    const run = await inject({
      method: 'POST',
      url: '/fees/carry-forward',
      headers: h(accountant),
      json: { toYearId: nextYearId, fromYearId: school.yearId },
    });
    expect(run.statusCode).toBe(201);
    expect(run.json().students).toBe(2); // "left" has no class in the new year, "clear" owes nothing
    const demands = (
      await inject({
        method: 'GET',
        url: `/fees/students/${students.due}/demands`,
        headers: h(),
      })
    ).json().rows as Demand[];
    const carried = demands.filter((d) => d.source === 'opening_balance');
    expect(carried.map((d) => d.net).sort()).toEqual([before.dueSchool, before.lateFee].sort());
    const adv = (
      await inject({
        method: 'GET',
        url: `/fees/students/${students.advance}/demands`,
        headers: h(),
      })
    ).json().rows as Demand[];
    expect(adv.find((d) => d.source === 'opening_balance')!.net).toBe('-1500.00');
    // the old year no longer shows the amount as due
    const old = (
      await inject({
        method: 'GET',
        url: `/fees/students/${students.due}/ledger`,
        headers: h(admin, school.yearId),
      })
    ).json() as { totals: { balance: string } };
    expect(old.totals.balance).toBe('0.00');
    const again = (await rowOf(students.due))!;
    expect(again.carried).toBe(true);
    const twice = await inject({
      method: 'POST',
      url: '/fees/carry-forward',
      headers: h(accountant),
      json: { toYearId: nextYearId, fromYearId: school.yearId, studentIds: [students.due] },
    });
    expect(twice.statusCode).toBe(409);
    expect((await preview()).json().data.runs).toHaveLength(1);
  });

  it('undo puts the old bills back; not after a receipt against the carried amount', async () => {
    const undo = await inject({
      method: 'POST',
      url: '/fees/carry-forward/undo',
      headers: h(accountant),
      json: { toYearId: nextYearId, fromYearId: school.yearId, studentId: students.due },
    });
    expect(undo.statusCode).toBe(201);
    const old = (
      await inject({
        method: 'GET',
        url: `/fees/students/${students.due}/ledger`,
        headers: h(admin, school.yearId),
      })
    ).json() as { totals: { balance: string } };
    expect(old.totals.balance).toBe('10000.00');
    const demands = (
      await inject({
        method: 'GET',
        url: `/fees/students/${students.due}/demands`,
        headers: h(),
      })
    ).json().rows as Demand[];
    expect(demands.some((d) => d.source === 'opening_balance')).toBe(false);
    // carry again, pay against it in the new year, and the undo is refused
    const run = await inject({
      method: 'POST',
      url: '/fees/carry-forward',
      headers: h(accountant),
      json: { toYearId: nextYearId, fromYearId: school.yearId, studentIds: [students.due] },
    });
    expect(run.statusCode).toBe(201);
    const pay = await inject({
      method: 'POST',
      url: '/payments/receipts',
      headers: h(accountant),
      json: { studentId: students.due, amount: 500, mode: 'cash' },
    });
    expect(pay.statusCode).toBe(201);
    const refused = await inject({
      method: 'POST',
      url: '/fees/carry-forward/undo',
      headers: h(accountant),
      json: { toYearId: nextYearId, fromYearId: school.yearId, studentId: students.due },
    });
    expect(refused.statusCode).toBe(409);
  });
});
