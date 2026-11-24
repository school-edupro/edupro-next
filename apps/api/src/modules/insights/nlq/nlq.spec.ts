/**
 * docs/design/103: the checks on a query the AI model wrote, and the answer made from a result (blanks, formats,
 * charts). Every value here is made up.
 */
import { autoChart, fillBlanks, fitChart, formatValue, tableColumns } from './nlq-answer';
import { matchingExample, pickViews, viewsFor, wordsOf, NLQ_VIEWS } from './nlq-catalogue';
import { checkNlqSql } from './nlq-sql';

describe('checkNlqSql: what a generated query may and may not do', () => {
  const ok = (sql: string) => expect(checkNlqSql(sql)).toMatchObject({ ok: true });
  const no = (sql: string, why: RegExp) => {
    const r = checkNlqSql(sql);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(why);
  };

  it('allows one SELECT or WITH over the views, with plain functions', () => {
    ok(
      'SELECT class, sum(amount) AS total FROM nlq.fee_receipts GROUP BY class ORDER BY total DESC LIMIT 200;',
    );
    ok(`WITH m AS (SELECT date_trunc('month', received_on)::date AS month, sum(amount) AS total FROM fee_receipts GROUP BY 1)
        SELECT month, total, lag(total) OVER (ORDER BY month) AS before FROM m`);
    ok(`SELECT count(*) FILTER (WHERE is_present) AS present, round(100.0 * avg(CASE WHEN is_present THEN 1 ELSE 0 END), 1)
        FROM nlq.attendance_days WHERE on_date = current_date AND class_section IN ('VI-A', 'VI-B')`);
    ok(
      `SELECT s.student_name FROM nlq.students s LEFT JOIN nlq.fee_bills b ON b.student_id = s.student_id WHERE s.is_current`,
    );
    // words that only look dangerous: inside text, or a column called "updated"
    ok(`SELECT 'please update; drop table' AS note_text FROM nlq.students -- delete me`);
  });

  it('refuses more than one statement, writes, control words and settings', () => {
    no('SELECT 1; SELECT 2', /one statement/);
    no('DELETE FROM nlq.students', /only a SELECT/);
    no('WITH d AS (DELETE FROM nlq.students RETURNING 1) SELECT * FROM d', /delete/);
    no('SELECT * INTO copy_of FROM nlq.students', /into/);
    no(`SELECT set_config('app.school_id', '2', true)`, /set_config/);
    no(`SELECT current_setting('app.school_id')`, /current_setting/);
    no(`SELECT query_to_xml('select 1', true, false, '')`, /query_to_xml/);
    no('SELECT pg_sleep(30)', /pg_sleep/);
    no('SET ROLE edupro_app', /only a SELECT/);
    no('SELECT * FROM nlq.students FOR UPDATE', /update/);
    no('SELECT $x$hidden$x$', /dollar/);
  });

  it('refuses every schema but nlq, however it is written', () => {
    no('SELECT * FROM public.students', /public/);
    no('SELECT * FROM "public"."students"', /public/);
    no('SELECT * FROM app.nlq_context', /app/);
    no('SELECT * FROM mart.fee_dues', /mart/);
    no('SELECT * FROM pg_catalog.pg_roles', /pg_/);
    no('SELECT * FROM information_schema.tables', /information_schema/);
    no('SELECT app.nlq_school_id()', /app/);
    no('SELECT nlq.anything(1)', /function anything/);
  });

  it('refuses broken quoting rather than guess', () => {
    no("SELECT 'not closed FROM nlq.students", /not closed/);
    no('SELECT 1 /* not closed', /not closed/);
    no('', /empty/);
  });
});

