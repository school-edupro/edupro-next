import {
  AiProviderError,
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
  type ToolCall,
} from './provider';

export interface ClaudeProviderOptions {
  apiKey: string;
  /** Defaults to Claude Sonnet 5 (the recommended balance of quality and cost for ERP assistants). */
  model?: string;
  baseUrl?: string;
  /** Request timeout in milliseconds (default 60 s). */
  timeoutMs?: number;
  /** Injected for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

interface ClaudeContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

interface ClaudeResponse {
  model: string;
  stop_reason: string | null;
  content: ClaudeContentBlock[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

const DEFAULT_MODEL = 'claude-sonnet-5';

/**
 * Claude API through the Messages endpoint. No SDK dependency: one POST with the API key from the
 * environment, the anthropic-version header and a bounded timeout. Tool definitions map one to one.
 */
export class ClaudeProvider implements AiProvider {
  readonly name = 'claude';
  readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: ClaudeProviderOptions) {
    if (!options.apiKey) throw new Error('ClaudeProvider needs an API key');
    this.model = options.model ?? DEFAULT_MODEL;
    this.baseUrl = (options.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /** The exact request body sent to the API, exposed for tests and the audit trail. */
  buildBody(request: CompletionRequest): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_tokens: request.maxTokens ?? 1024,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (request.system) body.system = request.system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.tools?.length)
      body.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      }));
    if (request.metadata) body.metadata = { user_id: request.metadata.userId ?? undefined };
    return body;
  }

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(this.buildBody(request)),
        signal: controller.signal,
      });
    } catch (error) {
      throw new AiProviderError(
        this.name,
        null,
        error instanceof Error && error.name === 'AbortError'
          ? `Claude API timed out after ${this.timeoutMs} ms`
          : `Claude API unreachable: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new AiProviderError(
        this.name,
        res.status,
        `Claude API ${res.status}: ${detail.slice(0, 300)}`,
      );
    }
    const data = (await res.json()) as ClaudeResponse;
    const toolCalls: ToolCall[] = [];
    const text: string[] = [];
    for (const block of data.content ?? []) {
      if (block.type === 'text' && block.text) text.push(block.text);
      if (block.type === 'tool_use' && block.name)
        toolCalls.push({ id: block.id ?? '', name: block.name, input: block.input ?? {} });
    }
    const stop = data.stop_reason;
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
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      },
      model: data.model ?? this.model,
      provider: this.name,
      latencyMs: Date.now() - started,
    };
  }
}
