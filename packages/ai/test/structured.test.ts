import { describe, expect, it } from 'vitest';
import {
  ClaudeStructuredProvider,
  STRUCTURED_DEFAULT_MODEL,
  StructuredProviderError,
  structuredFromEnv,
} from '../src';

/** A stand-in for the SDK client: records the request and answers with the given message (or throws). */
function client(answer: unknown | Error) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    beta: {
      messages: {
        create: (body: Record<string, unknown>) => {
          calls.push(body);
          if (answer instanceof Error) return Promise.reject(answer);
          return Promise.resolve(answer);
        },
      },
    },
  };
}
const message = (over: Record<string, unknown>) => ({
  model: STRUCTURED_DEFAULT_MODEL,
  stop_reason: 'end_turn',
  usage: { input_tokens: 1200, output_tokens: 300 },
  content: [{ type: 'text', text: '{"a":1}' }],
  ...over,
});

describe('structured answers (docs/design/88)', () => {
  it('asks Claude for JSON of the schema, with effort, the refusal fallback and the default model', async () => {
    const c = client(message({}));
    const p = new ClaudeStructuredProvider({ apiKey: 'k', client: c as never });
    const out = await p.structured({
      system: 'sys',
      prompt: 'the prompt',
      schema: { type: 'object' },
      effort: 'high',
    });
    expect(out).toMatchObject({
      json: { a: 1 },
      refused: false,
      usage: { inputTokens: 1200, outputTokens: 300 },
      model: STRUCTURED_DEFAULT_MODEL,
      provider: 'claude',
    });
    expect(c.calls[0]).toMatchObject({
      model: 'claude-opus-5-5',
      system: 'sys',
      messages: [{ role: 'user', content: 'the prompt' }],
      output_config: {
        effort: 'high',
        format: { type: 'json_schema', schema: { type: 'object' } },
      },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
  });

  it('a refusal or a reply that is not JSON gives no JSON; a failed call is an error', async () => {
    const refused = await new ClaudeStructuredProvider({
      apiKey: 'k',
      client: client(message({ stop_reason: 'refusal', content: [] })) as never,
    }).structured({ system: '', prompt: '', schema: {} });
    expect(refused).toMatchObject({ json: null, refused: true, stopReason: 'refusal' });
    const prose = await new ClaudeStructuredProvider({
      apiKey: 'k',
      client: client(message({ content: [{ type: 'text', text: 'not json' }] })) as never,
    }).structured({ system: '', prompt: '', schema: {} });
    expect(prose).toMatchObject({ json: null, refused: false });
    await expect(
      new ClaudeStructuredProvider({
        apiKey: 'k',
        client: client(new Error('socket hang up')) as never,
      }).structured({ system: '', prompt: '', schema: {} }),
    ).rejects.toBeInstanceOf(StructuredProviderError);
  });

  it('only with AI_PROVIDER=claude and a key', () => {
    expect(structuredFromEnv({})).toBeNull();
    expect(structuredFromEnv({ AI_PROVIDER: 'claude' })).toBeNull();
    expect(structuredFromEnv({ AI_PROVIDER: 'mock', ANTHROPIC_API_KEY: 'k' })).toBeNull();
    expect(structuredFromEnv({ AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'k' })?.model).toBe(
      'claude-opus-5-5',
    );
  });
});
