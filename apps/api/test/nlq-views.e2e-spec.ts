/**
 * docs/design/103 phase A: the nlq views the chatbot's data questions read. Every view runs through app.nlq_run as the
 * chatbot will run it; it sees only the school the question was begun for (even when the query changes the session's
 * school); the role behind it reads nothing else and writes nothing; every view and column is described; no personal
 * detail (contacts, addresses, birth dates, ID numbers, health, notes) is a column; the catalogue matches the views.
 * Every name and number here is made up.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { seedSchool, stamp, withMigrator, type SeededSchool } from './helpers';

interface CatalogueView {
  view: string;
  area: string;
  oneRowIs: string;
  rights: string[];
  columns: Record<string, string>;
  examples: Array<{ question: string; sql: string }>;
}
const CATALOGUE = JSON.parse(
  readFileSync(resolve(__dirname, '../src/modules/insights/nlq/catalogue.json'), 'utf8'),
) as { views: CatalogueView[] };

/** column names that would carry personal details the views must leave out */
const FORBIDDEN =
  /(mobile|phone|e_?mail|address|dob|birth|aadh?aar|^pan$|pan_no|uan|bank|account_no|ifsc|religion|caste|disab|allerg|medical|diagnos|photo|signature|password|secret|token|secure|^profile$|^details$|remark|_note|^notes?$|reason|^body$|guardian_name|father|mother)/i;
const KINDS = [
  'id',
  'label',
  'text',
  'date',
  'month',
  'money',
  'number',
  'count',
  'percent',
  'flag',
];

