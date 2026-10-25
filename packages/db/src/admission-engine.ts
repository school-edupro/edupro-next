/**
 * Admission form engine (docs/design/39, part 1): the field model of the admission form builder and the
 * rules every place applies the same way — show / hide / require, validation with the school's wording,
 * age as on a date, siblings, stream → subjects, marks with cut-offs, progress.
 *
 * NO IMPORTS: this file is copied as is to packages/ui/src/admission-engine.ts (the browser side runs the
 * same rules; the server checks again). Edit it here, then run `node scripts/sync-admission-engine.mjs`.
 */

export const ADMISSION_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'email',
  'mobile',
  'date',
  'select',
  'radio',
  'checkbox',
  'yesno',
  'file',
  'photo',
  'heading',
  'note',
  'age',
  'siblings',
  'subjects',
  'marks',
  'address_same',
  'agree',
  'signature',
] as const;
export type AdmissionFieldType = (typeof ADMISSION_FIELD_TYPES)[number];

/** Fields that only lay the form out or are worked out: nothing to type. */
export const LAYOUT_TYPES: AdmissionFieldType[] = ['heading', 'note'];

/** Ready checks with the reference form's wording. */
export const PRESETS = [
  'aadhaar',
  'apaar',
  'pen',
  'udise',
  'mobile',
  'pincode',
  'cbse_roll',
  'year',
  'pan',
  'name',
] as const;
export type AdmissionPreset = (typeof PRESETS)[number];

/** Option sources other than the school's lists (resolved by the server into options). */
export const OPTION_SOURCES = [
  'classes',
  'subjects',
  'cities',
  'states',
  'countries',
  'houses',
] as const;
export type OptionSource = (typeof OPTION_SOURCES)[number];

export const RULE_OPS = [
  'eq',
  'neq',
  'in',
  'not_in',
  'empty',
  'not_empty',
  'gt',
  'lt',
  'gte',
  'lte',
] as const;
export type RuleOp = (typeof RULE_OPS)[number];

export interface AdmissionCondition {
  field: string;
  op: RuleOp;
  /** one value, or several separated by | for in / not_in */
  value?: string;
}
export interface AdmissionRule {
  logic: 'all' | 'any';
  action: 'show' | 'hide' | 'require' | 'optional';
  conditions: AdmissionCondition[];
}

export interface SubjectSlot {
  label: string;
  /** a slot every stream has with one subject (e.g. English) */
  fixed?: string;
  /** stream value → the subjects that may be picked here */
  byStream?: Record<string, string[]>;
}
export interface MarksRow {
  key: string;
  label: string;
  /** when the row's subject is picked from a few (e.g. Basic / Standard Mathematics) */
  options?: string[];
}
export interface MarksCutoff {
  /** stream values this cut-off applies to; empty = every stream */
  streams: string[];
  /** row key → minimum marks */
  mins: Record<string, number>;
  aggregate?: number;
  message?: string;
  aggregateMessage?: string;
  /** a row subject that does not count for that row's minimum (e.g. Basic Mathematics) */
  notCounting?: Record<string, string[]>;
}

export interface AdmissionField {
  key: string;
  label: string;
  type: AdmissionFieldType;
  step: string;
  required?: boolean;
  help?: string;
  placeholder?: string;
  width?: 'half' | 'full';
  /** typed options (the builder prefers a school list or a master) */
  options?: string[];
  /** a school list code (Profile lists master) */
  list?: string;
  /** another master */
  source?: OptionSource;
  /**
   * a city list that follows the state chosen in this field (its key): only that state's cities. Not set:
   * the only state field on the same tab, if there is one (linkCityStates); '' for any city.
   */
  dependsOn?: string;
  preset?: AdmissionPreset;
  min?: number;
  max?: number;
  maxLength?: number;
  upper?: boolean;
  readOnly?: boolean;
  /** a value set by the office / the login (class sought, school) and shown locked */
  fixedValue?: string;
  rules?: AdmissionRule[];
  /** the student-master field this answer goes to on Admit */
  maps?: string;
  /** no master field: keep it as an additional student-master field (created on save) */
  copy?: boolean;
  /** files: the student document kind on Admit */
  docKind?: string;
  accept?: 'image' | 'image_pdf';
  maxFiles?: number;
  /** age: the date-of-birth field */
  dobField?: string;
  /** siblings: up to how many */
  maxSiblings?: number;
  /** subjects: the stream field and the slots */
  streamField?: string;
  slots?: SubjectSlot[];
  /** marks: rows, out of, cut-offs */
  outOf?: number;
  rows?: MarksRow[];
  cutoffs?: MarksCutoff[];
  /** address_same: copy these fields to those when ticked */
  copyFrom?: string[];
  copyTo?: string[];
}

