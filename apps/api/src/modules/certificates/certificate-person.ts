/**
 * The person's details a certificate prints, as boxes at issue (17 Nov 2026): filled from the record, any of them
 * changed for this certificate only — the record is not touched. Only the details the chosen layout prints are asked
 * (found in its wording, in the order it prints them). The certificate keeps each change with the record's value.
 */
import { dateInWords, maskAadhaarText } from './certificate-data';

export interface PersonSpec {
  /** where the layout reads it: student.fatherName, employee.designation, tc.lastClass */
  path: string;
  label: string;
  kind: 'text' | 'date';
}
export interface PersonBox extends PersonSpec {
  /** the box's value: as printed now (a date as yyyy-mm-dd) */
  value: string;
  /** the record's value, as it prints */
  record: string;
  changed: boolean;
}
/** what was changed on the certificate: path → the record's value and the printed one */
export type Printed = Record<string, { label: string; record: string; printed: string }>;

const t = (path: string, label: string): PersonSpec => ({ path, label, kind: 'text' });
const d = (path: string, label: string): PersonSpec => ({ path, label, kind: 'date' });

/**
 * Every detail of a person a layout may print. The admission number and the employee code stay as in the record (they
 * name the person in the register); the pronouns follow the record's gender.
 */
export const PERSON_DETAILS: PersonSpec[] = [
  t('student.name', 'Name of the student'),
  t('student.fatherName', "Father's name"),
  t('student.motherName', "Mother's name"),
  t('student.guardianName', "Guardian's name"),
  t('student.nationality', 'Nationality'),
  t('student.category', 'Category (SC / ST / OBC / General)'),
  t('student.religion', 'Religion'),
  t('student.caste', 'Caste'),
  t('student.motherTongue', 'Mother tongue'),
  t('student.placeOfBirth', 'Place of birth'),
  d('student.dob', 'Date of birth'),
  t('student.dobWords', 'Date of birth in words'),
  d('student.admittedOn', 'Date of first admission'),
  t('student.admissionClass', 'Class at first admission'),
  t('student.admissionClassLabel', 'Class at first admission'),
  t('student.classLabel', 'Class and section'),
  t('student.className', 'Class'),
  t('student.classWords', 'Class in words'),
  t('student.section', 'Section'),
  t('student.rollNo', 'Roll no.'),
  t('student.house', 'House'),
  t('student.academicYear', 'Academic year'),
  d('student.leftOn', 'Date of leaving'),
  t('student.address', 'Address'),
  t('student.pen', 'PEN'),
  t('student.apaar', 'APAAR ID'),
  t('student.srn', 'SRN'),
  t('student.registrationNo', 'Board registration no.'),
  // the Board exam registration form (17 Nov 2026)
  t('student.sex', 'Sex'),
  t('student.mobile', 'Mobile number'),
  t('student.email', 'E-mail'),
  t('student.familyIncome', 'Annual income (mother and father)'),
  t('student.aadhaar', "Child's Aadhaar (masked)"),
  t('student.fatherAadhaar', "Father's Aadhaar (masked)"),
  t('student.motherAadhaar', "Mother's Aadhaar (masked)"),
  t('student.cwsn', 'Differently abled'),
  t('student.singleChild', 'Single child'),
  t('student.minority', 'Minority'),
  t('student.subject1', 'Subject I'),
  t('student.subject2', 'Subject II'),
  t('student.subject3', 'Subject III'),
  t('student.subject4', 'Subject IV'),
  t('student.subject5', 'Subject V'),
  t('student.additionalSubject', 'Additional subject'),
  t('tc.lastClass', 'Class in which the pupil last studied'),
  t('tc.lastClassWords', 'Class last studied, in words'),
  t('employee.name', 'Name of the employee'),
  t('employee.fatherName', "Father's name"),
  t('employee.nationality', 'Nationality'),
  d('employee.dob', 'Date of birth'),
  t('employee.designation', 'Designation'),
  t('employee.department', 'Department'),
  t('employee.employeeType', 'Employee type'),
  d('employee.joinedOn', 'Date of joining'),
  d('employee.leftOn', 'Date of leaving'),
];
const BY_PATH = new Map(PERSON_DETAILS.map((x) => [x.path, x]));

/** The label of a printed detail ("Father's name"), for the change log. */
export const personLabel = (path: string): string | undefined => BY_PATH.get(path)?.label;

