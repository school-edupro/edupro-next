/**
 * The checks a staff member's own profile changes get on top of each field's format (normaliseValue: mobile, email,
 * PAN, IFSC, Aadhaar, account, dates, numbers, list values): a required field cannot be emptied, names are letters,
 * the date of birth gives an age of 18 to 80, the anniversary is not in the future nor before the birth, children
 * are 0 to 20, a phone is 6 to 15 digits, and the emergency contact's mobile is not one's own. The staff website and
 * the staff app check the same before sending (apps/teacher/lib/profile-rules.ts, apps/mobile/lib/staff/my_profile.dart).
 */
type Value = string | number | null;

/** The people's names among the fields (letters, spaces and . ' - only). */
export const NAME_FIELDS = new Set([
  'first_name',
  'last_name',
  'spouse_name',
  'father_name',
  'emergency_name',
  'bank_account_name',
]);

const NAME = /^[A-Za-z][A-Za-z .'-]*$/;

/** Years between two YYYY-MM-DD dates (whole years, as an age). */
function yearsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number) as [number, number, number];
  const [ty, tm, td] = to.split('-').map(Number) as [number, number, number];
  return ty - fy - (tm < fm || (tm === fm && td < fd) ? 1 : 0);
}

/**
 * The errors of the changed values, by field (`Label: what is wrong`). [changes] are the values after their format
 * was checked; [current] what is on file (the other half of a pair, e.g. the date of birth for the anniversary);
 * [today] the school's date (YYYY-MM-DD).
 */
export function selfFieldErrors(
  fields: ReadonlyMap<string, { label: string; required?: boolean }>,
  changes: Record<string, Value>,
  current: Record<string, Value | undefined>,
  today: string,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const after = (k: string): Value =>
    k in changes ? (changes[k] ?? null) : ((current[k] ?? null) as Value);
  for (const [key, value] of Object.entries(changes)) {
    const f = fields.get(key);
    if (!f) continue;
    const label = f.label;
    if (value === null || value === '') {
      if (f.required) errors[key] = `${label}: is required`;
      continue;
    }
    const s = String(value).trim();
    if (NAME_FIELDS.has(key) && !NAME.test(s)) {
      errors[key] = `${label}: letters, spaces and . ' - only`;
      continue;
    }
    switch (key) {
      case 'dob': {
        if (s > today) errors[key] = `${label}: cannot be in the future`;
        else {
          const age = yearsBetween(s, today);
          if (age < 18 || age > 80) errors[key] = `${label}: the age must be from 18 to 80`;
        }
        break;
      }
      case 'anniversary': {
        const dob = after('dob');
        if (s > today) errors[key] = `${label}: cannot be in the future`;
        else if (typeof dob === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dob) && s <= dob)
          errors[key] = `${label}: must be after the date of birth`;
        break;
      }
      case 'sons':
      case 'daughters': {
        const n = Number(s);
        if (!Number.isInteger(n) || n < 0 || n > 20)
          errors[key] = `${label}: a whole number from 0 to 20`;
        break;
      }
      case 'phone': {
        const digits = s.replace(/\D/g, '');
        if (!/^\+?[\d\s-]+$/.test(s) || digits.length < 6 || digits.length > 15)
          errors[key] = `${label}: a phone number of 6 to 15 digits`;
        break;
      }
      case 'emergency_mobile': {
        const own = after('mobile');
        if (own !== null && String(own) === s)
          errors[key] = `${label}: give another person's number, not your own`;
        break;
      }
      default:
        break;
    }
  }
  return errors;
}
