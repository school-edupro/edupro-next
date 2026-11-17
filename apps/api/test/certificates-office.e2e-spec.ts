/**
 * Certificate management, phase E (docs/design/87): bulk issue to a section in roll order with its preview, those that
 * cannot have it left out with the reason and the principal's override; one PDF of the batch; the awards and who
 * received them (one by one and from a CSV, checked first), issued as award certificates; the TC book register and
 * the reports with their files; the achievement certificates numbered by the register's series and in the register.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { StorageDriver } from '@edupro/storage';
import JSZip from 'jszip';
import { STORAGE_DRIVER } from '../src/modules/files/storage';
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

describe('certificate office: bulk, awards, registers (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let office: SeededUser;
  let section: string;
  let prefix: string;
  const kids: string[] = [];

  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const post = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });

  beforeAll(async () => {
    const s = stamp('CRE');
    prefix = s;
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      office = await seedUser(c, school, `${s}-office`, 'certificate_office');
    });
    app = await createApp();
    inject = injector(app);
    const k = await post('/academics/classes', { code: 'X', name: 'Class X', displayOrder: 10 });
    section = (await post(`/academics/classes/${k.json().id}/sections`, { name: 'A' })).json().id;
    // enrolled out of alphabetical order: the roll decides the order
    for (const [first, roll] of [
      ['Zara', 1],
      ['Arun', 2],
      ['Mira', 3],
    ] as const) {
      const r = await post('/people/students', {
        admissionNo: `${s}-${first}`,
        firstName: first,
        lastName: 'Test',
        dob: '2011-01-01',
        gender: 'female',
        guardians: [],
        enrolment: { classSectionId: section, rollNo: roll },
      });
      kids.push(r.json().id as string);
    }
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('previews a bulk issue to a section in roll order, with each one’s checks', async () => {
    // Mira holds a character certificate already: the type is set to one a student
    const t = (await get('/certificates/setup/types/CHARACTER')).json();
    await inject({
      method: 'PUT',
      url: '/certificates/setup/types/CHARACTER',
      headers: h(),
      json: {
        name: t.name,
        prefix: t.prefix,
        templateId: t.templateId,
        variants: t.variants,
        rules: t.rules,
        multiple: 'ONE',
        active: true,
        sortOrder: t.sortOrder,
        issuers: [],
        fields: [],
      },
    });
    expect(
      (await post('/certificates/issue', { typeCode: 'CHARACTER', studentId: kids[2] })).statusCode,
    ).toBe(201);
    const p = await post(
      '/certificates/bulk/preview',
      { typeCode: 'CHARACTER', sectionId: section },
      office,
    );
    expect(p.statusCode).toBe(201);
    expect(p.json().rows.map((r: { name: string }) => r.name)).toEqual([
      'Zara Test',
      'Arun Test',
      'Mira Test',
    ]);
    expect(p.json().figures).toMatchObject({ total: 3, ok: 2, held: 1 });
    expect(
      (await post('/certificates/bulk/preview', { typeCode: 'CHARACTER' }, office)).statusCode,
    ).toBe(400);
  });

  it('issues to each that can have it, leaves out the one who holds it, and prints the batch as one PDF', async () => {
    const r = await post(
      '/certificates/bulk/issue',
      {
        typeCode: 'CHARACTER',
        sectionId: section,
        purpose: 'Board examination',
        fields: { conduct: 'Very good' },
      },
      office,
    );
    expect(r.statusCode).toBe(201);
    const b = r.json();
    expect(b.issued.map((x: { name: string }) => x.name)).toEqual(['Zara Test', 'Arun Test']);
    expect(b.issued.map((x: { number: string }) => x.number)).toEqual([
      'CHR/2026-27/00002',
      'CHR/2026-27/00003',
    ]);
    expect(b.skipped).toEqual([
      expect.objectContaining({
        name: 'Mira Test',
        reason: expect.stringMatching(/Already holds/),
      }),
    ]);
    expect(b.exportId).toMatch(/^\d+$/);
    const ex = await get(`/reports/exports/${b.exportId as string}`);
    expect(ex.json().export.dataset).toBe('certificate_batch_doc');
    // no PDF of its own for a certificate of a batch; each is in the register with its batch
    const one = await withMigrator((c) =>
      c.query<{ export_id: string | null; batch_id: string }>(
        `SELECT export_id::text, batch_id::text FROM certificates WHERE id = $1`,
        [b.issued[0].id],
      ),
    );
    expect(one.rows[0]).toMatchObject({ export_id: null, batch_id: b.id });
    const list = await get('/certificates/batches', office);
    expect(list.json().rows[0]).toMatchObject({ id: b.id, issued: 2, skipped: 1 });
  });

  it('issues to those whose checks fail too, with the principal’s reason; the office cannot', async () => {
    await withMigrator((c) =>
      c.query(`UPDATE students SET status = 'inactive', left_on = '2026-06-01' WHERE id = $1`, [
        kids[0],
      ]),
    );
    const office1 = await post(
      '/certificates/bulk/issue',
      { typeCode: 'BONAFIDE', sectionId: section },
      office,
    );
    // Zara has left (out of the section's roll): the two on the rolls get it
    expect(office1.json().issued).toHaveLength(2);
    const chosen = await post(
      '/certificates/bulk/issue',
      {
        typeCode: 'BONAFIDE',
        studentIds: [kids[0]],
        overrideReason: 'Asked for the scholarship of last year',
      },
      office,
    );
    expect(chosen.json().issued).toHaveLength(0);
    expect(chosen.json().skipped[0].reason).toMatch(/principal/);
    const principal = await post('/certificates/bulk/issue', {
      typeCode: 'BONAFIDE',
      studentIds: [kids[0]],
      overrideReason: 'Asked for the scholarship of last year',
    });
    expect(principal.json().issued).toEqual([
      expect.objectContaining({ name: 'Zara Test', override: true }),
    ]);
    expect(principal.json().overrideReason).toBe('Asked for the scholarship of last year');
  });

  it('keeps the awards and who received them, from a CSV after a check, and issues their certificates', async () => {
    const a = await post('/certificates/awards', { name: 'Science Olympiad', typeCode: 'MERIT' });
    expect(a.statusCode).toBe(201);
    expect(
      (await post('/certificates/awards', { name: 'Science Olympiad', typeCode: 'MERIT' }))
        .statusCode,
    ).toBe(409);
    expect(
      (await post('/certificates/awards', { name: 'Staff award', typeCode: 'SERVICE' })).statusCode,
    ).toBe(400);
    expect(
      (
        await post(
          '/certificates/awards',
          { name: 'Sports day', typeCode: 'PARTICIPATION' },
          office,
        )
      ).statusCode,
    ).toBe(403);
    await post('/certificates/awards', { name: 'Sports day', typeCode: 'PARTICIPATION' });
    const one = await post(
      '/certificates/allotments',
      {
        awardId: a.json().id,
        studentId: kids[1],
        event: 'District round',
        position: 'First',
        awardedOn: '2026-11-10',
      },
      office,
    );
    expect(one.statusCode).toBe(201);
    const csv = [
      'admission_no,award,event,position,date,remarks',
      `${prefix}-Mira,Science Olympiad,District round,Second,10-11-2026,`,
      `${prefix}-Zara,Sports day,"Annual sports, 2026",,12-11-2026,"relay, 4x100"`,
      `NOPE-1,Science Olympiad,District round,,10-11-2026,`,
      `${prefix}-Arun,Chess,,,2026-11-12,`,
    ].join('\n');
    const bad = await post('/certificates/allotments/import', { csv }, office);
    expect(bad.json()).toMatchObject({ rows: 4, valid: 2, saved: 0 });
    expect(bad.json().errors).toEqual([
      'Line 4: no student with admission no. "NOPE-1"',
      'Line 5: no award named "Chess"',
    ]);
    const good = csv.split('\n').slice(0, 3).join('\n');
    expect(
      (await post('/certificates/allotments/import', { csv: good, dryRun: true }, office)).json(),
    ).toMatchObject({ valid: 2, saved: 0 });
    expect(
      (await post('/certificates/allotments/import', { csv: good }, office)).json(),
    ).toMatchObject({ saved: 2 });
    const all = await get('/certificates/allotments?issued=no', office);
    expect(all.json().total).toBe(3);
    const zara = all.json().rows.find((x: { name: string }) => x.name === 'Zara Test');
    expect(zara).toMatchObject({
      event: 'Annual sports, 2026',
      remarks: 'relay, 4x100',
      awardedOn: '2026-11-12',
    });
    const iss = await post(
      '/certificates/allotments/issue',
      { allotmentIds: all.json().rows.map((x: { id: string }) => x.id) },
      office,
    );
    expect(iss.statusCode).toBe(201);
    const batches = iss.json().batches as Array<{
      typeName: string;
      issued: Array<{ number: string }>;
    }>;
    expect(batches.map((x) => x.typeName).sort()).toEqual([
      'Merit certificate',
      'Participation certificate',
    ]);
    const merit = batches.find((x) => x.typeName === 'Merit certificate')!;
    expect(merit.issued.map((x) => x.number)).toEqual(['MRT/2026-27/00001', 'MRT/2026-27/00002']);
    const d = await get(`/certificates/${(merit.issued[0] as unknown as { id: string }).id}`);
    expect(d.json().data.fields).toMatchObject({
      award: 'Science Olympiad',
      event: 'District round',
    });
    expect((await get('/certificates/allotments?issued=yes', office)).json().total).toBe(3);
    const again = await post(
      '/certificates/allotments/issue',
      { allotmentIds: [one.json().id] },
      office,
    );
    expect(again.statusCode).toBe(400);
    expect(
      (await post(`/certificates/allotments/${one.json().id as string}/remove`, {}, office))
        .statusCode,
    ).toBe(409);
    const awards = (await get('/certificates/awards', office)).json();
    expect(awards.rows.find((x: { name: string }) => x.name === 'Science Olympiad')).toMatchObject({
      allotted: 2,
      issued: 2,
    });
  });

  it('numbers the achievement certificates by the register series and keeps them in the register', async () => {
    const tpl = await withMigrator((c) =>
      c.query<{ id: string }>(
        `INSERT INTO document_templates (school_id, code, name, kind, page_width, page_height, body_html, styles_css, variables)
         VALUES ($1, 'ach_old', 'Old achievement', 'certificate', '297mm', '210mm', '<p>{{student.name}}</p>', '', '[]'::jsonb)
         RETURNING id::text`,
        [school.id],
      ),
    );
    const r = await post('/engagement/certificates', {
      templateId: tpl.rows[0]!.id,
      classSectionId: section,
      title: 'Best attendance',
    });
    expect(r.statusCode).toBe(201);
    const rows = await withMigrator((c) =>
      c.query<{ serial_no: string; number: string; type: string }>(
        `SELECT ci.serial_no, x.number, t.code AS type FROM certificates_issued ci
           JOIN certificates x ON x.legacy_ref = 'achievement:' || ci.id::text JOIN certificate_types t ON t.id = x.type_id
          WHERE ci.school_id = $1 ORDER BY ci.id`,
        [school.id],
      ),
    );
    expect(rows.rows.map((x) => x.serial_no)).toEqual([
      'ACH/2026-27/00001',
      'ACH/2026-27/00002',
      'ACH/2026-27/00003',
    ]);
    expect(rows.rows.every((x) => x.number === x.serial_no && x.type === 'ACHIEVEMENT')).toBe(true);
    // the set-up's layouts say the achievement screen printed with it, though no type uses it (17 Nov 2026)
    const setup = (await get('/certificates/setup')).json();
    expect(
      (setup.templates as Array<{ id: string }>).find((x) => x.id === tpl.rows[0]!.id),
    ).toMatchObject({ usedBy: [], made: 0, screenMade: 3 });
    expect((await get(`/certificates/setup/templates/${tpl.rows[0]!.id}`)).json()).toMatchObject({
      usedBy: [],
      screenMade: 3,
    });
    // in the register its PDF is the batch's; made again, it gets a page of its own (16 Nov 2026)
    const reg = await get('/certificates?type=ACHIEVEMENT');
    expect(reg.json().total).toBe(3);
    const one = reg.json().rows[0] as { id: string; exportId: string };
    expect(one.exportId).toBe(r.json().exportId);
    const open = await post(`/certificates/${one.id}/pdf`, {});
    expect(open.json()).toMatchObject({ exportId: r.json().exportId });
    const again = await post(`/certificates/${one.id}/render`, {});
    expect(again.statusCode).toBe(201);
    expect(again.json().exportId).not.toBe(r.json().exportId);
    const own = await get(`/reports/exports/${again.json().exportId as string}`);
    expect(own.json().export).toMatchObject({ dataset: 'certificate', format: 'pdf' });
    const issued = await withMigrator((c) =>
      c.query<{ id: string }>(
        `SELECT ci.id::text FROM certificates_issued ci JOIN certificates x ON x.legacy_ref = 'achievement:' || ci.id::text WHERE x.id = $1`,
        [one.id],
      ),
    );
    expect(own.json().export.params).toEqual({ certificateId: issued.rows[0]!.id });
    // the batch's file made again after it was cleared: its certificates move to the new file, so it prints them
    await withMigrator((c) =>
      c.query(`UPDATE exports SET status = 'expired' WHERE id = $1`, [r.json().exportId]),
    );
    const batch = await post(`/reports/exports/${r.json().exportId as string}/again`, {});
    expect(batch.statusCode).toBe(201);
    const moved = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM certificates_issued WHERE school_id = $1 AND export_id = $2`,
        [school.id, batch.json().id],
      ),
    );
    expect(moved.rows[0]!.n).toBe(3);
  });
  it('keeps the TC book register and the reports, with their files', async () => {
    await withMigrator((c) =>
      c.query(`UPDATE students SET status = 'active', left_on = NULL WHERE id = $1`, [kids[0]]),
    );
    for (const id of [kids[0], kids[1]])
      await post('/certificates/issue', {
        typeCode: 'TC',
        studentId: id,
        fields: { reason: 'Moving' },
        overrideReason: 'Parents moving abroad this month',
      });
    const book = await get('/certificates/tc-book');
    expect(book.json()).toMatchObject({ total: 2, books: [1] });
    expect(book.json().rows.map((x: { slNo: number }) => x.slNo)).toEqual([1, 2]);
    const one = await get('/certificates/tc-book?book=1&q=Arun');
    expect(one.json().total).toBe(1);
    const r = await get('/certificates/reports?from=2026-04-01&to=2027-03-31');
    expect(r.statusCode).toBe(200);
    expect(r.json().figures).toMatchObject({ overrides: 3 });
    expect(
      r.json().types.find((x: { name: string }) => x.name === 'Character certificate'),
    ).toMatchObject({ issued: 3 });
    for (const url of [
      '/certificates/tc-book/file?format=xlsx',
      '/certificates/tc-book/file?format=pdf',
      ...['types', 'months', 'issuers', 'overrides', 'requests'].map(
        (k) => `/certificates/reports/file?kind=${k}&format=xlsx`,
      ),
      '/certificates/reports/file?kind=types&format=pdf',
    ]) {
      const f = await get(url);
      expect(f.statusCode).toBe(200);
      expect(Buffer.from(f.json().base64 as string, 'base64').length).toBeGreaterThan(300);
    }
  });

  /** The run's batch PDFs as stand-in files (the test does not wait for the workers), then ready. */
  const fakePdfs = async (batches: Array<{ exportId: string | null; title: string }>) => {
    const storage = app.get<StorageDriver>(STORAGE_DRIVER);
    for (const b of batches) {
      const key = `test/run-${b.exportId!}.pdf`;
      await storage.write(key, Buffer.from(`%PDF-1.4 ${b.title}`), 'application/pdf');
      await withMigrator(async (c) => {
        const f = await c.query<{ id: string }>(
          `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name,
                              owner_entity_type, owner_entity_id, classification, storage_driver, status, scanned_at, scan_result)
           VALUES ($1, $2, $3, 'application/pdf', 20, repeat('0', 64), 'run.pdf', 'exports', $4, 'internal', $5, 'ready', now(), 'generated')
           RETURNING id::text`,
          [school.id, storage.bucket, key, b.exportId, storage.name],
        );
        await c.query(`UPDATE exports SET status = 'ready', file_id = $2 WHERE id = $1`, [
          b.exportId,
          f.rows[0]!.id,
        ]);
      });
    }
  };

  it('issues to several classes and sections at once: a batch each, only the ticked, the run and its ZIP', async () => {
    const t = stamp('CRS');
    const k9 = await post('/academics/classes', { code: 'IX', name: 'Class IX', displayOrder: 9 });
    const a = (
      await post(`/academics/classes/${k9.json().id as string}/sections`, { name: 'A' })
    ).json().id as string;
    const b = (
      await post(`/academics/classes/${k9.json().id as string}/sections`, { name: 'B' })
    ).json().id as string;
    const ids: Record<string, string> = {};
    for (const [sec, first, roll] of [
      [b, 'Raj', 2],
      [a, 'Om', 2],
      [b, 'Pia', 1],
      [a, 'Ira', 1],
    ] as const) {
      const r = await post('/people/students', {
        admissionNo: `${t}-${first}`,
        firstName: first,
        lastName: 'Test',
        dob: '2012-02-02',
        gender: 'female',
        guardians: [],
        enrolment: { classSectionId: sec, rollNo: roll },
      });
      ids[first] = r.json().id as string;
    }
    // the tick list: classes with their sections and how many on the rolls
    const list = (await get('/certificates/bulk/sections')).json();
    const nine = (
      list.classes as Array<{
        name: string;
        students: number;
        sections: Array<{ name: string; students: number }>;
      }>
    ).find((c) => c.name === 'Class IX')!;
    expect(nine.students).toBe(4);
    expect(nine.sections.map((x) => [x.name, x.students])).toEqual([
      ['A', 2],
      ['B', 2],
    ]);
    // a preview of both sections: class, section and roll order
    const pv = await post('/certificates/bulk/preview', {
      typeCode: 'BONAFIDE',
      sectionIds: [b, a],
    });
    expect(pv.statusCode).toBe(201);
    expect((pv.json().rows as Array<{ name: string }>).map((r) => r.name)).toEqual([
      'Ira Test',
      'Om Test',
      'Pia Test',
      'Raj Test',
    ]);
    expect(pv.json().figures).toMatchObject({ total: 4, sections: 2 });
    // a staff type is not for sections
    expect(
      (await post('/certificates/bulk/preview', { typeCode: 'SERVICE', sectionIds: [a] }))
        .statusCode,
    ).toBe(400);
    // Om unticked: a batch per section, in order, only the ticked
    const run = await post('/certificates/bulk/run', {
      typeCode: 'BONAFIDE',
      sectionIds: [a, b],
      only: [ids.Ira, ids.Pia, ids.Raj],
      purpose: 'Bank account',
    });
    expect(run.statusCode).toBe(201);
    expect(run.json().figures).toMatchObject({ batches: 2, issued: 3, skipped: 0, withPdf: 2 });
    expect((run.json().batches as Array<{ title: string }>).map((x) => x.title)).toEqual([
      'Bonafide certificate · Class IX – A (1)',
      'Bonafide certificate · Class IX – B (2)',
    ]);
    const omHas = await withMigrator((c) =>
      c.query(`SELECT 1 FROM certificates WHERE student_id = $1`, [ids.Om]),
    );
    expect(omHas.rowCount).toBe(0);
    // the run's page; the ZIP waits until every PDF is made, then holds one a section
    const runId = run.json().runId as string;
    expect((await get(`/certificates/runs/${runId}`)).json().batches).toHaveLength(2);
    await fakePdfs(run.json().batches);
    const one = (run.json().batches as Array<{ exportId: string }>)[0]!.exportId;
    await withMigrator((c) =>
      c.query(`UPDATE exports SET status = 'running' WHERE id = $1`, [one]),
    );
    expect((await get(`/certificates/runs/${runId}/zip`)).statusCode).toBe(409);
    await withMigrator((c) => c.query(`UPDATE exports SET status = 'ready' WHERE id = $1`, [one]));
    const zip = await get(`/certificates/runs/${runId}/zip`);
    expect(zip.statusCode).toBe(200);
    expect(zip.json().contentType).toBe('application/zip');
    const opened = await JSZip.loadAsync(Buffer.from(zip.json().base64 as string, 'base64'));
    expect(Object.keys(opened.files).sort()).toEqual([
      'Bonafide certificate · Class IX – A (1).pdf',
      'Bonafide certificate · Class IX – B (2).pdf',
    ]);
    // not another school's run
    expect((await get(`/certificates/runs/${randomRun()}`)).statusCode).toBe(404);
  });

  it('issues a staff certificate to departments: in service or who have left, a batch per department', async () => {
    const t = stamp('CRD');
    await withMigrator(async (c) => {
      for (const [code, first, dept, status] of [
        ['S1', 'Asha', 'Science', 'active'],
        ['S2', 'Bina', 'Science', 'active'],
        ['M1', 'Chet', 'Maths', 'active'],
        ['M2', 'Dev', 'Maths', 'inactive'],
      ] as const)
        await c.query(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name, status, designation, department, joined_on, left_on)
           VALUES ($1, $2, $3, 'Test', $4, 'TGT', $5, '2018-06-01', $6)`,
          [
            school.id,
            `${t}-${code}`,
            first,
            status,
            dept,
            status === 'active' ? null : '2025-05-31',
          ],
        );
    });
    const d = (await get('/certificates/bulk/departments')).json().departments as Array<{
      name: string;
      active: number;
      left: number;
    }>;
    expect(d.find((x) => x.name === 'Science')).toMatchObject({ active: 2, left: 0 });
    expect(d.find((x) => x.name === 'Maths')).toMatchObject({ active: 1, left: 1 });
    // a student type is not for departments
    expect(
      (await post('/certificates/bulk/preview', { typeCode: 'BONAFIDE', departments: ['Science'] }))
        .statusCode,
    ).toBe(400);
    const pv = await post('/certificates/bulk/preview', {
      typeCode: 'SERVICE',
      departments: ['Science', 'Maths'],
    });
    expect(pv.statusCode).toBe(201);
    expect((pv.json().rows as Array<{ name: string }>).map((r) => r.name)).toEqual([
      'Chet Test',
      'Asha Test',
      'Bina Test',
    ]);
    const only = (pv.json().rows as Array<{ id: string }>).map((r) => r.id);
    const run = await post('/certificates/bulk/run', {
      typeCode: 'SERVICE',
      departments: ['Science', 'Maths'],
      only,
    });
    expect(run.statusCode).toBe(201);
    expect((run.json().batches as Array<{ title: string }>).map((x) => x.title)).toEqual([
      'Service certificate · Maths (1)',
      'Service certificate · Science (2)',
    ]);
    const batch = (
      await get(`/certificates/batches/${(run.json().batches as Array<{ id: string }>)[1]!.id}`)
    ).json();
    expect((batch.issued as Array<{ name: string }>).map((x) => x.name)).toEqual([
      'Asha Test',
      'Bina Test',
    ]);
    // those who have left
    const left = await post('/certificates/bulk/preview', {
      typeCode: 'EXPERIENCE',
      departments: ['Maths'],
      staffState: 'left',
    });
    expect((left.json().rows as Array<{ name: string }>).map((r) => r.name)).toEqual(['Dev Test']);
  });
});

const randomRun = () => '00000000-0000-4000-8000-000000000000';
