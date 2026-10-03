import { cookies } from 'next/headers';

export const API = process.env.API_BASE_URL ?? 'http://localhost:4000';
export const COOKIE = 'edupro_applicant';

export class PublicApiError extends Error {
  constructor(
    readonly status: number,
    readonly problem: { type: string; detail?: string; [k: string]: unknown },
  ) {
    super(problem.detail ?? problem.type);
  }
}

/** Server-side call to the public admissions API; the applicant token comes from the HttpOnly cookie. */
export async function publicFetch<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  return call<T>('/public/admissions', path, init, token);
}

/** The same for the public appointment pages (the visitor signs in with the same mobile OTP). */
export async function visitFetch<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  return call<T>('/public/appointments', path, init, token);
}

async function call<T>(
  base: string,
  path: string,
  init: RequestInit,
  token: string | null | undefined,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const t = token === undefined ? (await cookies()).get(COOKIE)?.value : token;
  if (t) headers.set('Authorization', `Bearer ${t}`);
  const res = await fetch(`${API}/api/v1${base}${path}`, {
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

export interface Criterion {
  classId: string;
  classCode: string;
  className: string;
  seats: number;
  dobFrom: string | null;
  dobTo: string | null;
  passcode: string | null;
}
export interface FormField {
  key: string;
  label: string;
  labelHi?: string;
  type: 'text' | 'textarea' | 'number' | 'date' | 'select' | 'boolean' | 'email' | 'mobile';
  required?: boolean;
  options?: Array<{ value: string; label: string; labelHi?: string }>;
  section: string;
  sectionHi?: string;
  min?: number;
  max?: number;
}
export interface Cycle {
  id: string;
  code: string;
  name: string;
  nameHi: string | null;
  instructions: string | null;
  instructionsHi: string | null;
  opensAt: string;
  closesAt: string;
  applicationFee: string;
  formSchema: FormField[];
  criteria: Criterion[];
  academicYear: string;
}
export interface Application {
  id: string;
  cycleCode: string;
  classCode: string;
  applicationNo: string | null;
  status: string;
  childName: string;
  childDob: string;
  score: string | null;
  submittedAt: string | null;
  createdAt: string;
  data: Record<string, unknown>;
  feePaidAt?: string | null;
  offer?: {
    status: 'offered' | 'accepted' | 'expired' | 'withdrawn';
    admissionFee: string;
    expiresAt: string;
    acceptedAt: string | null;
    payment: {
      status: 'created' | 'pending' | 'succeeded' | 'failed' | 'cancelled';
      txnId: string;
      form: { action: string; fields: Record<string, string> } | null;
    } | null;
  } | null;
}

export type Lang = 'en' | 'hi';
export const t = (lang: Lang, en: string, hi: string) => (lang === 'hi' ? hi : en);
export const langOf = (v: string | undefined): Lang => (v === 'hi' ? 'hi' : 'en');

export interface VisitHost {
  id: string;
  name: string;
  location: string | null;
  slotMinutes: number;
  hours: Array<{ weekday: number; starts: string; ends: string }>;
}
export type AskRule = 'off' | 'optional' | 'required';
export interface VisitInfo {
  school: string;
  enabled: boolean;
  hosts: VisitHost[];
  purposes: string[];
  idProofKinds: string[];
  ask: { organisation: AskRule; idProof: AskRule; photo: AskRule };
  maxParty: number;
  maxDaysAhead: number;
  instructions: string | null;
}
export interface VisitSlots {
  closed: string | null;
  slots: Array<{ time: string; startsAt: string; available: boolean }>;
}
export type VisitState =
  'requested' | 'approved' | 'rejected' | 'cancelled' | 'checked_in' | 'completed' | 'no_show';
export interface Visit {
  id: string;
  number: string;
  state: VisitState;
  host: string | null;
  place: string | null;
  startsAt: string | null;
  purpose: string;
  visitorName: string | null;
  partySize: number;
  note: string | null;
  createdAt: string;
  passLink: string | null;
  passQr: string | null;
}
export const VISIT_STATE: Record<
  VisitState,
  [string, string, 'neutral' | 'info' | 'success' | 'warning' | 'danger']
> = {
  requested: ['Waiting for the school', 'विद्यालय की प्रतीक्षा', 'warning'],
  approved: ['Confirmed', 'पुष्ट', 'success'],
  rejected: ['Not confirmed', 'पुष्टि नहीं हुई', 'danger'],
  cancelled: ['Cancelled', 'रद्द', 'neutral'],
  checked_in: ['Arrived', 'पहुँचे', 'info'],
  completed: ['Completed', 'पूर्ण', 'neutral'],
  no_show: ['Did not come', 'नहीं आए', 'danger'],
};
/** The school day (India) of now, as YYYY-MM-DD. */
export const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
export const whenIst = (v: string, lang: Lang) =>
  new Date(v).toLocaleString(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    timeZone: 'Asia/Kolkata',
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
