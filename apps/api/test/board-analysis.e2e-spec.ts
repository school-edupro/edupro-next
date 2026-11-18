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
  rules: { bestFive: { include: string }; distinction: number; scale: Array<{ grade: string }> };
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
    // the school's ten, and EduPro's extras (phase D)
    expect(v.analysis!.annexures.map((x) => x.no)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13,
    ]);
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
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      ...Array.from({ length: 10 }, (_, i) => `Annexure-${String(i + 1)}`),
      'Performance Index',
      'Five-year trend',
      'Lists',
    ]);
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

  it("a class's rules are a setting: any five, its own grade scale; the import right changes them", async () => {
    const FIVE = [
      { grade: 'A+', from: 90, to: 100 },
      { grade: 'A', from: 75, to: 89 },
      { grade: 'B', from: 60, to: 74 },
      { grade: 'C', from: 33, to: 59 },
      { grade: 'F', from: 0, to: 32 },
    ];
    const body = (more: Record<string, unknown> = {}) => ({
      classLabel: 'X',
      bestFive: {
        include: 'none',
        rest: 'best',
        optional: 'replace',
        optionalKinds: ['skill', 'additional'],
      },
      distinction: 80,
      passMarks: 33,
      grades: 'marks',
      scale: FIVE,
      ...more,
    });
    expect((await put('/exams/board-results/rules', body(), auditor)).statusCode).toBe(403);
    expect((await put('/exams/board-results/rules', body({ distinction: 20 }))).statusCode).toBe(
      400,
    );
    // a gap between A (75-88) and A+ (90-100): refused, saying where
    const gap = await put(
      '/exams/board-results/rules',
      body({ scale: [FIVE[0], { ...FIVE[1], to: 88 }, ...FIVE.slice(2)] }),
    );
    expect(gap.statusCode).toBe(400);
    expect(JSON.stringify(gap.json())).toContain('A+ starts at 90, so A must end at 89');
    // the rows in any order: saved highest first
    const r = await put('/exams/board-results/rules', body({ scale: [...FIVE].reverse() }));
    expect(r.statusCode).toBe(200);
    const v = await view();
    expect(v.rulesDefault).toBe(false);
    expect(v.rules).toMatchObject({ bestFive: { include: 'none' }, distinction: 80 });
    expect(v.rules.scale.map((g) => g.grade)).toEqual(['A+', 'A', 'B', 'C', 'F']);
    // ASHA's best five of any subjects is the same 471; CHETAN's: 50, 45, 40, 35, 30 — the same 200
    expect(tableOf(v, 1, 'toppers').rows[0]).toMatchObject({ total: 471 });
    // distinction from 80: Mathematics 100 only (75 and 79 no longer count)
    const maths = tableOf(v, 1, 'distinctions').rows.find(
      (x) => x.subject === 'Mathematics (Standard)',
    )!;
    expect(maths).toMatchObject({ dist: 1 });
    // Annexure 4 counts the school's grades
    expect(Object.keys(tableOf(v, 4, 'summary').rows[0]!)).toEqual(
      expect.arrayContaining(['gA+', 'gA', 'gB', 'gC', 'gF']),
    );
    const x = (await get('/exams/board-results/rules?classLabel=X', auditor)).json();
    expect(x.rules.bestFive).toMatchObject({ include: 'none' });
    // Class XII keeps its defaults
    const xii = (await get('/exams/board-results/rules?classLabel=XII')).json();
    expect(xii.isDefault).toBe(true);
    expect(xii.rules.bestFive).toMatchObject({
      include: 'language',
      optionalKinds: ['additional'],
    });
    expect(xii.rules.scale.at(-1)).toEqual({ grade: 'E1', from: 0, to: 32 });
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

  it('teacher wise result analysis: each teacher of a shared section on her own, one teacher, the files', async () => {
    const r = await get('/exams/board-results/reports/teacher-analysis?classLabel=X');
    expect(r.statusCode).toBe(200);
    const d = r.json() as {
      examYear: number;
      teachers: Array<{ key: string; name: string }>;
      table: { rows: Array<Record<string, string | number | null>>; strong: number[] };
    };
    expect(d.examYear).toBe(year);
    // the two names typed for section A's English, each on her own
    expect(d.teachers.map((t) => t.key)).toEqual(
      expect.arrayContaining(['n:Asha Teacher', 'n:Bhanu Teacher']),
    );
    const asha = d.table.rows.findIndex((x) => x.teacher === 'Asha Teacher');
    expect(d.table.rows[asha]).toMatchObject({ code: '184', section: 'A' });
    const one = (
      await get(
        `/exams/board-results/reports/teacher-analysis?classLabel=X&teacher=${encodeURIComponent('n:Bhanu Teacher')}`,
      )
    ).json() as typeof d;
    expect(one.table.rows.map((x) => [x.teacher, x.code, x.section])).toEqual([
      ['Bhanu Teacher', '184', 'A'],
    ]);
    expect(
      (await get('/exams/board-results/reports/teacher-analysis?classLabel=X&teacher=a%3Bb'))
        .statusCode,
    ).toBe(400);
    for (const format of ['pdf', 'xlsx']) {
      const f = await get(
        `/exams/board-results/reports/teacher-analysis/file?classLabel=X&format=${format}`,
      );
      expect(f.statusCode).toBe(200);
      expect(f.json()).toMatchObject({
        filename: `CBSE-Class-X-${String(year)}-teacher-analysis.${format}`,
      });
    }
    expect(
      (await get('/exams/board-results/reports/teacher-analysis/file?classLabel=XII&format=pdf'))
        .statusCode,
    ).toBe(404);
  });

  it("result analysis section wise names each section's teachers; one section; the files", async () => {
    type T = {
      sections: string[];
      table: { rows: Array<Record<string, string | number | null>>; strong: number[] };
    };
    const each = (
      await get('/exams/board-results/reports/result-analysis?classLabel=X&section=each&compare=0')
    ).json() as T;
    expect(each.sections).toEqual(['A', 'B']);
    const e = each.table.rows.findIndex((x) => x.code === '184');
    expect(each.table.strong).toContain(e);
    // section A's English: the two names typed on the Teachers tab
    expect(each.table.rows[e + 1]).toMatchObject({
      subject: 'Section A',
      teacher: 'Asha Teacher, Bhanu Teacher',
    });
    expect(each.table.rows[e + 2]).toMatchObject({ subject: 'Section B' });
    const together = (
      await get('/exams/board-results/reports/result-analysis?classLabel=X&compare=0')
    ).json() as T;
    expect(together.table.rows.find((x) => x.code === '184')!.teacher).toBe(
      'Asha Teacher, Bhanu Teacher',
    );
    const a = (
      await get('/exams/board-results/reports/result-analysis?classLabel=X&section=A&compare=0')
    ).json() as T;
    expect(a.table.rows.find((x) => x.code === '184')!.appeared).toBe(
      each.table.rows[e + 1]!.appeared,
    );
    const f = await get(
      '/exams/board-results/reports/result-analysis/file?classLabel=X&format=pdf&section=each',
    );
    expect(f.json().filename).toMatch(/result-analysis-section-wise\.pdf$/);
    expect(
      (
        await get(
          '/exams/board-results/reports/result-analysis/file?classLabel=X&format=xlsx&section=A',
        )
      ).statusCode,
    ).toBe(200);
  });

  it('the Results tab: candidate-wise marks, the class rank, filters, pages and files', async () => {
    const m = await get('/exams/board-results/marks?classLabel=X');
    expect(m.statusCode).toBe(200);
    const d = m.json() as {
      total: number;
      maxSubjects: number;
      results: Array<{ word: string; n: number }>;
      rows: Array<{
        sr: number;
        roll: string;
        total: number | null;
        max: number | null;
        rank: number | null;
        result: string;
      }>;
    };
    expect(d.total).toBe(5);
    expect(d.maxSubjects).toBe(5);
    expect(d.rows.map((r) => [r.roll, r.total, r.rank])).toEqual([
      [R[0], 471, 1],
      [R[3], 427, 2],
      [R[1], 375, 3],
      [R[2], 200, 4],
      [R[4], null, null],
    ]);
    expect(d.results).toEqual(
      expect.arrayContaining([
        { word: 'PASS', n: 3 },
        { word: 'COMP', n: 1 },
      ]),
    );
    const one = (await get('/exams/board-results/marks?classLabel=X&result=COMP')).json();
    expect(one.rows.map((r: { roll: string }) => r.roll)).toEqual([R[2]]);
    const paged = (
      await get('/exams/board-results/marks?classLabel=X&size=10&page=1&band=90')
    ).json();
    expect(paged.total).toBe(1);
    // the auditor looks too; the files
    expect((await get('/exams/board-results/marks?classLabel=X', auditor)).statusCode).toBe(200);
    const x = await get('/exams/board-results/marks/file?classLabel=X&format=xlsx&sort=roll');
    expect(x.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(x.json().base64 as string, 'base64') as unknown as ArrayBuffer);
    const heads = (wb.worksheets[0]!.getRow(5).values as unknown[]).slice(1);
    expect(heads.slice(0, 7)).toEqual([
      'Sr#',
      'Roll No',
      'Name',
      'Gender',
      'Class',
      'Comp Sub',
      'Subject-1',
    ]);
    expect(heads.slice(-5)).toEqual([
      'Max Marks',
      'Result',
      'Subject Aggregate',
      'Total Percentage',
      'Rank',
    ]);
    const p = await get('/exams/board-results/marks/file?classLabel=X&format=pdf');
    expect(
      Buffer.from(p.json().base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
  });

  it('Reports: the Subject Summary — every subject by boys and girls, with the total line and the files', async () => {
    const r = await get('/exams/board-results/reports/subject-summary?classLabel=X');
    expect(r.statusCode).toBe(200);
    const t = r.json().table as {
      rows: Array<Record<string, string | number | null>>;
      strong: number[];
    };
    // five subjects and the total
    expect(t.rows).toHaveLength(6);
    expect(t.rows.at(-1)).toMatchObject({ subject: 'Total', appeared: 20 });
    const hindi = t.rows.find((x) => x.subject === 'Hindi Course-B')!;
    // ASHA 92 F, BIRJU 75 M, CHETAN 30 M (compartment), DIVYA 90 F
    expect(hindi).toMatchObject({
      appeared: 4,
      boys: 2,
      girls: 2,
      compNo: 1,
      passNo: 3,
      girlsPassPct: 100,
    });
    const x = await get(
      '/exams/board-results/reports/subject-summary/file?classLabel=X&format=xlsx',
    );
    expect(x.statusCode).toBe(200);
    const p = await get(
      '/exams/board-results/reports/subject-summary/file?classLabel=X&format=pdf&gender=M',
    );
    expect(p.json().filename).toMatch(/subject-summary\.pdf$/);
    expect(
      (await get('/exams/board-results/reports/subject-summary?classLabel=X', auditor)).statusCode,
    ).toBe(200);
    // section wise: Hindi's row, then sections A and B (the details give A and B)
    const each = (
      await get('/exams/board-results/reports/subject-summary?classLabel=X&section=each')
    ).json() as {
      sections: string[];
      table: { rows: Array<Record<string, string | number | null>>; strong: number[] };
    };
    expect(each.sections).toEqual(['A', 'B']);
    const h = each.table.rows.findIndex((x) => x.subject === 'Hindi Course-B');
    const [ha, hb] = [each.table.rows[h + 1]!, each.table.rows[h + 2]!];
    expect([ha.subject, hb.subject]).toEqual(['Section A', 'Section B']);
    expect(Number(ha.appeared) + Number(hb.appeared)).toBe(4);
    expect(each.table.strong).toContain(h);
    expect(each.table.rows.at(-1)!.subject).toBe('Total · Section B');
    const oneB = (
      await get('/exams/board-results/reports/subject-summary?classLabel=X&section=B')
    ).json() as typeof each;
    expect(oneB.table.rows.find((x) => x.subject === 'Hindi Course-B')!.appeared).toBe(hb.appeared);
    const f = await get(
      '/exams/board-results/reports/subject-summary/file?classLabel=X&format=pdf&section=each',
    );
    expect(f.json().filename).toMatch(/subject-summary-section-wise\.pdf$/);
  });
});
