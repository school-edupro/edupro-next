/**
 * Employee profile field catalogue (docs/design/30-employee-master.md), shaped on the staff profile of the
 * legacy ERP (basic, contact, address, bank, identity, employment, statutory, approvers). One definition
 * drives the profile form, API validation, completeness, the Excel template and the report columns, as
 * the student catalogue does (student-fields.ts), whose validation it shares. Keys are stable: never
 * rename a key that holds data.
 */
import type { ProfileFieldType } from './student-fields';

/** Where a value lives. */
export type EmployeeStore =
  | { t: 'col'; col: string } // employees column
  | { t: 'addr'; part: 'present' | 'permanent'; key: string } // employees.address.<part>.<key>
  | { t: 'json'; key: string } // employees.profile
  | { t: 'secure'; key: string } // employees.secure (encrypted)
  | { t: 'auto' }; // computed

/** An employee picked by code (stored as the employee's id). */
export type EmployeeFieldType = ProfileFieldType | 'employee';

export interface EmployeeField {
  key: string;
  section: EmployeeSectionId;
  label: string;
  type: EmployeeFieldType;
  /** Counts toward completeness. */
  required?: boolean;
  /** Drop-down list: a profile list, a geography master, or Department / Designation / EmployeeType. */
  list?: string;
  upper?: boolean;
  help?: string;
  when?: { key: string; in?: string[]; notIn?: string[] };
  /** Encrypted at rest and masked unless the viewer holds people.sensitive.view. */
  sensitive?: boolean;
  store: EmployeeStore;
}

export const EMPLOYEE_SECTIONS = [
  { id: 'basic', title: 'Basic information' },
  { id: 'contact', title: 'Contact and emergency' },
  { id: 'address', title: 'Address' },
  { id: 'employment', title: 'Employment' },
  { id: 'statutory', title: 'Statutory' },
  { id: 'govt_ids', title: 'Identity documents' },
  { id: 'bank', title: 'Bank details' },
  { id: 'approvers', title: 'Approvers' },
] as const;
export type EmployeeSectionId = (typeof EMPLOYEE_SECTIONS)[number]['id'];

const married = { key: 'marital_status', in: ['Married', 'Widowed', 'Divorced'] };
const addr = (part: 'present' | 'permanent', title: string): EmployeeField[] => {
  const when = part === 'permanent' ? { key: 'permanent_same', notIn: ['Yes'] } : undefined;
  const req = part === 'present';
  return [
    {
      key: `${part}_line1`,
      label: `${title} address line 1`,
      type: 'text',
      required: req,
      store: { t: 'addr', part, key: 'line1' },
    },
    {
      key: `${part}_line2`,
      label: `${title} address line 2`,
      type: 'text',
      store: { t: 'addr', part, key: 'line2' },
    },
    {
      key: `${part}_line3`,
      label: `${title} address line 3`,
      type: 'text',
      store: { t: 'addr', part, key: 'line3' },
    },
    {
      key: `${part}_city`,
      label: `${title} city`,
      type: 'list',
      list: 'City',
      required: req,
      store: { t: 'addr', part, key: 'city' },
    },
    {
      key: `${part}_state`,
      label: `${title} state`,
      type: 'list',
      list: 'State',
      required: req,
      store: { t: 'addr', part, key: 'state' },
    },
    {
      key: `${part}_country`,
      label: `${title} country`,
      type: 'list',
      list: 'Country',
      store: { t: 'addr', part, key: 'country' },
    },
    {
      key: `${part}_pin`,
      label: `${title} PIN code`,
      type: 'pin',
      required: req,
      store: { t: 'addr', part, key: 'pin' },
    },
  ].map((f) => ({ ...f, section: 'address' as const, when })) as EmployeeField[];
};

