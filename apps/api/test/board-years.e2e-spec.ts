/**
 * CBSE board result analysis, phase E (docs/design/88): earlier years — a past result file uploaded by its
 * examination year alone (no academic year in EduPro), and a lost year's figures typed in — feeding the five-year
 * rows, the trend and Annexure 5. All names, roll numbers and marks are invented.
 */
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, string | number | null>>;
}
interface View {
  examYear: number;
  years: number[];
  analysis: { annexures: Array<{ no: number; tables: Table[] }> } | null;
}

describe('CBSE board results: earlier years (e2e, docs/design/88 phase E)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let auditor: SeededUser;
  let s = '';
  let now = 0;
  let typedId = '';
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

  const five = (m: number): Array<[string, string, string]> => [
    ['184', String(m), 'B1'],
    ['085', String(m), 'B1'],
    ['041', String(m), 'B1'],
    ['086', String(m), 'B1'],
    ['087', String(m), 'B1'],
  ];
  const file = (prefix: string, marks: number[]): FixtureCandidate[] =>
    marks.map((m, i) => ({
      roll: `${prefix}${String(i + 1).padStart(3, '0')}`,
      sex: i % 2 ? 'M' : 'F',
      name: `PAST CANDIDATE ${String.fromCharCode(65 + i)}`,
      subjects: five(m),
      result: 'PASS',
    }));
  const save = async (body: Record<string, unknown>) => {
    const u = await post('/exams/board-results/gazette', {
      classLabel: 'X',
      fileName: 'x.txt',
      ...body,
    });
    expect({ status: u.statusCode, body: u.statusCode === 201 ? null : u.body }).toEqual({
      status: 201,
      body: null,
    });
    const c = await post(`/exams/board-results/imports/${u.json().id as string}/commit`, {});
    expect({ status: c.statusCode, body: c.statusCode === 201 ? null : c.body }).toEqual({
      status: 201,
      body: null,
    });
  };

  beforeAll(async () => {
    s = stamp('BYR');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      auditor = await seedUser(c, school, `${s}-auditor`, 'auditor');
      now = (
        await c.query<{ y: number }>(
          `SELECT EXTRACT(YEAR FROM end_date)::int AS y FROM academic_years WHERE id = $1`,
          [school.yearId],
        )
      ).rows[0]!.y;
    });
    app = await createApp();
    inject = injector(app);
    // this year's file (the school's academic year), and one from two years back (no academic year in EduPro)
    await save({ academicYearId: school.yearId, text: gazetteX(file('29300', [90, 80, 70])) });
    await save({ examYear: now - 2, text: gazetteX(file('28300', [60, 70]), now - 2) });
  });
  afterAll(async () => {
    await app.close();
  });

  it('an earlier file saved by its examination year alone is analysed and joins the five years', async () => {
    const past = await withMigrator((c) =>
      c.query<{ n: number; ay: number }>(
        `SELECT count(*)::int AS n, count(academic_year_id)::int AS ay FROM board_candidates WHERE school_id = $1 AND exam_year = $2`,
        [school.id, now - 2],
      ),
    );
    expect(past.rows[0]).toEqual({ n: 2, ay: 0 });
    const v = await view();
    expect(v.examYear).toBe(now);
    expect(v.years).toEqual([now, now - 2]);
    const years = tableOf(v, 1, 'years');
    expect(years.columns.map((c) => c.key)).toEqual([
      'label',
      `y${String(now - 2)}`,
      `y${String(now)}`,
    ]);
    expect(years.rows[0]).toMatchObject({ [`y${String(now - 2)}`]: 2, [`y${String(now)}`]: 3 });
    expect(years.rows[3]).toMatchObject({ [`y${String(now - 2)}`]: 65, [`y${String(now)}`]: 80 });
    const old = await view(`&examYear=${String(now - 2)}`);
    expect(
      old.analysis!.annexures[0]!.tables.find((t) => t.key === 'summary')!.rows[1],
    ).toMatchObject({
      value: 2,
    });
  });

  it("a lost year's figures typed in fill the five years, the trend and Annexure 5", async () => {
    const body = {
      classLabel: 'X',
      examYear: now - 1,
      registered: 41,
      appeared: 40,
      passed: 39,
      n90: 4,
      n75: 20,
      aggregate: 72.5,
      pi: 61.25,
      subjects: [
        {
          code: '184',
          appeared: 40,
          highest: 97,
          aGrades: 12,
          compartments: 0,
          failures: 1,
          distinctions: 22,
          average: 74.5,
          pi: 63,
        },
        {
          code: '041',
          appeared: 40,
          highest: 100,
          aGrades: 9,
          failures: 2,
          distinctions: 15,
          average: 66,
        },
      ],
      note: 'From the old workbook',
    };
    expect((await put('/exams/board-results/year-figures', body, auditor)).statusCode).toBe(403);
    expect((await put('/exams/board-results/year-figures', { ...body, n90: 30 })).statusCode).toBe(
      400,
    );
    // a year whose file is saved takes its figures from the file
    expect(
      (await put('/exams/board-results/year-figures', { ...body, examYear: now - 2 })).statusCode,
    ).toBe(409);
    const r = await put('/exams/board-results/year-figures', body);
    expect(r.statusCode).toBe(200);
    expect(r.json().inserted).toBe(true);
    typedId = r.json().id as string;
    // saving again corrects it
    expect(
      (await put('/exams/board-results/year-figures', { ...body, aggregate: 72.75 })).json()
        .inserted,
    ).toBe(false);
    const list = (await get('/exams/board-results/year-figures?classLabel=X', auditor)).json();
    expect(list.rows).toEqual([
      expect.objectContaining({
        examYear: now - 1,
        appeared: 40,
        aggregate: 72.75,
        fileSaved: false,
      }),
    ]);
    expect(list.rows[0].subjects).toHaveLength(2);

    const v = await view();
    const years = tableOf(v, 1, 'years');
    expect(years.columns.map((c) => c.key)).toEqual([
      'label',
      `y${String(now - 2)}`,
      `y${String(now - 1)}`,
      `y${String(now)}`,
    ]);
    // 90% and above: 4 of 40 = 10%; the aggregate as typed
    expect(years.rows[1]).toMatchObject({ [`y${String(now - 1)}`]: 10 });
    expect(years.rows[3]).toMatchObject({ [`y${String(now - 1)}`]: 72.75 });
    const trend = v.analysis!.annexures[11]!.tables;
    expect(trend[0]!.rows.map((x) => x.year)).toHaveLength(3);
    expect(trend[0]!.rows[1]).toMatchObject({ passPct: 97.5, pi: 61.25 });
    expect(
      trend[1]!.rows.find((x) => x.subject === 'English Language and Literature'),
    ).toMatchObject({
      [`y${String(now - 1)}`]: 63,
    });
    // Annexure 5: this year against the typed year
    const eng = tableOf(v, 5, 'compare').rows.find(
      (x) => x.subject === 'English Language and Literature',
    )!;
    expect(eng).toMatchObject({
      appL: 40,
      hiL: 97,
      aL: 12,
      failL: 1,
      distL: 22,
      avgL: 74.5,
      appN: 3,
      avgN: 80,
    });
    // one section: typed figures are the whole class's, so they are left out
    await withMigrator((c) =>
      c.query(`UPDATE board_candidates SET section = 'A' WHERE school_id = $1`, [school.id]),
    );
    const one = await view('&section=A');
    expect(tableOf(one, 1, 'years').columns.map((c) => c.key)).not.toContain(`y${String(now - 1)}`);
  });

  it('removing the typed year takes it out again', async () => {
    expect(
      (
        await inject({
          method: 'DELETE',
          url: `/exams/board-results/year-figures/${typedId}`,
          headers: h(auditor),
        })
      ).statusCode,
    ).toBe(403);
    const d = await inject({
      method: 'DELETE',
      url: `/exams/board-results/year-figures/${typedId}`,
      headers: h(),
    });
    expect(d.json()).toEqual({ removed: true });
    const v = await view();
    expect(tableOf(v, 1, 'years').columns).toHaveLength(3);
    expect(tableOf(v, 5, 'compare').rows[0]).toMatchObject({ appL: null });
    const audit = await withMigrator((c) =>
      c.query<{ action: string }>(
        `SELECT action FROM audit_logs WHERE school_id = $1 AND action LIKE 'exams.board_result.year_figures%' ORDER BY id`,
        [school.id],
      ),
    );
    expect(audit.rows.map((x) => x.action)).toEqual([
      'exams.board_result.year_figures',
      'exams.board_result.year_figures',
      'exams.board_result.year_figures_remove',
    ]);
  });

  it('Reports: the Range Wise Subject Summary against the earlier saved year, as Excel and PDF', async () => {
    const r = await get('/exams/board-results/reports/range-subjects?classLabel=X&compare=1');
    expect(r.statusCode).toBe(200);
    const d = r.json() as {
      summary: {
        years: number[];
        blocks: Array<{
          code: string;
          rows: Array<{
            key: string;
            values: Record<string, { count: number | null; pct: number | null }>;
          }>;
        }>;
      };
    };
    expect(d.summary.years).toEqual([now - 2, now]);
    const eng = d.summary.blocks.find((b) => b.code === '184')!;
    const row = (k: string) => eng.rows.find((x) => x.key === k)!.values;
    expect(row('appeared')[String(now)]!.count).toBe(3);
    expect(row('appeared')[String(now - 2)]!.count).toBe(2);
    // marks 90, 80 and 70: two distinctions (75 and above) and one 1st division
    expect(row('distinction')[String(now)]).toEqual({ count: 2, pct: 66.67 });
    expect(row('first')[String(now)]).toEqual({ count: 1, pct: 33.33 });
    expect(row('average')[String(now - 2)]!.count).toBe(65);
    // girls only: two this year (the 1st and 3rd), one two years back
    const girls = (
      await get(
        '/exams/board-results/reports/range-subjects?classLabel=X&compare=1&gender=F&code=184',
      )
    ).json();
    expect(girls.summary.blocks).toHaveLength(1);
    expect(
      girls.summary.blocks[0].rows.find((x: { key: string }) => x.key === 'appeared').values[
        String(now)
      ].count,
    ).toBe(2);
    const x = await get(
      '/exams/board-results/reports/range-subjects/file?classLabel=X&compare=1&format=xlsx',
    );
    expect(x.statusCode).toBe(200);
    expect(x.json().filename).toMatch(/range-wise-subject-summary\.xlsx$/);
    const p = await get(
      '/exams/board-results/reports/range-subjects/file?classLabel=X&compare=1&format=pdf',
    );
    expect(
      Buffer.from(p.json().base64 as string, 'base64')
        .subarray(0, 4)
        .toString(),
    ).toBe('%PDF');
    expect(
      (await get('/exams/board-results/reports/range-subjects?classLabel=X', auditor)).statusCode,
    ).toBe(200);
  });
});
