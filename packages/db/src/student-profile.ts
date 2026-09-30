import {
  PROFILE_FIELDS,
  PROFILE_FIELD_BY_KEY,
  PROFILE_LIST_DEFAULTS,
  type ProfileField,
} from './student-fields';

/** A profile value as the API and forms see it: text (dates as YYYY-MM-DD), a number, or empty. */
export type ProfileValue = string | number | null;
export type ProfileValues = Record<string, ProfileValue>;
export type ProfileLists = Record<string, string[]>;

export type Normalised = { ok: true; value: ProfileValue } | { ok: false; error: string };

const PATTERNS: Partial<Record<ProfileField['type'], { re: RegExp; error: string }>> = {
  digits12: { re: /^\d{12}$/, error: '12 digits, no spaces' },
  digits11: { re: /^\d{11}$/, error: '11 digits' },
  mobile: { re: /^[6-9]\d{9}$/, error: '10-digit mobile starting 6-9, no +91 or 0' },
  pin: { re: /^[1-9]\d{5}$/, error: '6-digit PIN code' },
  pan: { re: /^[A-Z]{5}\d{4}[A-Z]$/, error: '10 characters, e.g. ABCDE1234F' },
  ifsc: { re: /^[A-Z]{4}0[A-Z0-9]{6}$/, error: '11 characters, 5th is 0, e.g. SBIN0001234' },
  account: { re: /^\d{9,18}$/, error: '9 to 18 digits' },
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, error: 'a valid email address' },
};

