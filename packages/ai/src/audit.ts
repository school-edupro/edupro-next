import type { Usage } from './provider';

/**
 * Every prompt, tool call and answer is audited like any other action (design principle 4). The sink is
 * an interface so the API writes to audit_logs and tests keep events in memory. Text reaches the sink
 * already redacted; the assistant never hands the sink raw prompts.
 */
export interface AiAuditEvent {
  kind: 'prompt' | 'tool' | 'answer' | 'refusal' | 'error';
  schoolId: string;
  userId: string | null;
  requestId: string | null;
  conversationId: string;
  provider: string;
  model: string;
  /** Redacted text (prompt, tool input/output summary, answer or refusal reason). */
  text: string;
  redactions: number;
  usage?: Usage;
  costPaise?: number;
  latencyMs?: number;
  citations?: string[];
  at: string;
}

export interface AiAuditSink {
  record(event: AiAuditEvent): Promise<void>;
}

export class MemoryAuditSink implements AiAuditSink {
  readonly events: AiAuditEvent[] = [];
  async record(event: AiAuditEvent): Promise<void> {
    this.events.push(event);
  }
}
