/**
 * docs/design/103: the nlq views the chatbot's data questions may read — which rights open each one, its columns'
 * kinds, checked examples — and which of them a question is offered: only those the person's rights cover, the ones
 * whose words the question shares (plus the core views), and the checked examples closest to the question.
 */
import catalogue from './catalogue.json';

export type ColumnKind =
  'id' | 'label' | 'text' | 'date' | 'month' | 'money' | 'number' | 'count' | 'percent' | 'flag';

export interface NlqView {
  view: string;
  area: string;
  oneRowIs: string;
  rights: string[];
  columns: Record<string, ColumnKind>;
  examples: Array<{ question: string; sql: string }>;
}

export const NLQ_VIEWS: readonly NlqView[] = (catalogue as unknown as { views: NlqView[] }).views;

/** Views offered with every question the person's rights allow (the backbone others join to). */
const CORE = ['academic_years', 'students', 'class_sections', 'staff'];

/** The views a person may query: any one of the view's rights. */
export function viewsFor(permissions: ReadonlySet<string> | undefined): NlqView[] {
  if (!permissions) return [];
  return NLQ_VIEWS.filter((v) => v.rights.some((r) => permissions.has(r)));
}

const STOP = new Set(
  'a an the of in on for to by and or is are was were be what which who whom how many much show list give me my our all this that these those with from as at per each every than then please tell'.split(
    ' ',
  ),
);

/** Everyday words → the words the views are named with (a question's words are widened with these). */
const SYNONYMS: Record<string, string[]> = {
  collected: ['receipt', 'collection'],
  collection: ['receipt'],
  received: ['receipt'],
  deposit: ['receipt'],
  due: ['bill', 'balance'],
  dues: ['bill', 'balance'],
  outstanding: ['bill', 'balance'],
  pending: ['bill', 'balance'],
  defaulter: ['bill', 'balance'],
  defaulters: ['bill', 'balance'],
  concession: ['concession', 'discount'],
  discount: ['concession'],
  salary: ['payslip', 'pay'],
  salaries: ['payslip', 'pay'],
  wage: ['payslip'],
  marks: ['exam', 'mark'],
  score: ['exam', 'mark'],
  result: ['exam', 'result'],
  topper: ['exam', 'result', 'rank'],
  absent: ['attendance', 'absent'],
  present: ['attendance', 'present'],
  absentee: ['attendance', 'absent'],
  bus: ['transport', 'route'],
  rider: ['transport'],
  book: ['library', 'copy', 'loan'],
  books: ['library', 'copy', 'loan'],
  borrowed: ['library', 'loan'],
  boarder: ['hostel', 'stay'],
  room: ['hostel', 'bed'],
  teacher: ['staff', 'teacher'],
  teachers: ['staff', 'teacher'],
  employee: ['staff'],
  employees: ['staff'],
  leave: ['leave'],
  enquiry: ['admission', 'enquiry'],
  applicant: ['admission', 'application'],
  admission: ['admission'],
  vendor: ['purchase', 'order'],
  stock: ['stock'],
  sms: ['message'],
  whatsapp: ['message'],
  complaint: ['helpdesk', 'query'],
  visitor: ['visitor'],
};

/** A question's words, lower case, singular-ish (fees → fee, classes → class). */
export function wordsOf(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.add(raw);
    for (const w of SYNONYMS[raw] ?? []) out.add(w);
    if (raw.endsWith('ies')) out.add(`${raw.slice(0, -3)}y`);
    else if (raw.endsWith('es')) out.add(raw.slice(0, -2));
    if (raw.endsWith('s')) out.add(raw.slice(0, -1));
  }
  return out;
}

/** A view's words by weight: its name and subject count most, its columns less, its examples least. */
const viewWords = new Map(
  NLQ_VIEWS.map((v) => [
    v.view,
    [
      { w: 4, words: wordsOf(v.view.replace(/_/g, ' ')) },
      { w: 2, words: wordsOf(`${v.area} ${v.oneRowIs}`) },
      { w: 1, words: wordsOf(Object.keys(v.columns).join(' ').replace(/_/g, ' ')) },
      { w: 0.5, words: wordsOf(v.examples.map((e) => e.question).join(' ')) },
    ],
  ]),
);