describe('the answer made from a result', () => {
  const rows = [
    { class: 'Class VI', total: 48200, pupils: 40, share: 41.5 },
    { class: 'Class VII', total: 62100, pupils: 38, share: 53.4 },
    { class: 'Class VIII', total: '5800.50', pupils: 6, share: 5.1 },
  ];
  const kinds = { class: 'label', total: 'money', pupils: 'count', share: 'percent' } as const;

  it('fills blanks from the rows, formatted (₹ with Indian grouping, %, counts)', () => {
    expect(fillBlanks('Collected {total:total} from {count} classes.', rows, kinds)).toBe(
      'Collected ₹1,16,100.50 from 3 classes.',
    );
    expect(fillBlanks('{top:class:total} collected the most ({max:total}).', rows, kinds)).toBe(
      'Class VII collected the most (₹62,100).',
    );
    expect(
      fillBlanks(
        '{bottom:class:pupils} has {min:pupils} pupils; average {average:share}.',
        rows,
        kinds,
      ),
    ).toBe('Class VIII has 6 pupils; average 33.3%.');
    expect(fillBlanks('First: {first:class}.', rows, kinds)).toBe('First: Class VI.');
  });

  it('leaves a sentence out when a blank cannot be filled', () => {
    expect(fillBlanks('{total:missing} in all.', rows, kinds)).toBeNull();
    expect(fillBlanks('{guess:total}', rows, kinds)).toBeNull();
    expect(fillBlanks('{max:total}', [], kinds)).toBeNull();
  });

  it('formats dates, months and flags as people read them', () => {
    expect(formatValue('2026-11-24', 'date')).toBe('24 Nov 2026');
    expect(formatValue('2026-11-01', 'month')).toBe('Nov 2026');
    expect(formatValue(true, 'flag')).toBe('Yes');
    expect(formatValue(null, 'money')).toBe('—');
  });

  it('draws the chart asked for only when it fits the result', () => {
    expect(fitChart({ type: 'bar', x: 'class', y: ['total'] }, rows, kinds)).toEqual({
      type: 'bar',
      x: 'class',
      y: ['total'],
    });
    expect(fitChart({ type: 'pie', x: 'class', y: 'total' }, rows, kinds)).toMatchObject({
      type: 'donut',
    });
    expect(fitChart({ type: 'bar', x: 'nope', y: ['total'] }, rows, kinds)).toBeNull();
    expect(fitChart({ type: 'bar', x: 'class', y: ['class'] }, rows, kinds)).toBeNull();
    expect(fitChart({ type: 'stacked_bar', x: 'class', y: ['total'] }, rows, kinds)).toBeNull();
    expect(fitChart({ type: 'radar', x: 'class', y: ['total'] }, rows, kinds)).toBeNull();
    expect(autoChart(rows, kinds)).toEqual({
      type: 'bar',
      x: 'class',
      y: ['total', 'pupils', 'share'],
    });
    expect(tableColumns(rows, kinds).map((c) => c.type)).toEqual([
      'text',
      'money',
      'number',
      'number',
    ]);
  });
});

describe('which views a question is offered', () => {
  it('only the views the rights cover, the matching ones first, the core views always', () => {
    const fee = NLQ_VIEWS.find((v) => v.view === 'fee_receipts')!;
    const mine = viewsFor(new Set(fee.rights.slice(0, 1)));
    expect(mine.map((v) => v.view)).toContain('fee_receipts');
    expect(mine.map((v) => v.view)).not.toContain('payslips');
    expect(viewsFor(new Set())).toEqual([]);
    const all = viewsFor(new Set(NLQ_VIEWS.flatMap((v) => v.rights)));
    const picked = pickViews('fee collected by class this month', all).map((v) => v.view);
    expect(picked.slice(0, 3)).toContain('fee_receipts');
    expect(picked).toContain('students');
  });

  it('a checked question answers a question asked the same way', () => {
    const all = viewsFor(new Set(NLQ_VIEWS.flatMap((v) => v.rights)));
    const e = NLQ_VIEWS.find((v) => v.view === 'fee_receipts')!.examples[0]!;
    expect(matchingExample(e.question, all)?.sql).toBe(e.sql);
    expect(matchingExample('how is the weather', all)).toBeNull();
    expect([...wordsOf('Fees of classes')]).toEqual(expect.arrayContaining(['fee', 'class']));
  });
});
