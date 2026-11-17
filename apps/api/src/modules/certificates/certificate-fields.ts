/**
 * The fields a type asks for at issue (docs/design/87): EduPro's own for each built-in type, filled from the record
 * where the record holds them (working days, subjects, the month the dues are paid to …), then the school's own fields
 * of the type (phase B, the type's set-up). All editable before issue.
 */
export interface FieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'date' | 'number' | 'list';
  required?: boolean;
  options?: string[];
  /** a hint under the field */
  hint?: string;
  /** the school's own field (set on the type) */
  custom?: boolean;
}

const CONDUCT = ['Excellent', 'Very good', 'Good', 'Satisfactory'];
const TRAVEL: FieldSpec[] = [
  { key: 'country', label: 'Country of travel', kind: 'text', required: true },
  { key: 'fromDate', label: 'Travelling from', kind: 'date', required: true },
  { key: 'toDate', label: 'Back by', kind: 'date', required: true },
];

/** the award certificates (phase E): what was won, where, the place and the day */
const AWARD_FIELDS: FieldSpec[] = [
  { key: 'award', label: 'For (the award or achievement)', kind: 'text', required: true },
  { key: 'event', label: 'Event or competition', kind: 'text' },
  { key: 'position', label: 'Place or level', kind: 'text', hint: 'e.g. First, Gold, Distinction' },
  { key: 'awardedOn', label: 'Date', kind: 'date' },
  { key: 'text', label: 'A line more (optional)', kind: 'text' },
];

export const TYPE_FIELDS: Record<string, FieldSpec[]> = {
  TC: [
    { key: 'reason', label: 'Reason for leaving the school', kind: 'text', required: true },
    {
      key: 'applicationDate',
      label: 'Date of application for the certificate',
      kind: 'date',
      required: true,
    },
    {
      key: 'struckOffDate',
      label: "Date the pupil's name was struck off the rolls",
      kind: 'date',
      required: true,
    },
    {
      key: 'examResult',
      label: 'School / Board annual examination last taken, with result',
      kind: 'text',
      hint: 'e.g. Class VIII annual examination, passed',
    },
    {
      key: 'failed',
      label: 'Whether failed in the same class',
      kind: 'list',
      options: ['No', 'Once', 'Twice'],
    },
    { key: 'subjects', label: 'Subjects studied', kind: 'text' },
    {
      key: 'promotion',
      label: 'Whether qualified for promotion to the higher class',
      kind: 'text',
      hint: 'Yes, No or Not applicable; or e.g. Promoted to class IX',
    },
    { key: 'duesMonth', label: 'Month up to which the school dues are paid', kind: 'text' },
    { key: 'concession', label: 'Any fee concession availed, and its nature', kind: 'text' },
    { key: 'workingDays', label: 'Total working days', kind: 'number' },
    { key: 'daysPresent', label: 'Total working days present', kind: 'number' },
    { key: 'ncc', label: 'Whether NCC cadet / Scout / Guide (details)', kind: 'text' },
    { key: 'activities', label: 'Games played or extra-curricular activities', kind: 'text' },
    { key: 'conduct', label: 'General conduct', kind: 'list', options: CONDUCT, required: true },
    { key: 'remarks', label: 'Any other remarks', kind: 'text' },
  ],
  CHARACTER: [
    { key: 'conduct', label: 'Moral character', kind: 'list', options: CONDUCT, required: true },
    {
      key: 'remark',
      label: 'A line more (optional)',
      kind: 'text',
      hint: "e.g. has taken part in the school's sports",
    },
  ],
  DOB_JUST: [
    {
      key: 'basis',
      label: 'Recorded on the basis of',
      kind: 'text',
      required: true,
      hint: 'e.g. the birth certificate issued by the municipal corporation',
    },
    { key: 'remark', label: 'A line more (optional)', kind: 'text' },
  ],
  NOC: [
    {
      key: 'forWhat',
      label: 'No objection to (printed after "no objection to her / him")',
      kind: 'text',
      required: true,
      hint: 'e.g. appearing in the state-level science olympiad',
    },
  ],
  TRAVEL_NOC: [
    ...TRAVEL,
    {
      key: 'accompaniedBy',
      label: 'Travelling with (optional)',
      kind: 'text',
      hint: 'e.g. the parents',
    },
  ],
  VISA: [
    ...TRAVEL,
    {
      key: 'embassy',
      label: 'Addressed to (optional)',
      kind: 'text',
      hint: 'e.g. Embassy of Japan, New Delhi',
    },
  ],
  SCHOLAR: [
    {
      key: 'scholarship',
      label: 'The scholarship',
      kind: 'text',
      required: true,
      hint: 'e.g. National Means-cum-Merit Scholarship 2026-27',
    },
  ],
  // the Board exam registration form (17 Nov 2026): the circular's own lines, the same for a class
  BOARD_FORM: [
    {
      key: 'examYear',
      label: 'Year of the Board examination',
      kind: 'text',
      required: true,
      hint: 'e.g. 2027',
    },
    {
      key: 'lastDate',
      label: 'Last date to return the form',
      kind: 'date',
      required: true,
    },
    {
      key: 'fee',
      label: 'Examination fee (printed as written)',
      kind: 'text',
      hint: 'e.g. ₹1,500; ₹300 for an additional subject; ₹150 for each practical subject',
    },
    {
      key: 'note',
      label: 'Note at the foot',
      kind: 'text',
      hint: 'e.g. Please attach a photocopy of the Class X marksheet.',
    },
  ],
  BOARD_REG: [
    { key: 'board', label: 'Board', kind: 'text', required: true },
    { key: 'registrationNo', label: 'Registration no.', kind: 'text', required: true },
    { key: 'session', label: 'Session', kind: 'text' },
  ],
  EXPERIENCE: [
    { key: 'conduct', label: 'Work and conduct', kind: 'list', options: CONDUCT, required: true },
    { key: 'remark', label: 'A line more (optional)', kind: 'text' },
  ],
  STAFF_VISA: [...TRAVEL, { key: 'embassy', label: 'Addressed to (optional)', kind: 'text' }],
  ...Object.fromEntries(
    ['ACHIEVEMENT', 'MERIT', 'PARTICIPATION', 'AWARD'].map((k) => [k, AWARD_FIELDS]),
  ),
};

