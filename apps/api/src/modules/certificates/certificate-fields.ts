/**
 * The fields a type asks for at issue (docs/design/87, phase A): filled from the student's record where the record holds
 * them (working days, subjects, the month the dues are paid to …) and editable before issue. Phase B lets the school add
 * its own per type.
 */
export interface FieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'date' | 'number' | 'list';
  required?: boolean;
  options?: string[];
  /** a hint under the field */
  hint?: string;
}

const CONDUCT = ['Excellent', 'Very good', 'Good', 'Satisfactory'];

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
  BONAFIDE: [],
  DOB: [],
};

export const fieldsOf = (code: string): FieldSpec[] => TYPE_FIELDS[code] ?? [];

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
  },
): Record<string, string | number> {
  if (code === 'TC')
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
  if (code === 'CHARACTER') return { conduct: 'Good', remark: '' };
  return {};
}

/** The typed fields as given, checked against the spec: required ones present, lists in their options, numbers whole. */
export function checkFields(code: string, given: Record<string, string | number>): string[] {
  const problems: string[] = [];
  for (const f of fieldsOf(code)) {
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
  return problems;
}
