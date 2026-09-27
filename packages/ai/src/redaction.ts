/**
 * Redaction before anything reaches a model or a log (design principle 4: prompts carry the minimum data).
 * Masks Indian mobiles, emails, Aadhaar-like 12-digit numbers, PAN, card-like 16-digit numbers, and any
 * names the caller lists (students and guardians the answer may mention).
 */
export interface RedactionResult {
  text: string;
  counts: Record<RedactionKind, number>;
  total: number;
}

export type RedactionKind = 'mobile' | 'email' | 'aadhaar' | 'pan' | 'card' | 'name';

export interface RedactionOptions {
  /** Names to mask (case-insensitive, whole words). */
  names?: string[];
  /** Replacement token per kind; defaults to [mobile], [email] ... */
  tokens?: Partial<Record<RedactionKind, string>>;
}

const PATTERNS: Array<[RedactionKind, RegExp]> = [
  ['card', /\b(?:\d[ -]?){15}\d\b/g],
  ['aadhaar', /\b\d{4}[ -]?\d{4}[ -]?\d{4}\b/g],
  ['mobile', /(?<![\d])(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\d])/g],
  ['email', /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g],
  ['pan', /\b[A-Z]{5}\d{4}[A-Z]\b/g],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redact(input: string, options: RedactionOptions = {}): RedactionResult {
  const counts: Record<RedactionKind, number> = {
    mobile: 0,
    email: 0,
    aadhaar: 0,
    pan: 0,
    card: 0,
    name: 0,
  };
  let text = input;
  for (const [kind, re] of PATTERNS) {
    text = text.replace(re, () => {
      counts[kind] += 1;
      return options.tokens?.[kind] ?? `[${kind}]`;
    });
  }
  const names = (options.names ?? []).map((n) => n.trim()).filter((n) => n.length >= 2);
  if (names.length) {
    const re = new RegExp(`\\b(?:${names.map(escapeRe).join('|')})\\b`, 'gi');
    text = text.replace(re, () => {
      counts.name += 1;
      return options.tokens?.name ?? '[name]';
    });
  }
  return { text, counts, total: Object.values(counts).reduce((a, b) => a + b, 0) };
}

/** Redacts every string inside a JSON-like value (tool inputs and outputs before audit). */
export function redactDeep<T>(value: T, options: RedactionOptions = {}): T {
  if (typeof value === 'string') return redact(value, options).text as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, options)) as unknown as T;
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redactDeep(v, options)]),
    ) as T;
  return value;
}
