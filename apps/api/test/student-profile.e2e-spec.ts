/**
 * Student 360 profile (phase A, 2026-09-30): the field catalogue from the data collection sheet,
 * field-level edit with validation and normalising, encrypted and masked Aadhaar / PAN, the
 * "Sensitive data viewer" role, parent records shared by siblings, quick add and number suggestions.
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

describe('student 360 profile (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let viewer: SeededUser;
  let sectionId: string;
  let first: string;
  let second: string;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);

  beforeAll(async () => {
    const s = stamp('SP');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      // the admin grants full sensitive values to one named user through the role
      viewer = await seedUser(c, school, `${s}-viewer`, 'school_admin');
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason)
         SELECT $1, $2, id, 'e2e' FROM roles WHERE school_id IS NULL AND code = 'sensitive_data_viewer'`,
        [school.id, viewer.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI' },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(),
      json: { name: 'A' },
    });
    sectionId = sec.json().id;
  });
  afterAll(async () => {
    await app.close();
  });

  const quick = (values: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
    inject({
      method: 'POST',
      url: '/people/profile/quick-add',
      headers: h(),
      json: { classSectionId: sectionId, values, ...extra },
    });
  const patch = (id: string, values: Record<string, unknown>, who: SeededUser = admin) =>
    inject({
      method: 'PATCH',
      url: `/people/students/${id}/profile`,
      headers: h(who),
      json: { values },
    });
  const read = (id: string, who: SeededUser = admin) =>
    inject({ method: 'GET', url: `/people/students/${id}/profile`, headers: h(who) });

  it('serves the catalogue with default lists for a school that has not edited them', async () => {
    const r = await inject({ method: 'GET', url: '/people/profile/catalogue', headers: h() });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.fields).toHaveLength(188);
    expect(body.sections).toHaveLength(14);
    const religion = body.fields.find((f: { key: string }) => f.key === 'religion');
    expect(religion.options).toEqual(expect.arrayContaining(['Hindu', 'Sikh', 'Parsi']));
    expect(body.fields.some((f: { label: string }) => /School \/ Branch/.test(f.label))).toBe(
      false,
    );
    expect(body.canSeeSensitive).toBe(false);
  });

  it('quick add needs the minimum fields, then enrols with the next roll number', async () => {
    const bad = await quick({ first_name: 'x' });
    expect(bad.statusCode).toBe(400);
    expect(Object.keys(bad.json().errors).sort()).toEqual(
      [
        'admission_no',
        'boarding',
        'category',
        'dob',
        'ews',
        'father_name',
        'gender',
        'sms_mobile',
        'transport_required',
      ].sort(),
    );
    const ok = await quick({
      admission_no: 'SP1001',
      first_name: 'riya',
      last_name: 'verma',
      dob: '15-06-2014',
      gender: 'female',
      father_name: 'amit verma',
      mother_name: 'neha verma',
      sms_mobile: '+91 98123 45678',
      category: 'general',
      ews: 'no',
      boarding: 'day scholar',
      transport_required: 'yes',
    });
    expect(ok.statusCode).toBe(201);
    first = ok.json().id;
    expect(ok.json().completeness).toBeGreaterThan(0);
    const p = await read(first);
    expect(p.json().values).toMatchObject({
      first_name: 'RIYA',
      gender: 'Female',
      dob: '2014-06-15',
      father_name: 'AMIT VERMA',
      father_mobile: '9812345678',
      class: 'Class VI',
      section: 'A',
      roll_no: 1,
      age: 11,
      boarding: 'Day Scholar',
    });
    const dup = await quick({
      admission_no: 'SP1001',
      first_name: 'b',
      dob: '01-01-2015',
      gender: 'Male',
      father_name: 'x',
      sms_mobile: '9812345670',
      category: 'General',
      ews: 'No',
      boarding: 'Hosteller',
      transport_required: 'No',
    });
    expect(dup.statusCode).toBe(400);
    expect(dup.json().errors.admission_no).toMatch(/already/);
    const next = await inject({
      method: 'GET',
      url: `/people/profile/next-numbers?classSectionId=${sectionId}`,
      headers: h(),
    });
    expect(next.json()).toEqual({ admissionNo: 'SP1002', rollNo: 2 });
  });

  it('validates each field and says why', async () => {
    const r = await patch(first, {
      aadhaar_no: '1234',
      father_pan_no: 'abc',
      religion: 'Martian',
      dob: '31-02-2020',
      age: 7,
      class: 'VII',
      unknown_key: 'x',
    });
    expect(r.statusCode).toBe(400);
    expect(Object.keys(r.json().errors).sort()).toEqual(
      ['aadhaar_no', 'age', 'class', 'dob', 'father_pan_no', 'religion', 'unknown_key'].sort(),
    );
  });

  it('stores Aadhaar and PAN encrypted, masks them, and shows them only to the sensitive viewer', async () => {
    const r = await patch(first, {
      aadhaar_no: '1234 5678 9012',
      father_pan_no: 'abcde1234f',
      religion: 'hindu',
      middle_name: 'kumari',
      family_income: '12,00,000',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().values).toMatchObject({
      aadhaar_no: 'XXXX-XXXX-9012',
      father_pan_no: 'XXXXXX234F',
      religion: 'Hindu',
      middle_name: 'KUMARI',
      family_income: 1200000,
    });
    const stored = await withMigrator((c) =>
      c.query<{ secure: Record<string, string> }>('SELECT secure FROM students WHERE id = $1', [
        first,
      ]),
    );
    expect(stored.rows[0]!.secure.aadhaar_no).toMatch(/^v1:/);
    expect(JSON.stringify(stored.rows[0]!.secure)).not.toContain('123456789012');
    const full = await read(first, viewer);
    expect(full.json().values).toMatchObject({
      aadhaar_no: '123456789012',
      father_pan_no: 'ABCDE1234F',
    });
    expect(full.json().masked).toEqual([]);
    // the masked value sent back by a form leaves the stored number alone
    await patch(first, { aadhaar_no: 'XXXX-XXXX-9012', remarks: 'checked' });
    expect((await read(first, viewer)).json().values.aadhaar_no).toBe('123456789012');
    const audit = await withMigrator((c) =>
      c.query<{ t: string }>(
        `SELECT before::text || after::text AS t FROM audit_logs WHERE entity_id = $1 AND action = 'people.student.profile.edit'`,
        [first],
      ),
    );
    expect(audit.rows.map((x) => x.t).join()).not.toContain('123456789012');
  });

  it('shares the father record between siblings and derives staff ward', async () => {
    const ok = await quick({
      admission_no: 'SP1002',
      first_name: 'kabir',
      dob: '10-01-2017',
      gender: 'Male',
      mother_name: 'neha verma',
      sms_mobile: '9812345678',
      category: 'General',
      ews: 'No',
      boarding: 'Day Scholar',
      transport_required: 'No',
    });
    expect(ok.statusCode).toBe(201);
    second = ok.json().id;
    const father = (await read(first)).json().guardianIds.father as string;
    const link = await inject({
      method: 'POST',
      url: `/people/students/${second}/guardians`,
      headers: h(),
      json: { guardianId: father, relation: 'father' },
    });
    expect(link.statusCode).toBe(201);
    await patch(first, {
      father_mobile: '9000000001',
      father_school_staff: 'Yes',
      father_staff_employee_id: 'E7',
    });
    const sib = (await read(second)).json().values;
    expect(sib).toMatchObject({ father_mobile: '9000000001', staff_ward: 'Yes' });
  });

  it('clears values with null but refuses to empty required identity fields', async () => {
    expect((await patch(first, { middle_name: null })).json().values.middle_name).toBeNull();
    const r = await patch(first, { first_name: null, father_name: null });
    expect(r.statusCode).toBe(400);
    expect(Object.keys(r.json().errors).sort()).toEqual(['father_name', 'first_name']);
  });

  it('the basic student edit accepts cleared optional fields', async () => {
    const r = await inject({
      method: 'PATCH',
      url: `/people/students/${second}`,
      headers: h(),
      json: { lastName: null, category: null, house: null, bloodGroup: null },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ lastName: null, category: null });
  });
});