/** The fields of a type: EduPro's own, then the school's own (custom) ones. */
export function fieldsOf(code: string, custom: unknown = []): FieldSpec[] {
  const own = TYPE_FIELDS[code] ?? [];
  const keys = new Set(own.map((f) => f.key));
  const extra = (Array.isArray(custom) ? (custom as FieldSpec[]) : [])
    .filter((f) => f && typeof f.key === 'string' && !keys.has(f.key))
    .map((f) => ({ ...f, custom: true }));
  return [...own, ...extra];
}

/** The defaults of the typed fields, from what the record holds. */
export function fieldDefaults(
  code: string,
  d: {
    today: string;
    leavingOn: string | null;
    requestedOn: string | null;
    reason: string | null;
    subjects: string;
    paidTo: string;
    concession: string;
    workingDays: number;
    present: number;
    board?: string;
    registrationNo?: string;
    year?: string;
  },
): Record<string, string | number> {
  switch (code) {
    case 'TC':
      return {
        reason: d.reason ?? '',
        applicationDate: d.requestedOn ?? d.today,
        struckOffDate: d.leavingOn ?? d.today,
        examResult: '',
        failed: 'No',
        subjects: d.subjects,
        promotion: '',
        duesMonth: d.paidTo,
        concession: d.concession,
        workingDays: d.workingDays,
        daysPresent: d.present,
        ncc: 'No',
        activities: '',
        conduct: 'Good',
        remarks: '',
      };
    case 'CHARACTER':
    case 'EXPERIENCE':
      return { conduct: 'Good', remark: '' };
    case 'DOB_JUST':
      return { basis: 'the birth certificate', remark: '' };
    case 'BOARD_FORM': {
      // the Board examination of a year 2026-27 is held in 2027
      const end = /^(\d{4})-(\d{2})$/.exec(String(d.year ?? ''));
      return {
        examYear: end ? `${end[1]!.slice(0, 2)}${end[2]!}` : '',
        lastDate: '',
        fee: '',
        note: '',
      };
    }
    case 'BOARD_REG':
      return {
        board: d.board ?? '',
        registrationNo: d.registrationNo ?? '',
        session: d.year ?? '',
      };
    default:
      return {};
  }
}

/** The typed fields as given, checked against the spec: required ones present, lists in their options, numbers whole. */
export function checkFields(specs: FieldSpec[], given: Record<string, string | number>): string[] {
  const problems: string[] = [];
  for (const f of specs) {
    const v = given[f.key];
    const empty = v === undefined || v === null || String(v).trim() === '';
    if (empty) {
      if (f.required) problems.push(`${f.label} is required`);
      continue;
    }
    if (
      f.kind === 'number' &&
      !(typeof v === 'number' ? Number.isInteger(v) && v >= 0 : /^\d{1,4}$/.test(String(v)))
    )
      problems.push(`${f.label} must be a whole number`);
    if (f.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(v)))
      problems.push(`${f.label} must be a date`);
    if (f.kind === 'list' && f.options && !f.options.includes(String(v)))
      problems.push(`${f.label} must be one of: ${f.options.join(', ')}`);
  }
  const from = given.fromDate;
  const to = given.toDate;
  if (typeof from === 'string' && typeof to === 'string' && from && to && to < from)
    problems.push('The return date is before the travel date');
  return problems;
}

/** The typed fields as they read in a sentence: dates as dd-mm-yyyy, the conduct in small letters. */
export function fieldText(
  specs: FieldSpec[],
  values: Record<string, string | number>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of specs) {
    const v = values[f.key];
    if (v === undefined || v === null) continue;
    const s = String(v);
    out[f.key] =
      f.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(s)
        ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}`
        : f.key === 'conduct'
          ? s.toLowerCase()
          : s;
  }
  return out;
}

/** A custom field list as the school set it on a type, checked: keys unique and not EduPro's, lists with choices. */
export function checkCustomFields(code: string, list: FieldSpec[]): string[] {
  const own = new Set((TYPE_FIELDS[code] ?? []).map((f) => f.key));
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const f of list) {
    if (own.has(f.key)) problems.push(`${f.key} is one of EduPro's own fields of this type`);
    if (seen.has(f.key)) problems.push(`${f.key} appears twice`);
    seen.add(f.key);
    if (f.kind === 'list' && !f.options?.length) problems.push(`${f.label} needs its choices`);
  }
  return problems;
}
