/**
 * Model provider abstraction (docs/design/07-ai-layer.md section 2). The ERP talks to one interface; the
 * Claude API is the default implementation, the mock provider serves development and tests, and an
 * on-premise model can be plugged in for schools that require data residency.
 */
export type Role = 'user' | 'assistant';

export interface Message {
  role: Role;
  content: string;
}

/** A tool the model may call; the ERP executes it with the caller's own token and permissions. */
export interface ToolDefinition {
  name: string;
  description: string;
  /** JSON schema of the tool input. */
  inputSchema: Record<string, unknown>;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompletionRequest {
  system?: string;
  messages: Message[];
  tools?: ToolDefinition[];
  maxTokens?: number;
  temperature?: number;
  /** Free-form metadata passed to the provider (never personal data). */
  metadata?: Record<string, string>;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface CompletionResult {
  text: string;
  toolCalls: ToolCall[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence' | 'other';
  usage: Usage;
  model: string;
  provider: string;
  latencyMs: number;
}

export interface AiProvider {
  readonly name: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export class AiProviderError extends Error {
  constructor(
    readonly provider: string,
    readonly status: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}