export interface AdmissionStep {
  key: string;
  title: string;
}

export interface AdmissionFormSettings {
  title?: string;
  notice?: string;
  declaration?: string;
  /** age as on this date (YYYY-MM-DD) */
  ageAsOn?: string;
  /** date of birth must be within */
  dobFrom?: string;
  dobTo?: string;
  /** PIN codes must start with one of these (empty = any) */
  pincodePrefixes?: string[];
  /** alumni pass-out year must be below this */
  passOutBefore?: number;
  /** type in capitals (emails stay small letters) */
  upperCase?: boolean;
  maxFileMb?: number;
}

export interface AdmissionFormDef {
  steps: AdmissionStep[];
  fields: AdmissionField[];
  settings: AdmissionFormSettings;
}

export interface SiblingAnswer {
  admissionNo: string;
  name?: string | null;
  classSection?: string | null;
}
export type AdmissionAnswer =
  | string
  | number
  | boolean
  | string[]
  | null
  | { count: number; list: SiblingAnswer[] }
  | Record<string, { subject?: string; marks: number | null }>;
export type AdmissionAnswers = Record<string, AdmissionAnswer | undefined>;

// ---- helpers ------------------------------------------------------------------------------------------

export function isEmptyAnswer(v: AdmissionAnswer | undefined): boolean {
  if (v === undefined || v === null || v === '') return true;
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === 'object') {
    if ('count' in v && 'list' in v) return false; // a sibling count of 0 is an answer
    return Object.keys(v).length === 0;
  }
  return false;
}

const text = (v: AdmissionAnswer | undefined): string => {
  if (v === undefined || v === null) return '';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return 'count' in v ? String((v as { count: number }).count) : '';
  return String(v);
};

const num = (x: string) => x !== '' && Number.isFinite(Number(x));

/** A yes / no switch keeps true / false: a rule written "Yes" / "No" (or true / false) matches it. */
const yesNo = (x: string) =>
  ['yes', 'true', 'y', '1'].includes(x) ? 'yes' : ['no', 'false', 'n', '0'].includes(x) ? 'no' : x;

function holds(c: AdmissionCondition, v: AdmissionAnswer | undefined): boolean {
  const flag = typeof v === 'boolean';
  const have = flag ? (v ? 'yes' : 'no') : text(v).trim().toLowerCase();
  const wants = (c.value ?? '')
    .split('|')
    .map((x) => x.trim().toLowerCase())
    .filter((x) => x !== '')
    .map((x) => (flag ? yesNo(x) : x));
  const want = wants[0] ?? '';
  const list = Array.isArray(v) ? v.map((x) => x.toLowerCase()) : [have];
  switch (c.op) {
    case 'eq':
      return list.includes(want);
    case 'neq':
      return !list.includes(want);
    case 'in':
      return list.some((x) => wants.includes(x));
    case 'not_in':
      return !list.some((x) => wants.includes(x));
    case 'empty':
      return isEmptyAnswer(v);
    case 'not_empty':
      return !isEmptyAnswer(v);
    // comparisons need a number on both sides: a blank answer is not 0
    case 'gt':
      return num(have) && num(want) && Number(have) > Number(want);
    case 'lt':
      return num(have) && num(want) && Number(have) < Number(want);
    case 'gte':
      return num(have) && num(want) && Number(have) >= Number(want);
    case 'lte':
      return num(have) && num(want) && Number(have) <= Number(want);
    default:
      return false;
  }
}

