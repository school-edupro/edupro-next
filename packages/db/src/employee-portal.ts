import type { PoolClient } from 'pg';
import { EMPLOYEE_FIELDS, EMPLOYEE_SECTIONS, type EmployeeField } from './employee-fields';
import { EMPLOYEE_LIST_KINDS, type EmployeeListKind } from './employee-rows';
import { windowState, type EditWindow, type PortalLevel } from './profile-portal';

/**
 * What staff may see and change on their own profile (0186, docs/design/33-people-dashboards.md), as the
 * family portal policy does for students (profile-portal.ts): a level per field, the proof document a change
 * needs (one of the school's employee document types), the update window, and the approvers.
 */
export type EmployeeApprover =
  | { kind: 'office' }
  | { kind: 'hod' }
  | { kind: 'l1' }
  | { kind: 'l2' }
  | { kind: 'role'; roleCode: string }
  | { kind: 'employee'; employeeId: string };
export type EmployeeRoute = EmployeeApprover[];

/** A row list (education, languages, experience, documents): what staff may do and the proof a change needs. */
export interface EmployeeListPolicy {
  level: PortalLevel;
  proof: string | null;
}

export interface EmployeePortalPolicy {
  fields: Record<string, PortalLevel>;
  /** key → employee_document_types.id */
  proofs: Record<string, string>;
  /** 0187: the four lists; approvers under approval.sections['list:<kind>'] */
  lists: Record<EmployeeListKind, EmployeeListPolicy>;
  /**
   * 0188: the employee's photo (shown; or changed by the employee with approval or at once). Stored as
   * fields.photo; approvers under approval.sections.photo. HR always changes it on the employee's page.
   */
  photo: Exclude<PortalLevel, 'hidden'>;
  window: EditWindow;
  approval: {
    default: EmployeeRoute;
    sections: Record<string, EmployeeRoute>;
    fields: Record<string, EmployeeRoute>;
  };
}

/** Kept by the office: never changed by the employee (the code, the job, the approvers, the machine id). */
export const EMPLOYEE_OFFICE_ONLY: ReadonlySet<string> = new Set([
  'employee_code',
  'biometric_id',
  // the school-issued address (it may be the login)
  'email',
  ...EMPLOYEE_FIELDS.filter((f) => f.section === 'employment' || f.section === 'approvers').map(
    (f) => f.key,
  ),
]);

export const employeeEditable = (f: EmployeeField): boolean =>
  f.store.t !== 'auto' && !EMPLOYEE_OFFICE_ONLY.has(f.key);

/** Until the school decides: personal, contact and address change with approval; the rest is shown. */
export function employeeDefaultLevel(f: EmployeeField): PortalLevel {
  if (!employeeEditable(f)) return f.section === 'approvers' ? 'hidden' : 'view';
  if (f.section === 'statutory') return 'view';
  return 'edit_approval';
}

export const EMPLOYEE_DEFAULT_ROUTE: EmployeeRoute = [{ kind: 'office' }];

const LEVELS = new Set<PortalLevel>(['hidden', 'view', 'edit_approval', 'edit_direct']);
/** The photo's key in the policy's fields, in change requests and in approval.sections (0188). */
export const EMPLOYEE_PHOTO_KEY = 'photo';
const SECTION_IDS = new Set<string>([
  ...EMPLOYEE_SECTIONS.map((s) => s.id),
  ...EMPLOYEE_LIST_KINDS.map((k) => `list:${k}`),
  EMPLOYEE_PHOTO_KEY,
]);
export const employeeListSection = (kind: EmployeeListKind) => `list:${kind}`;
export const employeePolicySectionIds = (): ReadonlySet<string> => SECTION_IDS;

function cleanRoute(raw: unknown): EmployeeRoute | null {
  if (!Array.isArray(raw)) return null;
  const out: EmployeeRoute = [];
  for (const a of raw.slice(0, 2)) {
    if (!a || typeof a !== 'object') continue;
    const k = (a as { kind?: string }).kind;
    if (k === 'office' || k === 'hod' || k === 'l1' || k === 'l2') out.push({ kind: k });
    else if (k === 'role' && typeof (a as { roleCode?: unknown }).roleCode === 'string')
      out.push({ kind: 'role', roleCode: (a as { roleCode: string }).roleCode });
    else if (
      k === 'employee' &&
      /^\d{1,18}$/.test(String((a as { employeeId?: unknown }).employeeId ?? ''))
    )
      out.push({ kind: 'employee', employeeId: String((a as { employeeId: string }).employeeId) });
  }
  return out.length ? out : null;
}