export const EMPLOYEE_FIELDS: EmployeeField[] = [
  // ---- basic ----
  {
    key: 'employee_code',
    section: 'basic',
    label: 'Employee code',
    type: 'text',
    required: true,
    upper: true,
    store: { t: 'col', col: 'employee_code' },
    help: 'Unique in the school.',
  },
  {
    key: 'first_name',
    section: 'basic',
    label: 'First name',
    type: 'text',
    required: true,
    upper: true,
    store: { t: 'col', col: 'first_name' },
  },
  {
    key: 'last_name',
    section: 'basic',
    label: 'Last name',
    type: 'text',
    upper: true,
    store: { t: 'col', col: 'last_name' },
  },
  {
    key: 'gender',
    section: 'basic',
    label: 'Gender',
    type: 'list',
    list: 'Gender',
    required: true,
    store: { t: 'col', col: 'gender' },
  },
  {
    key: 'dob',
    section: 'basic',
    label: 'Date of birth',
    type: 'date',
    required: true,
    store: { t: 'col', col: 'dob' },
  },
  { key: 'age', section: 'basic', label: 'Age', type: 'auto', store: { t: 'auto' } },
  {
    key: 'place_of_birth',
    section: 'basic',
    label: 'Place of birth',
    type: 'text',
    store: { t: 'json', key: 'place_of_birth' },
  },
  {
    key: 'nationality',
    section: 'basic',
    label: 'Nationality',
    type: 'list',
    list: 'Nationality',
    store: { t: 'json', key: 'nationality' },
  },
  {
    key: 'religion',
    section: 'basic',
    label: 'Religion',
    type: 'list',
    list: 'Religion',
    store: { t: 'json', key: 'religion' },
  },
  {
    key: 'category',
    section: 'basic',
    label: 'Category',
    type: 'list',
    list: 'Category',
    store: { t: 'json', key: 'category' },
  },
  {
    key: 'blood_group',
    section: 'basic',
    label: 'Blood group',
    type: 'list',
    list: 'BloodGroup',
    required: true,
    store: { t: 'json', key: 'blood_group' },
  },
  {
    key: 'marital_status',
    section: 'basic',
    label: 'Marital status',
    type: 'list',
    list: 'MaritalStatus',
    store: { t: 'json', key: 'marital_status' },
  },
  {
    key: 'spouse_name',
    section: 'basic',
    label: 'Spouse name',
    type: 'text',
    upper: true,
    when: married,
    store: { t: 'json', key: 'spouse_name' },
  },
  {
    key: 'anniversary',
    section: 'basic',
    label: 'Anniversary',
    type: 'date',
    when: married,
    store: { t: 'json', key: 'anniversary' },
  },
  {
    key: 'sons',
    section: 'basic',
    label: 'Sons',
    type: 'number',
    when: married,
    store: { t: 'json', key: 'sons' },
  },
  {
    key: 'daughters',
    section: 'basic',
    label: 'Daughters',
    type: 'number',
    when: married,
    store: { t: 'json', key: 'daughters' },
  },
  {
    key: 'hobbies',
    section: 'basic',
    label: 'Hobbies',
    type: 'text',
    store: { t: 'json', key: 'hobbies' },
  },
  {
    key: 'biometric_id',
    section: 'basic',
    label: 'Biometric / barcode id',
    type: 'text',
    store: { t: 'col', col: 'biometric_id' },
  },
  // ---- contact ----
  {
    key: 'mobile',
    section: 'contact',
    label: 'Mobile',
    type: 'mobile',
    required: true,
    store: { t: 'col', col: 'mobile' },
  },
  {
    key: 'alternate_mobile',
    section: 'contact',
    label: 'Alternate mobile',
    type: 'mobile',
    store: { t: 'json', key: 'alternate_mobile' },
  },
  {
    key: 'phone',
    section: 'contact',
    label: 'Landline',
    type: 'text',
    store: { t: 'json', key: 'phone' },
  },
  {
    key: 'email',
    section: 'contact',
    label: 'Official email',
    type: 'email',
    store: { t: 'col', col: 'email' },
  },
  {
    key: 'personal_email',
    section: 'contact',
    label: 'Personal email',
    type: 'email',
    store: { t: 'json', key: 'personal_email' },
  },
  {
    key: 'father_name',
    section: 'contact',
    label: "Father's name",
    type: 'text',
    upper: true,
    store: { t: 'json', key: 'father_name' },
  },
  {
    key: 'father_occupation',
    section: 'contact',
    label: "Father's occupation",
    type: 'list',
    list: 'Occupation',
    store: { t: 'json', key: 'father_occupation' },
  },
  {
    key: 'father_mobile',
    section: 'contact',
    label: "Father's mobile",
    type: 'mobile',
    store: { t: 'json', key: 'father_mobile' },
  },
  {
    key: 'emergency_name',
    section: 'contact',
    label: 'Emergency contact name',
    type: 'text',
    upper: true,
    required: true,
    store: { t: 'json', key: 'emergency_name' },
  },
  {
    key: 'emergency_relation',
    section: 'contact',
    label: 'Emergency contact relation',
    type: 'list',
    list: 'Relation',
    store: { t: 'json', key: 'emergency_relation' },
  },
  {
    key: 'emergency_mobile',
    section: 'contact',
    label: 'Emergency mobile',
    type: 'mobile',
    required: true,
    store: { t: 'json', key: 'emergency_mobile' },
  },
  // ---- address (the student pattern: lines, city, state, country, PIN) ----
  ...addr('present', 'Present'),
  {
    key: 'permanent_same',
    section: 'address',
    label: 'Permanent address same as present',
    type: 'list',
    list: 'YesNo',
    store: { t: 'json', key: 'permanent_same' },
  },
  ...addr('permanent', 'Permanent'),
  // ---- employment ----
  {
    key: 'staff_type',
    section: 'employment',
    label: 'Employee type',
    type: 'list',
    list: 'EmployeeType',
    required: true,
    store: { t: 'json', key: 'staff_type' },
    help: 'From Staff setup → Employee types; sets the staff group (teaching, non-teaching, contract, visiting).',
  },
  {
    key: 'department',
    section: 'employment',
    label: 'Department',
    type: 'list',
    list: 'Department',
    required: true,
    store: { t: 'col', col: 'department' },
  },
  {
    key: 'designation',
    section: 'employment',
    label: 'Designation',
    type: 'list',
    list: 'Designation',
    required: true,
    store: { t: 'col', col: 'designation' },
  },
  {
    key: 'designation_at_joining',
    section: 'employment',
    label: 'Designation at joining',
    type: 'list',
    list: 'Designation',
    store: { t: 'json', key: 'designation_at_joining' },
  },
  {
    key: 'nature_of_appointment',
    section: 'employment',
    label: 'Nature of appointment',
    type: 'list',
    list: 'NatureOfAppointment',
    store: { t: 'json', key: 'nature_of_appointment' },
  },
  {
    key: 'staff_role',
    section: 'employment',
    label: 'Role',
    type: 'list',
    list: 'StaffRole',
    store: { t: 'json', key: 'staff_role' },
  },
  {
    key: 'teaching_subject',
    section: 'employment',
    label: 'Teaching subject',
    type: 'text',
    store: { t: 'json', key: 'teaching_subject' },
  },
  {
    key: 'joined_on',
    section: 'employment',
    label: 'Date of joining',
    type: 'date',
    required: true,
    store: { t: 'col', col: 'joined_on' },
  },
  {
    key: 'contract_joined_on',
    section: 'employment',
    label: 'Date of joining (contract)',
    type: 'date',
    store: { t: 'json', key: 'contract_joined_on' },
  },
  {
    key: 'regularised_on',
    section: 'employment',
    label: 'Date of regularisation',
    type: 'date',
    store: { t: 'json', key: 'regularised_on' },
  },
  {
    key: 'probation_months',
    section: 'employment',
    label: 'Probation (months)',
    type: 'number',
    store: { t: 'json', key: 'probation_months' },
  },
  {
    key: 'confirmed_on',
    section: 'employment',
    label: 'Confirmation date',
    type: 'date',
    store: { t: 'json', key: 'confirmed_on' },
  },
  {
    key: 'promoted_on',
    section: 'employment',
    label: 'Date of promotion',
    type: 'date',
    store: { t: 'json', key: 'promoted_on' },
  },
  {
    key: 'upgraded_on',
    section: 'employment',
    label: 'Last upgradation',
    type: 'date',
    store: { t: 'json', key: 'upgraded_on' },
  },
  {
    key: 'macps_on',
    section: 'employment',
    label: 'MACPS date',
    type: 'date',
    store: { t: 'json', key: 'macps_on' },
  },
  {
    key: 'pay_band',
    section: 'employment',
    label: 'Pay band / grade',
    type: 'list',
    list: 'PayBand',
    store: { t: 'json', key: 'pay_band' },
  },
  {
    key: 'service_years',
    section: 'employment',
    label: 'Years of service',
    type: 'auto',
    store: { t: 'auto' },
  },
  {
    key: 'left_on',
    section: 'employment',
    label: 'Date of leaving',
    type: 'date',
    store: { t: 'col', col: 'left_on' },
  },
  {
    key: 'leaving_reason',
    section: 'employment',
    label: 'Reason for leaving',
    type: 'text',
    store: { t: 'json', key: 'leaving_reason' },
  },
  // ---- statutory ----
  {
    key: 'pf_no',
    section: 'statutory',
    label: 'PF number',
    type: 'text',
    upper: true,
    store: { t: 'json', key: 'pf_no' },
  },
  {
    key: 'uan',
    section: 'statutory',
    label: 'UAN',
    type: 'digits12',
    store: { t: 'json', key: 'uan' },
  },
  {
    key: 'nps_no',
    section: 'statutory',
    label: 'Pension / NPS (PRAN) number',
    type: 'text',
    upper: true,
    store: { t: 'json', key: 'nps_no' },
  },
  {
    key: 'esi_no',
    section: 'statutory',
    label: 'ESI number',
    type: 'text',
    upper: true,
    store: { t: 'json', key: 'esi_no' },
  },
  // ---- identity documents ----
  {
    key: 'aadhaar',
    section: 'govt_ids',
    label: 'Aadhaar number',
    type: 'digits12',
    required: true,
    sensitive: true,
    store: { t: 'secure', key: 'aadhaar' },
  },
  {
    key: 'pan',
    section: 'govt_ids',
    label: 'PAN',
    type: 'pan',
    required: true,
    sensitive: true,
    store: { t: 'secure', key: 'pan' },
  },
  {
    key: 'voter_id',
    section: 'govt_ids',
    label: 'Voter ID',
    type: 'text',
    upper: true,
    store: { t: 'json', key: 'voter_id' },
  },
  {
    key: 'passport_no',
    section: 'govt_ids',
    label: 'Passport number',
    type: 'text',
    upper: true,
    store: { t: 'json', key: 'passport_no' },
  },
  {
    key: 'passport_expiry',
    section: 'govt_ids',
    label: 'Passport valid till',
    type: 'date',
    store: { t: 'json', key: 'passport_expiry' },
  },
  {
    key: 'oasis_no',
    section: 'govt_ids',
    label: 'OASIS number',
    type: 'text',
    upper: true,
    store: { t: 'json', key: 'oasis_no' },
  },
  {
    key: 'udise_teacher_code',
    section: 'govt_ids',
    label: 'UDISE / teacher code',
    type: 'text',
    upper: true,
    store: { t: 'json', key: 'udise_teacher_code' },
  },
  // ---- bank ----
  {
    key: 'bank_name',
    section: 'bank',
    label: 'Bank',
    type: 'list',
    list: 'Bank',
    store: { t: 'json', key: 'bank_name' },
  },
  {
    key: 'bank_account_name',
    section: 'bank',
    label: 'Account name',
    type: 'text',
    upper: true,
    store: { t: 'json', key: 'bank_account_name' },
  },
  {
    key: 'bank_account_no',
    section: 'bank',
    label: 'Account number',
    type: 'account',
    required: true,
    sensitive: true,
    store: { t: 'secure', key: 'bank_account_no' },
  },
  {
    key: 'bank_ifsc',
    section: 'bank',
    label: 'IFSC',
    type: 'ifsc',
    required: true,
    store: { t: 'json', key: 'bank_ifsc' },
  },
  {
    key: 'bank_micr',
    section: 'bank',
    label: 'MICR',
    type: 'text',
    store: { t: 'json', key: 'bank_micr' },
  },
  {
    key: 'bank_branch',
    section: 'bank',
    label: 'Branch',
    type: 'text',
    store: { t: 'json', key: 'bank_branch' },
  },
  // ---- approvers ----
  {
    key: 'acr_hod',
    section: 'approvers',
    label: 'ACR HOD',
    type: 'employee',
    store: { t: 'json', key: 'acr_hod' },
    help: 'Who writes the annual report (pick by name or code).',
  },
  {
    key: 'approver_l1',
    section: 'approvers',
    label: 'L1 approver',
    type: 'employee',
    store: { t: 'json', key: 'approver_l1' },
  },
  {
    key: 'approver_l2',
    section: 'approvers',
    label: 'L2 approver',
    type: 'employee',
    store: { t: 'json', key: 'approver_l2' },
  },
  {
    key: 'approver_l3',
    section: 'approvers',
    label: 'L3 approver',
    type: 'employee',
    store: { t: 'json', key: 'approver_l3' },
  },
];

