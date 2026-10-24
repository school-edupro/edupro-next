/** Admission set-up and session planning shapes (docs/design/39, part 2). */
import type { AdmissionCondition } from '@edupro/ui';

export interface AdmissionSettings {
  signinChannels: Array<'email' | 'sms' | 'whatsapp'>;
  regReceiptPrefix: string;
  admReceiptPrefix: string;
  /** sign-in codes also shown on screen (testing, docs/design/41) */
  otpOnScreen: boolean;
  /** codes shown on screen in the last 7 days */
  codesShown7d: number;
}
export interface FeeCategory {
  id: string;
  code: string;
  name: string;
  logic: 'all' | 'any';
  conditions: AdmissionCondition[];
  isDefault: boolean;
  status: 'active' | 'inactive';
  sortOrder: number;
}
export interface AdmissionSetup {
  settings: AdmissionSettings;
  categories: FeeCategory[];
}
export interface SessionClass {
  classId: string;
  className: string;
  formId: string | null;
  formName: string | null;
  seats: number;
  opensAt: string | null;
  closesAt: string | null;
  ageAsOn: string | null;
  dobFrom: string | null;
  dobTo: string | null;
  notes: string | null;
  status: 'open' | 'closed';
  applications: number;
  registered: number;
}
export interface SessionPlan {
  session: {
    id: string;
    code: string;
    name: string;
    status: string;
    opensAt: string;
    closesAt: string;
    instructions: string | null;
    refundDeductionPct: number;
    offerDays: number;
    academicYear: string;
    url: string;
  };
  classes: SessionClass[];
  fees: Array<{
    classId: string;
    categoryId: string;
    registrationFee: number;
    admissionFee: number;
    seats: number | null;
  }>;
  categories: FeeCategory[];
  allClasses: Array<{ id: string; name: string }>;
  forms: Array<{ id: string; name: string }>;
}

/** Merit points of a session (docs/design/40, part 2). */
export interface PointRule {
  id?: string;
  name: string;
  logic: 'all' | 'any';
  conditions: AdmissionCondition[];
  points: number;
}
export interface SessionPoints {
  editable: boolean;
  session: PointRule[];
  classes: Array<{
    classId: string;
    className: string;
    formId: string | null;
    formName: string | null;
    own: boolean;
    rules: PointRule[];
  }>;
  /** questions of the session's forms, with the forms that ask each */
  fields: Array<{ key: string; label: string; type: string; values: string[]; forms: string[] }>;
}

/** A registration's merit points as the office sees them (docs/design/40, part 3). */
export interface RegistrationPoints {
  total: number;
  lines: Array<{ name: string; max: number; auto: number; points: number; reason?: string | null }>;
  confirmedAt: string | null;
  confirmedBy: string | null;
}

/** A late-entry passcode of a session (docs/design/41, part 4). */
export interface LatePasscode {
  id: string;
  classId: string;
  className: string;
  email: string;
  mobile: string | null;
  childName: string | null;
  validUntil: string;
  state: 'sent' | 'used' | 'expired' | 'revoked';
  sentAt: string | null;
  usedAt: string | null;
  usedBy: string | null;
  note: string | null;
  createdBy: string | null;
  createdAt: string;
}
