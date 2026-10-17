import type { ConsentField } from '@edupro/ui';
import type { ConsentAudience, ConsentSettings } from './ConsentBuilder';

/** A consent form as the API returns it (docs/design/28-consent-forms.md). */
export interface ConsentForm {
  id: string;
  code: string;
  title: string;
  description: string | null;
  respondents: 'family' | 'staff' | 'both';
  fields: ConsentField[];
  audience: ConsentAudience;
  settings: ConsentSettings;
  status: 'draft' | 'published' | 'closed' | 'archived';
  open: boolean;
  closedWhy: string | null;
  responses: number;
  asked: number | null;
  answered: number;
  publishedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  createdBy: string | null;
  lists?: Record<string, string[]>;
}
export interface ConsentAnswered {
  id: string;
  number: string | null;
  respondent: 'family' | 'staff' | 'office' | 'public';
  status: string;
  answers: Record<string, unknown>;
  signedName: string | null;
  signedAt: string;
  studentId: string | null;
  student: string | null;
  admissionNo: string | null;
  section: string | null;
  employeeId: string | null;
  employee: string | null;
  employeeCode: string | null;
  byUser: string | null;
  enteredBy: string | null;
}
export interface ConsentPending {
  kind: 'student' | 'employee';
  id: string;
  name: string;
  code: string | null;
  section: string | null;
  contact: string | null;
}
export const STATUS_TONE = {
  draft: 'neutral',
  published: 'success',
  closed: 'warning',
  archived: 'neutral',
} as const;
export const STATUS_LABEL = {
  draft: 'Draft',
  published: 'Published',
  closed: 'Closed',
  archived: 'Archived',
} as const;
export const WHO = { family: 'Families', staff: 'Staff', both: 'Families and staff' } as const;
/** "2026-11-20T18:00" as "20-11-2026 18:00". */
export const dt = (s?: string | null) =>
  s
    ? `${s.slice(8, 10)}-${s.slice(5, 7)}-${s.slice(0, 4)}${s.length > 10 ? ` ${s.slice(11, 16)}` : ''}`
    : '';
