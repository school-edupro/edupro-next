import { cookies } from 'next/headers';
import type { AdmissionFormDef, UploadedFile } from '@edupro/ui';
import { API, PublicApiError } from './api';

/** The admission portal's own sign-in (docs/design/39, part 3): a code to the family's mobile / email. */
export const ADMISSION_COOKIE = 'edupro_admission';

export async function admissionFetch<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const t = token === undefined ? (await cookies()).get(ADMISSION_COOKIE)?.value : token;
  if (t) headers.set('Authorization', `Bearer ${t}`);
  const res = await fetch(`${API}/api/v1/public/admission${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok)
    throw new PublicApiError(res.status, { type: String(body.type ?? 'request-error'), ...body });
  return body as T;
}

export interface PortalClass {
  id: string;
  name: string;
  seats: number;
  opensAt: string;
  closesAt: string;
  open: boolean;
  ageAsOn: string | null;
  dobFrom: string | null;
  dobTo: string | null;
  registrationFee: number | null;
  feeFrom: number | null;
  /** merit points the class goes by (docs/design/40) */
  points?: Array<{ name: string; points: number }>;
}
export interface PortalSession {
  id: string;
  code: string;
  name: string;
  academicYear: string;
  instructions: string | null;
  closesAt: string;
  classes: PortalClass[];
}
export interface PortalMe {
  candidate: { name: string | null; mobile: string | null; email: string | null };
  applications: Array<{
    id: string;
    number: string | null;
    status: string;
    candidate: string | null;
    className: string;
    session: string;
    academicYear: string;
    progress: number;
    feeDue: number;
    createdAt: string;
  }>;
}
export interface PortalApplication {
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
  steps: Array<{ name: string; kind: string; state: 'done' | 'current' | 'waiting' | 'rejected' }>;
  /** merit points from the form's answers (docs/design/40) */
  points?: {
    total: number;
    lines: Array<{ name: string; points: number }>;
    confirmed: boolean;
  } | null;
  slot: {
    stage: string;
    startsAt: string;
    minutes: number;
    venue: string;
    notes: string | null;
    rollNo: number;
  } | null;
  offer: { expiresAt: string | null; admissionFee: number } | null;
  waitRank: number | null;
  correction: { remark: string; dueOn: string | null } | null;
  admissionNo: string | null;
  admissionFeeDue: number;
  offerExpiresAt: string | null;
  hasAdmissionForm: boolean;
  cancelledAt: string | null;
  cancelReason: string | null;
}

export interface PortalInbox {
  notices: Array<{
    id: string;
    kind: string;
    title: string;
    body: string;
    bodyFormat: string;
    publishFrom: string;
    files: Array<{ id: string; name: string | null }>;
  }>;
  messages: Array<{
    id: string;
    channel: string;
    subject: string | null;
    body: string;
    format: string;
    at: string;
  }>;
}

export const whenIst = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso));

export const STATUS_TEXT: Record<
  string,
  { label: string; tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger' }
> = {
  draft: { label: 'Form not submitted', tone: 'neutral' },
  submitted: { label: 'Registration fee due', tone: 'warning' },
  registered: { label: 'Registered', tone: 'success' },
  under_review: { label: 'Under review', tone: 'info' },
  sent_back: { label: 'Correction asked', tone: 'warning' },
  shortlisted: { label: 'Shortlisted', tone: 'info' },
  selected: { label: 'Selected', tone: 'success' },
  waitlisted: { label: 'On the waiting list', tone: 'info' },
  offered: { label: 'Admission offered: fee due', tone: 'warning' },
  fee_paid: { label: 'Admission fee paid', tone: 'success' },
  admitted: { label: 'Admitted', tone: 'success' },
  rejected: { label: 'Not selected', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const dmy = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(d);
};
export const rupees = (n: number) => `₹${n.toLocaleString('en-IN')}`;
