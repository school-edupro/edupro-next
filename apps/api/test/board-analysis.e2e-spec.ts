/**
 * CBSE board result analysis, phase C (docs/design/88): the ten annexures of a saved result — on screen, as one Excel
 * workbook and as a PDF — counted with the school's rules (a setting). All names, roll numbers and marks are invented.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import ExcelJS from 'exceljs';
import { gazetteX, type FixtureCandidate } from './board-gazette-fixture';
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

interface Table {
  key: string;
  title: string;
  rows: Array<Record<string, string | number | null>>;
}
interface View {
  examYear: number | null;
  years: number[];
  sections: string[];
  rules: { bestFive: string; distinction: number };
  rulesDefault: boolean;
  analysis: {
    headline: Record<string, number | null>;
    annexures: Array<{ no: number; title: string; tables: Table[] }>;
  } | null;
}

describe('CBSE board results: the ten annexures (e2e, docs/design/88 phase C)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let auditor: SeededUser;
  let s = '';
  let year = 0;
  const h = (u: SeededUser = admin) => headersFor(u.sub, school.id);
  const post = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'POST', url, headers: h(u), json });
  const put = (url: string, json: unknown, u: SeededUser = admin) =>
    inject({ method: 'PUT', url, headers: h(u), json });
  const get = (url: string, u: SeededUser = admin) => inject({ method: 'GET', url, headers: h(u) });
  const view = async (q = '') =>
    (await get(`/exams/board-results/analysis?classLabel=X${q}`)).json() as View;
  const tableOf = (v: View, no: number, key: string) =>
    v.analysis!.annexures[no - 1]!.tables.find((t) => t.key === key)!;
  const R = ['29100001', '29100002', '29100003', '29100004', '29100005'];

  const file = (): FixtureCandidate[] => [
    {
      roll: R[0]!,
      sex: 'F',
      name: 'ASHA MADEUP',
      subjects: [
        ['184', '095', 'A1'],
        ['085', '092', 'A1'],
        ['041', '100', 'A1'],
        ['086', '091', 'A1'],
        ['087', '093', 'A1'],
      ],
      result: 'PASS',
    },
    {
      roll: R[1]!,
      sex: 'M',
      name: 'BIRJU MADEUP',
      subjects: [
        ['184', '080', 'A2'],
        ['085', '075', 'B1'],
        ['041', '075', 'B1'],
        ['086', '070', 'B2'],
        ['087', '075', 'B1'],
      ],
      result: 'PASS',
    },
    {
      roll: R[2]!,
      sex: 'M',
      name: 'CHETAN MADEUP',
      subjects: [
        ['184', '040', 'D1'],
        ['085', '030', 'E'],
        ['041', '045', 'D1'],
        ['086', '050', 'C2'],
        ['087', '035', 'D2'],
      ],
      result: 'COMP',
      compartment: ['085'],
    },
    {
      roll: R[3]!,
      sex: 'F',
      name: 'DIVYA MADEUP',
      subjects: [
        ['184', '088', 'A2'],
        ['085', '090', 'A1'],
        ['041', '079', 'B1'],
        ['086', '084', 'A2'],
        ['087', '086', 'A2'],
      ],
      result: 'PASS',
    },
    {
      roll: R[4]!,
      sex: 'F',
      name: 'EKTA MADEUP',
      subjects: [
        ['184', '', ''],
        ['085', '', ''],
        ['041', '', ''],
        ['086', '', ''],
        ['087', '', ''],
      ],
      result: 'ABST',
    },
  ];

  beforeAll(async () => {
    s = stamp('BAN');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      auditor = await seedUser(c, school, `${s}-auditor`, 'auditor');
    });
    app = await createApp();
    inject = injector(app);
    const u = await post('/exams/board-results/gazette', {
      classLabel: 'X',
      academicYearId: school.yearId,
      fileName: 'class-x.txt',
      text: gazetteX(file()),
    });
    expect(u.statusCode).toBe(201);
    const id = u.json().id as string;
    expect((await post(`/exams/board-results/imports/${id}/commit`, {})).statusCode).toBe(201);
    // the details (from the records in a school; set straight here): sections A and B, one EWS, one OBC
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE board_candidates SET section = CASE WHEN roll_no IN ($2, $3) THEN 'A' ELSE 'B' END,
                ews = (roll_no = $3), category = CASE WHEN roll_no = $4 THEN 'OBC' END
          WHERE school_id = $1`,
        [school.id, R[0], R[1], R[3]],
      );
      year = (
        await c.query<{ y: number }>(
          `SELECT DISTINCT exam_year AS y FROM board_candidates WHERE school_id = $1`,
          [school.id],
        )
      ).rows[0]!.y;
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('counts the saved year: the headline and all ten annexures', async () => {
    const v = await view();
    expect(v.years).toEqual([year]);
    expect(v.examYear).toBe(year);
    expect(v.sections).toEqual(['A', 'B']);
    expect(v.rulesDefault).toBe(true);
    expect(v.analysis!.annexures.map((x) => x.no)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    // ASHA: the best language (95) and four (100, 93, 92, 91) = 471; BIRJU 375; CHETAN 200; DIVYA 427
    expect(v.analysis!.headline).toMatchObject({
      registered: 5,
      appeared: 4,
      absent: 1,
      compartments: 1,
      passed: 3,
      n90: 1,
      n75: 3,
      aggregate: 73.65,
      highest: 94.2,
      lowest: 40,
    });
    expect(tableOf(v, 1, 'toppers').rows.map((r) => [r.rank, r.roll, r.total])).toEqual([
      [1, R[0], 471],
      [2, R[3], 427],
      [3, R[1], 375],
      [4, R[2], 200],
    ]);
    expect(tableOf(v, 1, 'full').rows).toEqual([
      expect.objectContaining({ subject: 'Mathematics (Standard)', roll: R[0] }),
    ]);
    // Hindi: CHETAN's compartment subject is not a pass
    const hindi = tableOf(v, 2, 'subjects').rows.find((r) => r.subject === 'Hindi Course-B')!;
    expect(hindi).toMatchObject({ appeared: 4, compNo: 1, failNo: 0, passNo: 3 });
    const groups = tableOf(v, 3, 'groups').rows;
    expect(groups.find((r) => r.label === 'EWS')).toMatchObject({ enrolled: 1, appeared: 1 });
    expect(groups.find((r) => r.label === 'OBC')).toMatchObject({ enrolled: 1 });
    // sections A and B in Annexure 7; each subject's sections and an all-sections line in Annexure 8
    expect(v.analysis!.annexures[6]!.tables.map((t) => t.title)).toEqual([
      'Section A',
      'Section B',
    ]);
    const maths = v.analysis!.annexures[7]!.tables.find((t) => t.key === 'sub-041')!;
    expect(maths.rows.map((r) => [r.section, r.total, r.highest])).toEqual([
      ['A', 2, 100],
      ['B', 2, 79],
      ['All', 4, 100],
    ]);
    // the year before is not saved: Annexure 5 says so
    expect(tableOf(v, 5, 'compare').rows[0]).toMatchObject({ appL: null });
  });

  it('one section only', async () => {
    const v = await view(`&examYear=${String(year)}&section=A`);
    expect(v.analysis!.headline).toMatchObject({ registered: 2, appeared: 2, passed: 2 });
    expect(v.analysis!.annexures[6]!.tables.map((t) => t.title)).toEqual(['Section A']);
  });

  it('the Excel workbook (a sheet an annexure) and the PDF (one annexure, or all)', async () => {
    const x = await get(`/exams/board-results/analysis/file?classLabel=X&format=xlsx`);
    expect(x.statusCode).toBe(200);
    expect(x.json().filename).toMatch(/\.xlsx$/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(x.json().base64 as string, 'base64') as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Annexure-${String(i + 1)}`),
    );
    // Annexure 4 laid out as the school's: a block a subject, label | value
    const a4: string[] = [];
    wb.getWorksheet('Annexure-4')!.eachRow((r) =>
      a4.push(`${String(r.getCell(1).value)}|${String(r.getCell(3).value)}`),
    );
    expect(a4).toContain('No. of students appeared|4');
    const one = await get(`/exams/board-results/analysis/file?classLabel=X&format=pdf&annexure=2`);
    expect(one.statusCode).toBe(200);
    expect(
      Buffer.from(one.json().base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    expect(one.json().filename).toMatch(/Annexure-2\.pdf$/);
    const all = await get(`/exams/board-results/analysis/file?classLabel=X&format=pdf`);
    expect(
      Buffer.from(all.json().base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    expect((all.json().base64 as string).length).toBeGreaterThan(
      (one.json().base64 as string).length,
    );
    // the export is on record
    const audit = await withMigrator((c) =>
      c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_logs WHERE school_id = $1 AND action = 'exams.board_result.analysis_export'`,
        [school.id],
      ),
    );
    expect(audit.rows[0]!.n).toBe(3);
  });

  it('the rules are a setting: any five changes the figures; the import right changes them', async () => {
    expect(
      (
        await put(
          '/exams/board-results/rules',
          { bestFive: 'any-five', distinction: 75, passMarks: 33, grades: 'marks' },
          auditor,
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await put('/exams/board-results/rules', {
          bestFive: 'any-five',
          distinction: 20,
          passMarks: 33,
          grades: 'marks',
        })
      ).statusCode,
    ).toBe(400);
    const r = await put('/exams/board-results/rules', {
      bestFive: 'any-five',
      distinction: 80,
      passMarks: 33,
      grades: 'marks',
    });
    expect(r.statusCode).toBe(200);
    const v = await view();
    expect(v.rulesDefault).toBe(false);
    expect(v.rules).toMatchObject({ bestFive: 'any-five', distinction: 80 });
    // ASHA's best five of any subjects is the same 471; CHETAN's: 50, 45, 40, 35, 30 — the same 200
    expect(tableOf(v, 1, 'toppers').rows[0]).toMatchObject({ total: 471 });
    // distinction from 80: Mathematics 100 only (75 and 79 no longer count)
    const maths = tableOf(v, 1, 'distinctions').rows.find(
      (x) => x.subject === 'Mathematics (Standard)',
    )!;
    expect(maths).toMatchObject({ dist: 1 });
    expect((await get('/exams/board-results/rules', auditor)).json().rules).toMatchObject({
      bestFive: 'any-five',
    });
  });

  it('two teachers sharing a section are named together; a class with no saved file says so', async () => {
    for (const name of ['Asha Teacher', 'Bhanu Teacher'])
      expect(
        (
          await post('/exams/board-results/teachers', {
            classLabel: 'X',
            examYear: year,
            section: 'A',
            code: '184',
            teacherName: name,
          })
        ).statusCode,
      ).toBe(201);
    const v = await view();
    const a = v.analysis!.annexures[6]!.tables[0]!.rows.find((r) => r.code === '184')!;
    expect(a.teacher).toBe('Asha Teacher, Bhanu Teacher');
    const none = (await get('/exams/board-results/analysis?classLabel=XII')).json() as View;
    expect(none).toMatchObject({ years: [], analysis: null });
    expect(
      (await get('/exams/board-results/analysis/file?classLabel=XII&format=pdf')).statusCode,
    ).toBe(404);
  });
});