describe('the nlq views (docs/design/103 phase A)', () => {
  let a: SeededSchool;
  let b: SeededSchool;
  const s = stamp('NLQ');
  /** one app connection for every question, as the API's pool would reuse one */
  let app: Client;

  /** a data question as the chatbot runs it: the school's context, begun, read-only, limited, rolled back */
  async function ask(
    school: SeededSchool,
    sql: string,
    begin = true,
  ): Promise<Record<string, unknown>[]> {
    const c = app;
    try {
      await c.query('BEGIN');
      await c.query(
        `SELECT set_config('app.school_id', $1, true), set_config('app.user_id', '1', true)`,
        [school.id],
      );
      if (begin) await c.query('SELECT app.nlq_begin()');
      // the library limit's rule reads tables by name: cache the person's libraries first, as the chatbot does
      await c.query('SELECT app.my_libraries()');
      await c.query('SET LOCAL transaction_read_only = on');
      await c.query(`SET LOCAL statement_timeout = '15s'`);
      const r = await c.query<{ row: Record<string, unknown> }>(
        'SELECT app.nlq_run($1, 1000) AS row',
        [sql],
      );
      return r.rows.map((x) => x.row);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
    }
  }

  beforeAll(async () => {
    app = new Client({ connectionString: process.env.DATABASE_URL });
    await app.connect();
    await withMigrator(async (c) => {
      for (const [key, code] of [
        ['a', `${s}A`],
        ['b', `${s}B`],
      ] as const) {
        const school = await seedSchool(c, code);
        if (key === 'a') a = school;
        else b = school;
        const cls = await c.query<{ id: string }>(
          `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, 'VI', 'Class VI', 6) RETURNING id::text`,
          [school.id],
        );
        const sec = await c.query<{ id: string }>(
          `INSERT INTO class_sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id::text`,
          [school.id, school.yearId, cls.rows[0]!.id],
        );
        const st = await c.query<{ id: string }>(
          `INSERT INTO students (school_id, admission_no, first_name, last_name, gender) VALUES ($1, $2, 'Pupil', $3, 'female') RETURNING id::text`,
          [school.id, `${code}-1`, key.toUpperCase()],
        );
        await c.query(
          `INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, roll_no, status) VALUES ($1, $2, $3, $4, 1, 'active')`,
          [school.id, st.rows[0]!.id, school.yearId, sec.rows[0]!.id],
        );
        await c.query(
          `INSERT INTO employees (school_id, employee_code, first_name, last_name) VALUES ($1, $2, 'Staff', $3)`,
          [school.id, `${code}-E1`, key.toUpperCase()],
        );
        // a library copy, so the library limit's row rule runs over a real row
        const lib = await c.query<{ id: string }>(
          `INSERT INTO library_libraries (school_id, code, name) VALUES ($1, 'MAIN', 'Main library') RETURNING id::text`,
          [school.id],
        );
        const title = await c.query<{ id: string }>(
          `INSERT INTO library_titles (school_id, code, title) VALUES ($1, 'T1', 'A made-up book') RETURNING id::text`,
          [school.id],
        );
        await c.query(
          `INSERT INTO library_copies (school_id, title_id, library_id, accession_no, accessioned_on, status)
           VALUES ($1, $2, $3, 'ACC-1', '2026-06-01', 'available')`,
          [school.id, title.rows[0]!.id, lib.rows[0]!.id],
        );
      }
    });
  });

  afterAll(async () => {
    await app?.end();
    await withMigrator((c) =>
      c.query(`UPDATE schools SET status = 'inactive' WHERE code = ANY($1)`, [[`${s}A`, `${s}B`]]),
    );
  });

  it('every view runs as the chatbot runs it; the catalogue and the views match', async () => {
    const views = await withMigrator(async (c) =>
      (
        await c.query<{ v: string }>(
          `SELECT table_name AS v FROM information_schema.views WHERE table_schema = 'nlq' ORDER BY 1`,
        )
      ).rows.map((x) => x.v),
    );
    expect(views.length).toBeGreaterThanOrEqual(30);
    expect(CATALOGUE.views.map((v) => v.view).sort()).toEqual(views);
    for (const v of views) await expect(ask(a, `SELECT * FROM ${v}`)).resolves.toBeDefined();
  });

  it('a view sees only the school the question was begun for, whatever the query does', async () => {
    const mine = await ask(a, 'SELECT admission_no FROM students');
    expect(mine.map((r) => r.admission_no)).toEqual([`${a.code}-1`]);
    expect((await ask(b, 'SELECT admission_no FROM students')).map((r) => r.admission_no)).toEqual([
      `${b.code}-1`,
    ]);
    // the session's school switched to the other school inside the query: still only the begun school
    const tricked = await ask(
      a,
      `WITH x AS MATERIALIZED (SELECT set_config('app.school_id', '${b.id}', true) AS v)
       SELECT (SELECT v FROM x) AS now_set, admission_no FROM students`,
    );
    // (row-level security on the joined tables now follows the switched setting, so rows may vanish — never appear)
    expect(tricked.filter((r) => r.admission_no !== `${a.code}-1`)).toEqual([]);
    expect((await ask(a, 'SELECT employee_code FROM staff')).map((r) => r.employee_code)).toEqual([
      `${a.code}-E1`,
    ]);
    expect(
      (await ask(a, 'SELECT accession_no FROM library_copies')).map((r) => r.accession_no),
    ).toEqual(['ACC-1']);
  });

  it('the role behind a question reads nothing but the views and writes nothing', async () => {
    const refused = async (sql: string, begin = true) =>
      ask(a, sql, begin).then(
        () => 'ran',
        (e: Error) => e.message,
      );
    expect(await refused('SELECT count(*) FROM public.students')).toMatch(/permission denied/);
    expect(await refused('SELECT count(*) FROM app.nlq_context')).toMatch(/permission denied/);
    expect(await refused(`SELECT set_config('role', 'edupro_app', true)`)).toMatch(
      /security-definer/,
    );
    expect(
      await refused(`SELECT query_to_xml('SELECT count(*) FROM public.students', true, false, '')`),
    ).toMatch(/permission denied/);
    expect(await refused(`WITH d AS (DELETE FROM students RETURNING 1) SELECT * FROM d`)).toMatch(
      /data-modifying|read-only|permission/,
    );
    expect(await refused('SELECT 1', false)).toMatch(/no question in progress/);
    // edupro_nlq holds no privilege on any table outside nlq; a view granted to PUBLIC must run as its caller
    // (security_invoker), so through it edupro_nlq still reads nothing (provider_issues 0057, admission_waiting 0256)
    const grants = await withMigrator(async (c) =>
      (
        await c.query<{ t: string }>(
          `SELECT n.nspname || '.' || c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
              WHERE n.nspname NOT IN ('nlq', 'pg_catalog', 'information_schema') AND c.relkind IN ('r', 'p', 'v', 'm')
                AND has_table_privilege('edupro_nlq', c.oid, 'SELECT, INSERT, UPDATE, DELETE')
                AND NOT (c.relkind = 'v' AND 'security_invoker=true' = ANY (COALESCE(c.reloptions, '{}')))`,
        )
      ).rows.map((x) => x.t),
    );
    expect(grants).toEqual([]);
  });

  it('every view and column is described; no personal detail is a column; no jsonb or arrays', async () => {
    const cols = await withMigrator(
      async (c) =>
        (
          await c.query<{
            v: string;
            col: string;
            type: string;
            vc: string | null;
            cc: string | null;
          }>(
            `SELECT c.relname AS v, a.attname AS col, format_type(a.atttypid, a.atttypmod) AS type,
                    obj_description(c.oid, 'pg_class') AS vc, col_description(c.oid, a.attnum) AS cc
               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
               JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
              WHERE n.nspname = 'nlq' AND c.relkind = 'v'`,
          )
        ).rows,
    );
    expect(cols.filter((x) => !x.vc?.trim()).map((x) => x.v)).toEqual([]);
    expect(cols.filter((x) => !x.cc?.trim()).map((x) => `${x.v}.${x.col}`)).toEqual([]);
    expect(cols.filter((x) => FORBIDDEN.test(x.col)).map((x) => `${x.v}.${x.col}`)).toEqual([]);
    expect(cols.filter((x) => /json|\[\]/.test(x.type)).map((x) => `${x.v}.${x.col}`)).toEqual([]);
    expect(cols.filter((x) => x.col === 'school_id').map((x) => x.v)).toEqual([]);
    // the catalogue's columns are the view's columns, each with a known kind
    for (const v of CATALOGUE.views) {
      const real = cols.filter((x) => x.v === v.view).map((x) => x.col);
      expect([v.view, Object.keys(v.columns).sort()]).toEqual([v.view, [...real].sort()]);
      expect(Object.values(v.columns).filter((k) => !KINDS.includes(k))).toEqual([]);
    }
  });

  it('the views keep their counting rules (made-up rows: cancelled, deleted, reversed, subject periods, leave)', async () => {
    await withMigrator(async (c) => {
      const sec = await c.query<{ id: string }>(
        `SELECT cs.id::text FROM class_sections cs WHERE cs.school_id = $1 LIMIT 1`,
        [a.id],
      );
      const first = await c.query<{ id: string }>(
        `SELECT id::text FROM students WHERE school_id = $1 AND admission_no = $2`,
        [a.id, `${a.code}-1`],
      );
      // a pupil whose admission was cancelled, and a pupil removed from the register
      for (const [no, how] of [
        ['2', 'cancelled'],
        ['3', 'deleted'],
      ] as const) {
        const st = await c.query<{ id: string }>(
          `INSERT INTO students (school_id, admission_no, first_name, gender, deleted_at)
           VALUES ($1, $2, 'Other', 'male', CASE WHEN $3 = 'deleted' THEN now() END) RETURNING id::text`,
          [a.id, `${a.code}-${no}`, how],
        );
        await c.query(
          `INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, roll_no, status)
           VALUES ($1, $2, $3, $4, $5, CASE WHEN $6 = 'cancelled' THEN 'cancelled' ELSE 'active' END::enrolment_status)`,
          [a.id, st.rows[0]!.id, a.yearId, sec.rows[0]!.id, Number(no), how],
        );
      }
      // two receipts: one kept, one reversed
      for (const [amount, status] of [
        [1200, 'posted'],
        [900, 'reversed'],
      ] as const)
        await c.query(
          `INSERT INTO fee_payments (school_id, student_id, academic_year_id, amount, received_on, mode, status)
           VALUES ($1, $2, $3, $4, '2026-07-10', 'cash', $5)`,
          [a.id, first.rows[0]!.id, a.yearId, amount, status],
        );
      // a day register (present), a period register (absent) and a day on leave
      const subject = await c.query<{ id: string }>(
        `INSERT INTO subjects (school_id, code, name) VALUES ($1, 'MATH', 'Mathematics') RETURNING id::text`,
        [a.id],
      );
      for (const [on, kind, code] of [
        ['2026-07-06', 'day', 'P'],
        ['2026-07-06', 'subject', 'A'],
        ['2026-07-07', 'day', 'LV'],
      ] as const) {
        const ses = await c.query<{ id: string }>(
          `INSERT INTO attendance_sessions (school_id, academic_year_id, class_section_id, on_date, kind, subject_id, source)
           VALUES ($1, $2, $3, $4, $5::attendance_kind, CASE WHEN $5 = 'subject' THEN $6::bigint END, 'manual') RETURNING id::text`,
          [a.id, a.yearId, sec.rows[0]!.id, on, kind, subject.rows[0]!.id],
        );
        await c.query(
          `INSERT INTO attendance_marks (school_id, session_id, student_id, code, source)
           VALUES ($1, $2, $3, $4::attendance_code, 'manual')`,
          [a.id, ses.rows[0]!.id, first.rows[0]!.id, code],
        );
      }
    });
    // only the pupil still on the register, in the class of that year
    expect(
      await ask(a, 'SELECT admission_no, class_section, is_current FROM students ORDER BY 1'),
    ).toEqual([{ admission_no: `${a.code}-1`, class_section: 'VI-A', is_current: true }]);
    // the reversed receipt never counts
    expect(
      await ask(a, 'SELECT count(*)::int AS n, sum(amount)::numeric AS total FROM fee_receipts'),
    ).toEqual([{ n: 1, total: 1200 }]);
    // day registers only: the period register is not a school day; leave is not present
    expect(
      await ask(
        a,
        'SELECT on_date::text AS on_date, code, is_present FROM attendance_days ORDER BY on_date',
      ),
    ).toEqual([
      { on_date: '2026-07-06', code: 'P', is_present: true },
      { on_date: '2026-07-07', code: 'LV', is_present: false },
    ]);
  });

  it("the catalogue's rights exist; its examples run", async () => {
    const started = Date.now();
    const codes = await withMigrator(
      async (c) =>
        new Set(
          (await c.query<{ code: string }>('SELECT code FROM permissions')).rows.map((x) => x.code),
        ),
    );
    for (const v of CATALOGUE.views) {
      expect([v.view, v.rights.length > 0]).toEqual([v.view, true]);
      expect([v.view, v.rights.filter((r) => !codes.has(r))]).toEqual([v.view, []]);
      expect([v.view, v.examples.length >= 3]).toEqual([v.view, true]);
      for (const e of v.examples)
        await expect(ask(a, e.sql).then(() => `${v.view}: ok`)).resolves.toBe(`${v.view}: ok`);
    }
    expect(Date.now() - started).toBeLessThan(120_000);
  }, 300_000);
});
