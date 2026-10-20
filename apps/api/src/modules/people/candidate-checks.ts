/**
 * The candidate's own checks on top of the employee master's (docs/design/34-recruitment.md): an age of
 * 18 to 65, names in letters, an Aadhaar number with a right check digit, the alternate mobile not the
 * same, months under twelve, no dates in the future, a year of passing after the age of 14, marks as a
 * percentage or a CGPA, experience from before to, and the address's city in its state and the state in
 * its country (the school's lists only). The careers form runs the same rules in the browser
 * (apps/public/lib/career-checks.ts); these are the ones that count.
 */
export const CANDIDATE_AGE = { min: 18, max: 65 } as const;

type Value = string | number | null | undefined;

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

/** An Aadhaar number: 12 digits, not starting 0 or 1, the last one the Verhoeff check digit. */
export function aadhaarOk(s: string): boolean {
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

/** Today's date in India (YYYY-MM-DD). */
export const todayIst = (now = new Date()) =>
  new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** Whole years from a date of birth to a day (both YYYY-MM-DD). */
export function ageOn(dob: string, day: string): number {
  const [y, m, d] = dob.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = day.split('-').map(Number) as [number, number, number];
  return ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
}

const shift = (day: string, years: number) =>
  `${String(Number(day.slice(0, 4)) + years).padStart(4, '0')}${day.slice(4)}`;
/** The day after (YYYY-MM-DD). */
const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
const NAME = /^\p{L}[\p{L}\p{M} .'’-]*$/u;
const NAMES = new Set(['first_name', 'last_name', 'father_name', 'spouse_name']);

/** The school's lists of places: each state's country and each city's state. */
export interface Places {
  states: Array<{ name: string; country: string | null }>;
  cities: Array<{ name: string; state: string | null }>;
}

/**
 * Checks the answers being saved (`keys`) against the whole form as it will stand (`all`); returns the
 * refusals by field key. Values are the master's normalised ones (dates YYYY-MM-DD, digits only).
 */
export function checkCandidateValues(
  keys: Iterable<string>,
  all: Record<string, Value>,
  places: Places,
  today = todayIst(),
): Record<string, string> {
  const out: Record<string, string> = {};
  const s = (k: string) => {
    const v = all[k];
    return v === null || v === undefined ? '' : String(v).trim();
  };
  for (const k of keys) {
    const v = s(k);
    if (!v) continue;
    if (NAMES.has(k) && !NAME.test(v)) out[k] = "letters only (spaces . ' - allowed)";
    else if (k === 'dob') {
      const age = ageOn(v, today);
      if (age < CANDIDATE_AGE.min || age > CANDIDATE_AGE.max)
        out[k] =
          `your age must be ${String(CANDIDATE_AGE.min)} to ${String(CANDIDATE_AGE.max)}: born ` +
          `between ${dmy(nextDay(shift(today, -CANDIDATE_AGE.max - 1)))} and ${dmy(shift(today, -CANDIDATE_AGE.min))}`;
    } else if (k === 'aadhaar' && !aadhaarOk(v))
      out[k] = 'not a valid Aadhaar number: check the 12 digits';
    else if (k === 'alternate_mobile' && v === s('mobile'))
      out[k] = 'another number than your mobile';
    else if (k === 'total_exp_months' && !(Number(v) >= 0 && Number(v) <= 11))
      out[k] = '0 to 11 months';
    else if (k === 'total_exp_years' && Number(v) > 50) out[k] = 'at most 50 years';
    else if (k === 'testimonials' && !(Number.isInteger(Number(v)) && Number(v) <= 100))
      out[k] = 'a whole number up to 100';
    else if (k === 'last_employment_end' && v > today) out[k] = 'not a date in the future';
    else if (/^(present|permanent)_state$/.test(k)) {
      const country = s(k.replace('_state', '_country'));
      const st = places.states.find((x) => x.name.toLowerCase() === v.toLowerCase());
      if (country && st?.country && st.country.toLowerCase() !== country.toLowerCase())
        out[k] = `not a state of ${country}`;
    } else if (/^(present|permanent)_city$/.test(k)) {
      const state = s(k.replace('_city', '_state'));
      const ci = places.cities.filter((x) => x.name.toLowerCase() === v.toLowerCase());
      if (
        state &&
        ci.length &&
        !ci.some((x) => (x.state ?? '').toLowerCase() === state.toLowerCase())
      )
        out[k] = `not a city of ${state} in the school's list`;
    }
  }
  return out;
}

/** Marks as a percentage (0 to 100, "72" or "72%"), out of a total ("450/600") or a CGPA up to 10 ("8.2 CGPA"). */
export function scoreOk(s: string): boolean {
  const of = /^(\d{1,4}(?:\.\d{1,2})?)\s*\/\s*(\d{1,4})$/.exec(s);
  if (of) return Number(of[1]) <= Number(of[2]) && Number(of[2]) > 0;
  const pct = /^(\d{1,3}(?:\.\d{1,2})?)\s*%?(?:\s+\S.*)?$/.exec(s);
  const gpa = /^(\d{1,2}(?:\.\d{1,2})?)\s*(?:cgpa|cpi|gpa|sgpa)\b/i.exec(s);
  if (gpa) return Number(gpa[1]) <= 10;
  return pct ? Number(pct[1]) <= 100 : false;
}

/** One row of a list (dates YYYY-MM-DD): the refusals by column. */
export function checkCandidateRow(
  kind: string,
  row: Record<string, string | null>,
  dob: string | null,
  today = todayIst(),
): Record<string, string> {
  const out: Record<string, string> = {};
  const year = Number(today.slice(0, 4));
  const at14 = dob ? shift(dob, 14) : null;
  if (kind === 'education') {
    const y = row.passingYear ? Number(row.passingYear) : null;
    if (y !== null && y > year) out.passingYear = 'not a year in the future';
    else if (y !== null && at14 && y < Number(at14.slice(0, 4)))
      out.passingYear = 'a year after you were 14';
    if (row.score && !scoreOk(row.score))
      out.score = 'a percentage (0 to 100), marks out of a total (450/600) or a CGPA (8.2 CGPA)';
  } else if (kind === 'experience') {
    if (row.fromOn && row.fromOn > today) out.fromOn = 'not a date in the future';
    else if (row.fromOn && at14 && row.fromOn < at14) out.fromOn = 'a date after you were 14';
    if (row.toOn && row.toOn > today) out.toOn = 'not a date in the future';
    else if (row.fromOn && row.toOn && row.toOn < row.fromOn) out.toOn = 'on or after From';
  } else if (kind === 'training') {
    if (row.year && Number(row.year) > year) out.year = 'not a year in the future';
  } else if (kind === 'children') {
    if (row.dob && row.dob > today) out.dob = 'not a date in the future';
  } else if (kind === 'references') {
    if (row.phone && !/^[0-9+()\- ]{6,20}$/.test(row.phone)) out.phone = 'a phone number';
  }
  return out;
}
