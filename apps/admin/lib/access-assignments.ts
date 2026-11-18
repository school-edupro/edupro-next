/**
 * Access → Role assignments (one row a person): what `GET /access/assignments/people` returns, and the small
 * helpers its pages share.
 */
import { sectionBound } from './section-bound';

export type AssignmentState = 'active' | 'ending' | 'upcoming' | 'ended' | 'revoked';
export type PeopleGroup = 'staff' | 'parents' | 'students' | 'all';
export type StatusFilter = AssignmentState | 'all';

export const PEOPLE_GROUPS: PeopleGroup[] = ['staff', 'parents', 'students', 'all'];
export const STATUS_FILTERS: StatusFilter[] = [
  'active',
  'ending',
  'upcoming',
  'ended',
  'revoked',
  'all',
];

export interface PersonAssignment {
  id: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  campusName: string | null;
  validFrom: string;
  validTo: string | null;
  grantedByName: string | null;
  reason: string | null;
  revokedAt: string | null;
  state: AssignmentState;
  scopes: Array<{ type: string; id: string; name: string | null }>;
}

export interface PersonWithRoles {
  userId: string;
  name: string;
  personType: 'employee' | 'guardian' | 'student' | 'external';
  email: string | null;
  mobile: string | null;
  assignments: PersonAssignment[];
}

export interface AssignmentPeople {
  figures: {
    staff: number;
    parents: number;
    students: number;
    active: number;
    ending: number;
    revoked: number;
  };
  roles: Array<{ id: string; name: string; people: number }>;
  data: PersonWithRoles[];
  page: { number: number; size: number; total: number };
}

/** 2026-11-04 → 04-11-2026 */
export const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';

/** the badge tone of a state */
export const STATE_TONE: Record<
  AssignmentState,
  'success' | 'warning' | 'info' | 'neutral' | 'danger'
> = {
  active: 'success',
  ending: 'warning',
  upcoming: 'info',
  ended: 'neutral',
  revoked: 'danger',
};

/**
 * The sections an assignment reaches, in words: its sections named, every section when it has none — or none yet
 * for a teacher role the system gave (Teacher assignments sets its sections).
 */
export function sectionWords(
  a: PersonAssignment,
  w: (key: string, values?: Record<string, string | number>) => string,
  max = 6,
): string {
  const names = a.scopes.filter((s) => s.type === 'class_section').map((s) => s.name ?? `#${s.id}`);
  const campuses = a.scopes.filter((s) => s.type === 'campus').map((s) => s.name ?? `#${s.id}`);
  const all = [...campuses, ...names];
  if (!all.length) return sectionBound(a) ? w('noSection') : w('allSections');
  return all.length > max
    ? `${all.slice(0, max).join(', ')} ${w('moreSections', { n: all.length - max })}`
    : all.join(', ');
}
