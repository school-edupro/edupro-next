/**
 * Portal profile policy (2026-10-01): what parents and students see and may change on the portal
 * profile, which changes carry a proof document, when editing is open and who approves a change.
 * Stored per school in profile_portal_policies; anything the school has not set falls back to the
 * defaults below. Shared by the API (portal, approvals) and the workers (parent profile PDF).
 */
import type { PoolClient } from 'pg';
import {
  FAMILY_EDITABLE_KEYS,
  PROFILE_FIELDS,
  PROFILE_FIELD_BY_KEY,
  PROFILE_SECTIONS,
  type ProfileField,
} from './student-fields';

export type PortalAudience = 'parent' | 'student';
export const PORTAL_AUDIENCES: readonly PortalAudience[] = ['parent', 'student'];
export type PortalLevel = 'hidden' | 'view' | 'edit_approval' | 'edit_direct';
export const PORTAL_LEVELS: readonly PortalLevel[] = [
  'hidden',
  'view',
  'edit_approval',
  'edit_direct',
];

/** One approval step. `office` = anyone who decides profile changes for the school. */
export type Approver =
  | { kind: 'office' }
  | { kind: 'class_teacher' }
  | { kind: 'role'; roleId: string; name?: string }
  | { kind: 'user'; userId: string; name?: string };
export type ApprovalRoute = Approver[];

export interface EditWindow {
  mode: 'open' | 'closed' | 'period';
  from?: string | null;
  to?: string | null;
  message?: string | null;
}

export interface PortalPolicy {
  fields: Record<PortalAudience, Record<string, PortalLevel>>;
  proofs: Record<string, string>;
  window: EditWindow;
  approval: {
    default: ApprovalRoute;
    sections: Record<string, ApprovalRoute>;
    fields: Record<string, ApprovalRoute>;
  };
}

/** Document kinds a proof may be (document_kind enum values used for students). */
export const PROOF_KINDS = [
  'birth_certificate',
  'address_proof',
  'aadhaar',
  'category_certificate',
  'medical',
  'transfer_certificate',
  'bank',
  'pan',
  'photo',
  'other',
] as const;

/** Fields a family can never change (computed, from the enrolment, or office records). */
export const OFFICE_ONLY_KEYS: ReadonlySet<string> = new Set([
  'registration_no',
  'admission_no',
  'registration_date',
  'admitted_on',
  'house',
  'stream',
  'route_no',
  'photo_ref',
  'father_photo',
  'mother_photo',
  'guardian_photo',
  'father_school_staff',
  'father_staff_employee_id',
  'mother_school_staff',
  'mother_staff_employee_id',
  'guardian_school_staff',
  'guardian_staff_employee_id',
  'birth_certificate_submitted',
  'residence_proof_submitted',
  'student_photo_submitted',
  'aadhaar_copy_submitted',
  'remarks',
]);

/** Legacy photo reference fields (file name / link text): never shown on the portal. */
export const LEGACY_PHOTO_KEYS: ReadonlySet<string> = new Set([
  'photo_ref',
  'father_photo',
  'mother_photo',
  'guardian_photo',
]);
const PHOTO_KEYS = LEGACY_PHOTO_KEYS;

/**
 * The photos a family may change from the portal. They follow the same levels and approval routes
 * as fields (by section); the value of a change is the uploaded file's id.
 */
export const PORTAL_PHOTOS: ReadonlyArray<{
  key: string;
  party: 'student' | 'father' | 'mother';
  section: string;
  label: string;
}> = [
  { key: 'photo_student', party: 'student', section: 'student', label: 'Student photo' },
  { key: 'photo_father', party: 'father', section: 'father', label: "Father's photo" },
  { key: 'photo_mother', party: 'mother', section: 'mother', label: "Mother's photo" },
];
export const PORTAL_PHOTO_BY_KEY = new Map(PORTAL_PHOTOS.map((p) => [p.key, p]));

/** Parents change photos with approval; a student sees their own photo, not the parents'. */
function defaultPhotoLevel(audience: PortalAudience, key: string): PortalLevel {
  if (audience === 'parent') return 'edit_approval';
  return key === 'photo_student' ? 'view' : 'hidden';
}

