/**
 * Academics set-up: every field is checked, the campus is not asked, a holiday's name and dates can be
 * corrected, and a subject is shown and typed by its name ("English (ENG)") on screen and in Excel.
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

describe('academics set-up (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const h = () => headersFor(admin.sub, school.id, { 'x-academic-year-id': school.yearId });
  const save = (master: string, values: Record<string, unknown>, id?: string) =>
    inject({ method: 'POST', url: `/masters/${master}/rows`, headers: h(), json: { id, values } });
  const rows = async (master: string) =>
    (await inject({ method: 'GET', url: `/masters/${master}/rows?size=100`, headers: h() })).json()
      .data as Array<Record<string, string>>;

  beforeAll(async () => {
    const s = stamp('AS');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
    });
    app = await createApp();
    inject = injector(app);
  });
  afterAll(async () => {
    if (app) await app.close();
  });

  it('checks the fields of a class, a section, a subject and a period', async () => {
    const bad = await save('classes', { code: 'VI A', name: '---', display_order: -1 });
    expect(bad.statusCode).toBe(400);
    for (const word of ['Class code:', 'Class name:', 'Order:'])
      expect(bad.json().detail).toContain(word);
    expect(
      (await save('classes', { code: 'VI', name: 'Class VI', display_order: 6 })).statusCode,
    ).toBe(201);
    expect((await save('class_sections', { class_id: 'VI', name: 'A@' })).json().detail).toContain(
      'Section:',
    );
    expect(
      (await save('class_sections', { class_id: 'VI', name: 'A', capacity: 0 })).statusCode,
    ).toBe(400);
    expect(
      (await save('class_sections', { class_id: 'VI', name: 'A', capacity: 40 })).statusCode,
    ).toBe(201);
    const period = {
      number: 1,
      name: 'First period',
      starts_at: '08:00',
      ends_at: '08:00',
      kind: 'teaching',
    };
    expect((await save('timetable_periods', period)).json().detail).toContain(
      'Ends at: Must be after Starts at',
    );
    expect((await save('timetable_periods', { ...period, ends_at: '08:40' })).statusCode).toBe(201);
  });

  it('does not ask the campus anywhere in the academics set-up', async () => {
    const list = (await inject({ method: 'GET', url: '/masters', headers: h() })).json()
      .data as Array<{
      group: string;
      fields: Array<{ key: string }>;
    }>;
    const academics = list.filter((m) => m.group === 'academics');
    expect(academics.length).toBeGreaterThan(4);
    for (const m of academics) expect(m.fields.map((f) => f.key)).not.toContain('campus_id');
  });

  it('lets a holiday name and From date be corrected; To cannot be before From', async () => {
    const made = await save('holidays', {
      name: 'Diwalli',
      starts_on: '2026-11-08',
      ends_on: '2026-11-09',
      kind: 'holiday',
      applies_to: 'everyone',
    });
    expect(made.statusCode).toBe(201);
    const id = made.json().id as string;
    const wrong = await save(
      'holidays',
      {
        name: 'Diwali',
        starts_on: '2026-11-10',
        ends_on: '2026-11-09',
        kind: 'holiday',
        applies_to: 'everyone',
      },
      id,
    );
    expect(wrong.json().detail).toContain('To: Cannot be before From');
    const fixed = await save(
      'holidays',
      {
        name: 'Diwali',
        starts_on: '2026-11-07',
        ends_on: '2026-11-09',
        kind: 'holiday',
        applies_to: 'everyone',
      },
      id,
    );
    expect(fixed.statusCode).toBe(201);
    const all = await rows('holidays');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ id, name: 'Diwali', starts_on: '2026-11-07' });
  });

  it('shows a subject by its name and takes the name in the form and in Excel', async () => {
    for (const [code, name] of [
      ['SCI', 'Science'],
      ['ENG', 'English'],
    ])
      expect(
        (await save('subjects', { code, name, kind: 'scholastic', display_order: 1 })).statusCode,
      ).toBe(201);
    // part of: typed as on screen, by the name alone, or by the code
    expect(
      (
        await save('subjects', {
          code: 'PHY',
          name: 'Physics',
          kind: 'scholastic',
          parent_id: 'Science (SCI)',
        })
      ).statusCode,
    ).toBe(201);
    expect(
      (
        await save('subjects', {
          code: 'CHE',
          name: 'Chemistry',
          kind: 'scholastic',
          parent_id: 'science',
        })
      ).statusCode,
    ).toBe(201);
    const self = await save('subjects', {
      code: 'BIO',
      name: 'Biology',
      kind: 'scholastic',
      parent_id: 'SCI',
    });
    expect(self.statusCode).toBe(201);
    const sci = (await rows('subjects')).find((r) => r.code === 'SCI')!;
    expect(
      (
        await save(
          'subjects',
          { code: 'SCI', name: 'Science', kind: 'scholastic', parent_id: 'Science (SCI)' },
          sci.id,
        )
      ).json().detail,
    ).toContain('Cannot be the row itself');
    expect((await rows('subjects')).find((r) => r.code === 'PHY')!.parent_id).toBe('Science (SCI)');

    expect(
      (await save('class_subjects', { class_id: 'VI', subject_id: 'English (ENG)' })).statusCode,
    ).toBe(201);
    expect((await rows('class_subjects'))[0]!.subject_id).toBe('English (ENG)');

    // the template lists the names; an upload with the name, or the name and code, is accepted
    const t = await inject({
      method: 'GET',
      url: '/masters/class_subjects/template',
      headers: h(),
    });
    const tpl = new ExcelJS.Workbook();
    await tpl.xlsx.load(t.rawPayload as unknown as ArrayBuffer);
    const listed: string[] = [];
    tpl.getWorksheet('Lists')!.eachRow((r) => r.eachCell((c) => listed.push(String(c.value))));
    expect(listed).toEqual(expect.arrayContaining(['Science (SCI)', 'Physics (PHY)']));
    expect(tpl.worksheets[0]!.getRow(1).values).toEqual(expect.arrayContaining(['Subject']));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Class and subject mapping');
    ws.getRow(1).values = ['Class code', 'Subject', 'Elective', 'Periods a week'];
    ws.getRow(2).values = ['VI', 'Science (SCI)', 'no', 6];
    ws.getRow(3).values = ['VI', 'Physics', 'yes', 2];
    ws.getRow(4).values = ['VI', 'Geography', 'no', 2];
    const up = await inject({
      method: 'POST',
      url: '/masters/class_subjects/imports/validate',
      headers: h(),
      json: {
        fileName: 'map.xlsx',
        contentBase64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
      },
    });
    expect(up.json()).toMatchObject({ status: 'failed', okRows: 2, rejectedRows: 1 });
    expect(up.json().report[0]).toMatchObject({ row: 4, column: 'Subject' });
  });
});
