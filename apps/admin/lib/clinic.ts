/** Clinic management (0075): the shapes and labels the ERP screens share. */
export interface ClinicMaster {
  id: string;
  kind: 'clinic' | 'doctor' | 'nurse' | 'disease';
  name: string;
  qualification: string | null;
  regNo: string | null;
  mobile: string | null;
  employeeId: string | null;
  employee: string | null;
  note: string | null;
  active: boolean;
  sortOrder: number;
  used: number;
}
export interface Medicine {
  id: string;
  name: string;
  form: string;
  strength: string | null;
  unit: string;
  lowStockAt: number;
  active: boolean;
  stock: number;
  expired: number;
  nextExpiry: string | null;
  low: boolean;
}
export interface CheckupField {
  key: string;
  label: string;
  group: string;
  kind: 'text' | 'number' | 'choice';
  unit: string | null;
  options: string[];
  /** Added by the school: can be edited and switched off. Built-in fields are only hidden. */
  custom: boolean;
  id: string | null;
  active: boolean;
  sortOrder: number;
}
export interface ClinicSettings {
  checkupHidden: string[];
  expiryAlertDays: number;
  cardNote: string | null;
}
export interface ClinicOptions {
  settings: ClinicSettings;
  masters: ClinicMaster[];
  medicines: Medicine[];
  fields: CheckupField[];
}
export interface ClinicSetup extends ClinicOptions {
  staff: Array<{ id: string; name: string }>;
  templates: Array<{
    code: string;
    channel: string;
    name: string;
    active: boolean;
    ready: boolean;
  }>;
}
export type Outcome = 'back_to_class' | 'rest' | 'sent_home' | 'referred';
export interface Visit {
  id: string;
  number: string;
  audience: 'student' | 'staff';
  studentId: string | null;
  student: string | null;
  admissionNo: string | null;
  section: string | null;
  employeeId: string | null;
  employee: string | null;
  employeeCode: string | null;
  designation: string | null;
  department: string | null;
  who: string;
  inAt: string;
  outAt: string | null;
  complaint: string;
  diseases: string[];
  temperatureC: number | null;
  pulse: number | null;
  bp: string | null;
  spo2: number | null;
  weightKg: number | null;
  diagnosis: string | null;
  treatment: string | null;
  prescription: string | null;
  remark: string | null;
  outcome: Outcome;
  outcomeLabel: string;
  referredTo: string | null;
  notifiedAt: string | null;
  clinic: string | null;
  doctor: string | null;
  nurse: string | null;
  recordedBy: string | null;
  medicines: Array<{
    id: string;
    name: string;
    strength: string | null;
    unit: string;
    qty: number;
    dosage: string | null;
  }>;
}
export interface Checkup {
  id: string;
  campId: string;
  camp: string;
  studentId: string;
  student: string;
  admissionNo: string | null;
  section: string | null;
  examDate: string;
  doctorId: string | null;
  doctor: string | null;
  place: string | null;
  heightCm: number | null;
  weightKg: number | null;
  bmi: number | null;
  bloodGroup: string | null;
  findings: Record<string, string>;
  diseaseId: string | null;
  disease: string | null;
  description: string | null;
  remarks: string | null;
  needsAttention: boolean;
  status: 'draft' | 'published';
  publishedAt: string | null;
}
export interface Camp {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string | null;
  doctorId: string | null;
  doctor: string | null;
  place: string | null;
  status: 'open' | 'closed';
  examined: number;
  published: number;
  attention: number;
  pupils: number;
}
export interface StockView {
  expiryAlertDays: number;
  medicines: Medicine[];
  batches: Array<{
    id: string;
    medicineId: string;
    batchNo: string | null;
    expiryOn: string | null;
    qtyIn: number;
    qtyLeft: number;
    receivedOn: string;
    supplier: string | null;
    note: string | null;
    expired: boolean;
    expiring: boolean;
  }>;
  moves: Array<{
    id: string;
    medicine: string;
    unit: string;
    kind: 'received' | 'given' | 'written_off';
    qty: number;
    note: string | null;
    at: string;
    visitId: string | null;
    by: string | null;
  }>;
}

export const OUTCOME_TONE: Record<Outcome, 'success' | 'info' | 'warning' | 'danger'> = {
  back_to_class: 'success',
  rest: 'info',
  sent_home: 'warning',
  referred: 'danger',
};
export const OUTCOMES: Array<[Outcome, string]> = [
  ['back_to_class', 'Back to class / work'],
  ['rest', 'Rest in the clinic'],
  ['sent_home', 'Sent home'],
  ['referred', 'Referred to a doctor or hospital'],
];
export const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'];
export const MASTER_LABEL: Record<ClinicMaster['kind'], [string, string]> = {
  clinic: ['Clinics', 'Clinic'],
  doctor: ['Doctors', 'Doctor'],
  nurse: ['Nurses', 'Nurse'],
  disease: ['Diseases and complaints', 'Disease or complaint'],
};
export const medName = (m: { name: string; strength: string | null }) =>
  `${m.name}${m.strength ? ` ${m.strength}` : ''}`;

export type SetupKind = 'clinic' | 'doctor' | 'nurse' | 'disease' | 'medicine';
export interface SetupRow {
  id: string;
  name: string;
  active: boolean;
  // people
  qualification?: string | null;
  regNo?: string | null;
  mobile?: string | null;
  employeeId?: string | null;
  employee?: string | null;
  employeeCode?: string | null;
  note?: string | null;
  sortOrder?: number;
  // medicines
  form?: string;
  strength?: string | null;
  unit?: string;
  lowStockAt?: number;
  stock?: number;
}
export const SETUP_TITLE: Record<SetupKind, [string, string]> = {
  clinic: ['Clinics', 'clinic'],
  doctor: ['Doctors', 'doctor'],
  nurse: ['Nurses', 'nurse'],
  disease: ['Diseases and complaints', 'disease or complaint'],
  medicine: ['Medicines', 'medicine'],
};
export const MEDICINE_FORMS = [
  'Tablet',
  'Capsule',
  'Syrup',
  'Ointment',
  'Drops',
  'Spray',
  'Injection',
  'Dressing',
  'Other',
];
