import { describe, expect, it } from 'vitest';
import {
  Assistant,
  BudgetExceededError,
  BudgetMeter,
  ClaudeProvider,
  MemoryAuditSink,
  MemoryBudgetStore,
  MockProvider,
  estimateCostPaise,
  providerFromEnv,
  redact,
  redactDeep,
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
    const p = new ClaudeProvider({ apiKey: 'test-key', fetchImpl });
    const res = await p.complete({
      system: 'sys',
      messages: [{ role: 'user', content: 'dues of class VI' }],
      tools: [{ name: 'fee_dues', description: 'd', inputSchema: { type: 'object' } }],
      metadata: { userId: '7' },
    });
    expect(calls[0]!.url).toBe('https://api.anthropic.com/v1/messages');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBeDefined();
    const body = JSON.parse(String(calls[0]!.init.body)) as Record<string, unknown>;
    expect(body.model).toBe('claude-sonnet-5');
    expect(body.system).toBe('sys');
    expect((body.tools as unknown[]).length).toBe(1);
    expect(res.toolCalls).toEqual([{ id: 'tu_1', name: 'fee_dues', input: { classCode: 'VI' } }]);
    expect(res.stopReason).toBe('tool_use');
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 30 });
    expect(res.text).toBe('Let me check.');
  });

  it('maps HTTP errors to AiProviderError', async () => {
    const fetchImpl = (async () => new Response('rate limited', { status: 429 })) as typeof fetch;
    const p = new ClaudeProvider({ apiKey: 'k', fetchImpl });
    await expect(p.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toMatchObject({
      name: 'AiProviderError',
      status: 429,
    });
  });
});

describe('provider from env', () => {
  it('defaults to mock outside production and refuses it in production', () => {
    expect(providerFromEnv({}).name).toBe('mock');
    expect(() => providerFromEnv({ NODE_ENV: 'production' })).toThrow(/refused in production/);
    expect(() => providerFromEnv({ AI_PROVIDER: 'claude' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(
      providerFromEnv({
        AI_PROVIDER: 'claude',
        ANTHROPIC_API_KEY: 'k',
        AI_MODEL: 'claude-opus-5-5',
      }).model,
    ).toBe('claude-opus-5-5');
  });
});
