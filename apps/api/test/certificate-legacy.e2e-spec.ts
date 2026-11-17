/**
 * Certificate management, phase F (docs/design/87): from the old system. The old register's rows, as the workers leave
 * them in the holding area, are grouped by their certificate name with a guessed type; a dry run counts; the school
 * maps a name; the bring keeps each number and date, cancels what the old system deleted, reprints from the old record
 * and never brings a row twice; each series and the TC book continue after the old system's last number; the count
 * check adds up; the public check says it comes from the old system.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  createApp,
  headersFor,
  humanCheck,
  injector,
  seedSchool,
  seedUser,
  stamp,
  withMigrator,
  type SeededSchool,
  type SeededUser,
} from './helpers';

describe('certificates from the old system (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let s: string;

  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });
  const post = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'POST', url, headers: h(u), json });

  beforeAll(async () => {
    s = stamp('CRF');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-office`, 'certificate_office');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, status, designation, joined_on, left_on)
         VALUES ($1, $2, 'Old', 'Teacher', 'inactive', 'TGT', '2015-06-01', '2025-05-31')`,
        [school.id, `${s}-E9`],
      );
    });
    app = await createApp();
    inject = injector(app);
    const k = await post('/academics/classes', { code: 'IX', name: 'Class IX', displayOrder: 9 });
    const sec = (await post(`/academics/classes/${k.json().id}/sections`, { name: 'A' })).json().id;
    for (const [no, first] of [
      ['A1', 'Anya'],
      ['B2', 'Bhanu'],
    ] as const)
      await post('/people/students', {
        admissionNo: `${s}-${no}`,
        firstName: first,
        lastName: 'Test',
        dob: '2012-05-05',
        gender: 'female',
        guardians: [],
        enrolment: { classSectionId: sec, rollNo: no === 'A1' ? 1 : 2 },
      });
    // the old register as the workers read it (no real school's data)
    const rows = [
      {
        srno: 11,
        user_type: 'student',
        certificate_type: 'TC',
        certificate_no: 'TC-2627-00041',
        person_id: `${s}-A1`,
        sadmission: `${s}-A1`,
        person_name: 'Anya Test',
        father_name: 'Old Father',
        class_or_dept: 'VIII-A',
        FinancialYear: '2026-2027',
        issue_date: '2026-08-10',
        book_no: '3',
        sl_no: '241',
        working_days: '220',
        reason_for_leaving: 'Parent transferred',
        isTrash: '0',
        CreationDate: '2026-08-10',
      },
      {
        srno: 12,
        user_type: 'student',
        certificate_type: 'Bonafide Certificate',
        certificate_no: 'BO-2627-00007',
        person_id: `${s}-B2`,
        sadmission: `${s}-B2`,
        person_name: 'Bhanu Test',
        FinancialYear: '2026-2027',
        issue_date: '2026-07-01',
        isTrash: '0',
      },
      {
        srno: 13,
        user_type: 'student',
        certificate_type: 'Bonafide Certificate',
        certificate_no: 'BO-2627-00008',
        person_id: `${s}-B2`,
        sadmission: `${s}-B2`,
        person_name: 'Bhanu Test',
        FinancialYear: '2026-2027',
        issue_date: '2026-07-02',
        isTrash: '1',
      },
      {
        srno: 14,
        user_type: 'student',
        certificate_type: 'Sports Day Pass',
        certificate_no: 'SP-2627-00001',
        person_id: `${s}-A1`,
        sadmission: `${s}-A1`,
        person_name: 'Anya Test',
        FinancialYear: '2026-2027',
        issue_date: '2026-09-01',
        isTrash: '0',
      },
      {
        srno: 15,
        user_type: 'staff',
        certificate_type: 'Experience Certificate',
        certificate_no: 'EX-2526-00002',
        person_id: `${s}-E9`,
        person_name: 'Old Teacher',
        FinancialYear: '2025-2026',
        issue_date: '2025-06-02',
        isTrash: '0',
      },
      {
        srno: 16,
        user_type: 'student',
        certificate_type: 'TC',
        certificate_no: 'TC-2627-00040',
        person_id: 'NOPE-1',
        sadmission: 'NOPE-1',
        person_name: 'Not Here',
        FinancialYear: '2026-2027',
        issue_date: '2026-08-01',
        book_no: '3',
        sl_no: '240',
        isTrash: '0',
      },
    ];
    await withMigrator(async (c) => {
      for (const r of rows)
        await c.query(
          `INSERT INTO certificate_legacy_rows (school_id, srno, payload, read_id) VALUES ($1, $2, $3::jsonb, 1)`,
          [school.id, r.srno, JSON.stringify(r)],
        );
      await c.query(
        `INSERT INTO certificate_cutover (school_id, read_at, book_last_sl, read_counts) VALUES ($1, now(), 250, '{"certificate_master": 6}')`,
        [school.id],
      );
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('groups the old rows by name with a guessed type; only for the set-up right', async () => {
    expect((await get('/certificates/setup/legacy', office)).statusCode).toBe(403);
    const r = await get('/certificates/setup/legacy');
    expect(r.statusCode).toBe(200);
    const g = Object.fromEntries(
      (
        r.json().groups as Array<{
          key: string;
          guessed: string | null;
          rows: number;
          cancelled: number;
          matched: number;
        }>
      ).map((x) => [x.key, x]),
    );
    expect(g.TC).toMatchObject({ guessed: 'TC', rows: 2, matched: 1 });
    expect(g['Bonafide Certificate']).toMatchObject({ guessed: 'BONAFIDE', rows: 2, cancelled: 1 });
    expect(g['Sports Day Pass']).toMatchObject({ guessed: null });
    expect(g['Experience Certificate (staff)']).toMatchObject({
      guessed: 'EXPERIENCE',
      matched: 1,
    });
    expect(r.json().read).toMatchObject({ rows: 6 });
    expect(r.json().book).toMatchObject({ oldLast: 250 });
    expect(r.json().series).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ typeCode: 'TC', yearCode: '2026-27', oldLast: 41 }),
        expect.objectContaining({ typeCode: 'BONAFIDE', yearCode: '2026-27', oldLast: 8 }),
        expect.objectContaining({ typeCode: 'EXPERIENCE', yearCode: '2025-26', oldLast: 2 }),
      ]),
    );
  });

  it('counts in a dry run; a mapped name comes too', async () => {
    const dry = await post('/certificates/setup/legacy/bring', { dryRun: true });
    expect(dry.json()).toMatchObject({
      dryRun: true,
      counts: { read: 6, brought: 4, noType: 1, noPerson: 1 },
    });
    expect((await get('/certificates?type=TC')).json().total).toBe(0);
    const bad = await inject({
      method: 'PUT',
      url: '/certificates/setup/legacy/map',
      headers: h(),
      json: { map: { 'Sports Day Pass': 'NOSUCH' } },
    });
    expect(bad.statusCode).toBe(400);
    await inject({
      method: 'PUT',
      url: '/certificates/setup/legacy/map',
      headers: h(),
      json: { map: { 'Sports Day Pass': 'PARTICIPATION' } },
    });
    const dry2 = await post('/certificates/setup/legacy/bring', { dryRun: true });
    expect(dry2.json().counts).toMatchObject({ brought: 5, noType: 0, noPerson: 1 });
  });

  it('brings them as history under their old numbers; never twice; the numbering carries on', async () => {
    const b = await post('/certificates/setup/legacy/bring', { dryRun: false });
    expect(b.json().counts).toMatchObject({ brought: 5, cancelled: 1, noPerson: 1 });
    const tc = (await get('/certificates?type=TC')).json().rows[0];
    expect(tc).toMatchObject({
      number: 'TC-2627-00041',
      legacy: true,
      bookNo: 3,
      slNo: 241,
      issuedOn: '2026-08-10',
    });
    const bon = (await get('/certificates?type=BONAFIDE&status=cancelled')).json().rows[0];
    expect(bon).toMatchObject({
      number: 'BO-2627-00008',
      status: 'cancelled',
      cancelReason: 'Deleted in the old system',
    });
    const exp = (await get('/certificates?type=EXPERIENCE')).json().rows[0];
    expect(exp).toMatchObject({ number: 'EX-2526-00002', studentName: 'Old Teacher' });
    const d = (await get(`/certificates/${tc.id as string}`)).json();
    expect(d.data.legacyFields).toEqual(
      expect.arrayContaining([
        { label: 'Working days', value: '220' },
        { label: 'Reason for leaving', value: 'Parent transferred' },
        { label: 'Date of issue', value: '10-08-2026' },
      ]),
    );
    expect(d.template.name).toMatch(/old system/);
    // a duplicate of a brought one: the same number, still from the old system; the bring still counts it once
    const dup = await post(`/certificates/${tc.id as string}/duplicate`, {
      reason: 'Original lost by the parents',
    });
    expect(dup.statusCode).toBe(201);
    expect(dup.json()).toMatchObject({ number: 'TC-2627-00041', copyNo: 1, legacy: true });
    // brought again: nothing twice
    const again = await post('/certificates/setup/legacy/bring', { dryRun: false });
    expect(again.json().counts).toMatchObject({ brought: 0, already: 5 });
    expect((await get('/certificates?type=TC&copy=original')).json().total).toBe(1);
    // the next TC and bonafide follow the old numbers; the book after Sl. No. 250
    const next = await post('/certificates/issue', {
      typeCode: 'TC',
      studentId: (await get('/certificates/students?q=B2')).json().rows[0].id,
      fields: { reason: 'Moving' },
      overrideReason: 'Leaving with the parents this week',
    });
    expect(next.json()).toMatchObject({ number: 'TC/2026-27/00042', bookNo: 3, slNo: 251 });
    const nb = await post('/certificates/issue', {
      typeCode: 'BONAFIDE',
      studentId: (await get('/certificates/students?q=A1')).json().rows[0].id,
    });
    expect(nb.json().number).toBe('BON/2026-27/00009');
  });

  it('reprints from the old record, and the public check says where it comes from', async () => {
    const tc = (await get('/certificates?type=TC&q=TC-2627&copy=original')).json().rows[0];
    const r = await post(`/certificates/${tc.id as string}/render`, {});
    expect(r.statusCode).toBe(201);
    const ex = await get(`/reports/exports/${r.json().exportId as string}`);
    expect(ex.json().export.dataset).toBe('certificate_doc');
    const tok = await withMigrator((c) =>
      c.query<{ token: string; code: string }>(
        `SELECT x.verify_token AS token, lower(s.code) AS code FROM certificates x JOIN schools s ON s.id = x.school_id WHERE x.id = $1`,
        [tc.id],
      ),
    );
    const v = await inject({
      method: 'POST',
      url: `/public/certificates/${tok.rows[0]!.code}/verify/${tok.rows[0]!.token}`,
      headers: {},
      json: humanCheck(app),
    });
    expect(v.json()).toMatchObject({
      result: 'valid',
      certificate: { number: 'TC-2627-00041', legacy: true, holder: 'A**a T**t' },
    });
  });

  it('adds up: every old row came or was left out with its reason; asks the workers to read again', async () => {
    const st = (await get('/certificates/setup/legacy')).json();
    expect(st.check).toEqual({ read: 6, brought: 5, left: 1, ok: true });
    expect(st.brought.counts).toMatchObject({ noPerson: 1 });
    const rd = await post('/certificates/setup/legacy/read', {});
    expect(rd.json()).toEqual({ requested: true });
    const q = await withMigrator((c) =>
      c.query<{ at: Date | null }>(
        `SELECT read_requested_at AS at FROM certificate_cutover WHERE school_id = $1`,
        [school.id],
      ),
    );
    expect(q.rows[0]!.at).not.toBeNull();
  });
});
