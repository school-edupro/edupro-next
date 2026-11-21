import type Anthropic from '@anthropic-ai/sdk';
import { usageOf, type ClaudeProvider } from './claude.provider';
import { redactDeep } from './redaction';

/**
 * Claude's turn in the hybrid assistant (docs/design/93): the question with the approved queries the person may run as
 * tools; Claude chooses, EduPro runs the query with the person's rights, the rows go back (contacts masked) as
 * tool_result turns, Claude answers from them. At most `maxRounds` tool rounds; a refusal or an empty answer is
 * reported, never invented.
 */
export interface LoopTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Runs with the caller's rights; what it returns goes to Claude (mask it first: see maskContacts). */
  run(input: Record<string, unknown>): Promise<unknown>;
}

export interface LoopInput {
  system: string;
  /** Earlier turns of the conversation, as plain text (already masked). */
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
  /** The question (already masked). */
  question: string;
  tools: LoopTool[];
  maxRounds?: number;
  maxTokens?: number;
  /** An opaque id for Anthropic's abuse checks (never personal data). */
  userId?: string | null;
}

export interface LoopCall {
  name: string;
  input: Record<string, unknown>;
  ok: boolean;
  output: unknown;
}

export interface LoopResult {
  text: string;
  calls: LoopCall[];
  refused: boolean;
  stopReason: string;
  rounds: number;
  model: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  };
}

/** A conversation the API accepts: starts with the person, turns alternate (same-role turns are joined). */
function turns(history: LoopInput['history'], question: string): Anthropic.MessageParam[] {
  const out: Array<{ role: 'user' | 'assistant'; text: string }> = [];
  for (const t of [...(history ?? []), { role: 'user' as const, text: question }]) {
    if (!t.text.trim()) continue;
    if (!out.length && t.role === 'assistant') continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.text = `${last.text}\n${t.text}`;
    else out.push({ role: t.role, text: t.text });
  }
  return out.map((t) => ({ role: t.role, content: t.text }));
}

export async function runToolLoop(provider: ClaudeProvider, input: LoopInput): Promise<LoopResult> {
  const maxRounds = input.maxRounds ?? 3;
  const tools: Anthropic.Tool[] = input.tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
  const messages = turns(input.history, input.question);
  const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const calls: LoopCall[] = [];
  let rounds = 0;
  let model = provider.model;
  for (;;) {
    rounds += 1;
    const res = await provider.send({
      model: provider.model,
      max_tokens: input.maxTokens ?? 800,
      // the rules and the tools stay the same for an audience: cached for the next question
      system: [{ type: 'text', text: input.system, cache_control: { type: 'ephemeral' } }],
      tools,
      messages,
      ...provider.turnParams(),
      ...(input.userId ? { metadata: { user_id: input.userId } } : {}),
    });
    model = res.model ?? model;
    const u = usageOf(res.usage);
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
    usage.cacheReadTokens += u.cacheReadTokens;
    usage.cacheWriteTokens += u.cacheWriteTokens;
    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (res.stop_reason === 'refusal')
      return { text: '', calls, refused: true, stopReason: 'refusal', rounds, model, usage };
    const uses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    if (res.stop_reason === 'tool_use' && uses.length && rounds <= maxRounds) {
      messages.push({ role: 'assistant', content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = [];
      for (const use of uses) {
        const tool = input.tools.find((t) => t.name === use.name);
        const args = (use.input ?? {}) as Record<string, unknown>;
        let ok = true;
        let output: unknown;
        if (!tool) {
          ok = false;
          output = { error: `No such query: ${use.name}` };
        } else {
          try {
            output = await tool.run(args);
          } catch (error) {
            ok = false;
            output = { error: error instanceof Error ? error.message : String(error) };
          }
        }
        calls.push({ name: use.name, input: args, ok, output });
        results.push({
          type: 'tool_result',
          tool_use_id: use.id,
          // data, not instructions (the system prompt says so too)
          content: JSON.stringify(output).slice(0, 20_000),
          ...(ok ? {} : { is_error: true }),
        });
      }
      messages.push({ role: 'user', content: results });
      continue;
    }
    return {
      text,
      calls,
      refused: !text,
      stopReason: res.stop_reason ?? 'other',
      rounds,
      model,
      usage,
    };
  }
}

/** Contact details out of query rows before they leave EduPro: such columns and such values are masked. */
const CONTACT_KEY =
  /(mobile|phone|whatsapp|e_?mail|address|aadhaar|aadhar|pan_no|^pan$|pincode|contact)/i;
export function maskContacts<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => maskContacts(v)) as unknown as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [
        k,
        CONTACT_KEY.test(k) && v !== null && v !== '' ? '[masked]' : maskContacts(v),
      ]),
    ) as T;
  return redactDeep(value);
}
