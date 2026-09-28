import type { AiProvider } from './provider';
import { estimateCostPaise } from './budget';

/** A fact the narrative may use; mirrors ReportFact in @edupro/db without importing it. */
export interface NarrativeFact {
  id: string;
  label: string;
  value: string | number | null;
  unit?: string;
  detail?: Record<string, string | number | null>;
}

export interface NarrativeInput {
  title: string;
  /** e.g. "22 to 28 September 2026" */
  period: string;
  school: string;
  audience: 'principal' | 'department';
  facts: NarrativeFact[];
  language: 'en' | 'hi';
}

export interface NarrativeResult {
  narrative: string;
  /** Fact ids the narrative cites, in order of first use. */
  citations: string[];
  /** Fact ids mentioned that do not exist (a model hallucinating a source): the caller may refuse the report. */
  unknownCitations: string[];
  provider: string;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  costPaise: number;
  latencyMs: number;
}

const CITE = /\[([a-z_]+\.[a-z_]+)\]/g;

const fmt = (f: NarrativeFact): string => {
  if (f.value === null || f.value === undefined) return '—';
  if (f.unit === '₹') return `₹${Number(f.value).toLocaleString('en-IN')}`;
  if (f.unit === '%') return `${f.value}%`;
  return String(f.value);
};

/**
 * The offline narrative: one sentence per fact with its citation, a comparison when the fact carries one.
 * Deterministic, so tests and the development stack produce the same text for the same facts.
 */
export function templateNarrative(input: NarrativeInput): string {
  const hi = input.language === 'hi';
  const lines: string[] = [];
  lines.push(hi ? `${input.title} — ${input.period}` : `${input.title} — ${input.period}`);
  for (const f of input.facts) {
    const v = fmt(f);
    let sentence = hi ? `${f.label}: ${v}` : `${f.label}: ${v}`;
    const d = f.detail ?? {};
    if (
      d.previousPeriod !== undefined &&
      d.previousPeriod !== null &&
      typeof f.value === 'number'
    ) {
      const prev = Number(d.previousPeriod);
      const diff = f.value - prev;
      const dir =
        diff > 0
          ? hi
            ? 'अधिक'
            : 'up'
          : diff < 0
            ? hi
              ? 'कम'
              : 'down'
            : hi
              ? 'समान'
              : 'unchanged';
      const by =
        f.unit === '₹'
          ? `₹${Math.abs(diff).toLocaleString('en-IN')}`
          : f.unit === '%'
            ? `${Math.abs(Math.round(diff * 10) / 10)} points`
            : String(Math.abs(diff));
      sentence += hi
        ? ` (पिछली अवधि ${fmt({ ...f, value: prev })} से ${diff === 0 ? '' : by + ' '}${dir})`
        : ` (${dir}${diff === 0 ? '' : ` ${by}`} on ${fmt({ ...f, value: prev })} in the previous period)`;
    }
    const extras = Object.entries(d)
      .filter(([k, v]) => k !== 'previousPeriod' && v !== null && v !== undefined && v !== '')
      .slice(0, 4)
      .map(([k, v]) => `${k} ${String(v)}`);
    if (extras.length) sentence += `; ${extras.join(', ')}`;
    lines.push(`${sentence}. [${f.id}]`);
  }
  if (input.facts.length === 0)
    lines.push(
      hi ? 'इस अवधि के लिए कोई आँकड़ा नहीं मिला।' : 'No figures were available for this period.',
    );
  return lines.join('\n');
}

const SYSTEM = `You write short weekly reports for a school from the facts given. Rules: use only the facts
and numbers provided; after every sentence that states a number, cite the fact in square brackets by its id,
for example [fees.collected]; never invent a figure or a cause; three to eight sentences, plain words, no
headings; mention the biggest change first. Write in the language asked.`;

/**
 * Sprint 16 (AI track): facts → narrative through the provider. With the mock provider (development and tests)
 * the template writes the text; with Claude the model writes it and every cited id is checked against the
 * facts. Unknown citations are reported so the caller can refuse to publish.
 */
export async function writeNarrative(
  provider: AiProvider,
  input: NarrativeInput,
): Promise<NarrativeResult> {
  const started = Date.now();
  const known = new Set(input.facts.map((f) => f.id));
  const finish = (
    text: string,
    usage: { inputTokens: number; outputTokens: number },
    model: string,
    providerName: string,
  ): NarrativeResult => {
    const citations: string[] = [];
    const unknown: string[] = [];
    for (const m of text.matchAll(CITE)) {
      const id = m[1]!;
      if (!known.has(id)) {
        if (!unknown.includes(id)) unknown.push(id);
      } else if (!citations.includes(id)) citations.push(id);
    }
    return {
      narrative: text.trim(),
      citations,
      unknownCitations: unknown,
      provider: providerName,
      model,
      usage,
      costPaise: estimateCostPaise(model, usage),
      latencyMs: Date.now() - started,
    };
  };
  if (provider.name === 'mock') {
    const text = templateNarrative(input);
    return finish(text, { inputTokens: 0, outputTokens: 0 }, provider.model, provider.name);
  }
  const res = await provider.complete({
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: `${input.title} for ${input.school}, period ${input.period}, audience: ${input.audience}. Language: ${input.language === 'hi' ? 'Hindi (Devanagari)' : 'English'}.\nFacts (JSON):\n${JSON.stringify(input.facts, null, 1)}`,
      },
    ],
    maxTokens: 700,
    temperature: 0.2,
  });
  return finish(res.text, res.usage, res.model, res.provider);
}
