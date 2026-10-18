/**
 * The employee master, part 1 (0175-0176, docs/design/30-employee-master.md): staff setup masters, the
 * field catalogue, quick onboarding with the next code and a staff login, the full profile (lists
 * checked, IDs encrypted and masked, the address pattern of students, approvers by code), completeness,
 * leaving, and the rows (education, languages, experience, transfers, remarks).
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

describe('employee master (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let viewer: SeededUser;
  const ids: Record<string, string> = {};
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });
  const post = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'PUT', url, headers: h(u), json });
  const del = (url: string) => inject({ method: 'DELETE', url, headers: h() });

  beforeAll(async () => {
    const s = stamp('EM');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}S`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      // and the full Aadhaar / PAN / account, as the Sensitive data viewer role gives
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason)
         SELECT $1, $2, id, 'e2e' FROM roles WHERE school_id IS NULL AND code = 'sensitive_data_viewer'`,
        [school.id, admin.id],
      );
      // sees employees, not the full IDs
      viewer = await seedUser(c, school, `${s}-viewer`, 'academic_coordinator');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, department, designation) VALUES ($1, 'KV0041', 'Old', 'Maths ', 'Sr. Teacher')`,
        [school.id],
      );
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => app.close());

  it('the catalogue: sections, lists from the staff setup masters (seeded, plus the free text already used), the next code', async () => {
    const r = await get('/people/staff/catalogue');
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d.sections.map((x: { id: string }) => x.id)).toEqual([
      'basic',
      'contact',
      'address',
      'employment',
      'statutory',
      'govt_ids',
      'bank',
      'approvers',
    ]);
    expect(d.lists.Department).toEqual(expect.arrayContaining(['Teaching Junior', 'Maths']));
    expect(d.lists.Designation).toEqual(expect.arrayContaining(['PGT', 'Sr. Teacher']));
    expect(d.lists.EmployeeType).toContain('Teaching Regular');
    expect(d.lists.MaritalStatus).toContain('Married');
    expect(d.nextCode).toBe('KV0042');
    expect(d.quickAdd).toContain('staff_type');
    expect(d.fields.find((f: { key: string }) => f.key === 'approver_l1').options).toContain(
      'Old (KV0041)',
    );
    // the staff setup masters are masters like the others
    const m = await get('/masters/designations/rows');
    expect(m.statusCode).toBe(200);
    expect(JSON.stringify(m.json())).toContain('Sr. Teacher');
  });

  it('quick onboarding: the minimum, the next code, a posting, a staff login with a role', async () => {
    const missing = await post('/people/staff/onboard', { values: { first_name: 'Asha' } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json().detail).toContain('Mobile: an answer is needed');
    const bad = await post('/people/staff/onboard', {
      values: {
        first_name: 'Asha',
        gender: 'Female',
        mobile: '98100 12345',
        staff_type: 'Teaching Regular',
        department: 'Nowhere',
        designation: 'PRT',
        joined_on: '01-07-2026',
      },
    });
    expect(bad.json().detail).toContain('Department: one of');
    const r = await post('/people/staff/onboard', {
      values: {
        first_name: 'asha',
        last_name: 'rao',
        gender: 'Female',
        mobile: '+91 98100 12345',
        email: 'Asha.Rao@school.test',
        staff_type: 'teaching regular',
        department: 'Teaching Junior',
        designation: 'PRT',
        joined_on: '01-07-2026',
      },
    });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ code: 'KV0042', login: { made: true } });
    ids.asha = r.json().id;
    const p = (await get(`/people/staff/${ids.asha}/profile`)).json();
    expect(p).toMatchObject({ name: 'ASHA RAO', hasLogin: true, staffGroup: 'teaching' });
    expect(p.values).toMatchObject({
      first_name: 'ASHA',
      mobile: '9810012345',
      email: 'asha.rao@school.test',
      staff_type: 'Teaching Regular',
      joined_on: '2026-07-01',
    });
    expect(p.rows.remarks[0]).toMatchObject({ remark: 'Onboarded', source: 'system' });
    await withMigrator(async (c) => {
      const post_ = await c.query(
        `SELECT department, designation FROM postings WHERE employee_id = $1`,
        [ids.asha],
      );
      expect(post_.rows[0]).toEqual({ department: 'Teaching Junior', designation: 'PRT' });
      const role = await c.query(
        `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN employees e ON e.user_id = ur.user_id WHERE e.id = $1`,
        [ids.asha],
      );
      expect(role.rows.map((x) => x.code)).toContain('subject_teacher');
    });
    // a code already used is refused; a contract type sets the contract group
    const dup = await post('/people/staff/onboard', {
      values: {
        employee_code: 'kv0042',
        first_name: 'B',
        gender: 'Male',
        mobile: '9810012346',
        staff_type: 'Teaching Contract',
        department: 'Accounts',
        designation: 'Accountant',
        joined_on: '2026-07-01',
      },
      createLogin: false,
    });
    expect(dup.json().detail).toContain('KV0042 is already used');
    const b = await post('/people/staff/onboard', {
      values: {
        first_name: 'Bala',
        gender: 'Male',
        mobile: '9810012346',
        staff_type: 'Non-Teaching Regular',
        department: 'Accounts',
        designation: 'Accountant',
        joined_on: '2026-07-01',
      },
      createLogin: false,
    });
    expect(b.json()).toMatchObject({ code: 'KV0043', login: { made: false } });
    ids.bala = b.json().id;
    expect((await get(`/people/staff/${ids.bala}/profile`)).json()).toMatchObject({
      staffGroup: 'non_teaching',
      hasLogin: false,
    });
  });

  it('the profile: lists and formats checked, the present address and the same permanent one, IDs encrypted and masked, approvers by code, completeness', async () => {
    const bad = await put(`/people/staff/${ids.asha}/profile`, {
      changes: {
        pan: 'ABC',
        present_pin: '12',
        marital_status: 'Engaged',
        approver_l1: 'NOPE',
        age: 30,
      },
    });
    expect(bad.statusCode).toBe(400);
    const errs = bad
      .json()
      .errors.map((e: { path: string }) => e.path)
      .sort();
    expect(errs).toEqual(['age', 'approver_l1', 'marital_status', 'pan', 'present_pin']);
    const r = await put(`/people/staff/${ids.asha}/profile`, {
      changes: {
        dob: '12/05/1990',
        blood_group: 'B+',
        marital_status: 'Married',
        spouse_name: 'ravi',
        emergency_name: 'Ravi',
        emergency_mobile: '9810099999',
        present_line1: '12 Park Street',
        present_city: null,
        present_state: 'Delhi',
        present_pin: '110001',
        permanent_same: 'Yes',
        aadhaar: '1234 5678 9012',
        pan: 'abcde1234f',
        bank_account_no: '001234567890',
        bank_ifsc: 'sbin0001234',
        approver_l1: 'KV0043',
        pf_no: 'dl/123',
      },
    });
    expect(r.json().detail ?? 'saved').toBe('saved');
    const p = r.json();
    expect(p.values).toMatchObject({
      dob: '1990-05-12',
      spouse_name: 'RAVI',
      pan: 'ABCDE1234F',
      aadhaar: '123456789012',
      bank_ifsc: 'SBIN0001234',
      pf_no: 'DL/123',
      present_pin: '110001',
      permanent_line1: '12 Park Street',
      permanent_pin: '110001',
      approver_l1: ids.bala,
    });
    expect(p.approvers[ids.bala!]).toBe('BALA (KV0043)');
    // only the city is missing of the required ones
    expect(p.missing).toEqual(['present_city']);
    // stored encrypted; a viewer without the sensitive right sees them masked
    await withMigrator(async (c) => {
      const s = await c.query<{ secure: Record<string, string>; completeness: number }>(
        `SELECT secure, completeness FROM employees WHERE id = $1`,
        [ids.asha],
      );
      expect(s.rows[0]!.secure.aadhaar).toMatch(/^v1:/);
      expect(JSON.stringify(s.rows[0]!.secure)).not.toContain('1234');
      expect(s.rows[0]!.completeness).toBe(p.completeness);
    });
    const v = (await get(`/people/staff/${ids.asha}/profile`, viewer)).json();
    expect(v.values.aadhaar).toBe('XXXX-XXXX-9012');
    expect(v.sensitiveShown).toBe(false);
    // the masked value sent back leaves it as it is
    await put(`/people/staff/${ids.asha}/profile`, {
      changes: { aadhaar: 'XXXX-XXXX-9012', hobbies: 'Music' },
    });
    expect((await get(`/people/staff/${ids.asha}/profile`)).json().values.aadhaar).toBe(
      '123456789012',
    );
    // the viewer cannot change it
    expect(
      (await put(`/people/staff/${ids.asha}/profile`, { changes: { hobbies: 'x' } }, viewer))
        .statusCode,
    ).toBe(403);
    // the employee cannot approve themself
    const self = await put(`/people/staff/${ids.asha}/profile`, {
      changes: { approver_l2: 'KV0042' },
    });
    expect(self.json().detail).toContain('cannot be the employee themself');
  });

  it('rows: education, languages (once each), experience (end after start), transfers, remarks; leaving makes inactive', async () => {
    const e = await post(`/people/staff/${ids.asha}/rows/education`, {
      qualification: 'B.Ed.',
      institution: 'DU',
      passingYear: 2012,
      score: '72%',
    });
    expect(e.statusCode).toBe(201);
    expect(e.json().rows.education).toEqual([
      expect.objectContaining({ qualification: 'B.Ed.', passingYear: 2012 }),
    ]);
    await post(`/people/staff/${ids.asha}/rows/languages`, {
      language: 'Hindi',
      canRead: true,
      canSpeak: true,
    });
    const twice = await post(`/people/staff/${ids.asha}/rows/languages`, { language: 'Hindi' });
    expect(twice.statusCode).toBe(409);
    const badExp = await post(`/people/staff/${ids.asha}/rows/experience`, {
      organisation: 'KV',
      fromOn: '2015-04-01',
      toOn: '2014-03-31',
    });
    expect(badExp.statusCode).toBe(400);
    const x = await post(`/people/staff/${ids.asha}/rows/experience`, {
      organisation: 'KV',
      designation: 'PRT',
      fromOn: '2013-04-01',
      toOn: '2019-03-31',
    });
    const rowId = x.json().rows.experience[0].id;
    const ch = await put(`/people/staff/${ids.asha}/rows/experience/${rowId}`, {
      organisation: 'Kendriya Vidyalaya',
      fromOn: '2013-04-01',
      toOn: '2019-03-31',
    });
    expect(ch.json().rows.experience[0]).toMatchObject({
      organisation: 'Kendriya Vidyalaya',
      fromOn: '2013-04-01',
    });
    await post(`/people/staff/${ids.asha}/rows/transfers`, {
      onDate: '2020-04-01',
      toPlace: 'Noida branch',
    });
    const rm = await post(`/people/staff/${ids.asha}/rows/remarks`, {
      remark: 'Good with Class III',
    });
    const mine = rm.json().rows.remarks.find((r: { source: string }) => r.source === 'office');
    // a system remark cannot be removed; an office one can
    const sys = rm.json().rows.remarks.find((r: { source: string }) => r.source === 'system');
    expect((await del(`/people/staff/${ids.asha}/rows/remarks/${sys.id}`)).statusCode).toBe(404);
    expect((await del(`/people/staff/${ids.asha}/rows/remarks/${mine.id}`)).statusCode).toBe(200);
    expect((await post(`/people/staff/${ids.asha}/rows/salary`, {})).statusCode).toBe(404);
    // leaving
    const left = await put(`/people/staff/${ids.bala}/profile`, {
      changes: { left_on: '2026-08-31', leaving_reason: 'Moved' },
    });
    expect(left.json()).toMatchObject({ status: 'inactive' });
    expect(left.json().rows.remarks[0].remark).toContain('Leaving date set to 2026-08-31');
  });

  it('a login later for one without, refused without a mobile or an email', async () => {
    const r = await post(`/people/staff/${ids.bala}/login`, {});
    expect(r.json()).toMatchObject({ hasLogin: true });
    const n = await withMigrator(
      async (c) =>
        (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name) VALUES ($1, 'KV9999', 'Nocontact') RETURNING id::text`,
            [school.id],
          )
        ).rows[0]!.id,
    );
    expect((await post(`/people/staff/${n}/login`, {})).json().type).toContain(
      'employee.no_contact',
    );
  });
});