/** Whether a set of conditions holds (fee categories, enquiry filters). */
export function conditionsHold(
  conditions: AdmissionCondition[],
  logic: 'all' | 'any',
  answers: AdmissionAnswers,
): boolean {
  if (!conditions.length) return false;
  const results = conditions.map((c) => holds(c, answers[c.field]));
  return logic === 'any' ? results.some(Boolean) : results.every(Boolean);
}

/** A merit point criterion (docs/design/40): conditions on the answers and the points they give. */
export interface PointCriterion {
  name: string;
  logic: 'all' | 'any';
  conditions: AdmissionCondition[];
  points: number;
}
/** One line of a registration's points: what the criterion gives, what was worked out, what counts. */
export interface PointLine {
  name: string;
  /** the criterion's points */
  max: number;
  /** worked out from the answers: the points when the conditions hold, else 0 */
  auto: number;
  /** what counts: the worked-out points, or the office's award */
  points: number;
  /** why the office awarded differently */
  reason?: string | null;
}

/** The points of a set of answers, a line per criterion (0 when it does not hold). */
export function workPoints(criteria: PointCriterion[], answers: AdmissionAnswers): PointLine[] {
  return criteria.map((r) => {
    const auto = conditionsHold(r.conditions, r.logic, answers) ? r.points : 0;
    return { name: r.name, max: r.points, auto, points: auto };
  });
}

/** The total of point lines, to two decimals. */
export function pointsTotal(lines: PointLine[]): number {
  return Math.round(lines.reduce((n, l) => n + l.points, 0) * 100) / 100;
}

/** The fee category of a candidate: the first (in order) whose conditions hold, else the default. */
export function matchCategory<
  T extends { conditions: AdmissionCondition[]; logic: 'all' | 'any'; isDefault: boolean },
>(categories: T[], answers: AdmissionAnswers): T | null {
  for (const c of categories)
    if (!c.isDefault && conditionsHold(c.conditions, c.logic, answers)) return c;
  return categories.find((c) => c.isDefault) ?? null;
}

/** Whether a field shows and whether it must be answered, given the answers so far. */
export function fieldState(
  f: AdmissionField,
  answers: AdmissionAnswers,
): { shown: boolean; required: boolean } {
  let shown = true;
  let required = Boolean(f.required);
  for (const r of f.rules ?? []) {
    const results = r.conditions.map((c) => holds(c, answers[c.field]));
    const ok = r.logic === 'any' ? results.some(Boolean) : results.every(Boolean);
    if (r.action === 'show') shown = shown && ok;
    else if (r.action === 'hide') shown = shown && !ok;
    else if (r.action === 'require' && ok) required = true;
    else if (r.action === 'optional' && ok) required = false;
  }
  if (LAYOUT_TYPES.includes(f.type) || f.type === 'age' || f.readOnly || f.fixedValue)
    required = false;
  return { shown, required: shown && required };
}

/**
 * The answers that count: an answer left in a field that is now hidden is dropped, again and again
 * until nothing changes, so it cannot keep showing the fields that hang on it (a father's "alumnus: Yes"
 * once the mother is the single parent).
 */
export function liveAnswers(def: AdmissionFormDef, answers: AdmissionAnswers): AdmissionAnswers {
  let cur = answers;
  for (let pass = 0; pass < def.fields.length + 1; pass++) {
    const gone = def.fields.filter((f) => f.key in cur && !fieldState(f, cur).shown);
    if (!gone.length) break;
    cur = { ...cur };
    for (const f of gone) delete cur[f.key];
  }
  return cur;
}

