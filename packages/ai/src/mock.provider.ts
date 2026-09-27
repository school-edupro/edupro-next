import type { AiProvider, CompletionRequest, CompletionResult } from './provider';

export type MockResponder = (
  request: CompletionRequest,
) => Partial<Pick<CompletionResult, 'text' | 'toolCalls' | 'stopReason'>> | string;

/**
 * Deterministic provider for development and tests: answers with the responder's text (default: an echo
 * of the last user message), counts tokens as whole words and records every request it saw.
 */
export class MockProvider implements AiProvider {
  readonly name = 'mock';
  readonly model = 'mock-1';
  readonly requests: CompletionRequest[] = [];

  constructor(private readonly responder?: MockResponder) {}

  async complete(request: CompletionRequest): Promise<CompletionResult> {
    this.requests.push(request);
    const last = [...request.messages].reverse().find((m) => m.role === 'user');
    const out = this.responder ? this.responder(request) : `echo: ${last?.content ?? ''}`;
    const partial = typeof out === 'string' ? { text: out } : out;
    const text = partial.text ?? '';
    const inputTokens =
      request.messages.reduce((n, m) => n + words(m.content), 0) + words(request.system ?? '');
    return {
      text,
      toolCalls: partial.toolCalls ?? [],
      stopReason: partial.stopReason ?? (partial.toolCalls?.length ? 'tool_use' : 'end_turn'),
      usage: { inputTokens, outputTokens: words(text) },
      model: this.model,
      provider: this.name,
      latencyMs: 0,
    };
  }
}

const words = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
