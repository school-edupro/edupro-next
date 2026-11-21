import { ClaudeProvider } from './claude.provider';
import { MockProvider } from './mock.provider';
import type { AiProvider } from './provider';

export interface AiEnv {
  AI_PROVIDER?: string;
  AI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_BASE_URL?: string;
  NODE_ENV?: string;
}

/**
 * Chooses the provider from the environment: `AI_PROVIDER=claude` needs ANTHROPIC_API_KEY; `mock` is the
 * development default and is refused in production, like every other development bypass in this code base.
 * `hybrid` (docs/design/93) answers like `local` here; Claude is reached through claudeFromEnv for the questions the
 * matcher cannot place.
 */
export function providerFromEnv(env: AiEnv): AiProvider {
  const name = (env.AI_PROVIDER ?? 'local').toLowerCase();
  if (name === 'hybrid') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('AI_PROVIDER=hybrid needs ANTHROPIC_API_KEY');
    return new MockProvider();
  }
  if (name === 'claude') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('AI_PROVIDER=claude needs ANTHROPIC_API_KEY');
    return new ClaudeProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL,
      baseUrl: env.ANTHROPIC_BASE_URL,
    });
  }
  // no outside model (docs/design/91): the chatbot answers with EduPro's own matcher; reports use the template
  if (name === 'local') return new MockProvider();
  if (name === 'mock') {
    if (env.NODE_ENV === 'production')
      throw new Error('AI_PROVIDER=mock is refused in production; set AI_PROVIDER=local or claude');
    return new MockProvider();
  }
  throw new Error(`Unknown AI_PROVIDER "${name}" (local, hybrid, claude or mock)`);
}

/**
 * Claude for the hybrid assistant (docs/design/93): with `AI_PROVIDER=hybrid` and a key, Claude Haiku 5.5 (or
 * AI_MODEL) with no thinking and low effort — it chooses one approved query and writes a short answer. Else null.
 */
export function claudeFromEnv(env: AiEnv): ClaudeProvider | null {
  if ((env.AI_PROVIDER ?? 'local').toLowerCase() !== 'hybrid' || !env.ANTHROPIC_API_KEY)
    return null;
  return new ClaudeProvider({
    apiKey: env.ANTHROPIC_API_KEY,
    model: env.AI_MODEL,
    baseUrl: env.ANTHROPIC_BASE_URL,
    timeoutMs: 30_000,
    maxRetries: 1,
    thinkingOff: true,
    effort: 'low',
  });
}
