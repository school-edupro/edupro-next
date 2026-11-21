/**
 * The assistant with Claude's help (docs/design/93, phase B; 0412), against a fake Claude API on this machine (no
 * real calls, no cost): off until the school switches it on; families cannot be switched on yet; a question the
 * matcher places stays local; one it cannot place goes to Claude with only the person's approved queries as tools;
 * EduPro runs Claude's choice with the person's rights and keeps the card, the screen and the follow-ups; the answer is
 * marked as Claude's and audited with its tokens; a refusal or an error falls back to the matcher's reply; a question
 * about changing records never leaves EduPro; the school's month has a limit (Mobilise's, else the default).
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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

type Body = {
  model: string;
  system: Array<{ type: string; text: string; cache_control?: unknown }>;
  tools: Array<{ name: string; input_schema: { properties: Record<string, unknown> } }>;
  messages: Array<{ role: string; content: unknown }>;
  thinking?: unknown;
  output_config?: unknown;
  temperature?: number;
};

/** What the fake Claude does next: call a tool, then answer; refuse; fail. */
const plan: { mode: 'tool' | 'refuse' | 'fail'; tool: string; input: Record<string, unknown> } = {
  mode: 'tool',
  tool: 'list_classes',
  input: {},
};
const seen: Body[] = [];
let server: Server;

function fakeClaude(body: Body) {
  const last = body.messages[body.messages.length - 1]!;
  const base = {
    id: 'msg_fake',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    usage: { input_tokens: 400, output_tokens: 40, cache_read_input_tokens: 1000 },
  };
  if (plan.mode === 'refuse') return { ...base, stop_reason: 'refusal', content: [] };
  // after the tool's rows: an answer that names how many came back
  if (Array.isArray(last.content)) {
    const result = (last.content as Array<{ content: string }>)[0]!.content;
    const parsed = JSON.parse(result) as { count?: number; error?: string };
    return {
      ...base,
      stop_reason: 'end_turn',
      content: [
        {
          type: 'text',
          text: parsed.error
            ? `I could not read that: ${parsed.error}`
            : `Here are ${String(parsed.count)} records from Claude.`,
        },
      ],
    };
  }
  return {
    ...base,
    stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 'toolu_1', name: plan.tool, input: plan.input }],
  };
}

