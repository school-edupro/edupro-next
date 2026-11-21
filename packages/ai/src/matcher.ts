/**
 * The chatbot's own reader (docs/design/91): no outside model. A question is matched to the approved queries (the
 * catalogue) by their words and phrasings in English, Hindi and Hinglish, and the query's inputs are read from it
 * (a day, a period, a class or section, an amount, a threshold, how many). Nothing leaves the server; the numbers
 * always come from the database. Pure functions — the API runs the chosen query with the person's rights.
 */

export interface MatchCandidate {
  id: string;
  /** words or short phrases that point to this query (longer = more specific) */
  keywords: string[];
  /** whole example questions (English, Hindi, Hinglish) */
  phrases?: string[];
  params: Array<{ name: string; type: string; required?: boolean }>;
}

export interface MatchContext {
  /** today in the school's time, YYYY-MM-DD */
  today: string;
  classes?: Array<{ id: string; code: string }>;
  /** sections as `VI-A` */
  sections?: Array<{ id: string; label: string }>;
}

export type MatchResult =
  | { kind: 'match'; id: string; params: Record<string, unknown>; score: number }
  | { kind: 'ambiguous'; ids: string[] }
  | { kind: 'none'; reason: 'not_data' | 'unknown'; near: string[] };

/** Questions that are not about reading school records: changes, the outside world, creative requests. */
const NOT_DATA =
  /\b(delete|remove|drop table|truncate|update|change|set|reset|send|post|pay now|transfer|poem|joke|story|weather|news|song|cricket|movie|recipe|translate|write an? essay|who is the (?:pm|prime minister|president))\b/i;

/** The least score that picks a query: a single short word such as "class" is not enough. */
const THRESHOLD = 6;

/** Lower case, Hinglish spellings brought together, punctuation to spaces. */
export function normalise(text: string): string {
  const t = text
    .toLowerCase()
    // 10,000 is one number
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/[“”"'`’?!.,;:()[\]{}]/g, ' ')
    .replace(/\bhaziri\b/g, 'hazri')
    .replace(/\bfee\b/g, 'fees')
    .replace(/\bhome ?work\b/g, 'homework')
    .replace(/\btime ?table\b/g, 'timetable')
    .replace(/\s+/g, ' ')
    .trim();
  return ` ${t} `;
}

const tokens = (s: string) =>
  normalise(s)
    .trim()
    .split(' ')
    .filter((w) => w.length >= 3);

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;

const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
};

/** A day named in the question: a date, "today", "yesterday", "12 Nov", "12/11". */
export function readDay(q: string, today: string): string | null {
  const x = /(\d{4}-\d{2}-\d{2})/.exec(q);
  if (x) return x[1]!;
  if (/\b(today|aaj)\b|आज/.test(q)) return today;
  if (/\b(yesterday|kal)\b|कल/.test(q)) return addDays(today, -1);
  const year = today.slice(0, 4);
  const dm = /\b(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/.exec(q);
  const md = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})\b/.exec(q);
  const [day, mon] = dm ? [dm[1]!, dm[2]!] : md ? [md[2]!, md[1]!] : [null, null];
  if (day && mon) {
    const m = MONTHS.indexOf(mon as (typeof MONTHS)[number]) + 1;
    return `${year}-${String(m).padStart(2, '0')}-${String(Number(day)).padStart(2, '0')}`;
  }
  const slash = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(q);
  if (slash) {
    const y = slash[3] ? (slash[3].length === 2 ? `20${slash[3]}` : slash[3]) : year;
    return `${y}-${slash[2]!.padStart(2, '0')}-${slash[1]!.padStart(2, '0')}`;
  }
  return null;
}

/** How many days back the question asks about: "last 10 days", "this week", "this month", "last month". */
export function readDays(q: string, today: string): number | null {
  const n = /\blast\s+(\d+)\s+days?\b|\b(\d+)\s+din\b|(\d+)\s+दिन/.exec(q);
  if (n) return Number(n[1] ?? n[2] ?? n[3]);
  if (/\b(this week|is hafte|is week|iss hafte)\b|इस सप्ताह|इस हफ्ते/.test(q)) return 7;
  if (/\b(last week|pichhle hafte|pichle hafte)\b|पिछले सप्ताह|पिछले हफ्ते/.test(q)) return 14;
  const dayOfMonth = Number(today.slice(8, 10));
  if (/\b(last month|pichhle mahine|pichle mahine)\b|पिछले महीने/.test(q)) return dayOfMonth + 31;
  if (/\b(this month|is mahine|iss mahine)\b|इस महीने/.test(q)) return Math.max(dayOfMonth - 1, 0);
  if (/\b(this year|this session|is saal)\b|इस साल|इस सत्र/.test(q)) return 365;
  return null;
}

