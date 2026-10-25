/** The school desk of online admission (docs/design/39, part 3). */
import type { AdmissionFormDef, UploadedFile } from '@edupro/ui';

export interface DeskClass {
  id: string;
  name: string;
  open: boolean;
  opensAt: string;
  closesAt: string;
  registrationFee: number | null;
  feeFrom: number | null;
}
export interface DeskSession {
  id: string;
  code: string;
  name: string;
  academicYear: string;
  closesAt: string;
  classes: DeskClass[];
}
export interface DeskRow {
  id: string;
  number: string | null;
  status: string;
  candidate: string | null;
  className: string;
  mobile: string | null;
  progress: number;
  feeDue: number;
  createdAt: string;
  enteredBy: string | null;
}
export interface DeskOverview {
  sessions: DeskSession[];
  recent: DeskRow[];
}
export interface RegistrationForm {
  id: string;
  number: string | null;
  status: string;
  session: { id: string; code: string; name: string; academicYear: string };
  class: { id: string; name: string };
  candidate: string | null;
  category: string | null;
  progress: number;
  registrationFee: number | null;
  feeDue: number;
  submittedAt: string | null;
  registeredAt: string | null;
  createdAt: string;
  enteredByOffice: boolean;
  hasPdf: boolean;
  def: AdmissionFormDef;
  options: Record<string, string[]>;
  answers: Record<string, unknown>;
  files: Record<string, UploadedFile>;
  receipts: Array<{
    id: string;
    receiptNo: string;
    amount: number;
    date: string;
    head: string;
    mode: string;
    status: string;
  }>;
  onlyFields: string[] | null;
  admissionNo: string | null;
  /** The pupil made at Admit. */
  studentId?: string | null;
  admissionFeeDue: number;
  offerExpiresAt: string | null;
  hasAdmissionForm: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export const REG_STATUS: Record<
  string,
  { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  draft: { label: 'Form being filled', tone: 'neutral' },
  submitted: { label: 'Registration fee due', tone: 'warning' },
  registered: { label: 'Registered', tone: 'success' },
  under_review: { label: 'Under review', tone: 'info' },
  sent_back: { label: 'Sent back for correction', tone: 'warning' },
  shortlisted: { label: 'Shortlisted', tone: 'info' },
  selected: { label: 'Selected', tone: 'success' },
  waitlisted: { label: 'Waiting list', tone: 'info' },
  offered: { label: 'Offered: admission fee due', tone: 'warning' },
  fee_paid: { label: 'Admission fee paid', tone: 'success' },
  admitted: { label: 'Admitted', tone: 'success' },
  rejected: { label: 'Not selected', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
export const dmy = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date(iso))
    : '';

/** What the desk's search finds (docs/design/45, part 4). */
export interface DeskFind {
  registrations: Array<{
    id: string;
    number: string | null;
    status: string;
    candidate: string | null;
    className: string;
    session: string;
    mobile: string | null;
    email: string | null;
    progress: number;
    admissionNo: string | null;
    feeDue: number;
    createdAt: string;
  }>;
  enquiries: Array<{
    id: string;
    parentName: string;
    childName: string | null;
    mobile: string | null;
    stage: string | null;
    counsellor: string | null;
  }>;
}
