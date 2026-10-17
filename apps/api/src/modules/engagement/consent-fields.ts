import { z } from 'zod';
import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';

/**
 * The fields of a consent form (docs/design/28-consent-forms.md): their shape, the show / hide /
 * require rules, the school lists a choice may take its options from, and the check of a response's
 * answers (a drawn signature comes as a PNG data URL). The rules are mirrored in packages/ui ConsentFill for the screen; the server never trusts
 * the screen: a hidden field's answer is dropped, a rule-required field is checked here.
 */
export const FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'email',
  'phone',
  'date',
  'time',
  'radio',
  'select',
  'checkbox',
  'yesno',
  'file',
  'signature',
  'agree',
  'heading',
  'pagebreak',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];
/** Fields that only lay the form out: no answer. */
export const LAYOUT: FieldType[] = ['heading', 'pagebreak'];
export const SOURCES = ['classes', 'sections', 'houses', 'routes', 'departments'] as const;
export const OPS = ['eq', 'neq', 'contains', 'gt', 'lt', 'in', 'empty', 'not_empty'] as const;

const ConditionSchema = z.object({
  field: z.string().trim().min(1).max(40),
  op: z.enum(OPS),
  value: z.string().trim().max(200).optional(),
});
export const RuleSchema = z.object({
  logic: z.enum(['all', 'any']).default('all'),
  action: z.enum(['show', 'hide', 'require']),
  conditions: z.array(ConditionSchema).min(1).max(10),
});
export const FieldSchema = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-z0-9_]{0,39}$/, 'a key is small letters, digits and _'),
    label: z.string().trim().min(1).max(300),
    type: z.enum(FIELD_TYPES),
    required: z.boolean().default(false),
    help: z.string().trim().max(500).optional(),
    placeholder: z.string().trim().max(120).optional(),
    options: z.array(z.string().trim().min(1).max(120)).max(100).optional(),
    source: z.enum(SOURCES).optional(),
    min: z.number().optional(),
    max: z.number().optional(),
    maxLength: z.number().int().min(1).max(5000).optional(),
    /** files: how many (1 to 5) */
    maxFiles: z.number().int().min(1).max(5).optional(),
    rule: RuleSchema.optional(),
  })
  .refine(
    (f) =>
      !['radio', 'select', 'checkbox'].includes(f.type) || f.source || (f.options?.length ?? 0) > 0,
    { message: 'a choice needs options or a school list', path: ['options'] },
  );
export type Field = z.infer<typeof FieldSchema>;
export type Answer = string | number | boolean | string[] | null;
export type Answers = Record<string, Answer>;

/** The fields as a whole: keys unique, rules only on fields before or after that exist. */
export function checkFields(fields: Field[]) {
  const keys = new Set<string>();
  for (const f of fields) {
    if (keys.has(f.key))
      throw new DomainError('consent.field_key', `Two fields have the key "${f.key}"`, {
        status: 400,
      });
    keys.add(f.key);
  }
  for (const f of fields)
    for (const c of f.rule?.conditions ?? [])
      if (!keys.has(c.field) || c.field === f.key)
        throw new DomainError(
          'consent.rule_field',
          `The rule of "${f.label}" looks at "${c.field}", which is not another field of the form`,
          { status: 400 },
        );
}

const empty = (v: Answer | undefined) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

function holds(c: z.infer<typeof ConditionSchema>, v: Answer | undefined): boolean {
  const text = Array.isArray(v) ? v.join(', ') : v === undefined || v === null ? '' : String(v);
  const want = c.value ?? '';
  switch (c.op) {
    case 'eq':
      return Array.isArray(v) ? v.includes(want) : text.toLowerCase() === want.toLowerCase();
    case 'neq':
      return Array.isArray(v) ? !v.includes(want) : text.toLowerCase() !== want.toLowerCase();
    case 'contains':
      return text.toLowerCase().includes(want.toLowerCase());
    case 'gt':
      return text !== '' && Number(text) > Number(want);
    case 'lt':
      return text !== '' && Number(text) < Number(want);
    case 'in': {
      const list = want.split(',').map((x) => x.trim().toLowerCase());
      return Array.isArray(v)
        ? v.some((x) => list.includes(x.toLowerCase()))
        : list.includes(text.toLowerCase());
    }
    case 'empty':
      return empty(v);
    case 'not_empty':
      return !empty(v);
  }
}

/** Is the field shown, and must it be answered, given the answers so far? */
export function ruleState(f: Field, answers: Answers): { shown: boolean; required: boolean } {
  if (!f.rule) return { shown: true, required: f.required };
  const results = f.rule.conditions.map((c) => holds(c, answers[c.field]));
  const match = f.rule.logic === 'any' ? results.some(Boolean) : results.every(Boolean);
  if (f.rule.action === 'show') return { shown: match, required: match && f.required };
  if (f.rule.action === 'hide') return { shown: !match, required: !match && f.required };
  return { shown: true, required: f.required || match };
}