export const isEditableKey = (f: ProfileField): boolean =>
  f.store.t !== 'auto' && f.store.t !== 'enrol' && !OFFICE_ONLY_KEYS.has(f.key);

const FAMILY_EDITABLE = new Set(FAMILY_EDITABLE_KEYS);
const STUDENT_HIDDEN = new Set([
  'family_income',
  'father_annual_income',
  'mother_annual_income',
  'guardian_annual_income',
]);

/** Caste details are sensitive personal data (DPDP): off the portal until the school opens them. */
const CASTE_HIDDEN = new Set(['sub_caste']);

/** What the school gets before it changes anything. */
export function defaultLevel(audience: PortalAudience, f: ProfileField): PortalLevel {
  if (PHOTO_KEYS.has(f.key)) return 'hidden';
  if (CASTE_HIDDEN.has(f.key)) return 'hidden';
  if (f.section === 'documents') return 'hidden';
  if (audience === 'student') {
    if (f.sensitive || f.section === 'bank' || STUDENT_HIDDEN.has(f.key)) return 'hidden';
    return 'view';
  }
  return FAMILY_EDITABLE.has(f.key) ? 'edit_approval' : 'view';
}

export const DEFAULT_PROOFS: Record<string, string> = {
  first_name: 'birth_certificate',
  middle_name: 'birth_certificate',
  last_name: 'birth_certificate',
  dob: 'birth_certificate',
  residential_address_line_1: 'address_proof',
  residential_city: 'address_proof',
  residential_pin_code: 'address_proof',
  category: 'category_certificate',
  aadhaar_no: 'aadhaar',
  bank_account_no: 'bank',
};

export const DEFAULT_ROUTE: ApprovalRoute = [{ kind: 'office' }];

const isLevel = (x: unknown): x is PortalLevel => PORTAL_LEVELS.includes(x as PortalLevel);

function cleanRoute(raw: unknown): ApprovalRoute | null {
  if (!Array.isArray(raw)) return null;
  const out: ApprovalRoute = [];
  for (const a of raw.slice(0, 2)) {
    if (!a || typeof a !== 'object') continue;
    const x = a as Record<string, unknown>;
    if (x.kind === 'office' || x.kind === 'class_teacher') out.push({ kind: x.kind });
    else if (x.kind === 'role' && /^\d{1,18}$/.test(String(x.roleId ?? '')))
      out.push({
        kind: 'role',
        roleId: String(x.roleId),
        name: typeof x.name === 'string' ? x.name.slice(0, 80) : undefined,
      });
    else if (x.kind === 'user' && /^\d{1,18}$/.test(String(x.userId ?? '')))
      out.push({
        kind: 'user',
        userId: String(x.userId),
        name: typeof x.name === 'string' ? x.name.slice(0, 80) : undefined,
      });
  }
  return out.length ? out : null;
}

