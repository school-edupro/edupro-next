/**
 * docs/design/103 phase B: data questions in the chatbot. A made-up AI model writes one query over the nlq views;
 * EduPro checks it, runs it for the asker's school only and answers with figures, sentences (blanks filled from the
 * rows), a chart and the table. The model is told the views and the question — never a record. Refused queries get
 * one retry; a checked question needs no model; the school's switch and the person's rights decide what is offered.
 * The server-wide AI model row found at the start is put back at the end. Every name and number here is made up.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { encryptField } from '@edupro/db';
import catalogue from '../src/modules/insights/nlq/catalogue.json';
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

const TOKEN = 'fake-nlq1';
const GOOD = {
  sql: 'SELECT class, sum(amount) AS collected FROM nlq.fee_receipts GROUP BY class ORDER BY collected DESC',
  title: 'Fee collected by class',
  explain: 'From fee receipts that were not reversed or bounced, totalled by class.',
  figures: [{ label: 'Collected', value: '{total:collected}' }],
  text: [
    '{top:class:collected} collected the most ({max:collected}).',
    '{nonsense:collected} is left out.',
  ],
  chart: { type: 'bar', x: 'class', y: ['collected'] },
  columns: { collected: 'money' },
};

describe('data questions in the chatbot (docs/design/103 phase B)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let server: Server;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let saved: Record<string, unknown> | null = null;
  const prompts: string[] = [];
  const env: Record<string, string | undefined> = {};
  const s = stamp('NLQC');

  const ask = (who: SeededUser, question: string) =>
    inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: headersFor(who.sub, school.id),
      json: { question, language: 'en' },
    });
  const settings = (nlq: boolean) =>
    inject({
      method: 'GET',
      url: '/insights/assistant/settings',
      headers: headersFor(admin.sub, school.id),
    }).then((r) => {
      const now = r.json() as { topicsOff: unknown; starters: unknown };
      return inject({
        method: 'PUT',
        url: '/insights/assistant/settings',
        headers: headersFor(admin.sub, school.id),
        json: {
          audiences: { student: true, parent: true, teacher: true, admin: true },
          dailyLimit: 500,
          topicsOff: now.topicsOff,
          starters: now.starters,
          claude: { student: false, parent: false, teacher: false, admin: false },
          nlq,
        },
      });
    });

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const prompt = (JSON.parse(raw || '{}') as { prompt?: string }).prompt ?? '';
        prompts.push(prompt);
        const asked = /The question: (.*)/.exec(prompt)?.[1] ?? '';
        let reply: unknown = { none: true };
        if (prompt.includes('Your query could not run'))
          reply = asked.includes('stubborn')
            ? { ...GOOD, sql: `SELECT set_config('app.school_id', '1', true)` }
            : GOOD;
        else if (prompt.includes('The data views you may query')) {
          if (asked.includes('sneaky'))
            reply = { ...GOOD, sql: 'SELECT admission_no FROM public.students' };
          else if (asked.includes('stubborn'))
            reply = { ...GOOD, sql: `SELECT set_config('app.school_id', '1', true)` };
          else if (asked.includes('wrong column'))
            reply = { ...GOOD, sql: 'SELECT nope FROM nlq.fee_receipts' };
          else if (asked.includes('salaries'))
            reply = { ...GOOD, sql: 'SELECT sum(net_pay) AS paid FROM nlq.payslips' };
          else if (asked.includes('per class')) reply = GOOD;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ response: JSON.stringify(reply) }));
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    await withMigrator(async (c) => {
      saved = (await c.query('SELECT * FROM ai_model_settings WHERE id = 1')).rows[0] ?? null;
      await c.query('DELETE FROM ai_model_settings');
      await c.query(
        `INSERT INTO ai_model_settings (id, url, token, token_last4, timeout_seconds, is_on) VALUES (1, $1, $2, $3, 10, true)`,
        [`${base}/v1/chat`, encryptField(TOKEN), TOKEN.slice(-4)],
      );
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
      const cls = await c.query<{ id: string }>(
        `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, 'VI', 'Class VI', 6) RETURNING id::text`,
        [school.id],
      );
      const sec = await c.query<{ id: string }>(
        `INSERT INTO class_sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id::text`,
        [school.id, school.yearId, cls.rows[0]!.id],
      );
      const cls7 = await c.query<{ id: string }>(
        `INSERT INTO classes (school_id, code, name, display_order) VALUES ($1, 'VII', 'Class VII', 7) RETURNING id::text`,
        [school.id],
      );
      const sec7 = await c.query<{ id: string }>(
        `INSERT INTO class_sections (school_id, academic_year_id, class_id, name) VALUES ($1, $2, $3, 'A') RETURNING id::text`,
        [school.id, school.yearId, cls7.rows[0]!.id],
      );
      for (const [no, amounts, section] of [
        ['1', [1200, 900], sec],
        ['2', [800], sec],
        ['3', [500], sec7],
      ] as const) {
        const st = await c.query<{ id: string }>(
          `INSERT INTO students (school_id, admission_no, first_name, gender) VALUES ($1, $2, 'Pupil', 'female') RETURNING id::text`,
          [school.id, `${s}-${no}`],
        );
        await c.query(
          `INSERT INTO enrolments (school_id, student_id, academic_year_id, class_section_id, roll_no, status) VALUES ($1, $2, $3, $4, $5, 'active')`,
          [school.id, st.rows[0]!.id, school.yearId, section.rows[0]!.id, Number(no)],
        );
        for (const [i, amount] of amounts.entries())
          await c.query(
            `INSERT INTO fee_payments (school_id, student_id, academic_year_id, amount, received_on, mode, status)
             VALUES ($1, $2, $3, $4, '2026-07-10', 'cash', $5)`,
            // the second receipt of the first pupil was reversed: it never counts
            [school.id, st.rows[0]!.id, school.yearId, amount, i === 1 ? 'reversed' : 'posted'],
          );
      }
    });
    for (const k of ['AI_PROVIDER', 'AI_CLAUDE_MONTHLY_QUESTIONS', 'AI_MODEL', 'ANTHROPIC_API_KEY'])
      env[k] = process.env[k];
    process.env.AI_PROVIDER = 'hybrid';
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.AI_CLAUDE_MONTHLY_QUESTIONS = '50';
    delete process.env.AI_MODEL;
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((r) => server.close(() => r()));
    await withMigrator(async (c) => {
      await c.query('DELETE FROM ai_model_settings');
      if (saved) {
        const cols = Object.keys(saved);
        await c.query(
          `INSERT INTO ai_model_settings (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
          Object.values(saved),
        );
      }
      await c.query(`UPDATE schools SET status = 'inactive' WHERE code = $1`, [`${s}A`]);
    });
    for (const [k, v] of Object.entries(env))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });

  it('off until the school turns it on: nothing goes to the model', async () => {
    expect((await settings(false)).statusCode).toBe(200);
    prompts.length = 0;
    const r = await ask(admin, 'break down the money collected per class for me');
    expect(r.json().by).toBe('local');
    expect(prompts).toHaveLength(0);
  });

  it('switched on: figures, sentences with the real numbers, a chart and the table — no record sent', async () => {
    expect((await settings(true)).statusCode).toBe(200);
    prompts.length = 0;
    const r = await ask(admin, 'break down the money collected per class for me');
    expect(r.statusCode).toBe(201);
    const body = r.json();
    expect(body).toMatchObject({
      by: 'llm',
      answer: 'Fee collected by class',
      card: {
        kind: 'data',
        title: 'Fee collected by class',
        explain: GOOD.explain,
        figures: [{ label: 'Collected', value: '₹2,500' }],
        // the sentence whose blank cannot be filled is left out
        text: ['Class VI collected the most (₹2,000).'],
        chart: { type: 'bar', x: 'class', y: ['collected'] },
        rows: [
          { class: 'Class VI', collected: 2000 },
          { class: 'Class VII', collected: 500 },
        ],
        more: 0,
        checked: false,
      },
    });
    expect(body.citations).toEqual([expect.objectContaining({ query: 'nlq', rows: 2 })]);
    // the model was told the views (their descriptions) and the question — no admission number, no amount
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('nlq.fee_receipts');
    expect(prompts[0]).toContain('Never write a number, name or date yourself');
    expect(prompts[0]).not.toContain(`${s}-1`);
    expect(prompts[0]).not.toContain('1200');
    // the query is in the audit
    const audit = await withMigrator(
      async (c) =>
        (
          await c.query<{ text: string }>(
            `SELECT text FROM ai_audit WHERE school_id = $1 AND kind = 'tool' ORDER BY at DESC LIMIT 1`,
            [school.id],
          )
        ).rows[0]?.text,
    );
    expect(audit).toBe(GOOD.sql);
  });

  it('a query outside the views is refused before it runs; one retry, told why', async () => {
    prompts.length = 0;
    const r = await ask(admin, 'a sneaky question about collections per class');
    expect(r.json()).toMatchObject({
      by: 'llm',
      card: { kind: 'data', rows: [{ class: 'Class VI', collected: 2000 }, {}] },
    });
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain(
      'Your query could not run: only the nlq views may be read, not public.*',
    );
  });

  it("the database's own error is sent back once; a second bad query gets EduPro's own reply", async () => {
    prompts.length = 0;
    const fixed = await ask(admin, 'collections by a wrong column please');
    expect(fixed.json()).toMatchObject({ by: 'llm', card: { kind: 'data' } });
    expect(prompts[1]).toContain('column "nope" does not exist');
    prompts.length = 0;
    const r = await ask(admin, 'a stubborn question about collections per month');
    expect(r.json().by).toBe('local');
    expect(JSON.stringify(r.json())).not.toContain('"kind":"data"');
    expect(prompts).toHaveLength(2);
  });

  it('a checked question is answered with its checked query — no model', async () => {
    const example = (
      catalogue as { views: Array<{ view: string; examples: Array<{ question: string }> }> }
    ).views.find((v) => v.view === 'fee_receipts')!.examples[0]!.question;
    prompts.length = 0;
    const r = await ask(admin, example);
    expect(r.json()).toMatchObject({ by: 'local', card: { kind: 'data', checked: true } });
    expect(prompts).toHaveLength(0);
  });

  it("only the views the person's rights cover are offered", async () => {
    prompts.length = 0;
    await ask(teacher, 'break down the money collected per class for me');
    // a class teacher may see pupils and attendance, not fee receipts (no heading, no example using it)
    expect(prompts.join('\n')).not.toMatch(/^nlq\.fee_receipts — /m);
    expect(prompts.join('\n')).not.toMatch(/SQL: .*fee_receipts/);
    expect(prompts.join('\n')).toMatch(/^nlq\.students — /m);
    // and a view not offered cannot be read by naming it: refused, the retry told why
    prompts.length = 0;
    const pay = await ask(teacher, 'total salaries paid per month');
    expect(pay.json().card?.kind).not.toBe('data');
    expect(prompts[1]).toContain('the view payslips is not open to this person');
  });
});
