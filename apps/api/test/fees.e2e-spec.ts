/**
 * Sprint 8 fee engine: masters, periods, structures, slabs, discounts, profiles and app.generate_fee_demand
 * against the reconstructed legacy cases in fixtures/fees/legacy-cases.json.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

interface Fixture {
  structure: {
    heads: Array<{ code: string; name: string; amount: number; frequency: string }>;
    transportSlab: { code: string; monthlyAmount: number };
    discounts: Array<{ code: string; name: string; head?: string; percent: number }>;
  };
  cases: Array<{
    id: string;
    title: string;
    profile: { discount?: string; slab?: string; openingBalance?: number };
    settings?: Record<string, unknown>;
    expectedRows: number;
    expectedTotal: number;
    wholeRupeePeriods?: boolean;
  }>;
}

const fixture = JSON.parse(
  readFileSync(join(__dirname, 'fixtures/fees/legacy-cases.json'), 'utf8'),
) as Fixture;

describe('fees (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let accountant: SeededUser;
  let teacher: SeededUser;
  let classId: string;
  let sectionId: string;
  const heads: Record<string, string> = {};
  const discounts: Record<string, string> = {};
  let slabId: string;
  const students: Record<string, string> = {};

  const h = () => headersFor(admin.sub, school.id);

  beforeAll(async () => {
    const s = stamp('F8');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      accountant = await seedUser(c, school, `${s}-acc`, 'accountant');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    classId = cls.json().id;
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${classId}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
    let roll = 1;
    for (const c of fixture.cases) {
      const st = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(),
        json: {
          admissionNo: `F8-${c.id}`,
          firstName: c.id,
          lastName: 'Fee',
          dob: '2015-01-01',
          admittedOn: '2026-04-05',
          enrolment: { classSectionId: sectionId, rollNo: roll },
        },
      });
      expect(st.statusCode).toBe(201);
      students[c.id] = st.json().id;
      roll += 1;
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('masters: heads, twelve periods with quarterly instalments, structure, slab and discounts', async () => {
    for (const [i, head] of fixture.structure.heads.entries()) {
      const r = await inject({
        method: 'POST',
        url: '/fees/heads',
        headers: h(),
        json: { code: head.code, name: head.name, sortOrder: i },
      });
      expect(r.statusCode).toBe(201);
      heads[head.code] = r.json().id;
    }
    const trn = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TRN', name: 'Transport fee', kind: 'transport', sortOrder: 9 },
    });
    heads.TRN = trn.json().id;
    const opb = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'OPB', name: 'Opening balance', kind: 'opening_balance', sortOrder: 10 },
    });
    heads.OPB = opb.json().id;
    const dup = await inject({
      method: 'POST',
      url: '/fees/heads',
      headers: h(),
      json: { code: 'TUI', name: 'again' },
    });
    expect(dup.statusCode).toBe(409);

    const periods = await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 3 },
    });
    expect(periods.statusCode).toBe(201);
    const rows = periods.json().data as Array<{
      sequence: number;
      name: string;
      instalment: number;
      dueOn: string;
    }>;
    expect(rows).toHaveLength(12);
    expect(rows[0]).toMatchObject({
      sequence: 1,
      name: 'April 2026',
      instalment: 1,
      dueOn: '2026-04-10',
    });
    expect(rows[11]).toMatchObject({
      sequence: 12,
      name: 'March 2027',
      instalment: 4,
      dueOn: '2027-01-10',
    });

    const structure = await inject({
      method: 'PUT',
      url: `/fees/structures/${classId}`,
      headers: h(),
      json: {
        feeGroup: 'general',
        entries: fixture.structure.heads.map((x) => ({
          headId: heads[x.code],
          amount: x.amount,
          frequency: x.frequency,
        })),
      },
    });
    expect(structure.statusCode).toBe(200);
    const annual = Object.fromEntries(
      (structure.json().data as Array<{ headCode: string; annual: string }>).map((x) => [
        x.headCode,
        Number(x.annual),
      ]),
    );
    expect(annual).toEqual({ TUI: 30000, DEV: 4800, COMP: 3600, ANN: 3500, EXAM: 800 });

    const slab = await inject({
      method: 'POST',
      url: '/fees/slabs',
      headers: h(),
      json: {
        code: 'S2',
        name: '3 to 8 km',
        distanceFromKm: 3,
        distanceToKm: 8,
        monthlyAmount: fixture.structure.transportSlab.monthlyAmount,
      },
    });
    expect(slab.statusCode).toBe(201);
    slabId = slab.json().id;
    for (const d of fixture.structure.discounts) {
      const r = await inject({
        method: 'POST',
        url: '/fees/discounts',
        headers: h(),
        json: {
          code: d.code,
          name: d.name,
          percent: d.percent,
          headId: d.head ? heads[d.head] : undefined,
        },
      });
      expect(r.statusCode).toBe(201);
      discounts[d.code] = r.json().id;
    }
    const both = await inject({
      method: 'POST',
      url: '/fees/discounts',
      headers: h(),
      json: { code: 'BAD', name: 'x', percent: 10, amount: 5 },
    });
    expect(both.statusCode).toBe(400);
  });

  for (const kase of fixture.cases) {
    it(`generates the demand: ${kase.title}`, async () => {
      if (kase.settings)
        await withMigrator((c) =>
          Promise.all(
            Object.entries(kase.settings!).map(([key, value]) =>
              c.query(
                `INSERT INTO school_settings (school_id, key, value) SELECT $1, $2, $3::jsonb WHERE NOT EXISTS (SELECT 1 FROM school_settings WHERE school_id = $1 AND key = $2)`,
                [school.id, key, JSON.stringify(value)],
              ),
            ),
          ),
        );
      const studentId = students[kase.id]!;
      const profile = await inject({
        method: 'PUT',
        url: `/fees/students/${studentId}/profile`,
        headers: h(),
        json: {
          studentType: 'new',
          discountId: kase.profile.discount ? discounts[kase.profile.discount] : undefined,
          transportSlabId: kase.profile.slab ? slabId : undefined,
          openingBalance: kase.profile.openingBalance ?? 0,
        },
      });
      expect(profile.statusCode).toBe(200);
      const gen = await inject({
        method: 'POST',
        url: `/fees/students/${studentId}/demands/generate`,
        headers: headersFor(accountant.sub, school.id),
      });
      expect(gen.statusCode).toBe(201);
      expect(gen.json()).toMatchObject({ rows: kase.expectedRows });
      expect(Number(gen.json().total)).toBe(kase.expectedTotal);
      const demands = await inject({
        method: 'GET',
        url: `/fees/students/${studentId}/demands`,
        headers: h(),
      });
      expect(demands.statusCode).toBe(200);
      expect(Number(demands.json().total.net)).toBe(kase.expectedTotal);
      expect(demands.json().rows).toHaveLength(kase.expectedRows);
      if (kase.wholeRupeePeriods)
        for (const inst of demands.json().byInstalment as Array<{ net: string }>)
          expect(Number(inst.net) % 1).toBe(0);
    });
  }

  it('re-running keeps paid rows and stays idempotent; locked years and inactive students are refused', async () => {
    const studentId = students.regular!;
    await withMigrator((c) =>
      c.query(
        `UPDATE fee_demands SET paid = net, status = 'paid' WHERE student_id = $1 AND id = (SELECT min(id) FROM fee_demands WHERE student_id = $1)`,
        [studentId],
      ),
    );
    const again = await inject({
      method: 'POST',
      url: `/fees/students/${studentId}/demands/generate`,
      headers: h(),
    });
    expect(again.statusCode).toBe(201);
    expect(Number(again.json().total)).toBe(42700);
    const demands = await inject({
      method: 'GET',
      url: `/fees/students/${studentId}/demands`,
      headers: h(),
    });
    expect(demands.json().rows).toHaveLength(31);
    expect(
      (demands.json().rows as Array<{ status: string }>).filter((r) => r.status === 'paid'),
    ).toHaveLength(1);
    expect(Number(demands.json().total.balance)).toBe(42700 - 2500);

    const summary = await inject({
      method: 'GET',
      url: `/fees/demands/summary?classId=${classId}`,
      headers: h(),
    });
    expect(summary.json().data).toHaveLength(4);
    const periodsAgain = await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: {},
    });
    expect(periodsAgain.statusCode).toBe(409);
    expect(periodsAgain.json()).toMatchObject({ type: 'fees.periods_in_use' });

    const denied = await inject({
      method: 'POST',
      url: `/fees/students/${studentId}/demands/generate`,
      headers: headersFor(teacher.sub, school.id),
    });
    expect(denied.statusCode).toBe(403);

    await withMigrator((c) =>
      c.query(`UPDATE academic_years SET locks = '{"fees": true}'::jsonb WHERE id = $1`, [
        school.yearId,
      ]),
    );
    const locked = await inject({
      method: 'POST',
      url: `/fees/students/${studentId}/demands/generate`,
      headers: h(),
    });
    expect(locked.statusCode).toBe(409);
    expect(locked.json()).toMatchObject({ type: 'year.stage_locked' });
    await withMigrator((c) =>
      c.query(`UPDATE academic_years SET locks = '{}'::jsonb WHERE id = $1`, [school.yearId]),
    );

    await inject({
      method: 'PATCH',
      url: `/people/students/${students['staff-opening']}`,
      headers: h(),
      json: { status: 'inactive', statusReason: 'left' },
    });
    const inactive = await inject({
      method: 'POST',
      url: `/fees/students/${students['staff-opening']}/demands/generate`,
      headers: h(),
    });
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json()).toMatchObject({ type: 'fees.student_inactive' });

    const klass = await inject({
      method: 'POST',
      url: '/fees/demands/generate',
      headers: h(),
      json: { classId },
    });
    expect(klass.statusCode).toBe(201);
    expect(klass.json()).toMatchObject({ generated: 3 }); // the inactive student is reported, not generated
    expect(klass.json().skipped).toHaveLength(1);
  });
});