/** Steps that have at least one field shown. */
export function visibleSteps(def: AdmissionFormDef, answers: AdmissionAnswers): AdmissionStep[] {
  const live = liveAnswers(def, answers);
  return def.steps.filter((s) =>
    def.fields.some((f) => f.step === s.key && fieldState(f, live).shown),
  );
}

/** Age as on a date, e.g. "12 Years 3 Months 4 Days". */
export function ageOn(
  dob: string,
  ref: string,
): { years: number; months: number; days: number; text: string } | null {
  const m1 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dob);
  const m2 = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ref);
  if (!m1 || !m2) return null;
  let y = Number(m2[1]) - Number(m1[1]);
  let m = Number(m2[2]) - Number(m1[2]);
  let d = Number(m2[3]) - Number(m1[3]);
  if (d < 0) {
    m -= 1;
    // days in the month before the reference month
    d += new Date(Date.UTC(Number(m2[1]), Number(m2[2]) - 1, 0)).getUTCDate();
  }
  if (m < 0) {
    y -= 1;
    m += 12;
  }
  if (y < 0) return null;
  return { years: y, months: m, days: d, text: `${y} Years ${m} Months ${d} Days` };
}

const DMY = (iso: string) => `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}`;

/** The checks a preset applies; returns the message or null. */
export function presetError(
  preset: AdmissionPreset,
  raw: string,
  settings: AdmissionFormSettings,
  label: string,
): string | null {
  const v = raw.trim();
  switch (preset) {
    case 'aadhaar':
      return /^\d{12}$/.test(v.replace(/[\s-]/g, ''))
        ? null
        : 'Please enter 12 digit Aadhar number';
    case 'apaar':
      return /^\d{12}$/.test(v) ? null : 'Please enter 12 digit Apaar Id';
    case 'pen':
      return /^[0-9A-Za-z]{1,20}$/.test(v) ? null : `Please enter a valid ${label}`;
    case 'udise':
      return /^\d{11}$/.test(v) ? null : 'Please enter the 11 digit UDISE number';
    case 'mobile':
      if (!/^\d{10}$/.test(v)) return 'Please enter 10 digit mobile number';
      return /^[6-9]/.test(v) ? null : 'Invalid mobile number. Must start with 6,7,8 or 9';
    case 'pincode': {
      if (!/^\d{6}$/.test(v)) return 'Please enter 6 digit pincode';
      const p = settings.pincodePrefixes ?? [];
      if (p.length && !p.some((x) => v.startsWith(x)))
        return `Enter valid pincode starting with following series only ${p.map((x) => `"${x}XXX"`).join(', ')}`;
      return null;
    }
    case 'cbse_roll':
      return /^\d{1,10}$/.test(v) ? null : 'Please enter 10 digit CBSE Roll No';
    case 'year': {
      if (!/^\d{4}$/.test(v)) return 'Please enter a 4 digit year';
      if (settings.passOutBefore && Number(v) >= settings.passOutBefore)
        return `Pass out year must be less than ${String(settings.passOutBefore)}`;
      return null;
    }
    case 'pan':
      return /^[A-Z]{5}\d{4}[A-Z]$/i.test(v) ? null : 'Please enter a valid PAN';
    case 'name':
      return /^(mr|mrs|ms|dr|prof)\.?\s/i.test(v)
        ? 'Avoid titles like Mr., Mrs., Dr., Prof.'
        : null;
    default:
      return null;
  }
}

