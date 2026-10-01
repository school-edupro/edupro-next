/**
 * Student profile drop-downs fed by setup masters: Sub-Caste (profile list), City (cities master) and
 * Bank Name (banks master). Values must come from the master once it has rows; an empty master does
 * not block the form. Sub-Caste starts hidden on the portal (DPDP).
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

describe('profile drop-downs from setup masters (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let studentId: string;
  let s: string;
  const h = () => headersFor(admin.sub, school.id);
  const save = (values: Record<string, unknown>) =>
    inject({
      method: 'PATCH',
      url: `/people/students/${studentId}/profile`,
      headers: h(),
      json: { values },
    });

  beforeAll(async () => {
    s = stamp('PM');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
    const st = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: { admissionNo: `${s}-1`, firstName: 'Neel', lastName: 'Master' },
    });
    expect(st.statusCode).toBe(201);
    studentId = st.json().id;
  });
  afterAll(async () => {
    await app.close();
  });

  it('accepts free text for city and bank while their masters are empty', async () => {
    const r = await save({ residential_city: 'Anywhere', bank_name: 'Any Bank' });
    expect(r.statusCode).toBe(200);
  });

  it('takes Sub-Caste, City and Bank Name only from the masters once they have rows', async () => {
    await withMigrator(async (c) => {
      const co = await c.query<{ id: string }>(
        `INSERT INTO countries (school_id, code, name) VALUES ($1, 'IN', 'India') RETURNING id`,
        [school.id],
      );
      const sta = await c.query<{ id: string }>(
        `INSERT INTO states (school_id, country_id, code, name) VALUES ($1, $2, 'MH', 'Maharashtra') RETURNING id`,
        [school.id, co.rows[0]!.id],
      );
      await c.query(`INSERT INTO cities (school_id, state_id, name) VALUES ($1, $2, 'Pune')`, [
        school.id,
        sta.rows[0]!.id,
      ]);
      await c.query(
        `INSERT INTO banks (school_id, code, name) VALUES ($1, 'SBI', 'State Bank of India')`,
        [school.id],
      );
    });
    const bad = await save({
      residential_city: 'Atlantis',
      bank_name: 'Fake Bank',
      sub_caste: 'Not A Listed Value',
    });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().errors).sort()).toEqual([
      'bank_name',
      'residential_city',
      'sub_caste',
    ]);
    const ok = await save({
      residential_city: 'pune',
      bank_name: 'State Bank of India',
      sub_caste: 'Rajput',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().values).toMatchObject({
      residential_city: 'Pune',
      bank_name: 'State Bank of India',
      sub_caste: 'Rajput',
    });
    const cat = await inject({ method: 'GET', url: '/people/profile/catalogue', headers: h() });
    const city = cat.json().fields.find((f: { key: string }) => f.key === 'residential_city');
    expect(city).toMatchObject({ type: 'list' });
  });

  it('keeps Sub-Caste off the portal until the school opens it', async () => {
    const r = await inject({ method: 'GET', url: '/people/portal-profile/policy', headers: h() });
    expect(r.statusCode).toBe(200);
    const fields = r.json().policy?.fields ?? r.json().fields;
    expect(fields.parent.sub_caste).toBe('hidden');
    expect(fields.student.sub_caste).toBe('hidden');
  });

  it('checks a sibling admission number and takes the name and class from that student', async () => {
    const other = await inject({
      method: 'POST',
      url: '/people/students',
      headers: h(),
      json: { admissionNo: `${s}-2`, firstName: 'Ira', lastName: 'Master' },
    });
    expect(other.statusCode).toBe(201);
    const bad = await save({ sibling_in_school: 'Yes', sibling_admission_no: 'NO-SUCH-NO' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().errors.sibling_admission_no).toMatch(/No other student/);
    const self = await save({ sibling_admission_no: `${s}-1` });
    expect(self.statusCode).toBe(400);
    const ok = await save({
      sibling_admission_no: `${s}-2`.toLowerCase(),
      sibling_name: 'typed wrong',
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().values).toMatchObject({
      sibling_in_school: 'Yes',
      sibling_admission_no: `${s}-2`,
      sibling_name: 'Ira Master',
    });
    const look = await inject({
      method: 'GET',
      url: `/people/profile/sibling?admissionNo=${s}-2&exclude=${studentId}`,
      headers: h(),
    });
    expect(look.json()).toMatchObject({ name: 'Ira Master', admissionNo: `${s}-2` });
  });
});
