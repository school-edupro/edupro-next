import { describe, expect, it } from 'vitest';
import {
  Assistant,
  BudgetExceededError,
  BudgetMeter,
  ClaudeProvider,
  MemoryAuditSink,
  MemoryBudgetStore,
  MockProvider,
  claudeFromEnv,
  estimateCostPaise,
  maskContacts,
  providerFromEnv,
  redact,
  redactDeep,
  runToolLoop,
} from '../src';

describe('redaction', () => {
  it('masks mobiles, emails, Aadhaar, PAN, cards and listed names', () => {
    const r = redact(
      'Call Suresh Sharma on +91 98765 43210 or 09876543210, mail suresh@example.test, Aadhaar 1234 5678 9012, PAN ABCDE1234F, card 4111 1111 1111 1111',
      { names: ['Suresh Sharma'] },
    );
    expect(r.text).not.toMatch(/\d{10}/);
    expect(r.text).toContain('[mobile]');
    expect(r.text).toContain('[email]');
    expect(r.text).toContain('[aadhaar]');
    expect(r.text).toContain('[pan]');
    expect(r.text).toContain('[card]');
    expect(r.text).toContain('[name]');
    expect(r.counts.mobile).toBe(2);
    expect(r.total).toBeGreaterThanOrEqual(7);
  });

  it('leaves ordinary numbers and words alone and redacts nested values', () => {
    expect(redact('Class VI has 42 students; fees due 12500 on 10 Oct').total).toBe(0);
    expect(redactDeep({ a: ['ring 9876543210'], b: { c: 'x@y.in' } })).toEqual({
      a: ['ring [mobile]'],
      b: { c: '[email]' },
    });
  });
});

describe('budget meter', () => {
  it('blocks a user at the daily limit and a school at the monthly limit', async () => {
    const store = new MemoryBudgetStore();
    const meter = new BudgetMeter(store, { perUserDailyTokens: 100, perSchoolMonthlyTokens: 250 });
    const u1 = { schoolId: '1', userId: 'a' };
    expect((await meter.check(u1)).allowed).toBe(true);
    await meter.record(u1, { inputTokens: 60, outputTokens: 40 });
    expect((await meter.check(u1)).reason).toBe('user_daily');
    const u2 = { schoolId: '1', userId: 'b' };
    expect((await meter.check(u2)).allowed).toBe(true);
    await meter.record(u2, { inputTokens: 100, outputTokens: 60 });
    expect((await meter.check(u2)).reason).toBe('school_monthly');
    expect((await meter.check({ schoolId: '2', userId: 'a' })).allowed).toBe(true);
  });

  it('expires counters and estimates cost per model', async () => {
    let now = Date.UTC(2026, 8, 27, 10);
    const store = new MemoryBudgetStore(() => now);
    await store.incr('k', 5, 60);
    expect(await store.get('k')).toBe(5);
    now += 61_000;
    expect(await store.get('k')).toBe(0);
    expect(estimateCostPaise('claude-sonnet-5', { inputTokens: 1_000_000, outputTokens: 0 })).toBe(
      25_000,
    );
    expect(estimateCostPaise('mock-1', { inputTokens: 100, outputTokens: 100 })).toBe(0);
  });
});

