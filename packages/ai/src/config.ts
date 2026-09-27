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
 */
export function providerFromEnv(env: AiEnv): AiProvider {
  const name = (env.AI_PROVIDER ?? 'mock').toLowerCase();
  if (name === 'claude') {
    if (!env.ANTHROPIC_API_KEY) throw new Error('AI_PROVIDER=claude needs ANTHROPIC_API_KEY');
    return new ClaudeProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL,
      baseUrl: env.ANTHROPIC_BASE_URL,
    });
  }
  if (name === 'mock') {
    if (env.NODE_ENV === 'production')
      throw new Error('AI_PROVIDER=mock is refused in production; set AI_PROVIDER=claude');
    return new MockProvider();
  }
  throw new Error(`Unknown AI_PROVIDER "${name}" (claude or mock)`);
}
