import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import {
  AiProviderError,
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
  type ToolCall,
} from './provider';

export interface ClaudeProviderOptions {
  apiKey: string;
  /** Defaults to Claude Haiku 5.5 (docs/design/93: fast and low-cost for choosing a query and a short answer). */
  model?: string;
  baseUrl?: string;
  /** Request timeout in milliseconds (default 60 s). */
  timeoutMs?: number;
  /** Retries on rate limits and overloads (default 1: a chat should not wait long). */
  maxRetries?: number;
  /** How much the model thinks before answering (sent only when set). */
  effort?: 'low' | 'medium' | 'high';
  /** No thinking at all (sent only when set; for short tool choices). */
  thinkingOff?: boolean;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export const DEFAULT_CLAUDE_MODEL = 'claude-haiku-5-5';

/**
 * Claude API through Anthropic's official TypeScript SDK (docs/design/93): the key from the environment, a bounded
 * timeout, typed errors mapped to AiProviderError. `complete` serves the string-message callers (reports, the older
 * assistant pipeline); `client`, `send` and `turnParams` serve the tool loop with real tool_use / tool_result turns.
 */
export class ClaudeProvider implements AiProvider {
  readonly name = 'claude';
  readonly model: string;
  readonly client: Anthropic;

  constructor(private readonly options: ClaudeProviderOptions) {
    if (!options.apiKey) throw new Error('ClaudeProvider needs an API key');
    this.model = options.model ?? DEFAULT_CLAUDE_MODEL;
    const clientOptions: ClientOptions = {
      apiKey: options.apiKey,
      // only the configured API key: never a token found in the environment (a person's own Claude sign-in)
      authToken: null,
      // EduPro's own setting or Anthropic's address: never an ANTHROPIC_BASE_URL found in the environment
      baseURL: options.baseUrl ?? 'https://api.anthropic.com',
      timeout: options.timeoutMs ?? 60_000,
      maxRetries: options.maxRetries ?? 1,
    };
    if (options.fetchImpl) clientOptions.fetch = options.fetchImpl as ClientOptions['fetch'];
    this.client = new Anthropic(clientOptions);
  }

  /** The thinking and effort settings, when the provider was given them. */
  turnParams(): Pick<Anthropic.MessageCreateParamsNonStreaming, 'thinking' | 'output_config'> {
    return {
      ...(this.options.thinkingOff ? { thinking: { type: 'disabled' as const } } : {}),
      ...(this.options.effort ? { output_config: { effort: this.options.effort } } : {}),
    };
  }

  /** The exact request body sent to the API, exposed for tests and the audit trail. */
  buildBody(request: CompletionRequest): Anthropic.MessageCreateParamsNonStreaming {
    const body: Anthropic.MessageCreateParamsNonStreaming = {
      model: this.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      ...this.turnParams(),
    };
    if (request.system) body.system = request.system;
    // no sampling parameters: the current models refuse them (the request's temperature is ignored)
    if (request.tools?.length)
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
      }));
    if (request.metadata?.userId) body.metadata = { user_id: request.metadata.userId };
    return body;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const data = await this.send(this.buildBody(request));
    const toolCalls: ToolCall[] = [];
    const text: string[] = [];
    for (const block of data.content) {
      if (block.type === 'text') text.push(block.text);
      if (block.type === 'tool_use')
        toolCalls.push({
          id: block.id,
          name: block.name,
          input: (block.input ?? {}) as Record<string, unknown>,
        });
    }
    const stop = data.stop_reason;
    const u = usageOf(data.usage);
    return {
      text: text.join('\n').trim(),
      toolCalls,
      stopReason:
        stop === 'end_turn' ||
        stop === 'tool_use' ||
        stop === 'max_tokens' ||
        stop === 'stop_sequence'
          ? stop
          : 'other',
      usage: { inputTokens: u.inputTokens, outputTokens: u.outputTokens },
      model: data.model ?? this.model,
      provider: this.name,
      latencyMs: Date.now() - started,
    };
  }

  /** One Messages call; SDK errors become AiProviderError with the HTTP status (null when unreachable). */
  async send(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    try {
      return await this.client.messages.create(body);
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError)
        throw new AiProviderError(this.name, null, 'Claude API timed out');
      if (error instanceof Anthropic.APIConnectionError)
        throw new AiProviderError(this.name, null, `Claude API unreachable: ${error.message}`);
      if (error instanceof Anthropic.APIError)
        throw new AiProviderError(
          this.name,
          typeof error.status === 'number' ? error.status : null,
          `Claude API ${String(error.status ?? '')}: ${error.message.slice(0, 300)}`,
        );
      throw error;
    }
  }
}

/** Tokens of a response, with cache reads and writes apart (they are priced differently). */
export function usageOf(u: Anthropic.Usage | undefined): {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
} {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}