/** The options of a choice taken from a school list, by source. */
export async function sourceOptions(
  c: PoolClient,
  fields: Field[],
): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for (const s of new Set(fields.map((f) => f.source).filter(Boolean)) as Set<string>) {
    const sql: Record<string, string> = {
      classes: `SELECT name AS v FROM classes WHERE deleted_at IS NULL ORDER BY display_order, name`,
      sections: `SELECT c.name || '-' || cs.name AS v FROM class_sections cs JOIN classes c ON c.id = cs.class_id
                  WHERE cs.academic_year_id = app.current_academic_year_id() AND cs.deleted_at IS NULL ORDER BY c.display_order, cs.name`,
      houses: `SELECT DISTINCT house AS v FROM students WHERE house IS NOT NULL AND house <> '' AND deleted_at IS NULL ORDER BY 1`,
      routes: `SELECT name AS v FROM transport_routes WHERE deleted_at IS NULL ORDER BY name`,
      departments: `SELECT DISTINCT department AS v FROM employees WHERE department IS NOT NULL AND department <> '' AND deleted_at IS NULL ORDER BY 1`,
    };
    const r = await c
      .query<{ v: string }>(sql[s]!)
      .then((x) => x.rows.map((y) => y.v))
      .catch(() => [] as string[]);
    out[s] = r;
  }
  return out;
}

/**
 * Checks the answers against the fields: hidden fields dropped, required ones present, numbers in
 * range, choices among the options, files named. Returns the answers kept and the file ids to check.
 */
export function checkAnswers(
  fields: Field[],
  given: Answers,
  lists: Record<string, string[]>,
): { answers: Answers; fileIds: string[]; signatures: Record<string, Buffer> } {
  const answers: Answers = {};
  const fileIds: string[] = [];
  const signatures: Record<string, Buffer> = {};
  const bad = (f: Field, why: string): never => {
    throw new DomainError('consent.answer', `${f.label}: ${why}`, { status: 400 });
  };
  for (const f of fields) {
    if (LAYOUT.includes(f.type)) continue;
    const { shown, required } = ruleState(f, given);
    if (!shown) continue;
    let v = given[f.key];
    if (typeof v === 'string') v = v.trim();
    if (f.type === 'agree' || f.type === 'yesno') {
      if (v === 'true' || v === 'yes' || v === 'on') v = true;
      if (v === 'false' || v === 'no') v = false;
    }
    if (f.type === 'agree' && required && v !== true) bad(f, 'please tick to agree');
    if (empty(v) || (f.type === 'yesno' && v === undefined)) {
      if (required) bad(f, 'an answer is needed');
      continue;
    }
    const options = f.source ? (lists[f.source] ?? []) : (f.options ?? []);
    switch (f.type) {
      case 'number': {
        const n = Number(v);
        if (!Number.isFinite(n)) bad(f, 'a number is needed');
        if (f.min !== undefined && n < f.min) bad(f, `at least ${f.min}`);
        if (f.max !== undefined && n > f.max) bad(f, `at most ${f.max}`);
        v = n;
        break;
      }
      case 'email':
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v))) bad(f, 'an email address is needed');
        break;
      case 'phone':
        if (!/^\+?[0-9 -]{7,16}$/.test(String(v))) bad(f, 'a phone number is needed');
        break;
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) bad(f, 'a date is needed');
        break;
      case 'time':
        if (!/^\d{2}:\d{2}$/.test(String(v))) bad(f, 'a time is needed');
        break;
      case 'radio':
      case 'select':
        if (!options.includes(String(v))) bad(f, 'choose one of the options');
        break;
      case 'checkbox': {
        const list = Array.isArray(v) ? v : [String(v)];
        if (list.some((x) => !options.includes(x))) bad(f, 'choose among the options');
        v = list;
        break;
      }
      case 'yesno':
        if (typeof v !== 'boolean') bad(f, 'yes or no');
        break;
      case 'agree':
        if (v !== true) continue;
        break;
      case 'signature': {
        // drawn on the screen: a PNG data URL (kept beside the response, the answer says "signed")
        const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(v));
        if (!m) bad(f, 'please sign in the box');
        const png = Buffer.from(m![1]!, 'base64');
        if (png.length < 50 || png.length > 300_000) bad(f, 'please sign again');
        signatures[f.key] = png;
        v = true;
        break;
      }
      case 'file': {
        const list = (Array.isArray(v) ? v : [String(v)]).filter((x) => /^\d+$/.test(x));
        if (!list.length) {
          if (required) bad(f, 'a file is needed');
          continue;
        }
        if (list.length > (f.maxFiles ?? 1)) bad(f, 'too many files');
        fileIds.push(...list);
        v = list;
        break;
      }
      default: {
        const s = String(v);
        if (s.length > (f.maxLength ?? (f.type === 'textarea' ? 5000 : 500)))
          bad(f, 'the answer is too long');
        v = s;
      }
    }
    answers[f.key] = v ?? null;
  }
  return { answers, fileIds, signatures };
}

/** An answer as text for the register, Excel and PDF. */
export function answerText(f: Field, v: Answer | undefined): string {
  if (v === undefined || v === null || v === '') return '';
  if (f.type === 'yesno') return v === true ? 'Yes' : 'No';
  if (f.type === 'agree') return v === true ? 'Agreed' : '';
  if (f.type === 'signature') return v === true ? 'Signed' : '';
  if (f.type === 'file')
    return `${(v as string[]).length} file${(v as string[]).length === 1 ? '' : 's'}`;
  return Array.isArray(v) ? v.join(', ') : String(v);
}
