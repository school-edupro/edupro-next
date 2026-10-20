/**
 * The candidate application (docs/design/34-recruitment.md, part 2), shaped on the school's legacy online
 * staff recruitment form (its input fields only). A field the employee master has is named by the
 * master's key and takes the master's label, type, list and validation, so a selected candidate moves to
 * the employee record without re-typing (part 4). The rest belongs to the candidate only: their family's
 * education, current pay and notice, skills, activities, references, children.
 */
import { EMPLOYEE_FIELD_BY_KEY } from './employee-fields';
import type { ProfileFieldType } from './student-fields';

export const CANDIDATE_SECTIONS = [
  { id: 'personal', title: 'Personal details' },
  { id: 'family', title: 'Father or spouse' },
  { id: 'contact', title: 'Contact' },
  { id: 'address', title: 'Address' },
  { id: 'job', title: 'Present job and pay' },
  { id: 'skills', title: 'Skills and interests' },
] as const;
export type CandidateSectionId = (typeof CANDIDATE_SECTIONS)[number]['id'];

export interface CandidateField {
  key: string;
  section: CandidateSectionId;
  label: string;
  type: ProfileFieldType | 'textarea';
  list?: string;
  upper?: boolean;
  required?: boolean;
  help?: string;
  when?: { key: string; in?: string[]; notIn?: string[] };
  /** Aadhaar and PAN: encrypted, shown masked. */
  sensitive?: boolean;
  /** A field of the employee master (validated as the master does, copied on joining). */
  master: boolean;
}

/** A master field by key, with the candidate's own required flag and help. */
const m = (
  key: string,
  section: CandidateSectionId,
  extra: { required?: boolean; label?: string; help?: string } = {},
): CandidateField => {
  const f = EMPLOYEE_FIELD_BY_KEY.get(key);
  if (!f) throw new Error(`candidate field ${key} is not in the employee master`);
  return {
    key,
    section,
    label: extra.label ?? f.label,
    type: f.type as ProfileFieldType,
    ...(f.list ? { list: f.list } : {}),
    ...(f.upper ? { upper: true } : {}),
    ...(f.when ? { when: f.when } : {}),
    ...(f.sensitive ? { sensitive: true } : {}),
    ...(extra.required ? { required: true } : {}),
    ...(extra.help ? { help: extra.help } : {}),
    master: true,
  };
};
/** A field of the candidate only. */
const own = (
  key: string,
  section: CandidateSectionId,
  label: string,
  type: CandidateField['type'],
  extra: Partial<Pick<CandidateField, 'required' | 'help' | 'list'>> = {},
): CandidateField => ({ key, section, label, type, ...extra, master: false });

export const CANDIDATE_FIELDS: CandidateField[] = [
  m('first_name', 'personal', { required: true }),
  m('last_name', 'personal'),
  m('gender', 'personal', { required: true }),
  m('dob', 'personal', { required: true }),
  m('nationality', 'personal'),
  m('religion', 'personal'),
  m('marital_status', 'personal'),
  m('aadhaar', 'personal', { help: 'Twelve digits; kept encrypted' }),
  m('pan', 'personal', { help: 'Kept encrypted' }),
  m('father_name', 'family', { required: true }),
  m('spouse_name', 'family'),
  own('guardian_qualification', 'family', 'Education of father or spouse', 'text'),
  own('guardian_work', 'family', 'Designation and organisation of father or spouse', 'text'),
  m('mobile', 'contact', { required: true }),
  m('alternate_mobile', 'contact'),
  m('email', 'contact', { required: true, label: 'Email' }),
  m('present_line1', 'address', { required: true, label: 'Residential address' }),
  m('present_line2', 'address', { label: 'Residential address line 2' }),
  m('present_city', 'address', { required: true, label: 'City' }),
  m('present_state', 'address', { required: true, label: 'State' }),
  m('present_pin', 'address', { label: 'PIN code' }),
  m('permanent_same', 'address'),
  m('permanent_line1', 'address', { label: 'Permanent address' }),
  m('permanent_city', 'address', { label: 'Permanent city' }),
  m('permanent_state', 'address', { label: 'Permanent state' }),
  m('permanent_pin', 'address', { label: 'Permanent PIN code' }),
  own('total_exp_years', 'job', 'Teaching or professional experience (years)', 'number'),
  own('total_exp_months', 'job', 'and months', 'number'),
  own('current_basic', 'job', 'Present basic pay (₹ a month)', 'number'),
  own('current_allowance', 'job', 'Allowances (₹ a month)', 'number'),
  own('current_total', 'job', 'Total (₹ a month)', 'number'),
  own('pay_scale', 'job', 'Pay scale', 'text'),
  own('last_employment_end', 'job', 'Last day of the last job', 'date', {
    help: 'Empty when working now',
  }),
  own('notice_period', 'job', 'When you can join, if selected', 'text', {
    help: 'For example: in one month',
  }),
  own('leaving_reason', 'job', 'Reason for leaving (or wishing to leave)', 'text'),
  own('testimonials', 'job', 'Attested testimonials and certificates you will bring', 'number'),
  own('computer_skills', 'skills', 'Computer skills', 'text', {
    help: 'For example: MS Office, Tally, typing speed',
  }),
  own('sports', 'skills', 'Games and sports', 'text'),
  own('languages', 'skills', 'Languages you know', 'text'),
  own('foreign_travel', 'skills', 'Travel abroad', 'text'),
  own('other_remarks', 'skills', 'Anything else you wish to tell the school', 'textarea'),
];
export const CANDIDATE_FIELD_BY_KEY: ReadonlyMap<string, CandidateField> = new Map(
  CANDIDATE_FIELDS.map((f) => [f.key, f]),
);