/**
 * Picks the query a question is about and reads its inputs. A clear winner is a match; two queries scoring the same
 * are "did you mean"; nothing over the threshold (or a question that is not about reading records) is none, with
 * the nearest queries to suggest.
 */
export function matchQuestion(
  question: string,
  candidates: MatchCandidate[],
  ctx: MatchContext,
): MatchResult {
  const q = normalise(question);
  const words = new Set(tokens(question));
  const scored = candidates
    .map((c) => {
      // longer keywords are more specific: "defaulter" beats "class", "collection by mode" beats "collection"
      const keyword = c.keywords
        .filter((k) => q.includes(normalise(k).trim()))
        .reduce((n, k) => n + k.length, 0);
      // a whole example question: shared words add a little, so close wordings win ties
      const phrase = Math.max(
        0,
        ...(c.phrases ?? []).map((p) => tokens(p).filter((w) => words.has(w)).length * 2),
      );
      return { c, score: keyword + (keyword > 0 ? phrase : Math.min(phrase, 4)) };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  const near = scored.slice(0, 3).map((x) => x.c.id);
  if (NOT_DATA.test(q)) return { kind: 'none', reason: 'not_data', near: [] };
  const best = scored[0];
  if (!best || best.score < THRESHOLD) return { kind: 'none', reason: 'unknown', near };
  const tied = scored.filter((x) => x.score === best.score);
  if (tied.length > 1) return { kind: 'ambiguous', ids: tied.slice(0, 3).map((x) => x.c.id) };
  return { kind: 'match', id: best.c.id, params: readParams(q, best.c, ctx), score: best.score };
}

/** The query's inputs from the question (only those the query has). */
export function readParams(
  q: string,
  c: MatchCandidate,
  ctx: MatchContext,
): Record<string, unknown> {
  const has = (name: string) => c.params.some((p) => p.name === name);
  const out: Record<string, unknown> = {};
  if (has('sectionId')) {
    const sec = (ctx.sections ?? []).find((s) => {
      const [k, n] = s.label.toLowerCase().split('-');
      return k && n && new RegExp(`\\b${k}\\s*-?\\s*${n}\\b`).test(q);
    });
    if (sec) out.sectionId = sec.id;
  }
  if (has('classId')) {
    const cls = (ctx.classes ?? []).find((k) =>
      new RegExp(`\\bclass\\s+${k.code.toLowerCase()}\\b|\\b${k.code.toLowerCase()}\\b`).test(q),
    );
    if (cls) out.classId = cls.id;
  }
  if (has('date')) {
    const d = readDay(q, ctx.today);
    if (d) out.date = d;
  }
  if (has('days')) {
    const d = readDays(q, ctx.today);
    if (d !== null) out.days = d;
  }
  if (has('minAmount')) {
    const a = /(?:above|over|more than|से अधिक|se zyada|se jyada)\s*₹?\s*([\d,]+)/.exec(q);
    if (a) out.minAmount = Number(a[1]!.replace(/,/g, ''));
  }
  if (has('threshold')) {
    const t = /(?:below|under|less than|से कम|se kam)\s*(\d{1,3})\s*%?/.exec(q);
    if (t) out.threshold = Number(t[1]);
  }
  if (has('minAbsences')) {
    const m = /(?:more than|over|at least)\s*(\d+)\s*(?:absences|days absent|times)/.exec(q);
    if (m) out.minAbsences = Number(m[1]);
  }
  if (has('limit')) {
    const l = /\btop\s+(\d+)\b/.exec(q);
    if (l) out.limit = Number(l[1]);
  }
  if (has('q')) {
    const name = /(?:find|about|of|named|student)\s+([a-z]+(?:\s+[a-z]+)?)/.exec(q);
    const adm = /\b([a-z]{0,4}\d{2,}[a-z0-9-]*)\b/.exec(q);
    if (adm) out.q = adm[1];
    else if (name) out.q = name[1];
  }
  return out;
}
