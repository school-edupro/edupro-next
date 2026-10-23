/** Admission set-up and session planning shapes (docs/design/39, part 2). */
import type { AdmissionCondition } from '@edupro/ui';

export interface AdmissionSettings {
  signinChannels: Array<'email' | 'sms' | 'whatsapp'>;
  regReceiptPrefix: string;
  admReceiptPrefix: string;
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
    academicYear: string;
    url: string;
  };
  classes: SessionClass[];
  fees: Array<{
    classId: string;
    categoryId: string;
    registrationFee: number;
    admissionFee: number;
  }>;
  categories: FeeCategory[];
  allClasses: Array<{ id: string; name: string }>;
  forms: Array<{ id: string; name: string }>;
}
