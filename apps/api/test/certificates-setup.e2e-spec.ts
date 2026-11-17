/**
 * Certificate management, phase B (docs/design/87): the set-up — every type with its checks, layouts, who issues it and
 * its own fields; the school's own types; the templates with their versions, restore, reset to the ready layout, a copy,
 * the live preview and the field list, and refusing a template that would run code; who signs and the signature
 * boxes; staff certificates; the class rule.
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

interface Cert {
  id: string;
  number: string;
  status: string;
  employeeId: string | null;
}

describe('certificate set-up (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let clerk: SeededUser;
  let officeRole: string;
  const pupils: Record<string, string> = {};
  const staff: Record<string, string> = {};

  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });
  const send = (method: 'POST' | 'PUT', url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method, url, headers: h(u), json });

  beforeAll(async () => {
    const s = stamp('CRB');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-office`, 'certificate_office');
      clerk = await seedUser(c, school, `${s}-clerk`);
      // a role of the school's own that may issue (but is not the certificate office)
      const role = await c.query<{ id: string }>(
        `INSERT INTO roles (school_id, code, name, kind) VALUES ($1, 'cert_clerk', 'Certificate clerk', 'module') RETURNING id::text`,
        [school.id],
      );
      await c.query(
        `INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, 'certificate.register.view'), ($1, 'certificate.register.issue')`,
        [role.rows[0]!.id],
      );
      await c.query(
        `INSERT INTO user_roles (school_id, user_id, role_id, reason) VALUES ($1, $2, $3, 'e2e')`,
        [school.id, clerk.id, role.rows[0]!.id],
      );
      officeRole = (
        await c.query<{ id: string }>(
          `SELECT id::text FROM roles WHERE school_id IS NULL AND code = 'certificate_office'`,
        )
      ).rows[0]!.id;
      // the principal (with a signature image on record), a teacher in service, one who has left
      const sig = await c.query<{ id: string }>(
        `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, original_name, status, created_by)
         VALUES ($1, 'test', $2, 'image/png', 1200, 'sign.png', 'ready', $3) RETURNING id::text`,
        [school.id, `${s}/sign.png`, admin.id],
      );
      for (const [key, code, first, gender, status, designation, extra] of [
        ['principal', 'P01', 'Prem', 'male', 'active', 'Principal', sig.rows[0]!.id],
        ['teacher', 'T01', 'Tara', 'female', 'active', 'PGT Physics', null],
        ['former', 'T02', 'Farah', 'female', 'inactive', 'TGT English', null],
      ] as const) {
        const e = await c.query<{ id: string }>(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, gender, status, designation, department,
                                  joined_on, left_on, signature_file_id)
           VALUES ($1, $2, $3, 'Test', $4::gender, $5::row_status, $6, 'Academics', '2019-07-01',
                   CASE WHEN $5 = 'inactive' THEN '2026-05-31'::date END, $7) RETURNING id::text`,
          [school.id, code, first, gender, status, designation, extra],
        );
        staff[key] = e.rows[0]!.id;
      }
    });
    app = await createApp();
    inject = injector(app);
    const cls = new Map<string, string>();
    for (const [code, order] of [
      ['VI', 6],
      ['IX', 9],
    ] as const) {
      const k = await send('POST', '/academics/classes', {
        code,
        name: `Class ${code}`,
        displayOrder: order,
      });
      const sec = await send('POST', `/academics/classes/${k.json().id}/sections`, { name: 'A' });
      cls.set(code, sec.json().id);
    }
    let roll = 1;
    for (const [key, first, cl] of [
      ['six', 'Sana', 'VI'],
      ['nine', 'Neel', 'IX'],
    ] as const) {
      const r = await send('POST', '/people/students', {
        admissionNo: `${s}-${key}`,
        firstName: first,
        lastName: 'Test',
        dob: '2012-08-15',
        gender: key === 'six' ? 'female' : 'male',
        guardians: [
          {
            guardian: {
              firstName: 'Raj',
              lastName: 'Test',
              mobile: `98764${String(50000 + roll)}`,
            },
            relation: 'father',
            isPrimary: true,
          },
        ],
        enrolment: { classSectionId: cls.get(cl), rollNo: roll++ },
      });
      if (r.statusCode !== 201) throw new Error(`student ${key}: ${r.statusCode} ${r.body}`);
      pupils[key] = r.json().id as string;
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('shows the set-up: every type, the ready templates, what to look at; only to the set-up right', async () => {
    const o = await get('/certificates/setup');
    expect(o.statusCode).toBe(200);
    expect(o.json().figures).toMatchObject({ types: 21, active: 21, own: 0, signatory: false });
    // the 22 ready layouts and the reprint of certificates from the old system (used by no type)
    const ready = (
      o.json().templates as Array<{ ready: boolean; code: string; usedBy: string[] }>
    ).filter((t) => t.ready);
    expect(ready).toHaveLength(23);
    expect(ready.find((t) => t.code === 'cert_legacy')).toMatchObject({ usedBy: [] });
    // a TC issued before the register prints with its own layout: the list says so (17 Nov 2026)
    const pupil = Object.values(pupils)[0]!;
    const tcTpl = await withMigrator(async (c) => {
      const t = await c.query<{ id: string }>(
        `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css, variables)
         VALUES ($1, 'tc_before', 'TC before the register', 'transfer_certificate', '210mm', '297mm', '<p>TC</p>', '', '[]'::jsonb)
         RETURNING id::text`,
        [school.id],
      );
      await c.query(
        `INSERT INTO transfer_certificates (school_id, student_id, academic_year_id, tc_no, serial, reason, template_id)
         VALUES ($1, $2, $3, 'TC/OLD/1', 1, 'Moving', $4)`,
        [school.id, pupil, school.yearId, t.rows[0]!.id],
      );
      return t.rows[0]!.id;
    });
    const after = (await get('/certificates/setup')).json();
    expect((after.templates as Array<{ id: string }>).find((x) => x.id === tcTpl)).toMatchObject({
      usedBy: [],
      tcMade: 1,
      screenMade: 0,
    });
    expect((await get(`/certificates/setup/templates/${tcTpl}`)).json()).toMatchObject({
      tcMade: 1,
    });
    expect(o.json().checks[0].text).toMatch(/No signatory/);
    const staffTypes = (o.json().types as Array<{ code: string; audience: string }>)
      .filter((t) => t.audience === 'STAFF')
      .map((t) => t.code);
    expect(staffTypes).toEqual(['EXPERIENCE', 'SERVICE', 'STAFF_VISA']);
    expect((await get('/certificates/setup', office)).statusCode).toBe(403);
  });

  it('sets who signs; the boxes print the issuer, the date and time, and the principal with the signature', async () => {
    const bad = await send('PUT', '/certificates/setup/settings', {
      signatoryEmployeeId: '999999999',
      signatoryTitle: 'Principal',
      printSignature: true,
      printPreparer: true,
    });
    expect(bad.statusCode).toBe(404);
    const ok = await send('PUT', '/certificates/setup/settings', {
      signatoryEmployeeId: staff.principal,
      signatoryTitle: 'Principal',
      printSignature: true,
      printPreparer: true,
      footerNote: 'Not valid without the school seal',
    });
    expect(ok.json()).toMatchObject({
      signatory: { name: 'Prem Test', code: 'P01', hasSignature: true },
    });
    const r = await send(
      'POST',
      '/certificates/issue',
      { typeCode: 'BONAFIDE', studentId: pupils.six },
      office,
    );
    expect(r.statusCode).toBe(201);
    const d = await get(`/certificates/${(r.json() as Cert).id}`);
    const signs = d.json().data.signs as Array<Record<string, string | null>>;
    expect(signs.map((x) => x.title)).toEqual(['Prepared by', 'Checked by', 'Principal']);
    expect(signs[0]!.at).toMatch(/^Issued on \d{2}-\d{2}-\d{4} \d{2}:\d{2} (AM|PM)$/);
    expect(signs[2]).toMatchObject({ name: 'Prem Test', empId: 'P01', designation: 'Principal' });
    expect(signs[2]!.fileId).toMatch(/^\d+$/);
    expect(d.json().data.footerNote).toBe('Not valid without the school seal');
    // the preview shows the boxes (the image cannot be read in the test store: the box is left empty)
    const p = await send(
      'POST',
      '/certificates/preview',
      { typeCode: 'BONAFIDE', studentId: pupils.six },
      office,
    );
    expect(p.json().html).toContain('eb-signs');
    expect(p.json().html).toContain('Prem Test');
    expect(p.json().html).toContain('Emp. ID P01 · Principal');
    expect(p.json().html).toContain('Not valid without the school seal');
  });

  it('issues staff certificates with their own checks: in service, left, one experience certificate', async () => {
    const svc = await send('POST', '/certificates/issue', {
      typeCode: 'SERVICE',
      employeeId: staff.teacher,
      purpose: 'Bank loan',
    });
    expect(svc.statusCode).toBe(201);
    expect(svc.json()).toMatchObject({ number: 'SRV/2026-27/00001', employeeId: staff.teacher });
    const notLeft = await send('POST', '/certificates/issue', {
      typeCode: 'EXPERIENCE',
      employeeId: staff.teacher,
    });
    expect(notLeft.statusCode).toBe(409);
    expect(notLeft.json().checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'state', label: 'Employee', ok: false }),
      ]),
    );
    const exp = await send('POST', '/certificates/issue', {
      typeCode: 'EXPERIENCE',
      employeeId: staff.former,
      fields: { conduct: 'Excellent' },
    });
    expect(exp.statusCode).toBe(201);
    const d = await get(`/certificates/${(exp.json() as Cert).id}`);
    expect(d.json().data.employee).toMatchObject({
      name: 'Farah Test',
      code: 'T02',
      joinedOn: '01-07-2019',
      leftOn: '31-05-2026',
      pronoun: 'she',
    });
    expect(d.json().data.text.conduct).toBe('excellent');
    const again = await send('POST', '/certificates/issue', {
      typeCode: 'EXPERIENCE',
      employeeId: staff.former,
    });
    expect(again.statusCode).toBe(409);
    expect(again.json().type).toBe('certificate.already_held');
    // a student type needs a student, a staff type an employee
    const wrong = await send('POST', '/certificates/issue', {
      typeCode: 'SERVICE',
      studentId: pupils.six,
    });
    expect(wrong.statusCode).toBe(400);
    const visa = await send('POST', '/certificates/issue', {
      typeCode: 'STAFF_VISA',
      employeeId: staff.teacher,
      fields: { country: 'Japan', fromDate: '2026-12-20', toDate: '2026-12-10' },
    });
    expect(visa.statusCode).toBe(400);
    expect(visa.json().detail).toMatch(/return date is before/);
    // the register finds staff certificates by name and employee code
    const reg = await get('/certificates?q=T02');
    expect(reg.json().rows[0]).toMatchObject({ studentName: 'Farah Test', admissionNo: 'T02' });
  });

  it('keeps a type to its classes (board registration for VIII–XII)', async () => {
    const six = await send('POST', '/certificates/preview', {
      typeCode: 'BOARD_REG',
      studentId: pupils.six,
    });
    expect(six.json().checks).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: 'class', ok: false })]),
    );
    const nine = await send('POST', '/certificates/preview', {
      typeCode: 'BOARD_REG',
      studentId: pupils.nine,
    });
    expect(nine.json().checks.find((x: { key: string }) => x.key === 'class')).toMatchObject({
      ok: true,
    });
    expect(nine.json().values).toMatchObject({ session: '2026-27' });
    const missing = await send('POST', '/certificates/issue', {
      typeCode: 'BOARD_REG',
      studentId: pupils.nine,
    });
    expect(missing.statusCode).toBe(400);
    const ok = await send('POST', '/certificates/issue', {
      typeCode: 'BOARD_REG',
      studentId: pupils.nine,
      fields: { board: 'CBSE', registrationNo: 'B2026/1234' },
    });
    expect(ok.statusCode).toBe(201);
  });

  it('chooses a layout from the type’s variants', async () => {
    const p = await send('POST', '/certificates/preview', {
      typeCode: 'BONAFIDE',
      studentId: pupils.nine,
    });
    const variants = p.json().variants as Array<{ templateId: string; label: string }>;
    expect(variants.map((v) => v.label)).toEqual([
      'Bonafide certificate',
      'Bonafide certificate (father only)',
    ]);
    const father = variants[1]!.templateId;
    const r = await send('POST', '/certificates/issue', {
      typeCode: 'BONAFIDE',
      studentId: pupils.nine,
      variant: father,
    });
    expect(r.statusCode).toBe(201);
    const v = await withMigrator((c) =>
      c.query<{ template_id: string }>(
        `SELECT v.template_id::text FROM certificates x JOIN document_template_versions v ON v.id = x.template_version_id WHERE x.id = $1`,
        [(r.json() as Cert).id],
      ),
    );
    expect(v.rows[0]!.template_id).toBe(father);
    const tc = (await get('/certificates/setup'))
      .json()
      .types.find((t: { code: string }) => t.code === 'TC');
    const bad = await send('POST', '/certificates/preview', {
      typeCode: 'BONAFIDE',
      studentId: pupils.nine,
      variant: tc.templateId,
    });
    expect(bad.statusCode).toBe(400);
  });

  it('sets a type: its own fields, who may issue it, its prefix; and adds a type of the school', async () => {
    const t = (await get('/certificates/setup/types/DOB')).json();
    expect(t.roles.length).toBeGreaterThan(3);
    const body = {
      name: 'Date of birth certificate',
      prefix: 'DOB',
      templateId: t.templateId,
      variants: [],
      rules: { state: 'any' },
      multiple: 'ANY',
      active: true,
      sortOrder: 40,
      issuers: [officeRole],
      fields: [{ key: 'witness', label: 'Verified against', kind: 'text', required: true }],
    };
    const dupKey = await send('PUT', '/certificates/setup/types/DOB', {
      ...body,
      fields: [
        { key: 'witness', label: 'A', kind: 'text' },
        { key: 'witness', label: 'B', kind: 'text' },
      ],
    });
    expect(dupKey.statusCode).toBe(400);
    const taken = await send('PUT', '/certificates/setup/types/DOB', { ...body, prefix: 'BON' });
    expect(taken.statusCode).toBe(409);
    // the reprint layout of certificates from the old system is no type's to print with
    expect((t.templates as Array<{ code: string }>).some((x) => x.code === 'cert_legacy')).toBe(
      false,
    );
    const legacyId = (
      (await get('/certificates/setup')).json().templates as Array<{ id: string; code: string }>
    ).find((x) => x.code === 'cert_legacy')!.id;
    const asLegacy = await send('PUT', '/certificates/setup/types/DOB', {
      ...body,
      templateId: legacyId,
    });
    expect(asLegacy.statusCode).toBe(400);
    const saved = await send('PUT', '/certificates/setup/types/DOB', body);
    expect(saved.statusCode).toBe(200);
    // the clerk's role may issue but is not the office: refused; the office may
    const refused = await send(
      'POST',
      '/certificates/issue',
      { typeCode: 'DOB', studentId: pupils.six, fields: { witness: 'Birth certificate' } },
      clerk,
    );
    expect(refused.statusCode).toBe(403);
    expect(refused.json().detail).toMatch(/issued by: Certificate office/);
    const noField = await send(
      'POST',
      '/certificates/issue',
      { typeCode: 'DOB', studentId: pupils.six },
      office,
    );
    expect(noField.statusCode).toBe(400);
    const ok = await send(
      'POST',
      '/certificates/issue',
      { typeCode: 'DOB', studentId: pupils.six, fields: { witness: 'Birth certificate' } },
      office,
    );
    expect(ok.statusCode).toBe(201);
    const d = await get(`/certificates/${(ok.json() as Cert).id}`);
    expect(d.json().data.fields.witness).toBe('Birth certificate');

    const own = await send('POST', '/certificates/setup/types', {
      code: 'SPORTS',
      name: 'Sports participation certificate',
      audience: 'STUDENT',
      prefix: 'SPT',
    });
    expect(own.statusCode).toBe(201);
    expect(own.json()).toMatchObject({ code: 'SPORTS', builtIn: false, active: true });
    const again = await send('POST', '/certificates/setup/types', {
      code: 'SPORTS2',
      name: 'Another',
      audience: 'STUDENT',
      prefix: 'SPT',
    });
    expect(again.statusCode).toBe(409);
    const sp = await send(
      'POST',
      '/certificates/issue',
      { typeCode: 'SPORTS', studentId: pupils.six },
      office,
    );
    expect(sp.json()).toMatchObject({ number: 'SPT/2026-27/00001' });
  });

  it('edits a template: the field list, a live preview, versions, restore, reset, a copy; refuses code', async () => {
    const o = (await get('/certificates/setup')).json();
    const id = (o.templates as Array<{ id: string; code: string }>).find(
      (t) => t.code === 'cert_character',
    )!.id;
    const t = (await get(`/certificates/setup/templates/${id}`)).json();
    expect(t).toMatchObject({ ready: true, version: 1, forType: 'CHARACTER' });
    const groups = (t.catalogue as Array<{ group: string; items: Array<{ token: string }> }>).map(
      (g) => g.group,
    );
    expect(groups).toEqual(
      expect.arrayContaining([
        'Blocks (EduPro prints them)',
        'Student',
        'Parents',
        'Fields typed at issue',
      ]),
    );
    const evil = await send('PUT', `/certificates/setup/templates/${id}`, {
      name: t.name,
      pageWidth: '210mm',
      pageHeight: '297mm',
      bodyHtml: '<p>Hi</p><img src="https://evil.example/x.png">',
      stylesCss: '',
    });
    expect(evil.statusCode).toBe(400);
    for (const bodyHtml of [
      '<script>alert(1)</script>',
      '<p onclick="x()">a</p>',
      '<a href="javascript:x">a</a>',
    ])
      expect(
        (
          await send('POST', '/certificates/setup/templates/preview', {
            typeCode: 'CHARACTER',
            pageWidth: '210mm',
            pageHeight: '297mm',
            bodyHtml,
          })
        ).statusCode,
      ).toBe(400);
    const preview = await send('POST', '/certificates/setup/templates/preview', {
      typeCode: 'CHARACTER',
      pageWidth: '210mm',
      pageHeight: '297mm',
      bodyHtml:
        '{{{blocks.letterhead}}}<p>Hello {{student.name}}: {{fields.remark}} / {{text.conduct}}</p>',
    });
    expect(preview.statusCode).toBe(201);
    expect(preview.json().html).toContain('eb-head');
    expect(preview.json().html).toContain('Hello Sana Test: [A line more (optional)] / good');
    const v2 = await send('PUT', `/certificates/setup/templates/${id}`, {
      name: 'Character certificate',
      pageWidth: '210mm',
      pageHeight: '297mm',
      bodyHtml: `${t.bodyHtml as string}<p>Edited</p>`,
      stylesCss: t.stylesCss,
    });
    expect(v2.json()).toMatchObject({ version: 2 });
    const back = await send('POST', `/certificates/setup/templates/${id}/restore/1`, {});
    expect(back.json().version).toBe(3);
    expect(back.json().bodyHtml).toBe(t.bodyHtml);
    await send('PUT', `/certificates/setup/templates/${id}`, {
      name: 'Character certificate',
      pageWidth: '210mm',
      pageHeight: '297mm',
      bodyHtml: '<p>Something else</p>',
      stylesCss: '',
    });
    const reset = await send('POST', `/certificates/setup/templates/${id}/reset`, {});
    expect(reset.json().version).toBe(5);
    expect(reset.json().bodyHtml).toBe(t.bodyHtml);
    expect(reset.json().versions.map((x: { version: number }) => x.version)).toEqual([
      5, 4, 3, 2, 1,
    ]);
    const copy = await send('POST', '/certificates/setup/templates', {
      name: 'Character (sports)',
      copyOf: id,
    });
    expect(copy.statusCode).toBe(201);
    expect(copy.json()).toMatchObject({ name: 'Character (sports)', ready: false, version: 1 });
    const notReady = await send(
      'POST',
      `/certificates/setup/templates/${copy.json().id as string}/reset`,
      {},
    );
    expect(notReady.statusCode).toBe(409);
  });
});
