/**
 * Master-data framework: one grid, upload, bulk update and clone for every registered master, each
 * under its own permission and the caller's school.
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
  withMigrator,
  type SeededSchool,
  type SeededUser,
} from './helpers';

describe('master-data framework (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let other: SeededSchool;
  let admin: SeededUser;
  let otherAdmin: SeededUser;
  let clerk: SeededUser; // a family login: no master permissions at all
  let s: string;
  let nextYearId: string;
  const h = (u: SeededUser = admin, sc: SeededSchool = school) => headersFor(u.sub, sc.id);

  beforeAll(async () => {
    s = stamp('MST');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      other = await seedSchool(c, `${s}B`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      otherAdmin = await seedUser(c, other, `${s}-other`, 'school_admin');
      clerk = await seedUser(c, school, `${s}-clerk`, 'parent', 'guardian');
      const y = await c.query<{ id: string }>(
        `INSERT INTO academic_years (school_id, code, name, start_date, end_date, status)
         VALUES ($1, '2027-28', '2027-28', '2027-04-01', '2028-03-31', 'planned') RETURNING id::text`,
        [school.id],
      );
      nextYearId = y.rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => {
    await app.close();
  });

  it('lists the masters the caller may see with their abilities', async () => {
    const r = await inject({ method: 'GET', url: '/masters', headers: h() });
    expect(r.statusCode).toBe(200);
    const ids = r.json().data.map((m: { id: string }) => m.id);
    expect(ids).toEqual(
      expect.arrayContaining(['fee_heads', 'fee_periods', 'classes', 'class_sections', 'banks']),
    );
    const heads = r.json().data.find((m: { id: string }) => m.id === 'fee_heads');
    expect(heads.canManage).toBe(true);
    expect(heads.dataset).toBe('master_fee_heads');
    const c = await inject({ method: 'GET', url: '/masters', headers: h(clerk) });
    expect(c.json().data.map((m: { id: string }) => m.id)).not.toContain('fee_heads');
  });

  it('refuses a master the caller may not see, with the master’s own permission', async () => {
    const r = await inject({ method: 'GET', url: '/masters/fee_heads/rows', headers: h(clerk) });
    expect(r.statusCode).toBe(403);
    expect(r.json().permission).toBe('fees.master.view');
    const u = await inject({ method: 'GET', url: '/masters/nope/rows', headers: h() });
    expect(u.statusCode).toBe(404);
  });

  it('CSV upload: dry run reports rejects by row and column; a clean file commits as upserts', async () => {
    const bad = await inject({
      method: 'POST',
      url: '/masters/fee_heads/imports/validate',
      headers: h(),
      json: {
        fileName: 'heads.csv',
        csv: 'Code,Name,Kind,Ledger,Optional,Refundable,Order\nTUI,Tuition,regular,school,no,no,1\nBUS,Bus fee,transport,school,yes,no,2\nX1,,regular,school,no,no,3\nBUS,Duplicate,transport,school,no,no,4\n',
      },
    });
    expect(bad.statusCode).toBe(201);
    expect(bad.json().status).toBe('failed');
    expect(bad.json().report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 4, column: 'Name', message: 'Required' }),
        expect.objectContaining({ row: 5, message: 'Duplicate of an earlier row in the file' }),
      ]),
    );
    const commitFailed = await inject({
      method: 'POST',
      url: `/masters/fee_heads/imports/${bad.json().id}/commit`,
      headers: h(),
    });
    expect(commitFailed.statusCode).toBe(409);

    const good = await inject({
      method: 'POST',
      url: '/masters/fee_heads/imports/validate',
      headers: h(),
      json: {
        fileName: 'heads.csv',
        csv: 'Code,Name,Kind,Ledger,Optional,Refundable,Order\nTUI,Tuition,regular,school,no,no,1\nBUS,Bus fee,transport,school,yes,no,2\n',
      },
    });
    expect(good.json().status).toBe('validated');
    const committed = await inject({
      method: 'POST',
      url: `/masters/fee_heads/imports/${good.json().id}/commit`,
      headers: h(),
    });
    expect(committed.json()).toMatchObject({
      status: 'committed',
      insertedRows: 2,
      updatedRows: 0,
    });

    // same file again: nothing inserted, both updated (name changed)
    const again = await inject({
      method: 'POST',
      url: '/masters/fee_heads/imports/validate',
      headers: h(),
      json: {
        csv: 'Code,Name,Kind,Ledger\nTUI,Tuition fee,regular,school\nBUS,Bus fee,transport,school\n',
      },
    });
    const c2 = await inject({
      method: 'POST',
      url: `/masters/fee_heads/imports/${again.json().id}/commit`,
      headers: h(),
    });
    expect(c2.json()).toMatchObject({ insertedRows: 0, updatedRows: 2 });
    const rows = await inject({
      method: 'GET',
      url: '/masters/fee_heads/rows?q=tui',
      headers: h(),
    });
    expect(rows.json().data).toHaveLength(1);
    expect(rows.json().data[0]).toMatchObject({
      code: 'TUI',
      name: 'Tuition fee',
      is_optional: 'false',
    });
  });

  it('xlsx upload through the template; refs resolve by code within the school', async () => {
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    expect(cls.statusCode).toBe(201);
    const tpl = await inject({
      method: 'GET',
      url: '/masters/class_sections/template',
      headers: h(),
    });
    expect(tpl.statusCode).toBe(200);
    expect(tpl.headers['content-type']).toContain('spreadsheetml');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(tpl.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(String(ws.getRow(1).getCell(1).value)).toBe('Class code');
    // the template is ready to fill: the class column is a drop-down of the school's classes
    expect(ws.getCell('A2').dataValidation).toMatchObject({ type: 'list', errorStyle: 'error' });
    expect(String(wb.getWorksheet('Lists')!.getCell('A2').value)).toBe('VI');
    ws.getRow(2).values = ['VI', 'A', null, 40];
    ws.getRow(3).values = ['VI', 'B', null, 40];
    ws.getRow(4).values = ['IX', 'A', null, 40]; // no such class
    const bytes = Buffer.from(await wb.xlsx.writeBuffer());
    const bad = await inject({
      method: 'POST',
      url: '/masters/class_sections/imports/validate',
      headers: h(),
      json: { fileName: 'sections.xlsx', contentBase64: bytes.toString('base64') },
    });
    expect(bad.json().status).toBe('failed');
    expect(bad.json().report[0]).toMatchObject({ row: 4, column: 'Class code' });
    ws.getRow(4).values = [];
    const ok = await inject({
      method: 'POST',
      url: '/masters/class_sections/imports/validate',
      headers: h(),
      json: {
        fileName: 'sections.xlsx',
        contentBase64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      },
    });
    expect(ok.json().status).toBe('validated');
    const c = await inject({
      method: 'POST',
      url: `/masters/class_sections/imports/${ok.json().id}/commit`,
      headers: h(),
    });
    expect(c.json().insertedRows).toBe(2);
    const rows = await inject({ method: 'GET', url: '/masters/class_sections/rows', headers: h() });
    expect(
      rows.json().data.map((r: { class_id: string; name: string }) => `${r.class_id}-${r.name}`),
    ).toEqual(['VI-A', 'VI-B']);
  });

  it('grid row save (add, then edit keeps the key), status toggle, paging and bulk update', async () => {
    const add = await inject({
      method: 'POST',
      url: '/masters/banks/rows',
      headers: h(),
      json: {
        values: { code: 'SBI', name: 'State Bank', branch: 'Sector 30', ifsc: 'SBIN0000001' },
      },
    });
    expect(add.statusCode).toBe(201);
    const id = add.json().id;
    const edit = await inject({
      method: 'POST',
      url: '/masters/banks/rows',
      headers: h(),
      json: { id, values: { code: 'CHANGED', name: 'State Bank of India', branch: 'Sector 31' } },
    });
    expect(edit.json()).toMatchObject({ id, code: 'SBI', name: 'State Bank of India' });
    const st = await inject({
      method: 'PUT',
      url: `/masters/banks/rows/${id}/status`,
      headers: h(),
      json: { status: 'inactive' },
    });
    expect(st.statusCode).toBe(200);
    const inactive = await inject({
      method: 'GET',
      url: '/masters/banks/rows?status=inactive',
      headers: h(),
    });
    expect(inactive.json().data).toHaveLength(1);
    for (let i = 1; i <= 12; i += 1)
      await inject({
        method: 'POST',
        url: '/masters/banks/rows',
        headers: h(),
        json: { values: { code: `B${i}`, name: `Bank ${i}` } },
      });
    const p2 = await inject({
      method: 'GET',
      url: '/masters/banks/rows?size=5&page=3',
      headers: h(),
    });
    expect(p2.json().page).toEqual({ number: 3, size: 5, total: 13 });
    expect(p2.json().data).toHaveLength(3);
    const bulk = await inject({
      method: 'POST',
      url: '/masters/fee_heads/bulk',
      headers: h(),
      json: { ids: [], field: 'sort_order', value: 9 },
    });
    expect(bulk.statusCode).toBe(400);
    const heads = await inject({ method: 'GET', url: '/masters/fee_heads/rows', headers: h() });
    const ids = heads.json().data.map((r: { id: string }) => r.id);
    const b2 = await inject({
      method: 'POST',
      url: '/masters/fee_heads/bulk',
      headers: h(),
      json: { ids, field: 'ledger', value: 'hostel' },
    });
    expect(b2.json().updated).toBe(2);
    const notBulk = await inject({
      method: 'POST',
      url: '/masters/fee_heads/bulk',
      headers: h(),
      json: { ids, field: 'code', value: 'X' },
    });
    expect(notBulk.statusCode).toBe(400);
  });

  it('clones a year-bound master into the next year, skipping keys that exist', async () => {
    const gen = await inject({
      method: 'POST',
      url: '/fees/periods/generate',
      headers: h(),
      json: { dueDay: 10, monthsPerInstalment: 3 },
    });
    expect([200, 201]).toContain(gen.statusCode);
    const clone = await inject({
      method: 'POST',
      url: '/masters/fee_periods/clone',
      headers: h(),
      json: { fromYearId: school.yearId, toYearId: nextYearId },
    });
    expect(clone.statusCode).toBe(201);
    expect(clone.json().copied).toBe(12);
    const again = await inject({
      method: 'POST',
      url: '/masters/fee_periods/clone',
      headers: h(),
      json: { fromYearId: school.yearId, toYearId: nextYearId },
    });
    expect(again.json().copied).toBe(0);
    const next = await withMigrator((c) =>
      c.query<{ n: string; first: string }>(
        `SELECT count(*)::text AS n, min(due_on)::text AS first FROM fee_periods WHERE academic_year_id = $1`,
        [nextYearId],
      ),
    );
    expect(next.rows[0]).toMatchObject({ n: '12' });
    expect(next.rows[0]!.first.startsWith('2027')).toBe(true);
    const noClone = await inject({
      method: 'POST',
      url: '/masters/fee_heads/clone',
      headers: h(),
      json: { fromYearId: school.yearId, toYearId: nextYearId },
    });
    expect(noClone.statusCode).toBe(400);
  });

  it('masters never cross schools: rows, uploads and exports stay within the caller’s school', async () => {
    const rows = await inject({
      method: 'GET',
      url: '/masters/banks/rows',
      headers: h(otherAdmin, other),
    });
    expect(rows.json().page.total).toBe(0);
    const up = await inject({
      method: 'POST',
      url: '/masters/banks/imports/validate',
      headers: h(otherAdmin, other),
      json: { csv: 'Code,Bank name\nSBI,Their SBI\n' },
    });
    await inject({
      method: 'POST',
      url: `/masters/banks/imports/${up.json().id}/commit`,
      headers: h(otherAdmin, other),
    });
    const mine = await inject({ method: 'GET', url: '/masters/banks/rows?q=SBI', headers: h() });
    expect(mine.json().data.map((r: { name: string }) => r.name)).toEqual(['State Bank of India']);
    const foreignCommit = await inject({
      method: 'POST',
      url: `/masters/banks/imports/${up.json().id}/commit`,
      headers: h(),
    });
    expect(foreignCommit.statusCode).toBe(404);
    const exp = await inject({
      method: 'POST',
      url: '/reports/exports',
      headers: h(),
      json: { dataset: 'master_banks', format: 'xlsx' },
    });
    expect(exp.statusCode).toBe(201);
    expect(exp.json().dataset).toBe('master_banks');
    const rowsExport = await inject({
      method: 'GET',
      url: '/reports/datasets/master_banks/rows?limit=50',
      headers: h(),
    });
    expect(rowsExport.statusCode).toBe(200);
    expect(rowsExport.json().rows ?? rowsExport.json().data).toBeDefined();
  });
});
