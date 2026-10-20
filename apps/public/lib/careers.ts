import { cookies } from 'next/headers';
import { API, PublicApiError } from './api';

/** The careers page's own sign-in (a code to the mobile or the email), kept apart from admissions. */
export const CAREERS_COOKIE = 'edupro_candidate';

/** Server-side call to the careers API; the candidate token comes from the HttpOnly cookie. */
/**
 * The signed-in candidate, when the sign-in is for this school's careers page (one sign-in at a time:
 * signing in at another school's page asks again).
 */
export async function careersMe(school: string): Promise<CareerMe | null> {
  if (!(await cookies()).get(CAREERS_COOKIE)?.value) return null;
  const me = await careersFetch<CareerMe>('/me').catch(() => null);
  return me && me.school === school.toLowerCase() ? me : null;
}

export async function careersFetch<T>(
  path: string,
  init: RequestInit = {},
  token?: string | null,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const t = token === undefined ? (await cookies()).get(CAREERS_COOKIE)?.value : token;
  if (t) headers.set('Authorization', `Bearer ${t}`);
  const res = await fetch(`${API}/api/v1/public/careers${path}`, {
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

export interface CareerVacancy {
  id: string;
  code: string;
  title: string;
  designation: string | null;
  department: string | null;
  subject: string | null;
  employeeType: string | null;
  posts: number;
  qualification: string | null;
  experience: string | null;
  payBand: string | null;
  description: string | null;
  opensAt: string;
  closesAt: string;
  campus: string | null;
}
export interface CareerField {
  key: string;
  section: string;
  label: string;
  type: string;
  required: boolean;
  help: string | null;
  sensitive: boolean;
  options: string[] | null;
  /** shown only when another answer is (or is not) one of these */
  when: { key: string; in?: string[]; notIn?: string[] } | null;
}
export interface CareerColumn {
  key: string;
  label: string;
  type: 'text' | 'year' | 'date' | 'number' | 'list';
  options?: string[];
  required?: boolean;
}
export interface CareerForm {
  sections: Array<{ id: string; title: string }>;
  fields: CareerField[];
  rows: Record<string, { title: string; max: number; columns: CareerColumn[] }>;
  documents: Array<{
    kind: string;
    label: string;
    required?: boolean;
    many?: boolean;
    image?: boolean;
  }>;
  activities: string[];
  /** the school's lists of places: country → state → city (a city's PIN when known) */
  places: {
    countries: string[];
    states: Array<{ name: string; country: string | null }>;
    cities: Array<{ name: string; state: string | null; pin: string | null }>;
  };
  age: { min: number; max: number };
  /** today in India, YYYY-MM-DD */
  today: string;
}
/** How a code can reach a candidate at the school. */
export interface CareerSignIn {
  mobile: boolean;
  email: boolean;
  minutes: number;
  dev: boolean;
}
/** What saving a step gives back: the refusals by field (`kind.i.column` for entries) and the form now. */
export interface CareerSaved {
  ok: boolean;
  errors: Record<string, string>;
  problem?: string;
  me?: CareerMe;
}
export interface CareerMe {
  candidate: { id: string; name: string | null; mobile: string | null; email: string | null };
  /** the school the sign-in is for (lower-case code) */
  school: string;
  values: Record<string, unknown>;
  rows: Record<string, Array<Record<string, string | null>>>;
  activities: string[];
  files: Array<{ id: string; kind: string; fileId: string; contentType: string }>;
  missing: string[];
  applications: Array<{
    id: string;
    number: string;
    vacancyId: string;
    title: string;
    code: string;
    status: string;
    submittedAt: string;
  }>;
}
export const APPLICATION_STATUS: Record<string, string> = {
  submitted: 'Received',
  screening: 'Under screening',
  selected: 'Selected',
  rejected: 'Not taken forward',
  on_hold: 'On hold',
  withdrawn: 'Withdrawn',
  joined: 'Joined',
};
export const dmy = (d: string | null | undefined) =>
  d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
/** A moment as people in the school read it: 30-10-2026, 5:00 pm (India time). */
export const istText = (iso: string | null | undefined) =>
  iso
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
        .format(new Date(iso))
        .replace(/\//g, '-')
        .replace(/\s?(am|pm)$/i, (m) => ` ${m.trim().toLowerCase()}`)
    : '';
