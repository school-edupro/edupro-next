import {
  AiProviderError,
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
} from './provider';

/**
 * An LLM of the school group's own (docs/design/101): `POST <url>` with a Bearer token and `{"prompt": "…"}` — the one
 * field such a model takes — and the answer read from its reply. The instructions, the conversation and the question
 * are written into the prompt. Set once for all schools in the admin (the token kept encrypted in the database).
 */
export interface HttpLlmConfig {
  url: string;
  token: string;
  /** where the answer sits in the reply (a dotted path such as `data.reply` or `choices[0].text`); null: found */
  replyField?: string | null;
  timeoutMs?: number;
  /** the network call (a test stands in a server of its own) */
  fetchImpl?: typeof fetch;
}

/** What one call to the model gave: the answer (or null), where it was found, the status, the raw reply, the time. */
export interface HttpLlmReply {
  ok: boolean;
  status: number | null;
  text: string | null;
  /** the field the answer came from (`(the body)` for a plain-text reply) */
  field: string | null;
  raw: string;
  ms: number;
  /** what went wrong, in words (never the token) */
  problem: string | null;
}

/** The usual places an answer sits in a chat model's JSON reply, in order. */
const USUAL = [
  'response',
  'answer',
  'reply',
  'text',
  'output',
  'content',
  'message',
  'result',
  'completion',
  'generated_text',
  'choices[0].message.content',
  'choices[0].text',
  'data.response',
  'data.answer',
  'data.reply',
  'data.text',
  'data.output',
  'data.content',
  'data.message',
  'output.text',
  'message.content',
  'result.text',
  '[0].generated_text',
];

/** A dotted path's value (`a.b[0].c`, or `[0].x` at the top of an array). */
export function valueAt(body: unknown, path: string): unknown {
  let at: unknown = body;
  for (const part of path.match(/[^.[\]]+|\[\d+\]/g) ?? []) {
    if (at === null || at === undefined) return undefined;
    if (part.startsWith('[')) {
      const i = Number(part.slice(1, -1));
      at = Array.isArray(at) ? at[i] : undefined;
    } else {
      at =
        typeof at === 'object' && !Array.isArray(at)
          ? (at as Record<string, unknown>)[part]
          : undefined;
    }
  }
  return at;
}

/**
 * The answer in a reply: the given field, else the first of the usual ones that holds words, else a plain-text body.
 * Null when none is found (the reply is then shown raw on the test panel).
 */
export function readReply(
  raw: string,
  field?: string | null,
): { text: string | null; field: string | null } {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    const plain = raw.trim();
    return plain && !field ? { text: plain, field: '(the body)' } : { text: null, field: null };
  }
  if (typeof body === 'string')
    return body.trim() ? { text: body.trim(), field: '(the body)' } : { text: null, field: null };
  const words = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  if (field) {
    const v = words(valueAt(body, field));
    return { text: v, field: v ? field : null };
  }
  for (const f of USUAL) {
    const v = words(valueAt(body, f));
    if (v) return { text: v, field: f };
  }
  return { text: null, field: null };
}

/** The request written as one prompt: the instructions, the conversation, then the last message. */
export function promptOf(request: CompletionRequest): string {
  const parts: string[] = [];
  if (request.system?.trim()) parts.push(request.system.trim());
  const msgs = request.messages;
  if (msgs.length > 1) {
    parts.push(
      `The conversation so far:\n${msgs
        .slice(0, -1)
        .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n')}`,
    );
  }
  const last = msgs.at(-1);
  if (last)
    parts.push(
      msgs.length > 1 || request.system
        ? `${last.role === 'user' ? 'User' : 'Assistant'}: ${last.content}`
        : last.content,
    );
  return parts.join('\n\n');
}

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);

export class HttpLlmProvider implements AiProvider {
  readonly name = 'llm';
  readonly model: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: HttpLlmConfig) {
    this.timeoutMs = config.timeoutMs ?? 30_000;
    this.fetchImpl = config.fetchImpl ?? fetch;
    let host = 'llm';
    try {
      host = new URL(config.url).host;
    } catch {
      // checked when saved
    }
    this.model = `llm@${host}`;
  }

  /** One prompt to the model, as the test panel shows it: never throws. */
  async ask(prompt: string): Promise<HttpLlmReply> {
    const started = Date.now();
    const ms = () => Date.now() - started;
    let res: Response;
    try {
      res = await this.fetchImpl(this.config.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json, text/plain;q=0.9, */*;q=0.5',
          Authorization: `Bearer ${this.config.token}`,
        },
        body: JSON.stringify({ prompt }),
        signal: AbortSignal.timeout(this.timeoutMs),
        redirect: 'error',
      });
    } catch (e) {
      const name = e instanceof Error ? e.name : '';
      const secs = Math.max(1, Math.round(this.timeoutMs / 1000));
      const why =
        e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
      const problem =
        name === 'TimeoutError' || name === 'AbortError'
          ? `No answer within ${String(secs)} second${secs === 1 ? '' : 's'}`
          : `The model could not be reached (${this.clean(why)})`;
      return { ok: false, status: null, text: null, field: null, raw: '', ms: ms(), problem };
    }
    let raw = '';
    try {
      raw = await res.text();
    } catch {
      raw = '';
    }
    if (!res.ok) {
      const problem =
        res.status === 401 || res.status === 403
          ? `The model refused the token (HTTP ${String(res.status)})`
          : `The model answered HTTP ${String(res.status)}`;
      return {
        ok: false,
        status: res.status,
        text: null,
        field: null,
        raw: this.clean(raw),
        ms: ms(),
        problem,
      };
    }
    const found = readReply(raw, this.config.replyField);
    return {
      ok: !!found.text,
      status: res.status,
      text: found.text,
      field: found.field,
      raw: this.clean(raw),
      ms: ms(),
      problem: found.text
        ? null
        : this.config.replyField
          ? `No words at "${this.config.replyField}" in the reply`
          : 'No answer found in the reply: set the Reply field',
    };
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const prompt = promptOf(request);
    const r = await this.ask(prompt);
    if (!r.ok || !r.text) throw new AiProviderError(this.name, r.status, r.problem ?? 'No answer');
    return {
      text: r.text,
      toolCalls: [],
      stopReason: 'end_turn',
      usage: { inputTokens: words(prompt), outputTokens: words(r.text) },
      model: this.model,
      provider: this.name,
      latencyMs: r.ms,
    };
  }

  /** a reply or an error as shown: never the token */
  private clean(s: string): string {
    return this.config.token.length >= 6 ? s.split(this.config.token).join('••••') : s;
  }
}
