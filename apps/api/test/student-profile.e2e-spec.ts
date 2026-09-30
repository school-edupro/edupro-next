/**
 * Student 360 profile (phase A, 2026-09-30): the field catalogue from the data collection sheet,
 * field-level edit with validation and normalising, encrypted and masked Aadhaar / PAN, the
 * "Sensitive data viewer" role, parent records shared by siblings, quick add and number suggestions.
 */
import { FAMILY_EDITABLE_KEYS, PROFILE_FIELD_BY_KEY } from '@edupro/db';
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
  let parent: SeededUser;
  let sectionId: string;
  let first: string;
  let second: string;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const firstStudent = () => first;

  beforeAll(async () => {
    const s = stamp('SP');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      // the admin grants full sensitive values to one named user through the role
      viewer = await seedUser(c, school, `${s}-viewer`, 'school_admin');
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
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
    expect(body.fields).toHaveLength(189);
    expect(body.sections).toHaveLength(14);
    expect(body.fields.find((f: { key: string }) => f.key === 'house').options).toEqual(
      expect.arrayContaining(['Red', 'Blue']),
    );
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
    const back = await patch(first, { aadhaar_no: 'XXXX-XXXX-9012', remarks: 'checked' });
    expect(back.statusCode).toBe(200);
    expect(back.json().values.remarks).toBe('checked');
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

  it('families request profile fields; approval applies them through the profile rules', async () => {
    expect(FAMILY_EDITABLE_KEYS.filter((k) => !PROFILE_FIELD_BY_KEY.has(k))).toEqual([]);
    // the parent account is the student's father
    const fatherId = (await read(first)).json().guardianIds.father as string;
    await withMigrator((c) =>
      c.query('UPDATE guardians SET user_id = $1 WHERE id = $2', [parent.id, fatherId]),
    );
    const fields = await inject({
      method: 'GET',
      url: `/engagement/change-requests/profile-fields?studentId=${first}`,
      headers: h(parent),
    });
    expect(fields.statusCode).toBe(200);
    expect(fields.json().fields.length).toBe(FAMILY_EDITABLE_KEYS.length);
    expect(fields.json().current).toMatchObject({ father_mobile: '9000000001' });
    const create = (changes: Record<string, string>) =>
      inject({
        method: 'POST',
        url: '/engagement/change-requests',
        headers: h(parent),
        json: { studentId: first, entity: 'profile', changes, reason: 'moved house' },
      });
    const notAllowed = await create({ category: 'SC', aadhaar_no: '123412341234' });
    expect(notAllowed.statusCode).toBe(422);
    const invalid = await create({ residential_pin_code: '2013' });
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().errors.residential_pin_code).toMatch(/PIN/);
    // the father may also ask for the sibling he is linked to
    const other = await inject({
      method: 'POST',
      url: '/engagement/change-requests',
      headers: h(parent),
      json: { studentId: second, entity: 'profile', changes: { residential_city: 'Noida' } },
    });
    expect(other.statusCode).toBe(201);
    const ok = await create({
      residential_address_line_1: 'C-4, Sector 62',
      residential_city: 'Noida',
      residential_pin_code: '201309',
      mother_occupation: 'education',
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ entity: 'profile', status: 'pending' });
    expect(ok.json().fieldLabels.residential_pin_code).toBe('Residential PIN Code');
    expect(ok.json().changes.mother_occupation.to).toBe('Education');
    const decide = await inject({
      method: 'POST',
      url: `/engagement/change-requests/${ok.json().id}/decide`,
      headers: h(),
      json: { approve: true },
    });
    expect(decide.statusCode).toBe(201);
    expect((await read(first)).json().values).toMatchObject({
      residential_address_line_1: 'C-4, Sector 62',
      residential_pin_code: '201309',
      mother_occupation: 'Education',
    });
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

  describe('documents', () => {
    const upload = async (name: string, contentType: string) => {
      const reg = await inject({
        method: 'POST',
        url: '/platform/files',
        headers: h(),
        json: { fileName: name, contentType, sizeBytes: 12, classification: 'personal' },
      });
      expect(reg.statusCode).toBe(201);
      const put = await inject({
        method: 'PUT',
        url: reg.json().upload.url,
        headers: {},
        raw: { body: Buffer.from('%PDF-1.4 abc'), contentType },
      });
      expect(put.statusCode).toBeLessThan(300);
      return reg.json().file.id as string;
    };

    it('adds, masks ID numbers, ticks the checklist, verifies, replaces and removes', async () => {
      const f1 = await upload('aadhaar.pdf', 'application/pdf');
      const add = await inject({
        method: 'POST',
        url: `/people/students/${second}/documents`,
        headers: h(),
        json: { kind: 'aadhaar', fileId: f1, number: '999988887777' },
      });
      expect(add.statusCode).toBe(201);
      const doc = add.json().find((d: { kind: string }) => d.kind === 'aadhaar');
      expect(doc.number).toBe('XXXX-XXXX-7777');
      expect((await read(second)).json().values.aadhaar_copy_submitted).toBe('Yes');
      const full = await inject({
        method: 'GET',
        url: `/people/students/${second}`,
        headers: h(viewer),
      });
      expect(full.json().documents.find((d: { id: string }) => d.id === doc.id).number).toBe(
        '999988887777',
      );

      const ver = await inject({
        method: 'POST',
        url: `/people/students/${second}/documents/${doc.id}/verify`,
        headers: h(),
        json: { verified: true },
      });
      expect(ver.json().find((d: { id: string }) => d.id === doc.id).verifiedAt).not.toBeNull();

      const f2 = await upload('aadhaar-new.pdf', 'application/pdf');
      const rep = await inject({
        method: 'PUT',
        url: `/people/students/${second}/documents/${doc.id}`,
        headers: h(),
        json: { fileId: f2 },
      });
      expect(rep.statusCode).toBe(200);
      const current = rep.json().filter((d: { kind: string }) => d.kind === 'aadhaar');
      expect(current).toHaveLength(1);
      expect(current[0]).toMatchObject({ fileId: f2, number: 'XXXX-XXXX-7777', verifiedAt: null });

      const del = await inject({
        method: 'DELETE',
        url: `/people/students/${second}/documents/${current[0].id}`,
        headers: h(),
      });
      expect(del.statusCode).toBe(200);
      expect(del.json().some((d: { kind: string }) => d.kind === 'aadhaar')).toBe(false);
      const history = await withMigrator((c) =>
        c.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM person_documents WHERE person_id = $1 AND kind = 'aadhaar'`,
          [second],
        ),
      );
      expect(history.rows[0]!.n).toBe('2'); // kept as history
    });

    it('a photo becomes the student photo; removing it falls back to the previous one', async () => {
      const p1 = await upload('p1.png', 'image/png');
      const p2 = await upload('p2.png', 'image/png');
      for (const fileId of [p1, p2])
        await inject({
          method: 'POST',
          url: `/people/students/${second}/documents`,
          headers: h(),
          json: { kind: 'photo', fileId },
        });
      const s1 = await inject({ method: 'GET', url: `/people/students/${second}`, headers: h() });
      expect(s1.json().photoFileId).toBe(p2);
      const latest = s1.json().documents.find((d: { fileId: string }) => d.fileId === p2);
      await inject({
        method: 'DELETE',
        url: `/people/students/${second}/documents/${latest.id}`,
        headers: h(),
      });
      expect(
        (await inject({ method: 'GET', url: `/people/students/${second}`, headers: h() })).json()
          .photoFileId,
      ).toBe(p1);
    });
  });

  describe('bulk update and create from Excel', () => {
    const upload = (mode: 'update' | 'create', csv: string) =>
      inject({
        method: 'POST',
        url: '/people/profile/bulk/validate',
        headers: h(),
        json: { mode, fileName: 't.csv', csv },
      });

    it('downloads a template pre-filled with current values', async () => {
      const r = await inject({
        method: 'GET',
        url: `/people/profile/bulk/template?mode=update&classSectionId=${sectionId}&fields=religion,sms_mobile,aadhaar_no`,
        headers: h(),
      });
      expect(r.statusCode).toBe(200);
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer);
      const ws = wb.getWorksheet('Students')!;
      expect(ws.getRow(1).values).toEqual(
        expect.arrayContaining([
          'Admission No *',
          'Student Name (reference)',
          'Religion',
          'Student Aadhaar No',
        ]),
      );
      const rows = [2, 3].map((n) => ws.getRow(n).values as unknown[]);
      const riya = rows.find((v) => v[1] === 'SP1001')!;
      expect(riya).toContain('Hindu');
      // Aadhaar is never written into a file
      expect(JSON.stringify(rows)).not.toContain('123456789012');
    });

    it('updates by admission number: blank = unchanged, CLEAR empties, errors named, sensitive values encrypted until commit', async () => {
      const v = await upload(
        'update',
        [
          'Admission No,Religion,Remarks,Student Aadhaar No,Unknown Column',
          'SP1001,sikh,CLEAR,,x',
          'SP1002,,,999988887777,',
          'SP1002,Hindu,,,',
          'NOPE,Hindu,,,',
          'SP1001,Martian,,,',
        ].join('\n'),
      );
      expect(v.statusCode).toBe(201);
      const d = v.json();
      expect(d).toMatchObject({ totalRows: 5, readyRows: 2, rejectedRows: 3 });
      expect(d.problems.map((p: { message: string }) => p.message)).toEqual(
        expect.arrayContaining([
          'Column not recognised; ignored',
          'appears twice in this file',
          'no student with this admission number',
        ]),
      );
      const row1 = d.preview.find((p: { admissionNo: string }) => p.admissionNo === 'SP1001');
      expect(row1.changes).toEqual(
        expect.arrayContaining([
          { field: 'Religion', from: 'Hindu', to: 'Sikh' },
          { field: 'Remarks', from: 'checked', to: null },
        ]),
      );
      const staged = await withMigrator((c) =>
        c.query<{ payload: unknown }>('SELECT payload FROM master_imports WHERE id = $1', [d.id]),
      );
      expect(JSON.stringify(staged.rows[0]!.payload)).not.toContain('999988887777');
      const commit = await inject({
        method: 'POST',
        url: `/people/profile/bulk/${d.id}/commit`,
        headers: h(),
      });
      expect(commit.json()).toMatchObject({ applied: 2, failed: 0 });
      expect((await read(firstStudent())).json().values).toMatchObject({
        religion: 'Sikh',
        remarks: null,
      });
      expect((await read(second, viewer)).json().values.aadhaar_no).toBe('999988887777');
      const again = await inject({
        method: 'POST',
        url: `/people/profile/bulk/${d.id}/commit`,
        headers: h(),
      });
      expect(again.statusCode).toBe(409);
    });

    it('creates students with enrolment and rejects existing admission numbers and unknown sections', async () => {
      const header =
        "Admission No,Class-Section,First Name,Date of Birth,Gender,Father's Name,SMS Mobile (Primary),Caste Category,EWS / DG Category,Day Scholar / Hosteller,Transport Required";
      const row = (adm: string, sec: string) =>
        `${adm},${sec},meera,05-05-2015,Female,raj,9811100077,General,No,Day Scholar,No`;
      const v = await upload(
        'create',
        [header, row('SP2001', 'VI-A'), row('SP2002', 'XI-Z'), row('SP1001', 'VI-A')].join('\n'),
      );
      const d = v.json();
      expect(d).toMatchObject({ readyRows: 1, rejectedRows: 2 });
      const commit = await inject({
        method: 'POST',
        url: `/people/profile/bulk/${d.id}/commit`,
        headers: h(),
      });
      expect(commit.json()).toMatchObject({ applied: 1 });
      const list = await inject({ method: 'GET', url: '/people/students?q=SP2001', headers: h() });
      expect(list.json().data[0]).toMatchObject({ admissionNo: 'SP2001', displayName: 'MEERA' });
      expect(list.json().data[0].enrolment).toMatchObject({ section: 'A', rollNo: 3 });
    });

    it('reads the data collection workbook: section band, S.No, separate Class and Section, unused columns', async () => {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      wb.addWorksheet('Instructions').getCell(1, 1).value = 'How to fill';
      const ws = wb.addWorksheet('Student Data Entry');
      ws.addRow(['S.No', 'STUDENT']);
      ws.addRow([
        null,
        'Registration No *',
        'Admission No',
        'First Name *',
        'Date of Birth *',
        'Gender *',
        'Caste Category *',
        'EWS / DG Category *',
        'Class *',
        'Section',
        'School / Branch *',
        "Father's Name *",
        'SMS Mobile (Primary) *',
        'Day Scholar / Hosteller *',
        'Transport Required *',
      ]);
      const base = ['2014-05-05', 'Female', 'General', 'No'];
      ws.addRow([
        1,
        'RG1',
        'SP3001',
        'tara',
        ...base,
        'VI',
        'A',
        'DPS X',
        'tara father',
        '9811100088',
        'Day Scholar',
        'No',
      ]);
      ws.addRow([
        2,
        'RG2',
        null,
        'isha',
        ...base,
        'VI',
        'A',
        'DPS X',
        'isha father',
        '9811100089',
        'Day Scholar',
        'No',
      ]);
      ws.addRow([3]); // serial number only
      ws.addRow([
        4,
        'RG4',
        'SP3004',
        'noor',
        ...base,
        'VI',
        'Z',
        'DPS X',
        'noor father',
        '9811100090',
        'Day Scholar',
        'No',
      ]);
      const b64 = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
      const v = await inject({
        method: 'POST',
        url: '/people/profile/bulk/validate',
        headers: h(),
        json: { mode: 'create', fileName: 'collection.xlsx', contentBase64: b64 },
      });
      expect(v.statusCode).toBe(201);
      const d = v.json();
      expect(d).toMatchObject({ totalRows: 3, readyRows: 1, rejectedRows: 2 });
      const byRow = (r: number) => d.problems.filter((p: { row: number }) => p.row === r);
      expect(
        byRow(1).map((p: { column: string; message: string }) => `${p.column}: ${p.message}`),
      ).toContain('School / Branch *: not used: the school is the one you are working in');
      expect(byRow(4)[0].message).toMatch(/registration RG2/);
      expect(byRow(6)[0].message).toMatch(/no section "Z"/);
      expect(d.preview[0]).toMatchObject({ row: 3, admissionNo: 'SP3001' });
    });

    it('needs the import permission', async () => {
      const clerkless = await withMigrator((c) =>
        seedUser(c, school, `${stamp('SP')}-t`, 'class_teacher'),
      );
      const r = await inject({
        method: 'POST',
        url: '/people/profile/bulk/validate',
        headers: h(clerkless),
        json: { mode: 'update', csv: 'Admission No\nSP1001' },
      });
      expect(r.statusCode).toBe(403);
    });
  });
});