/** The marks rule: which cut-off applies to the chosen stream and whether it is met. */
export function marksError(
  f: AdmissionField,
  value: AdmissionAnswer | undefined,
  answers: AdmissionAnswers,
): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rows = f.rows ?? [];
  const outOf = f.outOf ?? 100;
  const marks = value as Record<string, { subject?: string; marks: number | null }>;
  for (const r of rows) {
    const m = marks[r.key]?.marks;
    if (m === null || m === undefined || Number.isNaN(Number(m)))
      return `Enter the marks for ${r.label}`;
    if (Number(m) < 0 || Number(m) > outOf) return `Marks must be between 0 and ${String(outOf)}`;
    if (r.options?.length && !marks[r.key]?.subject) return `Choose the subject for ${r.label}`;
  }
  const stream = f.streamField ? text(answers[f.streamField]) : '';
  for (const c of f.cutoffs ?? []) {
    if (c.streams.length && !c.streams.some((s) => s.toLowerCase() === stream.toLowerCase()))
      continue;
    for (const [key, min] of Object.entries(c.mins)) {
      const row = marks[key];
      const notCounting = (c.notCounting?.[key] ?? []).map((x) => x.toLowerCase());
      const subjectOk = !row?.subject || !notCounting.includes(row.subject.toLowerCase());
      if (!row || Number(row.marks) < min || !subjectOk)
        return c.message ?? `You need a minimum of ${String(min)} in the required subjects.`;
    }
    if (c.aggregate !== undefined && rows.length) {
      const total = rows.reduce((s, r) => s + Number(marks[r.key]?.marks ?? 0), 0);
      const pct = (total / (rows.length * outOf)) * 100;
      if (pct < c.aggregate)
        return (
          c.aggregateMessage ??
          `You need an aggregate of ${String(c.aggregate)}% or above in ${String(rows.length)} subjects.`
        );
    }
  }
  return null;
}

/** One field's error, or null. `options` are the field's resolved options (lists / masters). */
export function fieldError(
  f: AdmissionField,
  answers: AdmissionAnswers,
  settings: AdmissionFormSettings,
  options?: string[],
): string | null {
  const st = fieldState(f, answers);
  if (!st.shown || LAYOUT_TYPES.includes(f.type) || f.type === 'age') return null;
  const v = answers[f.key];
  if (isEmptyAnswer(v)) {
    if (!st.required) return null;
    if (f.type === 'file' || f.type === 'photo') return `${f.label} is required.`;
    if (f.type === 'agree') return 'Please confirm the details before submitting.';
    return `${f.label} is mandatory!`;
  }
  switch (f.type) {
    case 'email':
      return /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(text(v).trim())
        ? null
        : 'Please enter a valid email address!';
    case 'mobile':
      return presetError('mobile', text(v), settings, f.label);
    case 'number': {
      const n = Number(v);
      if (Number.isNaN(n)) return `${f.label} must be a number`;
      if (f.min !== undefined && n < f.min) return `${f.label} must be at least ${String(f.min)}`;
      if (f.max !== undefined && n > f.max) return `${f.label} must be at most ${String(f.max)}`;
      break;
    }
    case 'date': {
      const d = text(v);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return `${f.label}: enter a valid date`;
      const isDob = Boolean(f.maps === 'dob' || /dob|birth/i.test(f.key));
      if (
        isDob &&
        settings.dobFrom &&
        settings.dobTo &&
        (d < settings.dobFrom || d > settings.dobTo)
      )
        return `DOB must be between ${DMY(settings.dobFrom)} & ${DMY(settings.dobTo)} !`;
      break;
    }
    case 'select':
    case 'radio': {
      if (
        options &&
        options.length &&
        !options.some((o) => o.toLowerCase() === text(v).toLowerCase())
      )
        return `${f.label}: choose from the list`;
      break;
    }
    case 'checkbox': {
      const vals = Array.isArray(v) ? v : [text(v)];
      if (options && options.length && vals.some((x) => !options.includes(x)))
        return `${f.label}: choose from the list`;
      break;
    }
    case 'siblings': {
      const s = v as { count: number; list: SiblingAnswer[] };
      const max = f.maxSiblings ?? 3;
      if (!Number.isInteger(s.count) || s.count < 0 || s.count > max)
        return `${f.label}: choose 0 to ${String(max)}`;
      for (let i = 0; i < s.count; i++)
        if (!s.list[i]?.admissionNo?.trim())
          return `Please enter Admission No (Sibling ${String(i + 1)})!`;
      if (s.list.slice(s.count).some((x) => x?.admissionNo?.trim()))
        return 'Please remove the sibling data!';
      break;
    }
    case 'subjects': {
      const picked = Array.isArray(v) ? v : [];
      const slots = f.slots ?? [];
      const stream = f.streamField ? text(answers[f.streamField]) : '';
      for (let i = 0; i < slots.length; i++) {
        const slot = slots[i]!;
        const chosen = picked[i] ?? '';
        const allowed = slot.fixed ? [slot.fixed] : (slot.byStream?.[stream] ?? []);
        if (!chosen) return `Choose ${slot.label}`;
        if (allowed.length && !allowed.includes(chosen))
          return `${slot.label}: choose from the list`;
      }
      if (new Set(picked.filter(Boolean)).size !== picked.filter(Boolean).length)
        return 'The same subject cannot be chosen twice';
      break;
    }
    case 'marks':
      return marksError(f, v, answers);
    case 'agree':
      return v === true ? null : 'Please confirm the details before submitting.';
    default:
      break;
  }
  if (typeof v === 'string') {
    if (f.maxLength && v.length > f.maxLength)
      return `${f.label}: at most ${String(f.maxLength)} characters`;
    if (f.preset) return presetError(f.preset, v, settings, f.label);
  }
  return null;
}

