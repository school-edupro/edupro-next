/**
 * Student and employee dashboards (docs/design/33-people-dashboards.md): strength, movement, today and the
 * records, and who may see them.
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

describe('people dashboards (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let gate: SeededUser;
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    const s = stamp('PDB');
    await withMigrator(async (c) => {
      school = await seedSchool(c, s);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      gate = await seedUser(c, school, `${s}-gate`, 'gate_security');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, employee_type, department, dob, joined_on, profile)
         VALUES ($1, 'E1', 'Asha', 'teaching', 'Science', $2::date - interval '30 years', CURRENT_DATE - 10, '{"probation_months": "1"}'),
                ($1, 'E2', 'Ravi', 'non_teaching', 'Accounts', CURRENT_DATE - interval '59 years 6 months', '2015-04-01', '{}')`,
        [school.id, today],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(admin),
      json: { code: 'IV', name: 'Class IV' },
    });
    const sec = (
      await inject({
        method: 'POST',
        url: `/academics/classes/${cls.json().id}/sections`,
        headers: h(admin),
        json: { name: 'A' },
      })
    ).json().id;
    for (const [adm, name, gender] of [
      ['D1', 'Mira', 'Female'],
      ['D2', 'Kabir', 'Male'],
    ]) {
      const r = await inject({
        method: 'POST',
        url: '/people/profile/quick-add',
        headers: h(admin),
        json: {
          classSectionId: sec,
          values: {
            admission_no: adm,
            first_name: name,
            dob: '10-10-2016',
            gender,
            father_name: `${name} father`,
            sms_mobile: '9812300000',
            category: 'General',
            ews: 'No',
            boarding: 'Day Scholar',
          },
        },
      });
      expect(r.statusCode).toBe(201);
    }
  });
  afterAll(async () => app.close());

  it('students: strength by class and gender, the records, rights', async () => {
    const r = await inject({ method: 'GET', url: '/people/dashboard/students', headers: h(admin) });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.strength.total).toBe(2);
    expect(d.strength.byClass).toEqual([
      expect.objectContaining({ name: 'Class IV', sections: 1, students: 2, boys: 1, girls: 1 }),
    ]);
    expect(d.strength.boarding).toEqual([{ key: 'Day Scholar', n: 2 }]);
    expect(d.health).toMatchObject({ noPhoto: 2, noAadhaar: 2, pendingChanges: 0 });
    expect(d.today).toMatchObject({ sections: 1, sectionsMarked: 0, present: 0 });
    const no = await inject({ method: 'GET', url: '/people/dashboard/students', headers: h(gate) });
    expect(no.statusCode).toBe(403);
  });

  it('staff: teaching and non-teaching, movement, probation and retirement, no logins, by department', async () => {
    const r = await inject({ method: 'GET', url: '/people/dashboard/staff', headers: h(admin) });
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.strength.total).toBe(2);
    expect(d.strength.side).toEqual(
      expect.arrayContaining([
        { key: 'Teaching', n: 1 },
        { key: 'Non-teaching', n: 1 },
      ]),
    );
    expect(d.movement).toMatchObject({ probationEnding30: 1, retiring12Months: 1 });
    expect(d.health).toMatchObject({ noLogin: 2, pendingChanges: 0, acr: null });
    const sci = (
      await inject({
        method: 'GET',
        url: '/people/dashboard/staff?department=science',
        headers: h(admin),
      })
    ).json();
    expect(sci.strength.total).toBe(1);
  });
});
