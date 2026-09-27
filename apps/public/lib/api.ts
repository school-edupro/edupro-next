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
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const t = token === undefined ? (await cookies()).get(COOKIE)?.value : token;
  if (t) headers.set('Authorization', `Bearer ${t}`);
  const res = await fetch(`${API}/api/v1/public/admissions${path}`, {
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