/** Errors of the fields on one step (or every step when `step` is omitted), keyed by field. */
export function formErrors(
  def: AdmissionFormDef,
  answers: AdmissionAnswers,
  optionsOf: (f: AdmissionField, answers: AdmissionAnswers) => string[] | undefined,
  step?: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  const live = liveAnswers(def, answers);
  for (const f of def.fields) {
    if (step && f.step !== step) continue;
    const e = fieldError(f, live, def.settings, optionsOf(f, live));
    if (e) out[f.key] = e;
  }
  return out;
}

/** Required fields shown, and how many are answered: the progress bar. */
export function formProgress(def: AdmissionFormDef, answers: AdmissionAnswers): number {
  let need = 0;
  let have = 0;
  const live = liveAnswers(def, answers);
  for (const f of def.fields) {
    const st = fieldState(f, live);
    if (!st.required) continue;
    need += 1;
    if (!isEmptyAnswer(answers[f.key])) have += 1;
  }
  return need === 0 ? 100 : Math.round((have / need) * 100);
}

/** Every answer shown, worked out and cleaned: hidden fields drop, capitals applied, age filled. */
export function cleanAnswers(def: AdmissionFormDef, answers: AdmissionAnswers): AdmissionAnswers {
  const out: AdmissionAnswers = {};
  const live = liveAnswers(def, answers);
  for (const f of def.fields) {
    if (LAYOUT_TYPES.includes(f.type)) continue;
    if (!fieldState(f, live).shown) continue;
    let v = answers[f.key];
    if (f.fixedValue) v = f.fixedValue;
    if (f.type === 'age') {
      const dob = f.dobField ? text(answers[f.dobField]) : '';
      const ref = def.settings.ageAsOn ?? '';
      v = dob && ref ? (ageOn(dob, ref)?.text ?? null) : null;
    }
    if (typeof v === 'string') {
      v = v.trim();
      if (f.type === 'email') v = v.toLowerCase();
      else if ((f.upper ?? def.settings.upperCase) && ['text', 'textarea'].includes(f.type))
        v = v.toUpperCase();
      if (f.preset === 'aadhaar') v = v.replace(/[\s-]/g, '');
    }
    if (f.type === 'siblings' && v && typeof v === 'object' && 'count' in v) {
      const s = v as { count: number; list: SiblingAnswer[] };
      v = { count: s.count, list: s.list.slice(0, s.count) };
    }
    if (!isEmptyAnswer(v)) out[f.key] = v;
    else if (f.type === 'siblings') out[f.key] = v;
  }
  return out;
}