const overlap = (a: Set<string>, b: Set<string> | undefined) => {
  if (!b) return 0;
  let n = 0;
  for (const w of a) if (b.has(w)) n += 1;
  return n;
};

const scoreOf = (q: Set<string>, view: string) =>
  (viewWords.get(view) ?? []).reduce((s, part) => s + part.w * overlap(q, part.words), 0);

/** The views to offer for a question: the best matches by shared words (up to `max`), then the core views. */
export function pickViews(question: string, allowed: NlqView[], max = 10): NlqView[] {
  const q = wordsOf(question);
  const scored = allowed
    .map((v) => ({ v, score: scoreOf(q, v.view) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.v.view.localeCompare(b.v.view))
    .slice(0, max)
    .map((x) => x.v);
  for (const name of CORE) {
    const core = allowed.find((v) => v.view === name);
    if (core && !scored.includes(core)) scored.push(core);
  }
  return scored;
}

const VIEW_NAMES = new Set(NLQ_VIEWS.map((v) => v.view));

/** Whether an example's query reads only views in `open` (examples may join across modules). */
export function usesOnly(sql: string, open: ReadonlySet<string>): boolean {
  for (const w of sql.toLowerCase().match(/[a-z_][a-z0-9_]*/g) ?? [])
    if (VIEW_NAMES.has(w) && !open.has(w)) return false;
  return true;
}

/** The checked examples of the offered views closest to the question (they show the model how to write it). */
export function closestExamples(
  question: string,
  views: NlqView[],
  max = 6,
  open?: ReadonlySet<string>,
): Array<{ question: string; sql: string }> {
  const q = wordsOf(question);
  return views
    .flatMap((v) => v.examples)
    .filter((e) => !open || usesOnly(e.sql, open))
    .map((e) => ({ e, score: overlap(q, wordsOf(e.question)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.e);
}

/** A checked example close enough to answer the question as it is (most of its words, and the question's). */
export function matchingExample(
  question: string,
  views: NlqView[],
  open?: ReadonlySet<string>,
): { view: NlqView; question: string; sql: string } | null {
  const q = wordsOf(question);
  if (q.size < 3) return null;
  let best: { view: NlqView; question: string; sql: string; score: number } | null = null;
  for (const v of views)
    for (const e of v.examples) {
      if (open && !usesOnly(e.sql, open)) continue;
      const w = wordsOf(e.question);
      const shared = overlap(q, w);
      const score = shared / Math.max(q.size, w.size);
      if (score >= 0.85 && (!best || score > best.score)) best = { view: v, ...e, score };
    }
  return best ? { view: best.view, question: best.question, sql: best.sql } : null;
}

/** The kind of a result column: the model's word for it, else a view column of that name, else from its values. */
export function kindOf(
  column: string,
  values: unknown[],
  views: NlqView[],
  modelKinds: Record<string, string> | undefined,
): ColumnKind {
  const said = modelKinds?.[column];
  const KINDS: ColumnKind[] = [
    'id',
    'label',
    'text',
    'date',
    'month',
    'money',
    'number',
    'count',
    'percent',
    'flag',
  ];
  if (said && (KINDS as string[]).includes(said)) return said as ColumnKind;
  for (const v of views) if (v.columns[column]) return v.columns[column];
  const seen = values.find((x) => x !== null && x !== undefined);
  if (typeof seen === 'boolean') return 'flag';
  if (typeof seen === 'number')
    return /(amount|fee|paid|balance|net|gross|salary|pay|cost|value|total_amount|collected|due|refund)/.test(
      column,
    )
      ? 'money'
      : 'number';
  if (typeof seen === 'string' && /^\d{4}-\d{2}-\d{2}/.test(seen)) return 'date';
  if (typeof seen === 'string' && /^-?\d+(\.\d+)?$/.test(seen))
    return /(amount|fee|paid|balance|net|gross|salary|pay|cost|value|collected|due|refund)/.test(
      column,
    )
      ? 'money'
      : /(percent|pct|rate)/.test(column)
        ? 'percent'
        : 'number';
  return 'label';
}
