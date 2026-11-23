import { describe, expect, it } from 'vitest';
import { AiProviderError, HttpLlmProvider, promptOf, readReply, valueAt } from '../src';

/** docs/design/101: an LLM of our own — the reply read, the prompt written, the call made (a stand-in fetch). */
describe('the LLM of our own', () => {
  it('finds the answer in the usual places, a given field, or a plain-text body', () => {
    expect(readReply('{"response":"Two lines."}')).toEqual({
      text: 'Two lines.',
      field: 'response',
    });
    expect(readReply('{"choices":[{"message":{"content":"Hi"}}]}')).toEqual({
      text: 'Hi',
      field: 'choices[0].message.content',
    });
    expect(readReply('{"data":{"reply":"Yes"},"ok":true}')).toEqual({
      text: 'Yes',
      field: 'data.reply',
    });
    expect(readReply('[{"generated_text":"G"}]')).toEqual({
      text: 'G',
      field: '[0].generated_text',
    });
    expect(readReply('Plain words')).toEqual({ text: 'Plain words', field: '(the body)' });
    expect(readReply('"a json string"')).toEqual({ text: 'a json string', field: '(the body)' });
    // a field of the school's own
    expect(readReply('{"out":{"msg":"Here"},"response":"not this"}', 'out.msg')).toEqual({
      text: 'Here',
      field: 'out.msg',
    });
    expect(readReply('{"out":{}}', 'out.msg')).toEqual({ text: null, field: null });
    // nothing that looks like an answer
    expect(readReply('{"status":"ok","id":7}')).toEqual({ text: null, field: null });
    expect(readReply('{"response":"   "}')).toEqual({ text: null, field: null });
    expect(valueAt({ a: [{ b: 'x' }] }, 'a[0].b')).toBe('x');
    expect(valueAt({ a: 'x' }, 'a[0]')).toBeUndefined();
  });

  it('writes the instructions, the conversation and the question into one prompt', () => {
    expect(promptOf({ messages: [{ role: 'user', content: 'Explain decorators' }] })).toBe(
      'Explain decorators',
    );
    const p = promptOf({
      system: 'You answer for a school.',
      messages: [
        { role: 'user', content: 'Who is absent?' },
        { role: 'assistant', content: 'Two pupils.' },
        { role: 'user', content: 'Which class?' },
      ],
    });
    expect(p).toBe(
      'You answer for a school.\n\nThe conversation so far:\nUser: Who is absent?\nAssistant: Two pupils.\n\nUser: Which class?',
    );
  });

  it('posts the prompt with the Bearer token and reads the answer', async () => {
    const seen: Array<{ url: string; init: RequestInit }> = [];
    const llm = new HttpLlmProvider({
      url: 'http://llm.test:8080/v1/chat',
      token: 'fake-1234',
      fetchImpl: (async (url: string, init: RequestInit) => {
        seen.push({ url, init });
        return new Response(JSON.stringify({ response: 'Decorators wrap functions.' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }) as unknown as typeof fetch,
    });
    const r = await llm.complete({ messages: [{ role: 'user', content: 'Explain decorators' }] });
    expect(r).toMatchObject({
      text: 'Decorators wrap functions.',
      provider: 'llm',
      model: 'llm@llm.test:8080',
    });
    expect(seen[0]!.url).toBe('http://llm.test:8080/v1/chat');
    expect(seen[0]!.init.method).toBe('POST');
    expect((seen[0]!.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer fake-1234',
    );
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ prompt: 'Explain decorators' });
  });

  it('says what went wrong — the token refused, a server error, no answer, no answer in time — never the token', async () => {
    const answer = (status: number, body: string) =>
      new HttpLlmProvider({
        url: 'http://llm.test/v1/chat',
        token: 'fake-1234',
        fetchImpl: (async () => new Response(body, { status })) as unknown as typeof fetch,
      });
    expect(await answer(401, '{"error":"bad token fake-1234"}').ask('x')).toMatchObject({
      ok: false,
      status: 401,
      problem: 'The model refused the token (HTTP 401)',
      raw: '{"error":"bad token ••••"}',
    });
    expect((await answer(500, 'boom').ask('x')).problem).toBe('The model answered HTTP 500');
    expect((await answer(200, '{"status":"ok"}').ask('x')).problem).toMatch(/set the Reply field/);
    await expect(
      answer(503, '').complete({ messages: [{ role: 'user', content: 'x' }] }),
    ).rejects.toBeInstanceOf(AiProviderError);
    const slow = new HttpLlmProvider({
      url: 'http://llm.test/v1/chat',
      token: 't',
      timeoutMs: 50,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(Object.assign(new Error('timed out'), { name: 'TimeoutError' })),
          );
        })) as unknown as typeof fetch,
    });
    expect((await slow.ask('x')).problem).toBe('No answer within 1 second');
    const down = new HttpLlmProvider({
      url: 'http://llm.test/v1/chat',
      token: 't',
      fetchImpl: (async () => {
        throw new TypeError('fetch failed', {
          cause: new Error('connect ECONNREFUSED 127.0.0.1:8080'),
        });
      }) as unknown as typeof fetch,
    });
    expect((await down.ask('x')).problem).toBe(
      'The model could not be reached (connect ECONNREFUSED 127.0.0.1:8080)',
    );
  });
});