/** The details a layout prints, in the order it prints them (a student's or an employee's, with a TC's class). */
export function printedDetails(
  body: string | undefined,
  audience: 'STUDENT' | 'STAFF',
): PersonSpec[] {
  if (!body) return [];
  const who = audience === 'STAFF' ? ['employee'] : ['student', 'tc'];
  const seen: string[] = [];
  for (const m of body.matchAll(
    /\{\{[#/]?(?:if\s+|unless\s+)?((?:student|employee|tc)\.[a-zA-Z][a-zA-Z0-9]*)/g,
  )) {
    const path = m[1]!;
    if (!seen.includes(path) && BY_PATH.has(path) && who.includes(path.split('.')[0]!))
      seen.push(path);
  }
  // the date in words goes with the date: both asked, the date first
  if (seen.includes('student.dobWords') && !seen.includes('student.dob'))
    seen.splice(seen.indexOf('student.dobWords'), 0, 'student.dob');
  // the ID numbers (often at the top of the paper) after the person's details, which start with the name
  const ids = seen.filter((p) => ID_NUMBERS.includes(p));
  // the name always first (a wording may name the class before it)
  const name: string[] = seen.filter((p) => p === 'student.name' || p === 'employee.name');
  return [...name, ...seen.filter((p) => !ID_NUMBERS.includes(p) && !name.includes(p)), ...ids].map(
    (p) => BY_PATH.get(p)!,
  );
}
const ID_NUMBERS = ['student.pen', 'student.apaar', 'student.srn', 'student.registrationNo'];

const DMY = /^(\d{2})-(\d{2})-(\d{4})$/;
const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoOf = (v: string) => {
  const m = DMY.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : ISO.test(v) ? v : '';
};
const dmyOf = (v: string) => {
  const m = ISO.exec(v);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : v;
};

/**
 * Puts the boxes' values on the paper's data (`target.student` / `employee` / `tc`, copies of the record's), for the
 * details the layout prints: a value that differs from the record is printed and kept in `printed`. A changed date of
 * birth changes its words too, unless they were typed. Returns the boxes for the form and what is wrong.
 */
export function applyPerson(
  target: Record<string, Record<string, unknown> | undefined>,
  specs: PersonSpec[],
  given: Record<string, string> | undefined,
): { boxes: PersonBox[]; printed: Printed; problems: string[] } {
  const printed: Printed = {};
  const problems: string[] = [];
  const read = (path: string) => {
    const [who, key] = path.split('.') as [string, string];
    const v = target[who]?.[key];
    return v === null || v === undefined || typeof v === 'object' ? '' : String(v);
  };
  const write = (path: string, v: string) => {
    const [who, key] = path.split('.') as [string, string];
    if (target[who]) target[who][key] = v;
  };
  // the guardian prints only when there is no father ("father, else guardian"): asked only then, or once changed
  specs = specs.filter(
    (s) =>
      s.path !== 'student.guardianName' ||
      !specs.some((x) => x.path === 'student.fatherName') ||
      !read('student.fatherName') ||
      (given?.[s.path] !== undefined && given[s.path] !== read(s.path)),
  );
  const record = new Map(specs.map((s) => [s.path, read(s.path)]));
  if (specs.some((s) => s.path === 'student.dob'))
    record.set('student.dobWords', read('student.dobWords'));
  for (const s of specs) {
    const raw = given?.[s.path];
    if (raw === undefined) continue;
    let v = raw.replace(/\s+/g, ' ').trim();
    if (s.kind === 'date' && v) {
      if (!ISO.test(v) && !DMY.test(v)) {
        problems.push(`${s.label}: a date`);
        continue;
      }
      v = dmyOf(v);
    }
    // an Aadhaar number is never printed in full, typed or not
    if (/Aadhaar$/i.test(s.path)) v = maskAadhaarText(v);
    const was = record.get(s.path) ?? '';
    if (v === was) continue;
    if (!v && (s.path === 'student.name' || s.path === 'employee.name')) {
      problems.push(`${s.label}: it cannot be empty`);
      continue;
    }
    write(s.path, v);
    printed[s.path] = { label: s.label, record: was, printed: v };
  }
  // the date of birth changed and its words not typed: the words follow the date
  if (printed['student.dob'] && !printed['student.dobWords']) {
    const words = printed['student.dob'].printed
      ? dateInWords(isoOf(printed['student.dob'].printed))
      : '';
    const was = record.get('student.dobWords') ?? '';
    if (words !== was) {
      write('student.dobWords', words);
      printed['student.dobWords'] = {
        label: personLabel('student.dobWords')!,
        record: was,
        printed: words,
      };
    }
  }
  const boxes = specs.map((s) => {
    const now = read(s.path);
    return {
      ...s,
      value: s.kind === 'date' ? isoOf(now) : now,
      record: record.get(s.path) ?? '',
      changed: !!printed[s.path],
    };
  });
  return { boxes, printed, problems };
}

/** The changes a certificate printed, as the boxes' values for a re-issue or a correction (path → value). */
export function personOf(printed: unknown): Record<string, string> {
  if (!printed || typeof printed !== 'object' || Array.isArray(printed)) return {};
  const out: Record<string, string> = {};
  for (const [path, v] of Object.entries(printed as Record<string, unknown>))
    if (BY_PATH.has(path) && v && typeof v === 'object' && 'printed' in v)
      out[path] = String((v as { printed: unknown }).printed ?? '');
  return out;
}
