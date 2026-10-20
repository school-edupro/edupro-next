/**
 * The careers form's checks in the browser, the same rules the API applies (the employee master's field
 * types and the candidate's own: apps/api/src/modules/people/candidate-checks.ts). The API's word counts;
 * these show a mistake beside the answer as the candidate leaves it, before anything is sent.
 */
import type { CareerColumn, CareerField, CareerForm } from './careers';

export type Answers = Record<string, string>;

const PATTERNS: Record<string, { re: RegExp; error: string }> = {
  digits12: { re: /^\d{12}$/, error: '12 digits' },
  digits11: { re: /^\d{11}$/, error: '11 digits' },
  mobile: { re: /^[6-9]\d{9}$/, error: 'a 10-digit mobile number starting 6, 7, 8 or 9' },
  pin: { re: /^[1-9]\d{5}$/, error: 'a 6-digit PIN code' },
  pan: { re: /^[A-Z]{5}\d{4}[A-Z]$/, error: '10 characters, like ABCDE1234F' },
  email: { re: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, error: 'an email address, like name@example.com' },
};

/** What the input box takes for a field type: keyboard, length, a hint. */
export const INPUT: Record<
  string,
  { inputMode?: 'numeric' | 'email' | 'tel' | 'decimal'; maxLength?: number; hint?: string }
> = {
  mobile: { inputMode: 'tel', maxLength: 10, hint: '10 digits' },
  digits12: { inputMode: 'numeric', maxLength: 14, hint: '12 digits' },
  pin: { inputMode: 'numeric', maxLength: 6, hint: '6 digits' },
  pan: { maxLength: 10, hint: 'Like ABCDE1234F' },
  number: { inputMode: 'decimal', maxLength: 12 },
  email: { inputMode: 'email', maxLength: 120 },
  year: { inputMode: 'numeric', maxLength: 4, hint: 'YYYY' },
};

/** The answer as the API will keep it: digits without spaces, PAN in capitals, no +91 on a mobile. */
export function tidy(type: string, raw: string): string {
  let s = raw.trim();
  if (type === 'mobile') s = s.replace(/[\s-]/g, '').replace(/^(\+91|0091|0)(?=\d{10}$)/, '');
  if (type === 'digits12' || type === 'digits11' || type === 'pin') s = s.replace(/[\s-]/g, '');
  if (type === 'pan') s = s.replace(/\s/g, '').toUpperCase();
  if (type === 'email') s = s.toLowerCase();
  return s;
}

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];
function aadhaarOk(s: string): boolean {
  if (!/^[2-9]\d{11}$/.test(s)) return false;
  let c = 0;
  [...s]
    .reverse()
    .map(Number)
    .forEach((d, i) => {
      c = D[c]![P[i % 8]![d]!]!;
    });
  return c === 0;
}

const shiftYears = (day: string, years: number) =>
  `${String(Number(day.slice(0, 4)) + years).padStart(4, '0')}${day.slice(4)}`;
const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
export const dmy = (d: string | null | undefined) =>
  d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';

/** The dates of birth the age range allows (for the date box's min and max). */
export function birthRange(form: Pick<CareerForm, 'age' | 'today'>) {
  return {
    min: nextDay(shiftYears(form.today, -form.age.max - 1)),
    max: shiftYears(form.today, -form.age.min),
  };
}

/** Whether a field is asked, given the other answers (its `when`). */
export function applies(f: Pick<CareerField, 'when'>, a: Answers): boolean {
  if (!f.when) return true;
  const v = a[f.when.key] ?? '';
  if (f.when.in) return f.when.in.includes(v);
  if (f.when.notIn) return !f.when.notIn.includes(v);
  return true;
}