/** The value as a person reads it (lists, PDF, emails). */
export function answerText(f: AdmissionField, v: AdmissionAnswer | undefined): string {
  if (isEmptyAnswer(v)) return '';
  if (f.type === 'yesno') return v === true || v === 'Yes' ? 'Yes' : 'No';
  if (f.type === 'agree') return v === true ? 'Agreed' : '';
  if (f.type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return DMY(v);
  if (f.type === 'siblings' && v && typeof v === 'object' && 'count' in v) {
    const s = v as { count: number; list: SiblingAnswer[] };
    if (!s.count) return 'None';
    return s.list
      .slice(0, s.count)
      .map(
        (x, i) =>
          `${String(i + 1)}. ${x.admissionNo}${x.name ? ` ${x.name}` : ''}${x.classSection ? ` (${x.classSection})` : ''}`,
      )
      .join('; ');
  }
  if (f.type === 'marks' && v && typeof v === 'object' && !Array.isArray(v)) {
    const m = v as Record<string, { subject?: string; marks: number | null }>;
    return (f.rows ?? [])
      .map((r) => `${m[r.key]?.subject ?? r.label}: ${String(m[r.key]?.marks ?? '')}`)
      .join(', ');
  }
  if (f.type === 'subjects' && Array.isArray(v))
    return v.map((x, i) => `${f.slots?.[i]?.label ?? `Subject ${String(i + 1)}`}: ${x}`).join(', ');
  if (f.type === 'file' || f.type === 'photo')
    return Array.isArray(v) ? `${String(v.length)} file${v.length === 1 ? '' : 's'}` : '1 file';
  return text(v);
}

/**
 * Links each city list to the state it follows: the one set in the builder, or else the only state field
 * on its tab ('' keeps any city). The fill screens and the server's checks both use the linked form.
 */
export function linkCityStates(def: AdmissionFormDef): AdmissionFormDef {
  const isState = (x: AdmissionField) => x.source === 'states' || x.list === 'State';
  return {
    ...def,
    fields: def.fields.map((f) => {
      if (f.source !== 'cities' || f.dependsOn !== undefined) return f;
      const same = def.fields.filter((x) => x.step === f.step && isState(x));
      return same.length === 1 ? { ...f, dependsOn: same[0]!.key } : f;
    }),
  };
}

/** Form-level checks the builder runs before saving a form. */
export function defProblems(def: AdmissionFormDef): string[] {
  const out: string[] = [];
  const keys = new Set<string>();
  const steps = new Set(def.steps.map((s) => s.key));
  if (!def.steps.length) out.push('Add at least one tab');
  for (const f of def.fields) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(f.key))
      out.push(`${f.label}: the key must be small letters, digits and _`);
    if (keys.has(f.key)) out.push(`Two fields use the key ${f.key}`);
    keys.add(f.key);
    if (!steps.has(f.step)) out.push(`${f.label}: its tab does not exist`);
    if (
      ['select', 'radio', 'checkbox'].includes(f.type) &&
      !f.list &&
      !f.source &&
      !f.options?.length
    )
      out.push(`${f.label}: choose a list, a master or type the options`);
    if (f.type === 'age' && !f.dobField) out.push(`${f.label}: choose the date of birth field`);
    if (f.type === 'subjects' && (!f.streamField || !f.slots?.length))
      out.push(`${f.label}: choose the stream field and add the subject slots`);
    if (f.type === 'marks' && !f.rows?.length) out.push(`${f.label}: add the subject rows`);
    if (f.dependsOn) {
      const st = def.fields.find((x) => x.key === f.dependsOn);
      if (!st) out.push(`${f.label}: the state field it follows does not exist`);
      else if (st.source !== 'states' && st.list !== 'State')
        out.push(`${f.label}: it can follow only a state field (${st.label} is not one)`);
    }
    for (const r of f.rules ?? [])
      for (const c of r.conditions)
        if (!def.fields.some((x) => x.key === c.field))
          out.push(`${f.label}: a rule uses a field that does not exist (${c.field})`);
  }
  return out;
}