export const EMPLOYEE_FIELD_BY_KEY: ReadonlyMap<string, EmployeeField> = new Map(
  EMPLOYEE_FIELDS.map((f) => [f.key, f]),
);

/** The quick onboard form: the minimum to start (name, gender, mobile, type, department, designation, joining). */
export const EMPLOYEE_QUICK_KEYS = [
  'employee_code',
  'first_name',
  'last_name',
  'gender',
  'mobile',
  'email',
  'staff_type',
  'department',
  'designation',
  'joined_on',
] as const;

/** Starter values of the staff drop-downs (each school keeps its own in Staff setup → Staff lists). */
export const EMPLOYEE_LIST_DEFAULTS: Record<string, string[]> = {
  MaritalStatus: ['Single', 'Married', 'Widowed', 'Divorced', 'Separated'],
  NatureOfAppointment: ['Permanent', 'Probation', 'Contract', 'Temporary', 'Ad hoc', 'Guest'],
  StaffRole: [
    'Teacher',
    'Class teacher',
    'Coordinator',
    'Head of department',
    'Administrator',
    'Support staff',
  ],
  PayBand: ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5', 'Level 6', 'Level 7', 'Level 8'],
  Language: [
    'English',
    'Hindi',
    'Sanskrit',
    'Punjabi',
    'Urdu',
    'Bengali',
    'Marathi',
    'Tamil',
    'Telugu',
    'French',
    'German',
  ],
  Qualification: [
    '10th',
    '12th',
    'Diploma',
    'B.A.',
    'B.Sc.',
    'B.Com.',
    'B.Tech.',
    'BCA',
    'B.Ed.',
    'M.A.',
    'M.Sc.',
    'M.Com.',
    'M.Ed.',
    'MCA',
    'MBA',
    'M.Phil.',
    'Ph.D.',
    'NTT',
    'D.El.Ed.',
    'CTET',
    'Other',
  ],
  EducationMode: ['Regular', 'Distance', 'Part time', 'Online'],
};
