/**
 * docs/design/101: an LLM of our own for all schools — the right only its holders pass on, the settings (the token
 * never returned), the test against a made-up model server. The settings are one row for the server: the row found
 * at the start is put back at the end. Every name, address and token here is made up.
 */
import { execFileSync } from 'node:child_process';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
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

const TOKEN = 'fake-7a1c';

describe('the AI model for all schools (e2e)', () => {
  let app: NestFastifyApplication;
  let inject: ReturnType<typeof injector>;
  let server: Server;
  let base = '';
  let school: SeededSchool;
  let admin: SeededUser;
  let holder: SeededUser;
  let teacher: SeededUser;
  let saved: Record<string, unknown> | null = null;
  const seen: Array<{ headers: IncomingHttpHeaders; body: unknown; url: string }> = [];
  /** what the made-up model answers next */
  let plan: 'response' | 'nested' | 'nothing' | 'fail' = 'response';
  const env: Record<string, string | undefined> = {};
  const s = stamp('AIM');
  const call = (
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    url: string,
    who: SeededUser,
    json?: unknown,
  ) => inject({ method, url, headers: headersFor(who.sub, school.id), ...(json ? { json } : {}) });

  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (d) => (raw += d));
      req.on('end', () => {
        seen.push({ headers: req.headers, body: JSON.parse(raw || 'null'), url: req.url ?? '' });
        // Claude's address (AI_BASE_URL points here): never to be called while the AI model is on
        if (req.url?.startsWith('/v1/messages') || plan === 'fail') {
          res.writeHead(500, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'not here' }));
          return;
        }
        if (req.headers.authorization !== `Bearer ${TOKEN}`) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'bad token' }));
          return;
        }
        const prompt = (JSON.parse(raw) as { prompt: string }).prompt;
        res.writeHead(200, { 'content-type': 'application/json' });
        // the assistant's two prompts and a report's facts (docs/design/101 phase B)
        if (prompt.includes('Reply with ONE line of JSON')) {
          // docs/design/102: a how-to question → a help topic offered; anything else → a free answer (ignored)
          const asked = /The question: (.*)/.exec(prompt)?.[1] ?? '';
          const topic = /- ((?:leave|faq)[#-][a-z0-9-]+):/.exec(prompt)?.[1];
          res.end(
            JSON.stringify({
              response:
                prompt.includes('- find_student:') && asked.includes('Asha')
                  ? 'Sure: {"query": "find_student", "inputs": {"q": "Asha"}}'
                  : prompt.includes('- my_children:') && asked.includes('kids')
                    ? '{"query": "my_children", "inputs": {}}'
                    : /how do i/i.test(asked) && topic
                      ? `{"help": "${topic}"}`
                      : '{"answer": "Decorators wrap functions."}',
            }),
          );
          return;
        }
        if (prompt.includes('The help text')) {
          res.end(JSON.stringify({ response: 'Open My leave and choose Apply.' }));
          return;
        }
        if (prompt.includes('The records from')) {
          res.end(JSON.stringify({ response: 'Here is what I found.' }));
          return;
        }
        if (prompt.includes('Facts (JSON)')) {
          res.end(JSON.stringify({ response: 'A steady week at the school.' }));
          return;
        }
        res.end(
          JSON.stringify(
            plan === 'response'
              ? { response: `You asked: ${prompt.slice(0, 40)}` }
              : plan === 'nested'
                ? { status: 'ok', out: { said: 'Nested words' } }
                : { status: 'ok' },
          ),
        );
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    await withMigrator(async (c) => {
      // the server's row as it was (put back at the end)
      saved = (await c.query('SELECT * FROM ai_model_settings WHERE id = 1')).rows[0] ?? null;
      await c.query('DELETE FROM ai_model_settings');
      school = await seedSchool(c, `${s}A`);
      admin = await seedUser(c, school, `${s}-admin`, 'school_admin');
      holder = await seedUser(c, school, `${s}-holder`, 'school_admin');
      teacher = await seedUser(c, school, `${s}-teacher`, 'class_teacher');
    });
    // Mobilise's first grant, as the database owner
    execFileSync(
      process.execPath,
      [resolve(__dirname, '../../../scripts/ai/ai-model-admin.mjs'), `${s}A`, holder.sub],
      { env: process.env, stdio: 'pipe' },
    );
    // Claude set up as in the dev .env, but at the made-up server: the AI model must keep it from being called
    for (const k of [
      'AI_PROVIDER',
      'ANTHROPIC_API_KEY',
      'AI_BASE_URL',
      'ANTHROPIC_BASE_URL',
      'AI_CLAUDE_MONTHLY_QUESTIONS',
      'AI_MODEL',
    ])
      env[k] = process.env[k];
    process.env.AI_PROVIDER = 'hybrid';
    process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
    process.env.AI_BASE_URL = base;
    process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:9';
    process.env.AI_CLAUDE_MONTHLY_QUESTIONS = '20';
    delete process.env.AI_MODEL;
    app = await createApp();
    inject = injector(app);
  });

  afterAll(async () => {
    await withMigrator(async (c) => {
      await c.query('DELETE FROM ai_model_settings');
      if (saved) {
        const cols = Object.keys(saved);
        await c.query(
          `INSERT INTO ai_model_settings (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${String(i + 1)}`).join(', ')})`,
          Object.values(saved),
        );
      }
    });
    await new Promise<void>((r) => server.close(() => r()));
    if (app) await app.close();
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('the first grant: the script gives the role; a school admin cannot give the right, take it, or give its role', async () => {
    const roles = (await call('GET', '/access/roles', admin)).json().data as Array<{
      id: string;
      code: string;
      permissions: string[];
    }>;
    const role = roles.find((r) => r.code === 'ai_model_admin');
    expect(role?.permissions).toEqual(['platform.ai_model.manage']);
    // a school admin: no new role with it, not added to a role, not taken from its role, its role not given
    const made = await call('POST', '/access/roles', admin, {
      code: 'my_ai',
      name: 'My AI',
      permissions: ['platform.ai_model.manage'],
    });
    expect(made.statusCode).toBe(403);
    expect(made.json()).toMatchObject({ type: 'access.holders_only' });
    const mine = await call('POST', '/access/roles', admin, {
      code: 'helpers',
      name: 'Helpers',
      permissions: ['platform.settings.view'],
    });
    expect(mine.statusCode).toBe(201);
    expect(
      (
        await call('PATCH', `/access/roles/${mine.json().id as string}`, admin, {
          permissions: ['platform.settings.view', 'platform.ai_model.manage'],
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('PATCH', `/access/roles/${role!.id}`, admin, { permissions: [] })).statusCode,
    ).toBe(403);
    const give = await call('POST', '/access/assignments', admin, {
      userId: admin.id,
      roleId: role!.id,
      reason: 'I want it',
    });
    expect(give.statusCode).toBe(403);
    expect(give.json()).toMatchObject({ type: 'access.holders_only' });
    // a holder may pass it on (and changes other rights of a role freely)
    expect(
      (
        await call('PATCH', `/access/roles/${mine.json().id as string}`, admin, {
          permissions: ['platform.settings.view', 'platform.settings.edit'],
        })
      ).statusCode,
    ).toBe(200);
    const passed = await call('POST', '/access/assignments', holder, {
      userId: teacher.id,
      roleId: role!.id,
      reason: 'Helps with the AI model',
    });
    expect(passed.statusCode).toBe(201);
    expect(
      (
        await call('POST', `/access/assignments/${passed.json().id as string}/revoke`, holder, {
          reason: 'Only for a day',
        })
      ).statusCode,
    ).toBeLessThan(300);
  });

  it('settings: only holders read and change them; the token is kept encrypted and never returned', async () => {
    // nothing set up yet
    expect((await call('GET', '/platform/ai-model', admin)).json()).toEqual({
      canManage: false,
      configured: false,
      on: false,
      settings: null,
    });
    expect(
      (
        await call('PUT', '/platform/ai-model', admin, {
          url: `${base}/v1/chat`,
          token: TOKEN,
          on: false,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (await call('POST', '/platform/ai-model/test', admin, { prompt: 'Hi' })).statusCode,
    ).toBe(403);
    // the holder: the token is needed the first time; the address is checked
    expect(
      (
        await call('PUT', '/platform/ai-model', holder, { url: `${base}/v1/chat`, on: false })
      ).json(),
    ).toMatchObject({ detail: 'Enter the token the first time' });
    for (const url of [
      'ftp://127.0.0.1/v1/chat',
      'http://user:pw@127.0.0.1/v1/chat',
      'not an address',
    ])
      expect([
        url,
        (await call('PUT', '/platform/ai-model', holder, { url, token: TOKEN, on: false }))
          .statusCode,
      ]).toEqual([url, 400]);
    const ok = await call('PUT', '/platform/ai-model', holder, {
      url: `${base}/v1/chat`,
      token: TOKEN,
      timeoutSeconds: 10,
      on: false,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.body).not.toContain(TOKEN);
    expect(ok.json()).toMatchObject({
      canManage: true,
      configured: true,
      on: false,
      settings: {
        url: `${base}/v1/chat`,
        tokenLast4: '7a1c',
        replyField: null,
        timeoutSeconds: 10,
      },
    });
    // stored encrypted; the audit has no token
    const row = await withMigrator(
      async (c) =>
        (await c.query<{ token: string }>('SELECT token FROM ai_model_settings')).rows[0]!,
    );
    expect(row.token.startsWith('v1:')).toBe(true);
    expect(row.token).not.toContain(TOKEN);
    const audit = await withMigrator(
      async (c) =>
        (
          await c.query<{ x: string }>(
            `SELECT row_to_json(a)::text AS x FROM audit_logs a WHERE school_id = $1 AND action = 'platform.ai_model.save'`,
            [school.id],
          )
        ).rows,
    );
    expect(audit.length).toBe(1);
    expect(audit[0]!.x).not.toContain(TOKEN);
    // the audit masks the token box itself
    expect(audit[0]!.x).toContain('"token": "***"');
    // others see whether it is set up, nothing more
    const other = await call('GET', '/platform/ai-model', admin);
    expect(other.json()).toEqual({ canManage: false, configured: true, on: false, settings: null });
  });

  it('the test panel: the saved model, its answer found, the raw reply, the last test kept; a refused token', async () => {
    seen.length = 0;
    const t = await call('POST', '/platform/ai-model/test', holder, {
      prompt: 'Explain Python decorators in 2 lines',
    });
    expect(t.statusCode).toBe(200);
    expect(t.json()).toMatchObject({
      ok: true,
      status: 200,
      reply: 'You asked: Explain Python decorators in 2 lines',
      field: 'response',
      problem: null,
    });
    expect(seen[0]).toMatchObject({
      url: '/v1/chat',
      body: { prompt: 'Explain Python decorators in 2 lines' },
    });
    expect(seen[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(seen[0]!.headers['content-type']).toBe('application/json');
    expect(
      (await call('GET', '/platform/ai-model', holder)).json().settings.lastTest,
    ).toMatchObject({
      ok: true,
      note: expect.stringMatching(/^Answered in \d+ ms \(from response\)$/),
    });
    // an answer somewhere else: found once the Reply field names it
    plan = 'nested';
    expect(
      (await call('POST', '/platform/ai-model/test', holder, { prompt: 'Hi' })).json(),
    ).toMatchObject({
      ok: false,
      problem: 'No answer found in the reply: set the Reply field',
      raw: '{"status":"ok","out":{"said":"Nested words"}}',
    });
    // the token kept when its box is left empty
    expect(
      (
        await call('PUT', '/platform/ai-model', holder, {
          url: `${base}/v1/chat`,
          token: '',
          replyField: 'out.said',
          on: false,
        })
      ).json().settings,
    ).toMatchObject({ tokenLast4: '7a1c', replyField: 'out.said', lastTest: null });
    expect(
      (await call('POST', '/platform/ai-model/test', holder, { prompt: 'Hi' })).json(),
    ).toMatchObject({
      ok: true,
      reply: 'Nested words',
      field: 'out.said',
    });
    // a wrong token: refused, said in words
    await call('PUT', '/platform/ai-model', holder, {
      url: `${base}/v1/chat`,
      token: 'fake-2nd',
      on: false,
    });
    const bad = await call('POST', '/platform/ai-model/test', holder, { prompt: 'Hi' });
    expect(bad.json()).toMatchObject({
      ok: false,
      status: 401,
      problem: 'The model refused the token (HTTP 401)',
    });
    expect(bad.body).not.toContain('fake-2nd');
    // nothing listening
    await call('PUT', '/platform/ai-model', holder, {
      url: 'http://127.0.0.1:9/v1/chat',
      token: TOKEN,
      on: false,
    });
    expect(
      (await call('POST', '/platform/ai-model/test', holder, { prompt: 'Hi' })).json().problem,
    ).toMatch(/^The model could not be reached/);
  });
  it('docs/design/101 phase B: the assistant asks the AI model (a query chosen, its rows, the answer), never Claude', async () => {
    plan = 'response';
    const saved1 = await call('PUT', '/platform/ai-model', holder, {
      url: `${base}/v1/chat`,
      token: TOKEN,
      replyField: '',
      on: true,
    });
    expect(saved1.json()).toMatchObject({ on: true, settings: { replyField: null } });
    const ask = (question: string) =>
      call('POST', '/insights/assistant', admin, { question, language: 'en' });
    const s1 = (await call('GET', '/insights/assistant/settings', admin)).json() as {
      audiences: Record<string, boolean>;
      topicsOff: unknown;
      starters: unknown;
      claudeInfo: Record<string, unknown>;
    };
    expect(s1.claudeInfo).toMatchObject({
      available: true,
      provider: 'llm',
      model: `llm@${base.slice('http://'.length)}`,
    });
    // the school has not switched it on: EduPro's own answer, nothing sent
    seen.length = 0;
    const off = await ask('could you dig up the kid called Asha for me please');
    expect(off.json().by).toBe('local');
    expect(seen).toHaveLength(0);
    // switched on for staff
    expect(
      (
        await call('PUT', '/insights/assistant/settings', admin, {
          audiences: s1.audiences,
          dailyLimit: 500,
          topicsOff: s1.topicsOff,
          starters: s1.starters,
          claude: { student: false, parent: false, teacher: true, admin: true },
        })
      ).statusCode,
    ).toBe(200);
    const a = await ask('could you dig up the kid called Asha for me please');
    expect(a.statusCode).toBe(201);
    expect(a.json()).toMatchObject({
      by: 'llm',
      provider: 'llm',
      refused: false,
      answer: 'Here is what I found.',
    });
    expect(
      (a.json() as { citations: Array<{ query: string }> }).citations.map((c) => c.query),
    ).toEqual(['find_student']);
    // two prompts: the queries and the question, then the rows; the token sent; Claude never called
    const prompts = seen.map((x) => (x.body as { prompt?: string } | null)?.prompt ?? '');
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain('The queries you may use');
    expect(prompts[0]).toContain('could you dig up the kid called Asha');
    expect(prompts[1]).toContain('The records from');
    expect(seen.every((x) => x.headers.authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(seen.some((x) => x.url.startsWith('/v1/messages'))).toBe(false);
    // counted in the school's monthly answers by an outside model
    expect(
      (
        (await call('GET', '/insights/assistant/settings', admin)).json() as {
          claudeInfo: { usedThisMonth: number };
        }
      ).claudeInfo.usedThisMonth,
    ).toBe(1);
    // the model down: EduPro's own answer, and still not Claude
    plan = 'fail';
    seen.length = 0;
    const down = await ask('could you dig up the kid called Asha for me again please');
    expect(down.json().by).toBe('local');
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.some((x) => x.url.startsWith('/v1/messages'))).toBe(false);
    plan = 'response';
  });

  it('docs/design/102 phase A: never the model\'s own words; "how do I …" from the help pages of the person\'s rights', async () => {
    plan = 'response';
    const ask = (who: SeededUser, question: string, surface?: 'admin' | 'teacher') =>
      call('POST', '/insights/assistant', who, {
        question,
        language: 'en',
        ...(surface ? { surface } : {}),
      });
    const prompts = () => seen.map((x) => (x.body as { prompt?: string } | null)?.prompt ?? '');
    // a question outside the school: the model's own sentence is never shown — EduPro's own reply
    seen.length = 0;
    const free = await ask(admin, 'Explain Python decorators in 2 lines');
    expect(free.statusCode).toBe(201);
    expect(free.json()).toMatchObject({ by: 'local', refused: true });
    expect(free.json().answer).not.toContain('Decorators');
    expect(free.json().answer).toContain('I can answer questions about your school records');
    expect(prompts()).toHaveLength(1);
    expect(prompts()[0]).toContain('Never answer in your own words');
    expect(prompts()[0]).toContain('never answer from your own knowledge');
    // a how-to question with a "change" word still reaches the model, which answers from the help page
    seen.length = 0;
    const how = await ask(admin, 'How do I change the approver of my leave?');
    expect(how.json()).toMatchObject({
      by: 'llm',
      refused: false,
      answer: 'Open My leave and choose Apply.',
    });
    const cited = (how.json() as { citations: Array<{ query: string }> }).citations.map(
      (c) => c.query,
    );
    expect(cited).toHaveLength(1);
    expect(cited[0]).toMatch(/^help:leave#[a-z0-9-]+$/);
    expect((how.json() as { link: { web: string } }).link.web).toBe(
      `/help/leave#${cited[0]!.split('#')[1]!}`,
    );
    expect(prompts()).toHaveLength(2);
    expect(prompts()[0]).toContain('The help topics on using EduPro');
    expect(prompts()[0]).toContain('- payroll#');
    expect(prompts()[1]).toContain('The help text "Leave & attendance (staff) › ');
    // a teacher: only the pages of their rights; from the teacher app, no link to the office website
    seen.length = 0;
    const t = await ask(teacher, 'How do I change the approver of my leave?', 'teacher');
    expect(t.json()).toMatchObject({ by: 'llm', link: null });
    expect(prompts()[0]).toContain('- leave#');
    expect(prompts()[0]).not.toContain('- payroll#');
    // help answers count as model answers
    expect(
      (
        (await call('GET', '/insights/assistant/settings', admin)).json() as {
          claudeInfo: { usedThisMonth: number };
        }
      ).claudeInfo.usedThisMonth,
    ).toBe(3);
  });

  it('docs/design/102 phase B: parents and students — the name first, the consent naming it, their own records only', async () => {
    plan = 'response';
    const p = stamp('AIMF');
    let parent!: SeededUser;
    let pupil!: SeededUser;
    await withMigrator(async (c) => {
      parent = await seedUser(c, school, `${p}-parent`, 'parent', 'guardian');
      pupil = await seedUser(c, school, `${p}-pupil`, 'student', 'student');
    });
    const cls = await call('POST', '/academics/classes', admin, {
      code: 'VII',
      name: 'Class VII',
      displayOrder: 7,
    });
    const sec = await call('POST', `/academics/classes/${String(cls.json().id)}/sections`, admin, {
      name: 'A',
    });
    const child = async (first: string, no: string, mobile?: string) => {
      const r = await call('POST', '/people/students', admin, {
        admissionNo: `${p}-${no}`,
        firstName: first,
        lastName: 'Made',
        guardians: mobile
          ? [
              {
                guardian: { firstName: 'Mina', lastName: 'Made', mobile },
                relation: 'mother',
                isPrimary: true,
              },
            ]
          : [],
        enrolment: { classSectionId: sec.json().id, rollNo: Number(no) },
      });
      expect(r.statusCode).toBe(201);
      return r.json().id as string;
    };
    const asha = await child('Asha', '1', '9876500077');
    await child('Bhanu', '2');
    await withMigrator(async (c) => {
      await c.query(
        `UPDATE guardians SET user_id = $1 WHERE mobile = '9876500077' AND school_id = $2`,
        [parent.id, school.id],
      );
      await c.query('UPDATE students SET user_id = $1 WHERE id = $2', [pupil.id, asha]);
    });
    type Setup = {
      topicsOff: unknown;
      starters: unknown;
      claudeInfo: { audiences: string[]; operator: string | null };
    };
    const setup = async () =>
      (await call('GET', '/insights/assistant/settings', admin)).json() as Setup;
    const saveSetup = async (claude: Record<string, boolean>) => {
      const now = await setup();
      return call('PUT', '/insights/assistant/settings', admin, {
        audiences: { student: true, parent: true, teacher: true, admin: true },
        dailyLimit: 500,
        topicsOff: now.topicsOff,
        starters: now.starters,
        claude,
      });
    };
    const everyone = { student: true, parent: true, teacher: true, admin: true };
    const name = (operator: string) =>
      call('PUT', '/platform/ai-model', holder, {
        url: `${base}/v1/chat`,
        token: '',
        replyField: '',
        on: true,
        operator,
      });
    const ask = (who: SeededUser, question: string) =>
      call('POST', '/insights/assistant', who, { question, language: 'en' });
    const start = async (who: SeededUser) =>
      (await call('GET', '/insights/assistant/start', who)).json() as {
        modelConsent: string | null;
      };
    const purposes = async (who: SeededUser) =>
      (
        (await call('GET', '/comms/consents/mine', who)).json() as {
          purposes: Array<{ code: string; description: string; status: string | null }>;
        }
      ).purposes;
    const prompts = () => seen.map((x) => (x.body as { prompt?: string } | null)?.prompt ?? '');

    // who runs the model not named yet: not for families
    const unnamed = await saveSetup(everyone);
    expect(unnamed.statusCode).toBe(400);
    expect(unnamed.body).toContain('needs the name of who runs the model');
    expect((await setup()).claudeInfo.audiences).toEqual(['teacher', 'admin']);
    expect((await purposes(parent)).some((x) => x.code === 'ai.model')).toBe(false);
    // named by a holder: every audience may be switched on
    expect((await name('Made-up Labs')).json()).toMatchObject({
      settings: { operator: 'Made-up Labs', tokenLast4: TOKEN.slice(-4) },
    });
    expect((await setup()).claudeInfo).toMatchObject({
      audiences: ['student', 'parent', 'teacher', 'admin'],
      operator: 'Made-up Labs',
    });
    expect((await saveSetup(everyone)).statusCode).toBe(200);
    // the assistant's own consent opens the assistant; the model's help waits for its own, which names who runs it
    await call('POST', '/comms/consents/mine', parent, {
      purposeCode: 'ai.assistant',
      status: 'granted',
    });
    expect(await start(parent)).toMatchObject({ modelConsent: 'needed' });
    expect(await start(pupil)).toMatchObject({ modelConsent: 'ask_parent' });
    const offered = (await purposes(parent)).find((x) => x.code === 'ai.model');
    expect(offered).toMatchObject({ status: null });
    expect(offered!.description).toContain('an AI model run by Made-up Labs');
    expect((await purposes(pupil)).some((x) => x.code === 'ai.model')).toBe(false);
    seen.length = 0;
    expect((await ask(parent, 'could you tell me all about my kids please')).json().by).toBe(
      'local',
    );
    expect(seen).toHaveLength(0);
    // allowed: the model helps with the parent's own children only
    await call('POST', '/comms/consents/mine', parent, {
      purposeCode: 'ai.model',
      status: 'granted',
    });
    expect(await start(parent)).toMatchObject({ modelConsent: 'granted' });
    seen.length = 0;
    const kids = await ask(parent, 'could you tell me all about my kids please');
    expect(kids.json()).toMatchObject({ by: 'llm', answer: 'Here is what I found.' });
    expect(prompts()[0]).toContain("a parent (only their own children's records)");
    expect(prompts()[0]).toContain('- my_children:');
    expect(prompts()[0]).not.toContain('- find_student:');
    expect(prompts()[1]).toContain('Asha');
    expect(prompts()[1]).not.toContain('Bhanu');
    // "how do I …" from the school's Help questions for parents, the link to the Help screen
    seen.length = 0;
    const how = await ask(parent, 'How do I reset the app password?');
    expect(how.json()).toMatchObject({
      by: 'llm',
      answer: 'Open My leave and choose Apply.',
      link: { app: '/help', web: '/help' },
    });
    expect(prompts()[0]).toMatch(/- faq-\d+: /);
    // a student: through the parent's consent, told "you"
    expect(await start(pupil)).toMatchObject({ modelConsent: 'granted' });
    seen.length = 0;
    expect((await ask(pupil, 'How do I reset the app password?')).json().by).toBe('llm');
    expect(prompts()[0]).toContain('a student (only their own records; say "you")');
    // the name changes: consents given before count no more, families are asked again
    await name('Other Made-up Co');
    expect(await start(parent)).toMatchObject({ modelConsent: 'needed' });
    const again = (await purposes(parent)).find((x) => x.code === 'ai.model');
    expect(again).toMatchObject({ status: null });
    expect(again!.description).toContain('run by Other Made-up Co');
    seen.length = 0;
    expect((await ask(parent, 'could you tell me all about my kids please')).json().by).toBe(
      'local',
    );
    expect(seen).toHaveLength(0);
    // the other tests: staff only
    expect(
      (await saveSetup({ student: false, parent: false, teacher: true, admin: true })).statusCode,
    ).toBe(200);
  });

  it('docs/design/101 phase B: an AI report written by the AI model when the school chose it; else the template', async () => {
    const run = () =>
      call('POST', '/insights/reports/run', admin, {
        kind: 'principal_brief',
        periodTo: '2026-11-15',
      });
    // not chosen: the template, the model not asked
    seen.length = 0;
    const t = await run();
    expect(t.statusCode).toBe(201);
    expect(t.json().provider).toBe('mock');
    expect(seen).toHaveLength(0);
    // chosen in School settings
    expect(
      (await call('PUT', '/platform/settings/ai.reports_model', admin, { value: true })).statusCode,
    ).toBeLessThan(300);
    const m = await run();
    expect(m.json()).toMatchObject({ provider: 'llm', narrative: 'A steady week at the school.' });
    expect((seen[0]?.body as { prompt?: string } | null)?.prompt ?? '').toContain('Facts (JSON)');
    // the model down: the template again (never Claude)
    plan = 'fail';
    const f = await run();
    expect(f.json().provider).toBe('mock');
    expect(seen.some((x) => x.url.startsWith('/v1/messages'))).toBe(false);
    plan = 'response';
    // the AI model switched off for all schools: the template, nothing sent
    await call('PUT', '/platform/ai-model', holder, {
      url: `${base}/v1/chat`,
      token: '',
      on: false,
    });
    seen.length = 0;
    expect((await run()).json().provider).toBe('mock');
    expect(seen).toHaveLength(0);
  });
});