/** Accepts YYYY-MM-DD, DD-MM-YYYY and DD/MM/YYYY (the sheet's format); returns YYYY-MM-DD. */
export function parseDate(raw: string): string | null {
  const s = raw.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else {
    r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
    if (!r) return null;
    [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || y > 2100) return null;
  return `${String(y)}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Options of a list: the school's master values when it has any, otherwise the defaults. */
export function optionsOf(field: ProfileField, lists: ProfileLists): string[] {
  if (!field.list) return [];
  const school = lists[field.list];
  return school && school.length > 0 ? school : (PROFILE_LIST_DEFAULTS[field.list] ?? []);
}

/**
 * Validates and normalises one raw value. Empty input means "no value" (null). List values match
 * case-insensitively and come back in the list's own spelling.
 */
export function normaliseValue(
  field: ProfileField,
  raw: unknown,
  lists: ProfileLists = {},
): Normalised {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  let s = (typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw : '').trim();
  if (typeof raw !== 'string' && typeof raw !== 'number')
    return { ok: false, error: 'must be text or a number' };
  if (s === '') return { ok: true, value: null };
  if (s.length > 300) return { ok: false, error: 'at most 300 characters' };
  switch (field.type) {
    case 'auto':
      return { ok: false, error: 'is calculated automatically' };
    case 'date': {
      const d = parseDate(s);
      return d ? { ok: true, value: d } : { ok: false, error: 'a date as DD-MM-YYYY' };
    }
    case 'number': {
      const n = Number(s.replace(/,/g, ''));
      if (!Number.isFinite(n) || n < 0) return { ok: false, error: 'a number of 0 or more' };
      if (field.key === 'disability_percent' && n > 100)
        return { ok: false, error: 'between 0 and 100' };
      if (field.key === 'roll_no' && (!Number.isInteger(n) || n < 1 || n > 999))
        return { ok: false, error: 'a whole number from 1 to 999' };
      return { ok: true, value: n };
    }
    case 'year': {
      const n = Number(s);
      const now = new Date().getUTCFullYear();
      return Number.isInteger(n) && n >= 1940 && n <= now
        ? { ok: true, value: String(n) }
        : { ok: false, error: `a 4-digit year from 1940 to ${String(now)}` };
    }
    case 'list': {
      const options = optionsOf(field, lists);
      const hit = options.find((o) => o.toLowerCase() === s.toLowerCase());
      return hit
        ? { ok: true, value: hit }
        : {
            ok: false,
            error: `one of: ${options.slice(0, 12).join(', ')}${options.length > 12 ? ', …' : ''}`,
          };
    }
    default:
      break;
  }
  if (field.type === 'mobile') s = s.replace(/[\s-]/g, '').replace(/^(\+91|0091|0)(?=\d{10}$)/, '');
  if (field.type === 'digits12' || field.type === 'digits11' || field.type === 'account')
    s = s.replace(/[\s-]/g, '');
  if (field.type === 'pan' || field.type === 'ifsc') s = s.replace(/\s/g, '').toUpperCase();
  if (field.type === 'email') s = s.toLowerCase();
  const p = PATTERNS[field.type];
  if (p && !p.re.test(s)) return { ok: false, error: p.error };
  if (field.upper) s = s.toUpperCase();
  return { ok: true, value: s };
}

/** Whether a field applies given the other values (its `when` condition). */
export function applies(field: ProfileField, values: ProfileValues): boolean {
  if (!field.when) return true;
  const v = values[field.when.key];
  const s = v === null || v === undefined ? '' : String(v);
  if (field.when.in) return field.when.in.includes(s);
  if (field.when.notIn) return !field.when.notIn.includes(s);
  return true;
}

/** Completeness over required fields that apply: percent and the keys still missing. */
export function completeness(values: ProfileValues): { percent: number; missing: string[] } {
  const required = PROFILE_FIELDS.filter(
    (f) => f.required && f.store.t !== 'auto' && applies(f, values),
  );
  const missing = required
    .filter((f) => {
      const v = values[f.key];
      return v === null || v === undefined || v === '';
    })
    .map((f) => f.key);
  const percent =
    required.length === 0
      ? 100
      : Math.round(((required.length - missing.length) / required.length) * 100);
  return { percent, missing };
}

/**
 * Computed fields. Age is in completed years as on 31 March of the academic year's start
 * (session 2026-27 → 31-03-2026), the usual admission cut-off. Staff ward is Yes when the father,
 * mother or guardian is school staff.
 */
export function autoValues(values: ProfileValues, academicYearStart: string | null): ProfileValues {
  let age: number | null = null;
  const dob = typeof values.dob === 'string' ? values.dob : null;
  if (dob && academicYearStart) {
    const year = Number(academicYearStart.slice(0, 4));
    const [by, bm, bd] = dob.split('-').map(Number) as [number, number, number];
    age = year - by - (bm > 3 || (bm === 3 && bd > 31) ? 1 : 0);
    if (age < 0) age = null;
  }
  const staff = ['father_school_staff', 'mother_school_staff', 'guardian_school_staff'].some(
    (k) => values[k] === 'Yes',
  );
  const anyAnswered = ['father_school_staff', 'mother_school_staff', 'guardian_school_staff'].some(
    (k) => values[k] === 'Yes' || values[k] === 'No',
  );
  return { age, staff_ward: staff ? 'Yes' : anyAnswered ? 'No' : null };
}

/** Validates a set of changes; unknown keys and read-only fields are errors. */
export function validateChanges(
  changes: Record<string, unknown>,
  lists: ProfileLists,
): { values: ProfileValues; errors: Record<string, string> } {
  const values: ProfileValues = {};
  const errors: Record<string, string> = {};
  for (const [key, raw] of Object.entries(changes)) {
    const field = PROFILE_FIELD_BY_KEY.get(key);
    if (!field) {
      errors[key] = 'unknown field';
      continue;
    }
    if (field.store.t === 'auto' || field.store.t === 'enrol') {
      errors[key] =
        field.store.t === 'auto'
          ? 'is calculated automatically'
          : 'changes through enrolment (class, section, roll number)';
      continue;
    }
    // a masked sensitive value sent back unchanged (XXXX-XXXX-1234) means "leave it as it is"
    if (field.sensitive && typeof raw === 'string' && /^X{2,}/i.test(raw.trim())) continue;
    const n = normaliseValue(field, raw, lists);
    if (n.ok) values[key] = n.value;
    else errors[key] = `${field.label}: ${n.error}`;
  }
  return { values, errors };
}