const NAME = /^\p{L}[\p{L}\p{M} .'’-]*$/u;
const NAMES = new Set(['first_name', 'last_name', 'father_name', 'spouse_name']);

/** The mistake in one answer, or null. `masked` = a sensitive number on file left as it is. */
export function checkField(
  f: CareerField,
  raw: string,
  a: Answers,
  form: CareerForm,
  masked = false,
): string | null {
  const v = tidy(f.type, raw);
  if (!v) return f.required && !masked && applies(f, a) ? 'Fill this in' : null;
  if (v.length > (f.type === 'textarea' ? 2000 : 300)) return 'Too long';
  const p = PATTERNS[f.type];
  if (p && !p.re.test(v)) return `Enter ${p.error}`;
  if (f.type === 'number' && !(Number(v.replace(/,/g, '')) >= 0)) return 'Enter a number';
  if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return 'Enter a date';
  if (
    f.type === 'list' &&
    f.options?.length &&
    !f.options.some((o) => o.toLowerCase() === v.toLowerCase())
  )
    return 'Pick one from the list';
  if (NAMES.has(f.key) && !NAME.test(v)) return "Use letters only (spaces . ' - allowed)";
  if (f.key === 'dob') {
    const r = birthRange(form);
    if (v < r.min || v > r.max)
      return `Your age must be ${String(form.age.min)} to ${String(form.age.max)}: born between ${dmy(r.min)} and ${dmy(r.max)}`;
  }
  if (f.key === 'aadhaar' && !aadhaarOk(v))
    return 'Not a valid Aadhaar number: check the 12 digits';
  if (f.key === 'alternate_mobile' && v === tidy('mobile', a.mobile ?? ''))
    return 'Give another number than your mobile';
  if (f.key === 'total_exp_months' && !(Number(v) >= 0 && Number(v) <= 11)) return 'Enter 0 to 11';
  if (f.key === 'total_exp_years' && Number(v) > 50) return 'At most 50 years';
  if (f.key === 'last_employment_end' && v > form.today) return 'Not a date in the future';
  return null;
}

/** Marks as a percentage, out of a total ("450/600") or a CGPA ("8.2 CGPA"). */
function scoreOk(s: string): boolean {
  const of = /^(\d{1,4}(?:\.\d{1,2})?)\s*\/\s*(\d{1,4})$/.exec(s);
  if (of) return Number(of[1]) <= Number(of[2]) && Number(of[2]) > 0;
  const gpa = /^(\d{1,2}(?:\.\d{1,2})?)\s*(?:cgpa|cpi|gpa|sgpa)\b/i.exec(s);
  if (gpa) return Number(gpa[1]) <= 10;
  const pct = /^(\d{1,3}(?:\.\d{1,2})?)\s*%?(?:\s+\S.*)?$/.exec(s);
  return pct ? Number(pct[1]) <= 100 : false;
}

/** The mistakes in one entry of a list (qualification, job…), by column; an empty entry has none. */
export function checkEntry(
  kind: string,
  columns: CareerColumn[],
  row: Record<string, string>,
  dob: string | null,
  today: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (!columns.some((c) => (row[c.key] ?? '').trim())) return out;
  const year = Number(today.slice(0, 4));
  const at14 = dob ? shiftYears(dob, 14) : null;
  for (const c of columns) {
    const v = (row[c.key] ?? '').trim();
    if (!v) {
      if (c.required) out[c.key] = 'Fill this in';
      continue;
    }
    if (c.type === 'year' && !(/^\d{4}$/.test(v) && Number(v) >= 1940 && Number(v) <= year))
      out[c.key] = `A year from 1940 to ${String(year)}`;
    else if (c.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) out[c.key] = 'Enter a date';
    else if (c.type === 'date' && v > today) out[c.key] = 'Not a date in the future';
  }
  if (kind === 'education') {
    if (
      !out.passingYear &&
      row.passingYear &&
      at14 &&
      Number(row.passingYear) < Number(at14.slice(0, 4))
    )
      out.passingYear = 'A year after you were 14';
    if (row.score?.trim() && !scoreOk(row.score.trim()))
      out.score = 'A percentage, marks out of a total (450/600) or a CGPA (8.2 CGPA)';
  } else if (kind === 'experience') {
    if (!out.fromOn && row.fromOn && at14 && row.fromOn < at14)
      out.fromOn = 'A date after you were 14';
    if (!out.toOn && row.fromOn && row.toOn && row.toOn < row.fromOn) out.toOn = 'On or after From';
  } else if (kind === 'references') {
    if (row.phone?.trim() && !/^[0-9+()\- ]{6,20}$/.test(row.phone.trim()))
      out.phone = 'Enter a phone number';
  }
  return out;
}

/** A mobile or an email shown in part: 98•••••210, k•••@gmail.com. */
export function maskAddress(to: string): string {
  if (/^\d{10}$/.test(to)) return `${to.slice(0, 2)}•••••${to.slice(-3)}`;
  const [user, domain] = to.split('@');
  if (!user || !domain) return to;
  return `${user.slice(0, Math.min(2, user.length))}•••@${domain}`;
}
