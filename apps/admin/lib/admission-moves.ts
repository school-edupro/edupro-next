/** A move between the schools of the group as the API gives it (docs/design/64). */
export interface AdmissionMove {
  id: string;
  direction: 'outgoing' | 'incoming';
  status: 'requested' | 'accepted' | 'refused' | 'withdrawn';
  statusLabel: string;
  candidate: string | null;
  number: string | null;
  admissionNo: string | null;
  fromStatus: string;
  className: string;
  session: string;
  fromSchool: string;
  toSchool: string;
  reason: string;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  /** this school's own registration: the old one (outgoing) or the new one (incoming) */
  applicationId: string | null;
  to: { number: string | null; className: string; session: string } | null;
  money: {
    paid: number;
    registration: number;
    admission: number;
    receipts: Array<{
      receiptNo: string;
      head: 'registration' | 'admission';
      amount: number;
      on: string;
    }>;
    carried: number | null;
    toRegistration: number | null;
    differenceDue: number | null;
    credit: number | null;
  };
  carries: { answers: number; files: number; login: boolean };
  missing: string[];
  details: {
    dob: string | null;
    gender: string;
    mobile: string | null;
    email: string | null;
    points: number | null;
  } | null;
}

export const MOVE_TONE: Record<
  AdmissionMove['status'],
  'warning' | 'success' | 'danger' | 'neutral'
> = {
  requested: 'warning',
  accepted: 'success',
  refused: 'danger',
  withdrawn: 'neutral',
};
