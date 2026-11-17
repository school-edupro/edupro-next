/**
 * Certificates from an Excel sheet (docs/design/87, 17 Nov 2026): the sheet built for a type and a scope, filled from
 * the records; an upload kept as a draft, each row checked as the Issue page checks it (the person, a second row of
 * them, the details, the checks); a TC row without a withdrawal says so, and once the withdrawals are cleared the rows
 * are ready; the errors file; a corrected sheet into the same draft; the ready rows issued in one run, numbered, each
 * with its own details; nothing left to issue twice. Staff and other types get their own columns.
 */
import ExcelJS from 'exceljs';
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
  key: string;
  personId: string | null;
  status: string;
  problems: string[];
  startWithdrawal: boolean;
  certificateId: string | null;
  number: string | null;
}
interface Upload {
  id: string;
  figures: {
    rows: number;
    ready: number;
    attention: number;
    issued: number;
    startWithdrawal: number;
  };
  rows: Row[];
}

describe('certificates from an Excel sheet (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let teacher: SeededUser;
  let section: string;
  let s: string;
  const pupils: Record<string, string> = {};

  const h = (u: SeededUser = office) => headersFor(u.sub, school.id);
  const post = (url: string, json: unknown, u: SeededUser = office) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const get = (url: string, u: SeededUser = office) =>
    inject({ method: 'GET', url, headers: h(u) });

  /** A sheet as the API gives it: its headings and rows as the cells' values. */
  async function open(base64: string) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(base64, 'base64') as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const heads = (ws.getRow(1).values as ExcelJS.CellValue[]).slice(1).map((v) => String(v));
    return { wb, ws, heads };
  }
  /** the rows with someone in them (the drop-downs make the sheet 500 rows long) */
  const filled = (ws: ExcelJS.Worksheet) => {
    let n = 0;
    ws.eachRow((row, i) => {
      if (i > 1 && row.getCell(1).value) n += 1;
    });
    return n;
  };
  const col = (heads: string[], name: string) =>
    heads.findIndex((x) => x.replace(/ \*$/, '') === name) + 1;

  beforeAll(async () => {
    s = stamp('CIM');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-office`, 'certificate_office');
      teacher = await seedUser(c, school, `${s}-teacher`);
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, gender, status, designation, department, joined_on)
         VALUES ($1, 'T01', 'Tara', 'Test', 'female', 'active', 'PGT Physics', 'Academics', '2019-07-01')`,
        [school.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await post(
      '/academics/classes',
      { code: 'XII', name: 'Class XII', displayOrder: 12 },
      admin,
    );
    const sec = await post(
      `/academics/classes/${cls.json().id as string}/sections`,
      { name: 'A' },
      admin,
    );
    section = sec.json().id as string;
    let roll = 1;
    for (const [key, first] of [
      ['asha', 'Asha'],
      ['bina', 'Bina'],
      ['chet', 'Chetan'],
      ['dev', 'Dev'],
    ] as const) {
      const r = await post(
        '/people/students',
        {
          admissionNo: `${s}-${key}`,
          firstName: first,
          lastName: 'Test',
          dob: '2008-03-09',
          gender: 'female',
          guardians: [
            {
              guardian: {
                firstName: 'Ravi',
                lastName: 'Test',
                mobile: `98764${String(50000 + roll)}`,
              },
              relation: 'father',
              isPrimary: true,
            },
          ],
          enrolment: { classSectionId: section, rollNo: roll++ },
        },
        admin,
      );
      if (r.statusCode !== 201) throw new Error(`student ${key}: ${r.statusCode} ${r.body}`);
      pupils[key] = r.json().id as string;
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('builds a TC sheet for a section: one row a student, filled from the records, with drop-downs', async () => {
    expect(
      (
        await post(
          '/certificates/imports/sheet',
          { typeCode: 'TC', sectionIds: [section] },
          teacher,
        )
      ).statusCode,
    ).toBe(403);
    const r = await post('/certificates/imports/sheet', { typeCode: 'TC', sectionIds: [section] });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toMatchObject({ filename: 'tc-sheet.xlsx' });
    const { wb, ws, heads } = await open(r.json().base64 as string);
    expect(ws.name).toBe('Transfer certificate');
    expect(heads.slice(0, 4)).toEqual(['Admission no. *', 'Student', 'Class', 'Date of issue']);
    expect(heads).toEqual(
      expect.arrayContaining([
        'Reason for leaving the school *',
        'General conduct *',
        'Name of the student',
        "Father's name",
        'Date of birth',
        'Class in which the pupil last studied',
      ]),
    );
    // a TC asks no purpose; the guide sheet is there
    expect(heads).not.toContain('Purpose');
    expect(wb.getWorksheet('How to fill')).toBeTruthy();
    expect(filled(ws)).toBe(4);
    const asha = ws.getRow(2);
    expect(asha.getCell(1).value).toBe(`${s}-asha`);
    expect(asha.getCell(2).value).toBe('Asha Test');
    expect(asha.getCell(col(heads, "Father's name")).value).toBe('Ravi Test');
    expect(asha.getCell(col(heads, 'Date of birth')).value).toEqual(
      new Date('2008-03-09T00:00:00Z'),
    );
    // the conduct is a drop-down of its answers
    const dv = asha.getCell(col(heads, 'General conduct')).dataValidation;
    expect(dv?.type).toBe('list');
    // a bonafide asks the purpose; a staff certificate is by employee code
    const bon = await open(
      (
        await post('/certificates/imports/sheet', { typeCode: 'BONAFIDE', sectionIds: [section] })
      ).json().base64 as string,
    );
    expect(bon.heads).toContain('Purpose');
    const svc = await post('/certificates/imports/sheet', {
      typeCode: 'SERVICE',
      departments: ['Academics'],
    });
    expect(svc.statusCode).toBe(201);
    const staff = await open(svc.json().base64 as string);
    expect(staff.heads.slice(0, 3)).toEqual(['Employee code *', 'Employee', 'Department']);
    expect(staff.heads).toContain('Designation');
    expect(staff.ws.getRow(2).getCell(1).value).toBe('T01');
    // a student type is not given departments
    expect(
      (await post('/certificates/imports/sheet', { typeCode: 'TC', departments: ['Academics'] }))
        .statusCode,
    ).toBe(400);
  });

  it('checks an upload row by row, starts nothing, then issues the ready rows in one run after the fixes', async () => {
    const sheet = await post('/certificates/imports/sheet', {
      typeCode: 'TC',
      sectionIds: [section],
    });
    const { wb, ws, heads } = await open(sheet.json().base64 as string);
    const at = (name: string) => col(heads, name);
    // fill: reason, dates, conduct; Chetan's reason left out; Dev's date of issue wrong and his mother's name typed
    for (let r = 2; r <= 5; r += 1) {
      const row = ws.getRow(r);
      if (r !== 4) row.getCell(at('Reason for leaving the school')).value = 'Passed out Class XII';
      row.getCell(at('Date of application for the certificate')).value = new Date(
        '2027-04-01T00:00:00Z',
      );
      row.getCell(at("Date the pupil's name was struck off the rolls")).value = '31-03-2027';
      row.getCell(at('General conduct')).value = 'good';
    }
    ws.getRow(5).getCell(at('Date of issue')).value = 'soon';
    ws.getRow(5).getCell(at("Mother's name")).value = 'Meena Test';
    // Bina twice, and someone unknown
    ws.addRow((ws.getRow(3).values as ExcelJS.CellValue[]).slice(1));
    ws.addRow([`${s}-nobody`]);
    const upload = async (book: ExcelJS.Workbook) =>
      Buffer.from((await book.xlsx.writeBuffer()) as ArrayBuffer).toString('base64');
    const up = await post('/certificates/imports', {
      typeCode: 'TC',
      title: 'TC · XII-A',
      scope: { sectionIds: [section], label: 'XII-A' },
      fileName: 'tc-xii.xlsx',
      fileBase64: await upload(wb),
    });
    expect(up.statusCode).toBe(201);
    let u = up.json() as Upload;
    expect(u.figures).toMatchObject({
      rows: 6,
      ready: 0,
      issued: 0,
      attention: 6,
      startWithdrawal: 4,
    });
    const byKey = (x: Upload, k: string) => x.rows.filter((r) => r.key === `${s}-${k}`);
    expect(byKey(u, 'asha')[0]!.problems).toEqual([
      'Student: No withdrawal is complete: the student is still on the rolls',
    ]);
    expect(byKey(u, 'chet')[0]!.problems).toContain('Reason for leaving the school is required');
    expect(byKey(u, 'dev')[0]!.problems).toContain('Date of issue: a date, like 31-03-2027');
    expect(byKey(u, 'bina')[1]!.problems).toEqual(['Also on row 3']);
    expect(byKey(u, 'nobody')[0]!.problems).toEqual([`No student with admission no. ${s}-nobody`]);
    // nothing was issued by the upload
    const none = await withMigrator((c) =>
      c.query(`SELECT 1 FROM certificates WHERE school_id = $1`, [school.id]),
    );
    expect(none.rowCount).toBe(0);
    // the withdrawals started for those rows (People → Withdrawals, in bulk), then cleared by the departments
    const wd = await post(
      '/people/withdrawals/bulk',
      {
        studentIds: Object.values(pupils),
        leavingOn: '2027-03-31',
        reason: 'Passed out Class XII',
      },
      admin,
    );
    expect(wd.statusCode).toBe(201);
    await withMigrator((c) =>
      c.query(`UPDATE student_withdrawals SET status = 'cleared' WHERE school_id = $1`, [
        school.id,
      ]),
    );
    u = (await post(`/certificates/imports/${u.id}/verify`, {})).json() as Upload;
    expect(byKey(u, 'asha')[0]).toMatchObject({
      status: 'ready',
      problems: [],
      startWithdrawal: false,
    });
    // Chetan's reason, left empty, is now the withdrawal's
    expect(byKey(u, 'chet')[0]).toMatchObject({ status: 'ready' });
    expect(u.figures).toMatchObject({ ready: 3, attention: 3 });
    // the errors file: the rows to fix, with why
    const err = await get(`/certificates/imports/${u.id}/errors`);
    expect(err.statusCode).toBe(200);
    const fix = await open(err.json().base64 as string);
    expect(fix.heads[fix.heads.length - 1]).toBe('What to fix');
    expect(filled(fix.ws)).toBe(3);
    // corrected: Dev's date; the two others deleted from the file (they stay in the draft)
    const f = (name: string) => col(fix.heads, name);
    let last = 1;
    fix.ws.eachRow((row, r) => {
      if (row.getCell(1).value) last = r;
      if (String(row.getCell(1).value) === `${s}-dev`) row.getCell(f('Date of issue')).value = '';
    });
    for (let r = last; r >= 2; r -= 1)
      if (String(fix.ws.getRow(r).getCell(1).value) !== `${s}-dev`) fix.ws.spliceRows(r, 1);
    const again = await post(`/certificates/imports/${u.id}/upload`, {
      fileName: 'tc-xii-fixed.xlsx',
      fileBase64: await upload(fix.wb),
    });
    expect(again.statusCode).toBe(201);
    u = again.json() as Upload;
    expect(u.figures).toMatchObject({ rows: 6, ready: 4, attention: 2, issued: 0 });
    // issued: the ready rows in one run, numbered in order, each with its own details
    const done = await post(`/certificates/imports/${u.id}/issue`, {});
    expect(done.statusCode).toBe(201);
    u = done.json().upload as Upload;
    expect(u.figures).toMatchObject({ issued: 4, ready: 0, attention: 2 });
    expect(
      u.rows
        .filter((r) => r.status === 'issued')
        .map((r) => r.number)
        .sort(),
    ).toEqual(['TC/2026-27/00001', 'TC/2026-27/00002', 'TC/2026-27/00003', 'TC/2026-27/00004']);
    const run = await get(`/certificates/runs/${done.json().runId as string}`);
    expect(run.json().figures).toMatchObject({ batches: 1, issued: 4, skipped: 0 });
    const devCert = await get(`/certificates/${byKey(u, 'dev')[0]!.certificateId!}`);
    expect(devCert.json().data.printed['student.motherName']).toMatchObject({
      printed: 'Meena Test',
    });
    expect(devCert.json().data.tc.reason).toBe('Passed out Class XII');
    // nothing to issue twice; the list keeps the upload
    expect((await post(`/certificates/imports/${u.id}/issue`, {})).statusCode).toBe(400);
    const list = await get('/certificates/imports');
    expect(list.json().rows[0]).toMatchObject({
      id: u.id,
      title: 'TC · XII-A',
      uploads: 2,
      issued: 4,
      attention: 2,
    });
  });
});
