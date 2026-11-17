import Anthropic from '@anthropic-ai/sdk';
import type { Usage } from './provider';

/**
 * Structured answers (docs/design/88): one request whose reply must be JSON of a given schema — e.g. "describe
 * the layout of this result file". The Claude implementation uses the official Anthropic SDK with structured
 * output (`output_config.format`), adaptive thinking and the server-side refusal fallback; the caller validates
 * the JSON again with its own schema. Never put personal data in the prompt: the caller masks it first.
 */
export interface StructuredRequest {
  system: string;
  prompt: string;
  /** JSON schema of the reply (objects closed: additionalProperties false, every property required). */
  schema: Record<string, unknown>;
  maxTokens?: number;
  effort?: 'low' | 'medium' | 'high' | 'xhigh' | 'max';
}

export interface StructuredResult {
  /** The parsed JSON, or null when the model declined or the reply was not JSON. */
  json: unknown;
  refused: boolean;
  stopReason: string;
  usage: Usage;
  model: string;
  provider: string;
  latencyMs: number;
}

export interface StructuredProvider {
  readonly name: string;
  readonly model: string;
  structured(request: StructuredRequest): Promise<StructuredResult>;
}

export class StructuredProviderError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'StructuredProviderError';
  }
}

export interface ClaudeStructuredOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  /** Request timeout in milliseconds (default 120 s). */
  timeoutMs?: number;
  /** For tests: a client stand-in with the same `beta.messages.create`. */
  client?: Pick<Anthropic, 'beta'>;
}

/** The default model for structured work (the project default). */
export const STRUCTURED_DEFAULT_MODEL = 'claude-opus-5-5';

export class ClaudeStructuredProvider implements StructuredProvider {
  readonly name = 'claude';
  readonly model: string;
  private readonly client: Pick<Anthropic, 'beta'>;

  constructor(options: ClaudeStructuredOptions) {
    this.model = options.model ?? STRUCTURED_DEFAULT_MODEL;
    this.client =
      options.client ??
      new Anthropic({
        apiKey: options.apiKey,
        baseURL: options.baseUrl,
        timeout: options.timeoutMs ?? 120_000,
        maxRetries: 2,
      });
  }

  async structured(request: StructuredRequest): Promise<StructuredResult> {
    const started = Date.now();
    let message;
    try {
      message = await this.client.beta.messages.create({
        model: this.model,
        max_tokens: request.maxTokens ?? 16_000,
        system: request.system,
        messages: [{ role: 'user', content: request.prompt }],
        output_config: {
          effort: request.effort ?? 'high',
          format: { type: 'json_schema', schema: request.schema },
        },
        // a policy decline is answered by the fallback model inside the same call
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      });
    } catch (error) {
      if (error instanceof Anthropic.APIError)
        throw new StructuredProviderError(error.status ?? null, error.message);
      throw new StructuredProviderError(null, error instanceof Error ? error.message : 'failed');
    }
    const usage: Usage = {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    };
    const base = {
      usage,
      model: message.model,
      provider: this.name,
      latencyMs: Date.now() - started,
      stopReason: String(message.stop_reason ?? 'other'),
    };
    if (message.stop_reason === 'refusal') return { ...base, json: null, refused: true };
    const text = message.content
      .map((b) => (b.type === 'text' ? b.text : ''))
      .join('')
      .trim();
    try {
      return { ...base, json: JSON.parse(text) as unknown, refused: false };
    } catch {
      return { ...base, json: null, refused: false };
    }
  }
}

export interface StructuredEnv {
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
}

/** The structured provider the environment allows: Claude when `AI_PROVIDER=claude` and a key is set, else none. */
export function structuredFromEnv(env: StructuredEnv): StructuredProvider | null {
  if ((env.AI_PROVIDER ?? 'mock').toLowerCase() !== 'claude' || !env.ANTHROPIC_API_KEY) return null;
  return new ClaudeStructuredProvider({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.AI_MODEL,
    baseUrl: env.ANTHROPIC_BASE_URL,
  });
}