/** The interests ticked (the legacy activity grid). */
export const CANDIDATE_ACTIVITIES = [
  'Gardening',
  'Art and craft',
  'Photography',
  'Dramatics',
  'Debate',
  'Quiz',
  'Music',
  'Social service',
  'Dancing (Indian or Western)',
] as const;

export type CandidateRowKind = 'education' | 'experience' | 'training' | 'children' | 'references';
export interface CandidateColumn {
  key: string;
  label: string;
  type: 'text' | 'year' | 'date' | 'number' | 'list';
  options?: string[];
  required?: boolean;
}
/** The row lists of the application; columns named as the employee master's rows where they map. */
export const CANDIDATE_ROWS: Record<
  CandidateRowKind,
  { title: string; max: number; columns: CandidateColumn[] }
> = {
  education: {
    title: 'Qualifications',
    max: 10,
    columns: [
      { key: 'qualification', label: 'Qualification', type: 'text', required: true },
      { key: 'passingYear', label: 'Year', type: 'year' },
      { key: 'score', label: 'Marks (%)', type: 'text' },
      {
        key: 'division',
        label: 'Division',
        type: 'list',
        options: ['First', 'Second', 'Third', 'Pass'],
      },
      { key: 'institution', label: 'School or college', type: 'text' },
      { key: 'university', label: 'Board or university', type: 'text' },
      { key: 'mode', label: 'Regular or distance', type: 'list', options: ['Regular', 'Distance'] },
      { key: 'specialisation', label: 'Subjects', type: 'text' },
    ],
  },
  experience: {
    title: 'Experience',
    max: 15,
    columns: [
      { key: 'organisation', label: 'Institution served', type: 'text', required: true },
      { key: 'designation', label: 'Post, subject or classes taught', type: 'text' },
      { key: 'fromOn', label: 'From', type: 'date' },
      { key: 'toOn', label: 'To', type: 'date' },
    ],
  },
  training: {
    title: 'Training and workshops',
    max: 15,
    columns: [
      { key: 'topic', label: 'Workshop or course', type: 'text', required: true },
      { key: 'organisation', label: 'Institute or organisation', type: 'text' },
      { key: 'year', label: 'Year', type: 'year' },
      { key: 'duration', label: 'Duration', type: 'text' },
    ],
  },
  children: {
    title: 'Children',
    max: 6,
    columns: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'dob', label: 'Date of birth', type: 'date' },
      { key: 'class', label: 'Class', type: 'text' },
      { key: 'school', label: 'School or college', type: 'text' },
    ],
  },
  references: {
    title: 'References',
    max: 3,
    columns: [
      { key: 'name', label: 'Name', type: 'text', required: true },
      { key: 'phone', label: 'Telephone', type: 'text' },
      { key: 'address', label: 'Address', type: 'text' },
    ],
  },
};

/** The documents the application asks for; the photo is needed to apply. */
export const CANDIDATE_DOCUMENTS: Array<{
  kind: string;
  label: string;
  required?: boolean;
  many?: boolean;
  image?: boolean;
}> = [
  { kind: 'photo', label: 'Your photo', required: true, image: true },
  { kind: 'father_photo', label: 'Father’s photo', image: true },
  { kind: 'mother_photo', label: 'Mother’s photo', image: true },
  { kind: 'address_proof', label: 'Address proof' },
  { kind: 'high_school', label: 'Class X certificate' },
  { kind: 'certificate', label: 'Qualification certificates', many: true },
  { kind: 'father_proof', label: 'Father’s ID proof' },
  { kind: 'mother_proof', label: 'Mother’s ID proof' },
  { kind: 'resume', label: 'Résumé (CV)' },
];