/** The stored row made complete: every field has a level; office-only fields are at most shown. */
export function resolveEmployeePolicy(
  row: {
    fields?: unknown;
    proofs?: unknown;
    lists?: unknown;
    edit_window?: unknown;
    approval?: unknown;
  } | null,
): EmployeePortalPolicy {
  const stored = (row?.fields ?? {}) as Record<string, unknown>;
  const fields: Record<string, PortalLevel> = {};
  for (const f of EMPLOYEE_FIELDS) {
    const v = stored[f.key];
    let level =
      typeof v === 'string' && LEVELS.has(v as PortalLevel)
        ? (v as PortalLevel)
        : employeeDefaultLevel(f);
    if (!employeeEditable(f) && (level === 'edit_approval' || level === 'edit_direct'))
      level = 'view';
    fields[f.key] = level;
  }
  const proofs: Record<string, string> = {};
  for (const [k, v] of Object.entries((row?.proofs ?? {}) as Record<string, unknown>))
    if (EMPLOYEE_FIELDS.some((f) => f.key === k) && /^\d{1,18}$/.test(String(v)))
      proofs[k] = String(v);
  const pv = stored[EMPLOYEE_PHOTO_KEY];
  const photo: EmployeePortalPolicy['photo'] =
    pv === 'view' || pv === 'edit_direct' || pv === 'edit_approval' ? pv : 'edit_approval';
  const storedLists = (row?.lists ?? {}) as Record<string, unknown>;
  const lists = {} as Record<EmployeeListKind, EmployeeListPolicy>;
  for (const kind of EMPLOYEE_LIST_KINDS) {
    const v = (storedLists[kind] ?? {}) as { level?: unknown; proof?: unknown };
    lists[kind] = {
      level:
        typeof v.level === 'string' && LEVELS.has(v.level as PortalLevel)
          ? (v.level as PortalLevel)
          : 'edit_approval',
      proof: /^\d{1,18}$/.test(String(v.proof ?? '')) ? String(v.proof) : null,
    };
  }
  const w = (row?.edit_window ?? {}) as Partial<EditWindow>;
  const window: EditWindow = {
    mode: w.mode === 'closed' || w.mode === 'period' ? w.mode : 'open',
    from: w.from ?? null,
    to: w.to ?? null,
    message: w.message ?? null,
  } as EditWindow;
  const a = (row?.approval ?? {}) as { default?: unknown; sections?: unknown; fields?: unknown };
  const sections: Record<string, EmployeeRoute> = {};
  for (const [k, v] of Object.entries((a.sections ?? {}) as Record<string, unknown>)) {
    const r = cleanRoute(v);
    if (r && SECTION_IDS.has(k)) sections[k] = r;
  }
  const byField: Record<string, EmployeeRoute> = {};
  for (const [k, v] of Object.entries((a.fields ?? {}) as Record<string, unknown>)) {
    const r = cleanRoute(v);
    if (r && EMPLOYEE_FIELDS.some((f) => f.key === k)) byField[k] = r;
  }
  return {
    fields,
    proofs,
    lists,
    photo,
    window,
    approval: {
      default: cleanRoute(a.default) ?? EMPLOYEE_DEFAULT_ROUTE,
      sections,
      fields: byField,
    },
  };
}

export async function loadEmployeePolicy(c: PoolClient): Promise<EmployeePortalPolicy> {
  const r = await c.query<{
    fields: unknown;
    proofs: unknown;
    lists: unknown;
    edit_window: unknown;
    approval: unknown;
  }>('SELECT fields, proofs, lists, edit_window, approval FROM employee_portal_policies LIMIT 1');
  return resolveEmployeePolicy(r.rows[0] ?? null);
}

/** The approvers of one field: its own, else its section's, else the default. */
export function employeeRouteFor(p: EmployeePortalPolicy, key: string): EmployeeRoute {
  const f = EMPLOYEE_FIELDS.find((x) => x.key === key);
  return (
    p.approval.fields[key] ?? (f ? p.approval.sections[f.section] : undefined) ?? p.approval.default
  );
}
/** The approvers of a row list: its own, else the default. */
export function employeeListRouteFor(
  p: EmployeePortalPolicy,
  kind: EmployeeListKind,
): EmployeeRoute {
  return p.approval.sections[employeeListSection(kind)] ?? p.approval.default;
}
/** The approvers of a photo change (0188): its own, else the default. */
export function employeePhotoRouteFor(p: EmployeePortalPolicy): EmployeeRoute {
  return p.approval.sections[EMPLOYEE_PHOTO_KEY] ?? p.approval.default;
}
export const employeeRouteSignature = (r: EmployeeRoute): string => JSON.stringify(r);
export const employeeWindowState = windowState;

export function employeeApproverLabel(
  a: EmployeeApprover,
  names: Record<string, string> = {},
): string {
  switch (a.kind) {
    case 'office':
      return 'HR / office';
    case 'hod':
      return 'The employee’s ACR HOD';
    case 'l1':
      return 'The employee’s L1 approver';
    case 'l2':
      return 'The employee’s L2 approver';
    case 'role':
      return names[`role:${a.roleCode}`] ?? a.roleCode;
    case 'employee':
      return names[`employee:${a.employeeId}`] ?? 'A named person';
  }
}
