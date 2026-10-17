import { cookies } from 'next/headers';
import type { ConsentFee, ConsentField } from '@edupro/ui';
import { API, PublicApiError } from './api';

/** The pass of a consent form's public link (docs/design/28-consent-forms.md): HttpOnly, two hours. */
export const CONSENT_COOKIE = 'edupro_consent';
export const SCHOOL_RE = /^[A-Za-z0-9-]{1,40}$/;
export const TOKEN_RE = /^[A-Za-z0-9_-]{10,60}$/;

/** Server-side call to the form's public link; the pass comes from the cookie unless given. */
export async function consentFetch<T>(
  school: string,
  token: string,
  path: string,
  init: RequestInit = {},
  pass?: string | null,
): Promise<T> {
  const p = pass === undefined ? (await cookies()).get(CONSENT_COOKIE)?.value : pass;
  const headers = new Headers(init.headers);
  if (p) headers.set('Authorization', `Bearer ${p}`);
  if (init.body) headers.set('Content-Type', 'application/json');
  const res = await fetch(
    `${API}/api/v1/public/consent-forms/${encodeURIComponent(school)}/${encodeURIComponent(token)}${path}`,
    { ...init, headers, cache: 'no-store' },
  );
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => ({ type: 'bad-response' }))) as T & {
    type?: string;
    detail?: string;
  };
  if (!res.ok) throw new PublicApiError(res.status, body as { type: string; detail?: string });
  return body;
}

export interface ConsentInfo {
  school: string;
  title: string;
  description: string | null;
  fields: ConsentField[];
  lists: Record<string, string[]>;
  open: boolean;
  closedWhy: string | null;
  closesAt: string | null;
  editUntil: string | null;
  repeat: 'once' | 'many';
  families: boolean;
  outsiders: boolean;
  fee: ConsentFee;
  approval: boolean;
}
export interface ConsentMe {
  mode: 'outsider' | 'family';
  about: { name: string; section: string | null };
  address: string;
  canAnswer: boolean;
  responses: Array<{
    id: string;
    number: string;
    status: 'submitted' | 'approved' | 'rejected';
    signedAt: string;
    fee: string;
    lineId: string | null;
    lineAmount: string | null;
    paid: string | null;
    decidedNote: string | null;
    waiting: boolean;
    canEdit: boolean;
  }>;
}