/** The stored row (or nothing) made whole: every field has a level for both audiences. */
export function resolvePolicy(
  row?: {
    fields?: unknown;
    proofs?: unknown;
    edit_window?: unknown;
    approval?: unknown;
  } | null,
): PortalPolicy {
  const storedFields = (row?.fields ?? {}) as Record<string, Record<string, unknown>>;
  const fields = { parent: {}, student: {} } as PortalPolicy['fields'];
  for (const a of PORTAL_AUDIENCES) {
    const stored = storedFields[a] ?? {};
    for (const f of PROFILE_FIELDS) {
      let lvl = isLevel(stored[f.key]) ? (stored[f.key] as PortalLevel) : defaultLevel(a, f);
      if ((lvl === 'edit_approval' || lvl === 'edit_direct') && !isEditableKey(f)) lvl = 'view';
      if (PHOTO_KEYS.has(f.key) || f.retired) lvl = 'hidden';
      fields[a][f.key] = lvl;
    }
    for (const ph of PORTAL_PHOTOS)
      fields[a][ph.key] = isLevel(stored[ph.key])
        ? (stored[ph.key] as PortalLevel)
        : defaultPhotoLevel(a, ph.key);
  }
  const proofs: Record<string, string> = {};
  const storedProofs = row?.proofs as Record<string, unknown> | undefined;
  // a school that has saved its policy keeps exactly its own list (it may have removed every proof)
  const proofSource = row ? (storedProofs ?? {}) : DEFAULT_PROOFS;
  for (const [k, v] of Object.entries(proofSource))
    if (PROFILE_FIELD_BY_KEY.has(k) && PROOF_KINDS.includes(v as (typeof PROOF_KINDS)[number]))
      proofs[k] = v as string;
  const w = (row?.edit_window ?? {}) as Record<string, unknown>;
  const window: EditWindow = {
    mode: w.mode === 'closed' || w.mode === 'period' ? w.mode : 'open',
    from: typeof w.from === 'string' ? w.from : null,
    to: typeof w.to === 'string' ? w.to : null,
    message: typeof w.message === 'string' ? w.message : null,
  };
  const ap = (row?.approval ?? {}) as Record<string, unknown>;
  const sections: Record<string, ApprovalRoute> = {};
  for (const [k, v] of Object.entries((ap.sections ?? {}) as Record<string, unknown>)) {
    const r = cleanRoute(v);
    if (r && PROFILE_SECTIONS.some((s) => s.id === k)) sections[k] = r;
  }
  const fieldRoutes: Record<string, ApprovalRoute> = {};
  for (const [k, v] of Object.entries((ap.fields ?? {}) as Record<string, unknown>)) {
    const r = cleanRoute(v);
    if (r && (PROFILE_FIELD_BY_KEY.has(k) || PORTAL_PHOTO_BY_KEY.has(k))) fieldRoutes[k] = r;
  }
  return {
    fields,
    proofs,
    window,
    approval: {
      default: cleanRoute(ap.default) ?? DEFAULT_ROUTE,
      sections,
      fields: fieldRoutes,
    },
  };
}

export async function loadPortalPolicy(c: PoolClient): Promise<PortalPolicy> {
  const r = await c.query<{
    fields: unknown;
    proofs: unknown;
    edit_window: unknown;
    approval: unknown;
  }>(
    `SELECT fields, proofs, edit_window, approval FROM profile_portal_policies WHERE school_id = app.current_school_id()`,
  );
  return resolvePolicy(r.rows[0] ?? null);
}

/** The route a field's change follows: the field's own, else its section's, else the default. */
export function routeFor(policy: PortalPolicy, key: string): ApprovalRoute {
  const section = PROFILE_FIELD_BY_KEY.get(key)?.section ?? PORTAL_PHOTO_BY_KEY.get(key)?.section;
  return (
    policy.approval.fields[key] ??
    (section ? policy.approval.sections[section] : undefined) ??
    policy.approval.default
  );
}

/** A stable text for grouping fields that follow the same route. */
export const routeSignature = (r: ApprovalRoute): string =>
  r
    .map((a) =>
      a.kind === 'role' ? `role:${a.roleId}` : a.kind === 'user' ? `user:${a.userId}` : a.kind,
    )
    .join('>');

/** Is editing open today (India time)? With the reason to show when it is not. */
export function windowState(
  w: EditWindow,
  today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
): { open: boolean; message: string | null; until: string | null } {
  if (w.mode === 'closed')
    return {
      open: false,
      message: w.message || 'Profile updates are closed at the moment.',
      until: null,
    };
  if (w.mode === 'period') {
    const open = (!w.from || today >= w.from) && (!w.to || today <= w.to);
    return {
      open,
      message: open
        ? w.message || null
        : w.message ||
          (w.from && today < w.from
            ? `Profile updates open on ${w.from}.`
            : 'The profile update period has ended.'),
      until: open ? (w.to ?? null) : null,
    };
  }
  return { open: true, message: w.message || null, until: null };
}

/** Human text for an approver (lists and the parent's request history). */
export function approverLabel(a: Approver): string {
  if (a.kind === 'office') return 'School office';
  if (a.kind === 'class_teacher') return 'Class teacher';
  if (a.kind === 'role') return a.name ? `Role: ${a.name}` : 'Role';
  return a.name ?? 'Named employee';
}
