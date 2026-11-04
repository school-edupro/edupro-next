/**
 * Who enters what (docs/design/71, 0305-0306): an Indicator assignment names areas and optionally single
 * indicators, and the teacher rates only those (the class teacher everything); a Remarks assignment names
 * remark categories the teacher writes; height and weight is one record per pupil per exam, with the class
 * teacher's sheet; each by Excel; and a teacher's "To enter" list.
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

interface Ind {
  id: string;
  code: string;
  mine: boolean;
  enteredBy: string[];
}
interface Cat {
  id: string;
  code: string;
  may: boolean;
  writtenBy: string[];
}

describe('who enters what (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  const s = stamp('EBM');
  const id: Record<string, string> = {};
  const staff: Record<string, string> = {}; // employee ids
  const student: string[] = [];
  const asAdmin = () => headersFor(admin.sub, school.id);
  const as = (who: string) => headersFor(`employee:${school.id}:${staff[who]!}`, school.id);
  const call = (h: Record<string, string>, method: string, url: string, json?: unknown) =>
    inject({
      method: method as 'GET',
      url,
      headers: h,
      ...(json === undefined ? {} : { json }),
    });
  const sheetOf = async (b64: string) => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(b64, 'base64') as unknown as ArrayBuffer);
    return wb;
  };
  const b64Of = async (wb: ExcelJS.Workbook) =>
    Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
  const headers = (ws: ExcelJS.Worksheet) =>
    (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v).replace(/\s*\*$/, ''));

  beforeAll(async () => {
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}S`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      for (const code of ['CT', 'ART', 'PE', 'RM'])
        staff[code] = (
          await c.query<{ id: string }>(
            `INSERT INTO employees (school_id, employee_code, first_name, email) VALUES ($1, $2, $2, $3) RETURNING id::text`,
            [school.id, code, `${s.toLowerCase()}-${code.toLowerCase()}@example.com`],
          )
        ).rows[0]!.id;
    });
    app = await createApp();
    inject = injector(app);
    for (const code of Object.keys(staff))
      expect(
        (await call(asAdmin(), 'POST', `/people/staff/${staff[code]!}/login`, {})).json(),
      ).toMatchObject({ hasLogin: true });
    for (const [code, order] of [
      ['VI', 6],
      ['VII', 7],
    ] as const)
      id[code] = (
        await call(asAdmin(), 'POST', '/academics/classes', {
          code,
          name: `Class ${code}`,
          displayOrder: order,
        })
      ).json().id;
    for (const name of ['A', 'B'])
      id[name] = (
        await call(asAdmin(), 'POST', `/academics/classes/${id.VI!}/sections`, { name })
      ).json().id;
    for (const [i, first] of ['Asha', 'Bhanu'].entries())
      student.push(
        (
          await call(asAdmin(), 'POST', '/people/students', {
            admissionNo: `${s}-${String(i + 1)}`,
            firstName: first,
            lastName: 'Map',
            guardians: [],
            enrolment: { classSectionId: id.A, rollNo: i + 1 },
          })
        ).json().id,
      );
    for (const name of ['Art Education', 'Health and PE']) {
      const r = await call(asAdmin(), 'PUT', '/exams/indicator-areas', { name });
      expect(r.statusCode).toBeLessThan(300);
    }
    const areas = (await call(asAdmin(), 'GET', '/exams/indicator-areas')).json().data as Array<{
      id: string;
      name: string;
    }>;
    id.art = areas.find((a) => a.name === 'Art Education')!.id;
    id.pe = areas.find((a) => a.name === 'Health and PE')!.id;
    expect(
      (
        await call(asAdmin(), 'PUT', '/exams/indicator-sets', {
          code: 'COS',
          name: 'Co-scholastic',
          grades: ['A', 'B', 'C'],
          indicators: [
            { code: 'ART1', name: 'Drawing', area: 'Art Education', sortOrder: 1 },
            { code: 'ART2', name: 'Music', area: 'Art Education', sortOrder: 2 },
            { code: 'WRT', name: 'Art note', area: 'Art Education', sortOrder: 3, kind: 'text' },
            { code: 'PE1', name: 'Games', area: 'Health and PE', sortOrder: 4 },
          ],
        })
      ).statusCode,
    ).toBeLessThan(300);
    const set = (
      (await call(asAdmin(), 'GET', '/exams/indicator-sets')).json().data as Array<{
        id: string;
        code: string;
        indicators: Array<{ id: string; code: string }>;
      }>
    ).find((x) => x.code === 'COS')!;
    id.set = set.id;
    for (const i of set.indicators) id[i.code] = i.id;
    await call(asAdmin(), 'PUT', `/exams/indicator-sets/${set.id}/classes`, {
      classIds: [id.VI],
    });
    const type = (
      await call(asAdmin(), 'POST', '/exams/types', { code: 'TRM', name: 'Term' })
    ).json().id;
    id.exam = (
      await call(asAdmin(), 'POST', '/exams', {
        examTypeId: type,
        code: 'T1',
        name: 'Term 1',
        classes: [{ classId: id.VI }],
      })
    ).json().id;
    await call(asAdmin(), 'PUT', `/exams/${id.exam!}/indicator-sets`, {
      classId: id.VI,
      setId: id.set,
    });
    for (const [code, name, classIds] of [
      ['SPORTS', 'Sports', [id.VI]],
      ['GEN', 'General', []],
      ['X7', 'Seventh only', [id.VII]],
    ] as const) {
      const r = await call(asAdmin(), 'PUT', '/exams/remark-categories', {
        code,
        name,
        classIds,
      });
      expect(r.statusCode).toBeLessThan(300);
      id[code] = (r.json().data as Array<{ id: string; code: string }>).find(
        (k) => k.code === code,
      )!.id;
    }
  });
  afterAll(async () => app.close());

  const bulk = (json: Record<string, unknown>) =>
    call(asAdmin(), 'POST', '/academics/teacher-assignments/bulk', {
      classSectionIds: [id.A],
      ...json,
    });

  it('an Indicator assignment names areas and single indicators of them; checked', async () => {
    const art = await bulk({
      employeeId: staff.ART,
      kind: 'indicator',
      areaIds: [id.art],
      indicatorIds: [id.ART1],
    });
    expect(art.json()).toMatchObject({ created: 1 });
    const wrong = await bulk({
      employeeId: staff.PE,
      kind: 'indicator',
      areaIds: [id.pe],
      indicatorIds: [id.ART1],
    });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().detail).toContain('ART1 is not in the areas picked');
    expect(
      (await bulk({ employeeId: staff.PE, kind: 'indicator', areaIds: [id.pe] })).json(),
    ).toMatchObject({ created: 1 });
    expect((await bulk({ employeeId: staff.CT, kind: 'class_teacher' })).json()).toMatchObject({
      created: 1,
    });
    const rows = (
      await call(asAdmin(), 'GET', `/academics/teacher-assignments?classSectionId=${id.A!}`)
    ).json().data as Array<{
      id: string;
      employeeId: string;
      indicatorAreas: Array<{ name: string }>;
      indicators: Array<{ code: string }>;
    }>;
    const artRow = rows.find((r) => r.employeeId === staff.ART)!;
    expect(artRow.indicatorAreas.map((a) => a.name)).toEqual(['Art Education']);
    expect(artRow.indicators.map((i) => i.code)).toEqual(['ART1']);
    const put = await call(asAdmin(), 'PUT', `/academics/teacher-assignments/${artRow.id}/areas`, {
      areaIds: [id.art],
      indicatorIds: [id.ART1, id.WRT],
    });
    expect(put.statusCode).toBe(200);
    expect(
      put
        .json()
        .indicators.map((i: { code: string }) => i.code)
        .sort(),
    ).toEqual(['ART1', 'WRT']);
    // the Indicator-only teacher holds the Subject Teacher role, bound to the section
    const scopes = await withMigrator(
      async (c) =>
        (
          await c.query<{ code: string; n: number }>(
            `SELECT r.code, count(s.id)::int AS n FROM user_roles ur JOIN roles r ON r.id = ur.role_id
               JOIN employees e ON e.user_id = ur.user_id LEFT JOIN user_role_scopes s ON s.user_role_id = ur.id
              WHERE e.id = $1 AND ur.revoked_at IS NULL GROUP BY r.code`,
            [staff.ART],
          )
        ).rows,
    );
    expect(scopes).toEqual([{ code: 'subject_teacher', n: 1 }]);
  });

  it('a mapped teacher rates only theirs; the class teacher every indicator', async () => {
    const secs = (await call(as('ART'), 'GET', `/exams/${id.exam!}/entry/sections`)).json()
      .data as Array<{ classSectionId: string; register: boolean; indicators: boolean }>;
    expect(secs.map((x) => [x.classSectionId, x.register, x.indicators])).toEqual([
      [id.A, false, true],
    ]);
    const mine = (
      await call(as('ART'), 'GET', `/exams/${id.exam!}/indicators?classSectionId=${id.A!}`)
    ).json() as { reach: string; indicators: Ind[] };
    expect(mine.reach).toBe('mapped');
    expect(Object.fromEntries(mine.indicators.map((i) => [i.code, i.mine]))).toEqual({
      ART1: true,
      ART2: false,
      WRT: true,
      PE1: false,
    });
    const put = (who: string, indicatorId: string, grade: string) =>
      call(as(who), 'PUT', `/exams/${id.exam!}/indicators`, {
        classSectionId: id.A,
        rows: [{ studentId: student[0], indicatorId, grade }],
      });
    expect((await put('ART', id.ART1!, 'A')).statusCode).toBe(200);
    const no = await put('ART', id.PE1!, 'A');
    expect(no.statusCode).toBe(409);
    expect(no.json()).toMatchObject({ type: 'exams.indicator_not_mapped' });
    const ct = (
      await call(as('CT'), 'GET', `/exams/${id.exam!}/indicators?classSectionId=${id.A!}`)
    ).json() as { reach: string; indicators: Ind[] };
    expect(ct.reach).toBe('all');
    expect(ct.indicators.every((i) => i.mine)).toBe(true);
    expect(ct.indicators.find((i) => i.code === 'PE1')!.enteredBy).toEqual(['PE (PE)']);
    expect((await put('CT', id.PE1!, 'B')).statusCode).toBe(200);
    // another section is not theirs
    const other = await call(as('ART'), 'PUT', `/exams/${id.exam!}/indicators`, {
      classSectionId: id.B,
      rows: [{ studentId: student[0], indicatorId: id.ART1, grade: 'A' }],
    });
    expect(other.statusCode).toBe(403);
  });

  it('the indicators sheet holds only the teacher’s; levels checked; saved', async () => {
    const file = (
      await call(as('ART'), 'GET', `/exams/${id.exam!}/indicators/excel?classSectionId=${id.A!}`)
    ).json() as { base64: string };
    const wb = await sheetOf(file.base64);
    const ws = wb.worksheets[0]!;
    const head = headers(ws);
    expect(head.filter((h) => h.includes(' · '))).toEqual(['ART1 · Drawing', 'WRT · Art note']);
    expect(ws.getRow(2).getCell(4).value).toBe('A'); // what was entered
    ws.getRow(3).getCell(4).value = 'z';
    ws.getRow(3).getCell(5).value = 'Draws well';
    const up = (b64: string, apply: boolean) =>
      call(as('ART'), 'POST', `/exams/${id.exam!}/indicators/upload`, {
        classSectionId: id.A,
        file: b64,
        apply,
      });
    const bad = (await up(await b64Of(wb), true)).json();
    expect(bad).toMatchObject({ errors: 1, applied: false });
    expect(bad.rows[1].error).toContain('z is not a level');
    ws.getRow(3).getCell(4).value = 'b';
    const good = (await up(await b64Of(wb), true)).json();
    expect(good).toMatchObject({ errors: 0, ready: 2, applied: true });
    const after = (
      await call(as('CT'), 'GET', `/exams/${id.exam!}/indicators?classSectionId=${id.A!}`)
    ).json() as {
      rows: Array<{ grades: Record<string, { grade: string | null; note: string | null }> }>;
    };
    expect(after.rows[1]!.grades[id.ART1!]).toMatchObject({ grade: 'B' });
    expect(after.rows[1]!.grades[id.WRT!]).toMatchObject({ note: 'Draws well' });
  });

  it('a Remarks assignment names the categories the teacher writes; the page says why not', async () => {
    expect(
      (await bulk({ employeeId: staff.RM, kind: 'remarks', remarkCategoryIds: [] })).statusCode,
    ).toBe(400);
    const off = await bulk({ employeeId: staff.RM, kind: 'remarks', remarkCategoryIds: [id.X7] });
    expect(off.json().skipped[0].why).toContain('"Seventh only" is not set for Class VI');
    expect(
      (
        await bulk({ employeeId: staff.RM, kind: 'remarks', remarkCategoryIds: [id.SPORTS] })
      ).json(),
    ).toMatchObject({ created: 1 });
    const items = (
      await call(as('RM'), 'GET', `/exams/${id.exam!}/remark-items?classSectionId=${id.A!}`)
    ).json() as { reason: string | null; categories: Cat[] };
    expect(items.reason).toBeNull();
    expect(Object.fromEntries(items.categories.map((k) => [k.code, k.may]))).toEqual({
      GEN: false,
      SPORTS: true,
    });
    expect(items.categories.find((k) => k.code === 'SPORTS')!.writtenBy).toEqual([
      'Class teacher',
      'RM (RM)',
    ]);
    const write = (who: string, categoryId: string) =>
      call(as(who), 'PUT', `/exams/${id.exam!}/remark-items`, {
        classSectionId: id.A,
        rows: [{ studentId: student[0], categoryId, text: 'Plays fair' }],
      });
    expect((await write('RM', id.SPORTS!)).statusCode).toBe(200);
    expect((await write('RM', id.GEN!)).json()).toMatchObject({ type: 'exams.not_assigned' });
    // a teacher who writes none is told why
    const pe = (
      await call(as('PE'), 'GET', `/exams/${id.exam!}/remark-items?classSectionId=${id.A!}`)
    ).json() as { reason: string | null };
    expect(pe.reason).toContain('You write no remark category');
    // the categories changed on the row
    const row = (
      (
        await call(
          asAdmin(),
          'GET',
          `/academics/teacher-assignments?kind=remarks&classSectionId=${id.A!}`,
        )
      ).json().data as Array<{ id: string; remarkCategories: Array<{ code: string }> }>
    )[0]!;
    expect(row.remarkCategories.map((k) => k.code)).toEqual(['SPORTS']);
    const changed = await call(
      asAdmin(),
      'PUT',
      `/academics/teacher-assignments/${row.id}/categories`,
      { categoryIds: [id.SPORTS, id.GEN] },
    );
    expect(changed.json().remarkCategories.map((k: { code: string }) => k.code)).toEqual([
      'GEN',
      'SPORTS',
    ]);
    // by Excel: only the categories the teacher writes
    const file = (
      await call(as('RM'), 'GET', `/exams/${id.exam!}/remark-items/excel?classSectionId=${id.A!}`)
    ).json() as { base64: string };
    const wb = await sheetOf(file.base64);
    const ws = wb.worksheets[0]!;
    expect(headers(ws).filter((h) => h.includes(' · '))).toEqual([
      'GEN · General',
      'SPORTS · Sports',
    ]);
    ws.getRow(3).getCell(4).value = 'Helpful in class';
    const up = (
      await call(as('RM'), 'POST', `/exams/${id.exam!}/remark-items/upload`, {
        classSectionId: id.A,
        file: await b64Of(wb),
        apply: true,
      })
    ).json();
    expect(up).toMatchObject({ errors: 0, applied: true });
  });

  it('height and weight: one record per pupil per exam; the class teacher’s sheet', async () => {
    const put = (rows: unknown[]) =>
      call(as('CT'), 'PUT', `/exams/${id.exam!}/health`, { classSectionId: id.A, rows });
    expect((await put([{ studentId: student[0], heightCm: 140, weightKg: 35 }])).statusCode).toBe(
      200,
    );
    expect((await put([{ studentId: student[0], weightKg: 36 }])).statusCode).toBe(200);
    const recs = await withMigrator(
      async (c) =>
        (
          await c.query<{ height_cm: string; weight_kg: string; bmi: string }>(
            `SELECT height_cm::text, weight_kg::text, bmi::text FROM health_records WHERE student_id = $1 AND exam_id = $2`,
            [student[0], id.exam],
          )
        ).rows,
    );
    expect(recs).toEqual([{ height_cm: '140.0', weight_kg: '36.00', bmi: '18.37' }]);
    const sheet = (
      await call(as('CT'), 'GET', `/exams/${id.exam!}/health?classSectionId=${id.A!}`)
    ).json();
    expect(sheet).toMatchObject({ takes: true, canEnter: true, locked: false });
    expect(sheet.rows[0].current).toMatchObject({ heightCm: '140.0', bmi: '18.37' });
    // a subject teacher has no height and weight
    expect(
      (await call(as('ART'), 'GET', `/exams/${id.exam!}/health?classSectionId=${id.A!}`))
        .statusCode,
    ).toBe(403);
    const file = (
      await call(as('CT'), 'GET', `/exams/${id.exam!}/health/excel?classSectionId=${id.A!}`)
    ).json() as { base64: string };
    const wb = await sheetOf(file.base64);
    const ws = wb.worksheets[0]!;
    expect(headers(ws).slice(4)).toEqual(['Height (cm)', 'Weight (kg)', 'Blood group']);
    ws.getRow(3).getCell(5).value = 300;
    ws.getRow(3).getCell(6).value = 30;
    const up = (apply: boolean) =>
      b64Of(wb).then((file) =>
        call(as('CT'), 'POST', `/exams/${id.exam!}/health/upload`, {
          classSectionId: id.A,
          file,
          apply,
        }),
      );
    expect((await up(true)).json().rows[1].error).toContain('Height 300 is not 40 to 250 cm');
    ws.getRow(3).getCell(5).value = 132;
    ws.getRow(3).getCell(7).value = 'b+';
    expect((await up(true)).json()).toMatchObject({ errors: 0, applied: true });
    const after = (
      await call(as('CT'), 'GET', `/exams/${id.exam!}/health?classSectionId=${id.A!}`)
    ).json();
    expect(after.rows[1].current).toMatchObject({
      heightCm: '132.0',
      weightKg: '30.00',
      bloodGroup: 'B+',
    });
  });

  it('a teacher’s "To enter": what is theirs and not done yet', async () => {
    const lines = (who: string) =>
      call(as(who), 'GET', '/exams/my-entry').then((r) =>
        (r.json().data as Array<{ area: string; what: string; done: number; total: number }>).map(
          (x) => `${x.area}:${x.what}:${String(x.done)}/${String(x.total)}`,
        ),
      );
    // ART: ART1 (2 of 2) and WRT (1 of 2) of the 4 cells theirs
    expect(await lines('ART')).toEqual(['indicators:Indicators:3/4']);
    // the class teacher: every indicator (ART1 ×2, WRT, PE1 of 8), every category of the class; height
    // and weight is done
    expect(await lines('CT')).toEqual([
      'indicators:Indicators:4/8',
      'remarks:General:1/2',
      'remarks:Sports:1/2',
    ]);
    expect(await lines('RM')).toEqual(['remarks:General:1/2', 'remarks:Sports:1/2']);
  });
});