describe('the assistant with Claude’s help (e2e, docs/design/93 phase B)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let school: SeededSchool;
  let admin: SeededUser;
  let teacher: SeededUser;
  let parent: SeededUser;
  const saved: Record<string, string | undefined> = {};
  const h = (u: SeededUser) => headersFor(u.sub, school.id);
  const ask = async (u: SeededUser, question: string) => {
    const r = await inject({
      method: 'POST',
      url: '/insights/assistant',
      headers: h(u),
      json: { question, language: 'en' },
    });
    expect(r.statusCode).toBe(201);
    return r.json() as {
      answer: string;
      refused: boolean;
      by: string;
      provider: string;
      model: string;
      citations: Array<{ query: string }>;
      card: { kind: string } | null;
      link: { web: string | null } | null;
      followUps: unknown[];
      usage: { inputTokens: number; outputTokens: number };
      costPaise: number;
      conversationId: string;
    };
  };
  const settings = async () =>
    (
      await inject({ method: 'GET', url: '/insights/assistant/settings', headers: h(admin) })
    ).json() as {
      audiences: Record<string, boolean>;
      dailyLimit: number;
      topicsOff: Record<string, string[]>;
      starters: Record<string, string[]>;
      claude: Record<string, boolean>;
      claudeInfo: {
        available: boolean;
        model: string;
        audiences: string[];
        monthlyLimit: number;
        limitBy: string;
        usedThisMonth: number;
      };
    };
  const save = async (claude: Record<string, boolean>) => {
    const s = await settings();
    return inject({
      method: 'PUT',
      url: '/insights/assistant/settings',
      headers: h(admin),
      json: {
        audiences: s.audiences,
        dailyLimit: 500,
        topicsOff: s.topicsOff,
        starters: s.starters,
        claude,
      },
    });
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        const body = JSON.parse(raw) as Body;
        seen.push(body);
        if (plan.mode === 'fail') {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ type: 'error', error: { type: 'api_error', message: 'boom' } }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(fakeClaude(body)));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    for (const k of [
      'AI_PROVIDER',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_BASE_URL',
      'AI_CLAUDE_MONTHLY_QUESTIONS',
      'AI_MODEL',
    ])
      saved[k] = process.env[k];
    process.env.AI_PROVIDER = 'hybrid';
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${String(port)}`;
    process.env.AI_CLAUDE_MONTHLY_QUESTIONS = '4';
    delete process.env.AI_MODEL;

    const s = stamp('CL');
    await withMigrator(async (c) => {
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`);
      parent = await seedUser(c, school, `${s}-parent`, 'parent', 'guardian');
      await c.query(
        `INSERT INTO employees (school_id, employee_code, first_name, last_name, user_id) VALUES ($1, 'CL01', 'Claude', 'Teacher', $2)`,
        [school.id, teacher.id],
      );
    });
    app = await createApp();
    inject = injector(app);
    const cls = await inject({
      method: 'POST',
      url: '/academics/classes',
      headers: h(admin),
      json: { code: 'VI', name: 'Class VI', displayOrder: 6 },
    });
    const sec = await inject({
      method: 'POST',
      url: `/academics/classes/${cls.json().id}/sections`,
      headers: h(admin),
      json: { name: 'A' },
    });
    const emps = (
      await inject({ method: 'GET', url: '/people/employees?size=5', headers: h(admin) })
    ).json().data as Array<{ id: string; employeeCode: string }>;
    await inject({
      method: 'POST',
      url: '/academics/teacher-assignments',
      headers: h(admin),
      json: {
        employeeId: emps.find((e) => e.employeeCode === 'CL01')!.id,
        classSectionId: sec.json().id,
        kind: 'class_teacher',
      },
    });
    for (const [first, no] of [
      ['Asha', '1'],
      ['Ravi', '2'],
    ] as const) {
      const st = await inject({
        method: 'POST',
        url: '/people/students',
        headers: h(admin),
        json: {
          admissionNo: `${s}-${no}`,
          firstName: first,
          lastName: 'Claude',
          guardians: [
            {
              guardian: { firstName: 'Mina', lastName: 'Claude', mobile: `98765000${no}9` },
              relation: 'mother',
              isPrimary: true,
            },
          ],
          enrolment: { classSectionId: sec.json().id, rollNo: Number(no) },
        },
      });
      expect(st.statusCode).toBe(201);
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [k, v] of Object.entries(saved))
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
  });

  it('off until the school switches it on; families cannot be switched on yet', async () => {
    const s = await settings();
    expect(s.claude).toEqual({ student: false, parent: false, teacher: false, admin: false });
    expect(s.claudeInfo).toMatchObject({
      available: true,
      model: 'claude-haiku-5-5',
      audiences: ['teacher', 'admin'],
      monthlyLimit: 4,
      limitBy: 'default',
      usedThisMonth: 0,
    });
    const off = await ask(admin, 'how is the weather of the solar system cohort zzq');
    expect(off.by).toBe('local');
    expect(seen).toHaveLength(0);
    const bad = await save({ student: false, parent: true, teacher: true, admin: true });
    expect(bad.statusCode).toBe(400);
    expect(JSON.stringify(bad.json())).toContain('consent must name Anthropic');
    expect(
      (await save({ student: false, parent: false, teacher: true, admin: true })).statusCode,
    ).toBe(200);
  });

  it('a question the matcher places stays local; one it cannot place goes to Claude', async () => {
    const local = await ask(admin, 'list of classes and sections');
    expect(local.by).toBe('local');
    expect(seen).toHaveLength(0);

    plan.mode = 'tool';
    plan.tool = 'find_student';
    plan.input = { q: 'Asha' };
    const a = await ask(admin, 'could you dig up the kid called Asha for me please');
    expect(a).toMatchObject({
      by: 'claude',
      provider: 'claude',
      model: 'claude-haiku-5-5',
      refused: false,
    });
    expect(a.answer).toBe('Here are 1 records from Claude.');
    expect(a.citations.map((c) => c.query)).toEqual(['find_student']);
    expect(a.card).toMatchObject({ kind: 'table' });
    expect(a.link?.web).toBe('/people/search');
    expect(a.followUps.length).toBeGreaterThan(0);
    expect(a.usage.inputTokens).toBeGreaterThan(0);
    expect(a.costPaise).toBeGreaterThanOrEqual(0);

    // the request: Haiku 5.5, no thinking, low effort, no temperature, the rules cached, the admin's queries only
    const first = seen[0]!;
    expect(first.model).toBe('claude-haiku-5-5');
    expect(first.thinking).toEqual({ type: 'disabled' });
    expect(first.output_config).toEqual({ effort: 'low' });
    expect(first).not.toHaveProperty('temperature');
    expect(first.system[0]!.cache_control).toEqual({ type: 'ephemeral' });
    expect(first.system[0]!.text).toMatch(/Never invent a number/);
    const names = first.tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['find_student', 'fee_defaulters']));
    expect(names).not.toContain('child_dues');
    // inputs as words, never ids
    const absentees = first.tools.find((t) => t.name === 'absentees_of_day')!;
    expect(Object.keys(absentees.input_schema.properties)).toEqual(
      expect.arrayContaining(['date', 'section']),
    );
    // the rows that went back: no guardian's number
    expect(JSON.stringify(seen[1]!.messages)).not.toMatch(/98765000\d9/);

    // kept in the conversation with its author, audited with the provider
    const conv = await inject({
      method: 'GET',
      url: `/insights/assistant/conversations/${a.conversationId}`,
      headers: h(admin),
    });
    const said = (
      conv.json().messages as Array<{ role: string; display: { by: string } | null }>
    ).find((m) => m.role === 'assistant')!;
    expect(said.display?.by).toBe('claude');
    const audit = await withMigrator((c) =>
      c.query<{ provider: string; kind: string; input_tokens: number | null }>(
        `SELECT provider, kind, input_tokens FROM ai_audit WHERE school_id = $1 AND conversation_id = $2 ORDER BY id`,
        [school.id, a.conversationId],
      ),
    );
    expect(audit.rows.every((r) => r.provider === 'claude')).toBe(true);
    expect(audit.rows.find((r) => r.kind === 'answer')!.input_tokens).toBeGreaterThan(0);
  });

  it('a section in words; a teacher gets only their own queries', async () => {
    seen.length = 0;
    plan.tool = 'my_absentees';
    plan.input = {};
    const t = await ask(teacher, 'blorp frumble about my lot please kindly zzq');
    expect(t.by).toBe('claude');
    const names = seen[0]!.tools.map((x) => x.name);
    expect(names).toContain('my_absentees');
    expect(names).not.toContain('fee_defaulters');
    expect(seen[0]!.system[0]!.text).toMatch(/a teacher/);

    seen.length = 0;
    plan.tool = 'absentees_of_day';
    plan.input = { section: 'VI - A' };
    const a = await ask(admin, 'whoever skipped in that one group yesterday maybe zzq');
    expect(a.by).toBe('claude');
    expect(a.citations[0]).toMatchObject({ query: 'absentees_of_day' });
    // a section that does not exist: Claude hears why, nothing is invented
    seen.length = 0;
    plan.input = { section: 'XII-Z' };
    const z = await ask(admin, 'whoever skipped in the other group maybe zzq');
    expect(z.answer).toMatch(/No section "XII-Z"/);
    expect(z.citations).toEqual([]);
  });

  it('a refusal or an error falls back to the matcher’s reply; changing records never leaves EduPro', async () => {
    plan.mode = 'refuse';
    const r = await ask(admin, 'something odd nobody asks zzq');
    expect(r.by).toBe('local');
    expect(r.refused).toBe(true);
    plan.mode = 'fail';
    const f = await ask(admin, 'another odd thing nobody asks zzq');
    expect(f.by).toBe('local');
    plan.mode = 'tool';
    seen.length = 0;
    const d = await ask(admin, 'delete all attendance of today');
    expect(d.by).toBe('local');
    expect(seen).toHaveLength(0);
  });

  it('the school’s month: the default limit, then Mobilise’s own for the school', async () => {
    // four Claude answers so far (the limit is 4): the next stays local without a call
    expect((await settings()).claudeInfo.usedThisMonth).toBe(4);
    seen.length = 0;
    plan.tool = 'list_classes';
    plan.input = {};
    const over = await ask(admin, 'one more odd question zzq');
    expect(over.by).toBe('local');
    expect(seen).toHaveLength(0);
    // Mobilise raises this school's limit (as the database owner: the school's API cannot)
    await withMigrator((c) =>
      c.query(`UPDATE assistant_settings SET claude_monthly_limit = 10 WHERE school_id = $1`, [
        school.id,
      ]),
    );
    expect((await settings()).claudeInfo).toMatchObject({ monthlyLimit: 10, limitBy: 'school' });
    expect((await ask(admin, 'one more odd question again zzq')).by).toBe('claude');
    // a parent never reaches Claude (families are not switched on)
    seen.length = 0;
    await withMigrator((c) =>
      c.query(`UPDATE guardians SET user_id = $1 WHERE mobile = '9876500019' AND school_id = $2`, [
        parent.id,
        school.id,
      ]),
    );
    await inject({
      method: 'POST',
      url: '/comms/consents/mine',
      headers: h(parent),
      json: { purposeCode: 'ai.assistant', status: 'granted' },
    });
    expect((await ask(parent, 'some odd family question zzq')).by).toBe('local');
    expect(seen).toHaveLength(0);
  });
});
