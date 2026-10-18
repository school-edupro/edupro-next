/**
 * The employee master, part 1 (0175-0176, docs/design/30-employee-master.md): staff setup masters, the
 * field catalogue, quick onboarding with the next code and a staff login, the full profile (lists
 * checked, IDs encrypted and masked, the address pattern of students, approvers by code), completeness,
 * leaving, and the rows (education, languages, experience, transfers, remarks).
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
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
    // the staff drop-downs are rows of the profile lists master, editable there
    const lists = await get('/masters/profile_lists/rows?q=MaritalStatus&size=50');
    expect(JSON.stringify(lists.json())).toContain('Married');
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

  // ---- part 2: the list, its export and employee reports ----------------------------------------
  it('the list: fields by section, status counts, search in all, quick and any-field filters, sort, pages; masked IDs', async () => {
    const f = (await get('/people/staff/grid/fields')).json();
    expect(f.sections.map((x: { id: string }) => x.id)).toContain('rows');
    const keys = f.fields.map((x: { key: string }) => x.key);
    expect(keys).toEqual(
      expect.arrayContaining(['aadhaar', 'highest_qualification', 'languages', 'has_login']),
    );
    expect(f.fields.find((x: { key: string }) => x.key === 'staff_group').options).toContain(
      'Non-teaching',
    );
    const grid = (body: Record<string, unknown>, u: SeededUser = admin) =>
      post('/people/staff/grid', { columns: [], ...body }, u);
    const all = (await grid({ status: 'all', size: 10 })).json();
    expect(all.stats).toMatchObject({ total: 4, active: 3, inactive: 1 });
    // active by default; the leaver is found by a search whatever the status
    expect((await grid({})).json().total).toBe(3);
    const found = (await grid({ search: 'bala' })).json();
    expect(found).toMatchObject({ total: 1, searchedAll: true });
    expect(found.rows[0]).toMatchObject({ employee_code: 'KV0043', employee_status: 'Inactive' });
    // filters on catalogue, record and row fields; sort; columns
    const t = (
      await grid({
        status: 'all',
        columns: [{ key: 'highest_qualification' }, { key: 'languages' }, { key: 'aadhaar' }],
        filters: [
          { key: 'staff_group', op: 'eq', values: ['Teaching'] },
          { key: 'experience_years', op: 'gte', values: ['5'] },
        ],
      })
    ).json();
    expect(t.total).toBe(1);
    expect(t.rows[0]).toMatchObject({
      employee_code: 'KV0042',
      highest_qualification: 'B.Ed.',
      languages: 'Hindi',
      aadhaar: '123456789012',
    });
    expect(t.columns.map((c: { header: string }) => c.header)).toEqual([
      'Highest qualification',
      'Languages',
      'Aadhaar number',
    ]);
    const masked = (await grid({ columns: [{ key: 'aadhaar' }], search: 'asha' }, viewer)).json();
    expect(masked.rows[0].aadhaar).toBe('XXXX-XXXX-9012');
    const sorted = (
      await grid({ status: 'all', sort: [{ key: 'employee_code', dir: 'desc' }], size: 10 })
    ).json();
    expect(sorted.rows.map((r: { employee_code: string }) => r.employee_code)).toEqual([
      'KV9999',
      'KV0043',
      'KV0042',
      'KV0041',
    ]);
    const paged = (await grid({ status: 'all', size: 10, page: 2 })).json();
    expect(paged).toMatchObject({ page: 1, pages: 1 });
    expect((await grid({ columns: [{ key: 'nope' }] })).statusCode).toBe(400);
    expect((await grid({ filters: [{ key: 'department', op: 'eq' }] })).json().detail).toContain(
      'needs a value',
    );
  });

  it('export: the view as an Excel / PDF job on the employee dataset; too many columns for a PDF refused', async () => {
    const r = await post('/people/staff/grid/export', {
      columns: [{ key: 'department' }],
      filters: [{ key: 'staff_group', op: 'eq', values: ['Teaching'] }],
      format: 'xlsx',
    });
    expect(r.statusCode).toBe(201);
    expect(r.json().spec).toMatchObject({ dataset: 'employee_profile' });
    expect(r.json().spec.filters[0]).toEqual({
      key: 'employee_status',
      op: 'eq',
      values: ['Active'],
    });
    await withMigrator(async (c) => {
      const e = await c.query<{ dataset: string; params: { spec: { dataset: string } } }>(
        `SELECT dataset, params FROM exports WHERE id = $1`,
        [r.json().exportId],
      );
      expect(e.rows[0]).toMatchObject({
        dataset: 'report_builder',
        params: { spec: { dataset: 'employee_profile' } },
      });
    });
    const many = Array.from({ length: 26 }, (_, i) => ({
      key: [
        'mobile',
        'email',
        'dob',
        'gender',
        'religion',
        'category',
        'blood_group',
        'marital_status',
        'department',
        'designation',
        'staff_type',
        'joined_on',
        'pf_no',
        'uan',
        'esi_no',
        'nps_no',
        'voter_id',
        'passport_no',
        'oasis_no',
        'bank_name',
        'bank_ifsc',
        'bank_branch',
        'hobbies',
        'father_name',
        'emergency_name',
        'emergency_mobile',
      ][i]!,
    }));
    const pdf = await post('/people/staff/grid/export', { columns: many, format: 'pdf' });
    expect(pdf.json().detail).toContain('A PDF on A3 holds at most 25 columns');
  });

  it('the report builder reports on employees: fields, save with the dataset, preview with employee rows', async () => {
    // the school admin may build reports
    const f = (await get('/reports/builder/fields?dataset=employee_profile')).json();
    expect(f.dataset).toBe('employee_profile');
    expect(f.fields.map((x: { key: string }) => x.key)).toContain('designation');
    const spec = {
      dataset: 'employee_profile',
      columns: [{ key: 'employee_code' }, { key: 'full_name' }, { key: 'highest_qualification' }],
      filters: [{ key: 'has_login', op: 'eq', values: ['Yes'] }],
      sort: [{ key: 'employee_code', dir: 'asc' }],
      options: { paper: 'A4', orientation: 'auto', includeInactive: true },
    };
    const p = await post('/reports/builder/preview', { spec, limit: 10 });
    expect(p.statusCode).toBe(201);
    expect(p.json().rows.map((r: { employee_code: string }) => r.employee_code)).toEqual([
      'KV0042',
      'KV0043',
    ]);
    const saved = await post('/reports/builder', { name: 'Staff with a login', spec });
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({ dataset: 'employee_profile' });
    // a student report is unchanged
    const s = await post('/reports/builder/preview', {
      spec: {
        columns: [{ key: 'admission_no' }],
        filters: [],
        sort: [],
        options: { paper: 'A4', orientation: 'auto' },
      },
      limit: 5,
    });
    expect(s.statusCode).toBe(201);
  });

  // ---- part 3: Excel upload --------------------------------------------------------------------
  const xlsx = async (header: string[], rows: string[][]) => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Employees');
    ws.addRow(header);
    for (const r of rows) ws.addRow(r);
    return Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  };

  it('the templates: create (needed columns marked, a login column, lists) and update (pre-filled by code, IDs not)', async () => {
    const t = await inject({
      method: 'GET',
      url: '/people/staff/bulk/template?mode=create',
      headers: h(),
    });
    expect(t.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(t.rawPayload as never);
    const head = (wb.getWorksheet('Employees')!.getRow(1).values as unknown[]).slice(1).map(String);
    expect(head.slice(0, 4)).toEqual([
      'Employee Code',
      'Create staff login (Yes/No)',
      'First name *',
      'Last name',
    ]);
    expect(head).toContain('Employee type *');
    expect(head).not.toContain('Age');
    const u = await inject({
      method: 'GET',
      url: '/people/staff/bulk/template?mode=update&fields=mobile,aadhaar,approver_l1',
      headers: h(),
    });
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(u.rawPayload as never);
    const ws2 = wb2.getWorksheet('Employees')!;
    expect((ws2.getRow(1).values as unknown[]).slice(1)).toEqual([
      'Employee Code *',
      'Employee Name (reference)',
      'Mobile',
      'Aadhaar number',
      'L1 approver',
    ]);
    const asha = [2, 3, 4, 5]
      .map((r) => ws2.getRow(r))
      .find((r) => r.getCell(1).value === 'KV0042')!;
    expect(asha.getCell(3).value).toBe('9810012345');
    expect(asha.getCell(4).value).toBeNull(); // the Aadhaar is never pre-filled
    expect(asha.getCell(5).value).toBe('KV0043'); // the approver by code
  });

  it('create from Excel: next codes for blank ones, needed fields and lists checked, a login when asked; commit once', async () => {
    const file = await xlsx(
      [
        'Employee Code',
        'Create staff login (Yes/No)',
        'First name *',
        'Gender *',
        'Mobile *',
        'Employee type *',
        'Department *',
        'Designation *',
        'Date of joining *',
        'Aadhaar number',
        'L1 approver',
        'Shoe size',
      ],
      [
        [
          '',
          'Yes',
          'Ravi',
          'Male',
          '9811100001',
          'Teaching Regular',
          'Teaching Senior',
          'PGT',
          '01-08-2026',
          '1111 2222 3333',
          'KV0042',
          '9',
        ],
        [
          '',
          'No',
          'Sita',
          'Female',
          '9811100002',
          'Non-Teaching Regular',
          'Accounts',
          'Accountant',
          '2026-08-01',
          '',
          '',
          '',
        ],
        [
          'KV0042',
          '',
          'Dup',
          'Male',
          '9811100003',
          'Teaching Regular',
          'Accounts',
          'PRT',
          '01-08-2026',
          '',
          '',
          '',
        ],
        [
          '',
          '',
          'Bad',
          'Robot',
          '12345',
          'Teaching Regular',
          'Nowhere',
          'PRT',
          '31-02-2026',
          '',
          'NOBODY',
          '',
        ],
        ['', '', 'Short', '', '', '', '', '', '', '', '', ''],
      ],
    );
    const v = await post('/people/staff/bulk/validate', {
      mode: 'create',
      fileName: 'new.xlsx',
      contentBase64: file,
    });
    expect(v.statusCode).toBe(201);
    const s = v.json();
    expect(s).toMatchObject({ mode: 'create', totalRows: 5, readyRows: 2, rejectedRows: 3 });
    expect(s.preview.map((p: { code: string; login: boolean }) => [p.code, p.login])).toEqual([
      ['KV10000', true],
      ['KV10001', false],
    ]);
    const msgs = s.problems.map(
      (p: { row: number; column: string; message: string }) => `${p.row} ${p.column}: ${p.message}`,
    );
    expect(msgs).toEqual(
      expect.arrayContaining([
        '1 Shoe size: Column not recognised; ignored',
        '4 Employee Code: already used; use the update template for existing employees',
        '5 Department: one of: ' +
          msgs
            .find((m: string) => m.startsWith('5 Department: one of: '))!
            .slice('5 Department: one of: '.length),
        '5 L1 approver: no employee with the code NOBODY',
        '6 Mobile: is required',
      ]),
    );
    expect(msgs.some((m: string) => m.startsWith('5 Gender: one of'))).toBe(true);
    expect(msgs.some((m: string) => m.startsWith('5 Date of joining'))).toBe(true);
    // the Aadhaar is masked in the preview
    const ravi = s.preview[0].changes.find((c: { field: string }) => c.field === 'Aadhaar number');
    expect(ravi.to).toBe('XXXX-XXXX-3333');
    const c = await post(`/people/staff/bulk/${s.id}/commit`, {});
    expect(c.json()).toMatchObject({ applied: 2, logins: 1, failed: 0 });
    expect((await post(`/people/staff/bulk/${s.id}/commit`, {})).statusCode).toBe(409);
    const grid = (
      await post('/people/staff/grid', {
        columns: [{ key: 'aadhaar' }, { key: 'approver_l1' }],
        search: 'KV1000',
      })
    ).json();
    expect(
      grid.rows.map((r: { employee_code: string; has_login: string }) => [
        r.employee_code,
        r.has_login,
      ]),
    ).toEqual([
      ['KV10000', 'Yes'],
      ['KV10001', 'No'],
    ]);
    expect(grid.rows[0]).toMatchObject({
      aadhaar: '111122223333',
      approver_l1: 'ASHA RAO (KV0042)',
    });
    const r = await inject({
      method: 'GET',
      url: `/people/staff/bulk/${s.id}/result`,
      headers: h(),
    });
    expect(r.statusCode).toBe(200);
    const list = (await get('/people/staff/bulk')).json().data;
    expect(list[0]).toMatchObject({ id: s.id, mode: 'create', status: 'committed', applied: 2 });
  });

  it('update from Excel: by code, only what changed (old → new), CLEAR empties, a masked number leaves it, unknown code refused', async () => {
    const file = await xlsx(
      [
        'Employee Code',
        'Employee Name (reference)',
        'Mobile',
        'Hobbies',
        'Aadhaar number',
        'Blood group',
      ],
      [
        ['KV0042', 'x', '9810012345', 'CLEAR', 'XXXX-XXXX-9012', 'O+'],
        ['KV0043', 'x', '9810012346', '', '', ''],
        ['ZZ1', 'x', '9810000000', '', '', ''],
      ],
    );
    const v = (
      await post('/people/staff/bulk/validate', { mode: 'update', contentBase64: file })
    ).json();
    expect(v).toMatchObject({ readyRows: 1, rejectedRows: 1, unchangedRows: 1 });
    expect(v.preview[0]).toMatchObject({ code: 'KV0042' });
    expect(v.preview[0].changes).toEqual([
      { field: 'Hobbies', from: 'Music', to: null },
      { field: 'Blood group', from: 'B+', to: 'O+' },
    ]);
    expect(v.problems.find((p: { code: string }) => p.code === 'ZZ1').message).toBe(
      'no employee with this code',
    );
    expect((await post(`/people/staff/bulk/${v.id}/commit`, {})).json()).toMatchObject({
      applied: 1,
    });
    const p = (await get(`/people/staff/${ids.asha}/profile`)).json();
    expect(p.values).toMatchObject({ hobbies: null, blood_group: 'O+', aadhaar: '123456789012' });
    // the viewer may not upload
    expect(
      (await post('/people/staff/bulk/validate', { mode: 'update', contentBase64: file }, viewer))
        .statusCode,
    ).toBe(403);
  });
});