describe('assistant pipeline', () => {
  const caller = { schoolId: '1', userId: '7', requestId: 'r1', sensitiveNames: ['Aarav'] };

  it('redacts the prompt, runs tools with the caller, cites them and audits every step', async () => {
    const provider = new MockProvider((req) => {
      const last = req.messages[req.messages.length - 1]!.content;
      if (last.startsWith('Tool results')) return 'Aarav was absent twice this week.';
      return { toolCalls: [{ id: 't1', name: 'attendance_week', input: { studentId: '9' } }] };
    });
    const audit = new MemoryAuditSink();
    const assistant = new Assistant({
      provider,
      budget: new BudgetMeter(new MemoryBudgetStore(), {
        perUserDailyTokens: 10_000,
        perSchoolMonthlyTokens: 100_000,
      }),
      audit,
    });
    const seen: unknown[] = [];
    const res = await assistant.ask({
      caller,
      system: 'You are the school assistant.',
      question: 'Was Aarav absent this week? My number is 9876543210',
      tools: [
        {
          name: 'attendance_week',
          description: 'Absences of a child this week',
          inputSchema: { type: 'object', properties: { studentId: { type: 'string' } } },
          async run(input, who) {
            seen.push({ input, who: who.userId });
            return { absent: 2 };
          },
        },
      ],
    });
    expect(res.answer).toContain('absent twice');
    expect(res.citations).toEqual(['attendance_week']);
    expect(res.rounds).toBe(2);
    expect(seen).toEqual([{ input: { studentId: '9' }, who: '7' }]);
    const prompt = provider.requests[0]!.messages[0]!.content;
    expect(prompt).toContain('[name]');
    expect(prompt).toContain('[mobile]');
    expect(prompt).not.toContain('9876543210');
    expect(audit.events.map((e) => e.kind)).toEqual(['prompt', 'tool', 'answer']);
    expect(audit.events[2]!.text).toContain('[name]');
    expect(audit.events[2]!.citations).toEqual(['attendance_week']);
    expect(res.usage.inputTokens).toBeGreaterThan(0);
  });

  it('refuses when the budget is used up and records the refusal', async () => {
    const audit = new MemoryAuditSink();
    const store = new MemoryBudgetStore();
    const meter = new BudgetMeter(store, { perUserDailyTokens: 1, perSchoolMonthlyTokens: 10 });
    await meter.record(caller, { inputTokens: 1, outputTokens: 0 });
    const assistant = new Assistant({ provider: new MockProvider(), budget: meter, audit });
    await expect(assistant.ask({ caller, system: 's', question: 'hello' })).rejects.toBeInstanceOf(
      BudgetExceededError,
    );
    expect(audit.events[0]).toMatchObject({ kind: 'refusal', text: 'budget:user_daily' });
  });

  it('treats an empty answer as a decline', async () => {
    const assistant = new Assistant({
      provider: new MockProvider(() => ''),
      budget: new BudgetMeter(new MemoryBudgetStore(), {
        perUserDailyTokens: 100,
        perSchoolMonthlyTokens: 100,
      }),
      audit: new MemoryAuditSink(),
    });
    const res = await assistant.ask({
      caller,
      system: 's',
      question: 'what is the meaning of life',
    });
    expect(res.refused).toBe(true);
    expect(res.answer).toMatch(/can't answer/);
  });
});

describe('claude provider', () => {
  it('builds the Messages request and parses text, tool calls and usage', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(
        JSON.stringify({
          model: 'claude-sonnet-5',
          stop_reason: 'tool_use',
          content: [
            { type: 'text', text: 'Let me check.' },
            { type: 'tool_use', id: 'tu_1', name: 'fee_dues', input: { classCode: 'VI' } },
          ],
          usage: { input_tokens: 120, output_tokens: 30 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }) as typeof fetch;
    const p = new ClaudeProvider({ apiKey: 'test-key', fetchImpl, maxRetries: 0 });
    const res = await p.complete({
      temperature: 0.2,
      system: 'sys',
      messages: [{ role: 'user', content: 'dues of class VI' }],
      tools: [{ name: 'fee_dues', description: 'd', inputSchema: { type: 'object' } }],
      metadata: { userId: '7' },
    });
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    // through Anthropic's official SDK (docs/design/93)
    const headers = new Headers(calls[0]!.init.headers);
    // the API key only (the SDK sends it as a bearer), never an ambient ANTHROPIC_AUTH_TOKEN
    expect(headers.get('authorization')).toBe('Bearer test-key');
    expect(headers.get('anthropic-version')).toBeTruthy();
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    // the default is Claude Haiku 5.5; no sampling parameters are sent
    expect(body.model).toBe('claude-haiku-5-5');
    expect(body).not.toHaveProperty('temperature');
    expect(body.system).toBe('sys');
    expect((body.tools as unknown[]).length).toBe(1);
    expect(res.toolCalls).toEqual([{ id: 'tu_1', name: 'fee_dues', input: { classCode: 'VI' } }]);
    expect(res.stopReason).toBe('tool_use');
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(res.text).toBe('Let me check.');
  });

  it('maps HTTP errors to AiProviderError', async () => {
    const fetchImpl = (async () => new Response('rate limited', { status: 429 })) as typeof fetch;
    const p = new ClaudeProvider({ apiKey: 'k', fetchImpl, maxRetries: 0 });
    await expect(p.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      name: 'AiProviderError',
      status: 429,
    });
  });
});

describe('provider from env', () => {
  it('defaults to local (no outside model) everywhere; mock is refused in production', () => {
    // docs/design/91: local is the chatbot's own matcher; reports keep their template narrative
    expect(providerFromEnv({}).name).toBe('mock');
    expect(providerFromEnv({ NODE_ENV: 'production' }).name).toBe('mock');
    expect(() => providerFromEnv({ AI_PROVIDER: 'mock', NODE_ENV: 'production' })).toThrow(
      /refused in production/,
    );
    expect(() => providerFromEnv({ AI_PROVIDER: 'claude' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(
      providerFromEnv({
        AI_PROVIDER: 'claude',
        ANTHROPIC_API_KEY: 'k',
        AI_MODEL: 'claude-opus-5-5',
      }).model,
    ).toBe('claude-opus-5-5');
  });

  it('hybrid (docs/design/93): the chat stays local; Claude Haiku 5.5 with no thinking for the rest', () => {
    expect(() => providerFromEnv({ AI_PROVIDER: 'hybrid' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(providerFromEnv({ AI_PROVIDER: 'hybrid', ANTHROPIC_API_KEY: 'k' }).name).toBe('mock');
    expect(claudeFromEnv({})).toBeNull();
    expect(claudeFromEnv({ AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'k' })).toBeNull();
    const c = claudeFromEnv({ AI_PROVIDER: 'hybrid', ANTHROPIC_API_KEY: 'k' })!;
    expect(c.model).toBe('claude-haiku-5-5');
    expect(c.turnParams()).toEqual({
      thinking: { type: 'disabled' },
      output_config: { effort: 'low' },
    });
  });
});

describe('the tool loop (docs/design/93)', () => {
  const reply = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  const message = (
    content: unknown[],
    stop: string,
    usage = { input_tokens: 100, output_tokens: 20 },
  ) => ({
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-haiku-5-5',
    stop_reason: stop,
    content,
    usage,
  });

  it('a tool_use turn, the rows back as a tool_result, then the answer', async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const answers = [
      message(
        [{ type: 'tool_use', id: 'tu_1', name: 'fee_defaulters', input: { classId: '6' } }],
        'tool_use',
      ),
      message([{ type: 'text', text: '2 students of VI owe fees.' }], 'end_turn', {
        input_tokens: 150,
        output_tokens: 12,
      }),
    ];
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return reply(answers.shift());
    }) as typeof fetch;
    const p = new ClaudeProvider({
      apiKey: 'k',
      fetchImpl,
      maxRetries: 0,
      thinkingOff: true,
      effort: 'low',
    });
    const ran: Array<Record<string, unknown>> = [];
    const r = await runToolLoop(p, {
      system: 'rules',
      history: [
        { role: 'assistant', text: 'dropped: a conversation starts with the person' },
        { role: 'user', text: 'earlier question' },
        { role: 'assistant', text: 'earlier answer' },
      ],
      question: 'who has not paid in VI?',
      userId: '42',
      tools: [
        {
          name: 'fee_defaulters',
          description: 'Students whose fee balance is above an amount',
          inputSchema: { type: 'object', properties: { classId: { type: 'string' } } },
          run: async (input) => {
            ran.push(input);
            return maskContacts([{ student: 'A One', mobile: '9876500011', balance: 1200 }]);
          },
        },
      ],
    });
    expect(ran).toEqual([{ classId: '6' }]);
    expect(r).toMatchObject({ text: '2 students of VI owe fees.', refused: false, rounds: 2 });
    expect(r.calls).toEqual([expect.objectContaining({ name: 'fee_defaulters', ok: true })]);
    expect(r.usage).toMatchObject({ inputTokens: 250, outputTokens: 32 });
    // the first request: rules cached, the tools, no thinking, low effort, alternating turns
    const first = bodies[0]!;
    expect(first.system).toEqual([
      { type: 'text', text: 'rules', cache_control: { type: 'ephemeral' } },
    ]);
    expect(first.thinking).toEqual({ type: 'disabled' });
    expect(first.output_config).toEqual({ effort: 'low' });
    expect((first.messages as Array<{ role: string }>).map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'user',
    ]);
    expect(first.metadata).toEqual({ user_id: '42' });
    // the second: Claude's tool_use turn, then the result for that id, contacts masked
    const second = bodies[1]!.messages as Array<{ role: string; content: unknown }>;
    const result = (second[second.length - 1]!.content as Array<Record<string, unknown>>)[0]!;
    expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' });
    expect(String(result.content)).toContain('[masked]');
    expect(String(result.content)).not.toContain('9876500011');
  });

  it('a refusal, an unknown tool and the round limit', async () => {
    const fetchRefuse = (async () => reply(message([], 'refusal'))) as typeof fetch;
    const p1 = new ClaudeProvider({ apiKey: 'k', fetchImpl: fetchRefuse, maxRetries: 0 });
    expect(await runToolLoop(p1, { system: 's', question: 'q', tools: [] })).toMatchObject({
      refused: true,
      stopReason: 'refusal',
    });
    // always asks for a tool: stops after the limit, with nothing invented
    const always = (async () =>
      reply(
        message([{ type: 'tool_use', id: 'tu', name: 'nope', input: {} }], 'tool_use'),
      )) as typeof fetch;
    const p2 = new ClaudeProvider({ apiKey: 'k', fetchImpl: always, maxRetries: 0 });
    const r = await runToolLoop(p2, { system: 's', question: 'q', tools: [], maxRounds: 2 });
    expect(r.refused).toBe(true);
    expect(r.rounds).toBe(3);
    expect(r.calls.every((c) => !c.ok)).toBe(true);
  });

  it('masks contact columns and values; the cost counts cache reads cheaply', () => {
    expect(
      maskContacts([
        {
          name: 'A One',
          guardian_mobile: '9876500011',
          email: 'a@x.test',
          note: 'call 9876500022',
          fee: 5,
        },
      ]),
    ).toEqual([
      {
        name: 'A One',
        guardian_mobile: '[masked]',
        email: '[masked]',
        note: 'call [mobile]',
        fee: 5,
      },
    ]);
    const plain = estimateCostPaise('claude-haiku-5-5', {
      inputTokens: 1_000_000,
      outputTokens: 0,
    });
    const cached = estimateCostPaise('claude-haiku-5-5', {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    expect(plain).toBe(840);
    expect(cached).toBe(84);
  });
});
