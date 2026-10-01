import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  LEGACY_PHOTO_KEYS,
  PORTAL_PHOTOS,
  PORTAL_PHOTO_BY_KEY,
  PROFILE_FIELDS,
  PROFILE_FIELD_BY_KEY,
  PROFILE_SECTIONS,
  PROOF_KINDS,
  approverLabel,
  decryptField,
  encryptField,
  isEditableKey,
  loadPortalPolicy,
  loadProfileLists,
  maskValue,
  optionsOf,
  readStudentProfile,
  refreshCompleteness,
  resolvePolicy,
  routeFor,
  routeSignature,
  validateChanges,
  windowState,
  writeStudentProfile,
  ProfileWriteError,
  type ApprovalRoute,
  type Approver,
  type PoolClient,
  type PortalAudience,
  type PortalPolicy,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { FilesService } from '../files/files.service';
import { ReportsService } from '../reports/reports.service';
import { ENGAGEMENT } from './engagement.dto';
import {
  PORTAL,
  type BulkDecideDto,
  type DecideItemsDto,
  type InboxQueryDto,
  type SavePortalPolicyDto,
  type SubmitPortalChangesDto,
} from './portal-profile.dto';

/** One changed field of a request. Sensitive values are stored encrypted (`enc`). */
export interface ChangeItem {
  from: unknown;
  to: unknown;
  status?: 'pending' | 'approved' | 'rejected';
  note?: string | null;
  enc?: boolean;
}

interface RequestDb {
  id: string;
  student_id: string;
  student_name: string;
  admission_no: string;
  class_section_id: string | null;
  class_section: string | null;
  requested_by: string | null;
  requested_by_user_id: string;
  audience: string;
  entity: 'student' | 'guardian' | 'profile';
  entity_id: string;
  changes: Record<string, ChangeItem>;
  reason: string | null;
  status: string;
  route: ApprovalRoute;
  current_level: number;
  proofs: Array<{ kind: string; fileId: string; fileName?: string | null }>;
  auto_applied: boolean;
  decided_by: string | null;
  decided_at: Date | null;
  decision_note: string | null;
  created_at: Date;
}

/** Who is deciding: what an approver step can match against. */
interface Actor {
  userId: string;
  roleIds: Set<string>;
  sections: Set<string>;
  office: boolean;
  override: boolean;
  sensitive: boolean;
}

const SELECT_REQUEST = `
  SELECT r.id::text, r.student_id::text, s.display_name AS student_name, s.admission_no,
         e.class_section_id::text, k.code || '-' || cs.name AS class_section,
         u.display_name AS requested_by, r.requested_by_user_id::text, r.audience, r.entity, r.entity_id::text,
         r.changes, r.reason, r.status::text, r.route, r.current_level, r.proofs, r.auto_applied,
         d.display_name AS decided_by, r.decided_at, r.decision_note, r.created_at
    FROM profile_change_requests r
    JOIN students s ON s.id = r.student_id
    LEFT JOIN enrolments e ON e.student_id = r.student_id AND e.academic_year_id = app.current_academic_year_id() AND e.status = 'active'
    LEFT JOIN class_sections cs ON cs.id = e.class_section_id
    LEFT JOIN classes k ON k.id = cs.class_id
    LEFT JOIN users u ON u.id = r.requested_by_user_id
    LEFT JOIN users d ON d.id = r.decided_by`;

const EDIT_LEVELS = new Set(['edit_approval', 'edit_direct']);
/** Requests made before the student 360 profile used column names. */
const LEGACY_LABEL: Record<string, string> = {
  mobile: 'Mobile',
  email: 'Email',
  occupation: 'Occupation',
  blood_group: 'Blood Group',
  house: 'House',
  'address.line1': 'Address line 1',
  'address.line2': 'Address line 2',
  'address.city': 'City',
  'address.pin': 'PIN code',
  'details.emergency_contact': 'Emergency contact',
};
const label = (k: string) =>
  PROFILE_FIELD_BY_KEY.get(k)?.label ?? PORTAL_PHOTO_BY_KEY.get(k)?.label ?? LEGACY_LABEL[k] ?? k;
const sectionOf = (k: string) =>
  PROFILE_FIELD_BY_KEY.get(k)?.section ?? PORTAL_PHOTO_BY_KEY.get(k)?.section ?? 'other';
/** Photos a family sends: JPG, PNG or WebP up to 5 MB. */
const PHOTO_TYPES = /^image\/(png|jpeg|webp)$/;
const PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PROOF_LABEL: Record<string, string> = {
  birth_certificate: 'birth certificate',
  address_proof: 'residence proof',
  aadhaar: 'Aadhaar card',
  category_certificate: 'caste / category certificate',
  medical: 'medical certificate',
  transfer_certificate: 'transfer certificate',
  bank: 'bank passbook or cheque',
  pan: 'PAN card',
  photo: 'photo',
  other: 'supporting document',
};
const CHECKLIST_BY_KIND: Record<string, string> = {
  birth_certificate: 'birth_certificate_submitted',
  address_proof: 'residence_proof_submitted',
  photo: 'student_photo_submitted',
  aadhaar: 'aadhaar_copy_submitted',
};

/**
 * Portal profile (2026-10-01): parents and students see the fields the school allows, change the ones
 * it opens (straight away or after approval, with proof where asked), download the profile as a PDF,
 * and follow their requests. Approvers see the requests routed to them (role, name, class teacher or
 * the office; one or two levels), accept or refuse field by field, and decide many at once.
 */
@Injectable()
export class PortalProfileService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly reports: ReportsService,
    private readonly files: FilesService,
  ) {}

  // ---- policy (administrators) ---------------------------------------------------------------------
  async policy(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await c.query<{
        fields: unknown;
        proofs: unknown;
        edit_window: unknown;
        approval: unknown;
        updated_at: Date;
        updated_by: string | null;
      }>(
        `SELECT p.fields, p.proofs, p.edit_window, p.approval, p.updated_at, u.display_name AS updated_by
           FROM profile_portal_policies p LEFT JOIN users u ON u.id = p.updated_by WHERE p.school_id = app.current_school_id()`,
      );
      const roles = await c.query<{ id: string; name: string; code: string }>(
        `SELECT id::text, name, code FROM roles WHERE (school_id IS NULL OR school_id = app.current_school_id())
            AND code NOT IN ('parent', 'student', 'support_engineer') AND deleted_at IS NULL ORDER BY name`,
      );
      const staff = await c.query<{ user_id: string; name: string; designation: string | null }>(
        `SELECT e.user_id::text, e.display_name AS name, e.designation FROM employees e
          WHERE e.user_id IS NOT NULL AND e.deleted_at IS NULL ORDER BY e.display_name`,
      );
      return {
        policy: resolvePolicy(row.rows[0] ?? null),
        saved: Boolean(row.rows[0]),
        updatedAt: row.rows[0]?.updated_at.toISOString() ?? null,
        updatedBy: row.rows[0]?.updated_by ?? null,
        sections: PROFILE_SECTIONS,
        fields: [
          ...PROFILE_FIELDS.filter((f) => !LEGACY_PHOTO_KEYS.has(f.key) && !f.retired).map((f) => ({
            key: f.key,
            section: f.section,
            label: f.label,
            sensitive: Boolean(f.sensitive),
            editable: isEditableKey(f),
            photo: false,
          })),
          ...PORTAL_PHOTOS.map((ph) => ({
            key: ph.key,
            section: ph.section,
            label: ph.label,
            sensitive: false,
            editable: true,
            photo: true,
          })),
        ],
        proofKinds: PROOF_KINDS.map((k) => ({ id: k, label: PROOF_LABEL[k] ?? k })),
        roles: roles.rows,
        staff: staff.rows.map((x) => ({
          userId: x.user_id,
          name: x.name,
          designation: x.designation,
        })),
      };
    });
  }

  async savePolicy(ctx: RequestContext, dto: SavePortalPolicyDto) {
    const unknown = [
      ...[
        ...Object.keys(dto.fields.parent),
        ...Object.keys(dto.fields.student),
        ...Object.keys(dto.approval.fields),
      ].filter((k) => !PROFILE_FIELD_BY_KEY.has(k) && !PORTAL_PHOTO_BY_KEY.has(k)),
      ...Object.keys(dto.proofs).filter((k) => !PROFILE_FIELD_BY_KEY.has(k)),
    ];
    const badSections = Object.keys(dto.approval.sections).filter(
      (s) => !PROFILE_SECTIONS.some((x) => x.id === s),
    );
    const badKinds = Object.values(dto.proofs).filter(
      (k) => !PROOF_KINDS.includes(k as (typeof PROOF_KINDS)[number]),
    );
    if (unknown.length || badSections.length || badKinds.length)
      throw new DomainError('validation-failed', 'Unknown fields, sections or document kinds', {
        status: 400,
        extra: { fields: [...new Set(unknown)], sections: badSections, kinds: badKinds },
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // approvers must exist in this school
      const routes = [
        dto.approval.default,
        ...Object.values(dto.approval.sections),
        ...Object.values(dto.approval.fields),
      ].flat();
      const roleIds = routes.flatMap((a) => (a.kind === 'role' ? [a.roleId] : []));
      const userIds = routes.flatMap((a) => (a.kind === 'user' ? [a.userId] : []));
      if (roleIds.length) {
        const r = await c.query<{ n: number }>(
          `SELECT count(DISTINCT id)::int AS n FROM roles WHERE id = ANY($1::bigint[]) AND (school_id IS NULL OR school_id = app.current_school_id())`,
          [roleIds],
        );
        if (r.rows[0]!.n !== new Set(roleIds).size)
          throw new DomainError('validation-failed', 'An approver role does not exist', {
            status: 400,
          });
      }
      if (userIds.length) {
        const r = await c.query<{ n: number }>(
          `SELECT count(DISTINCT user_id)::int AS n FROM employees WHERE user_id = ANY($1::bigint[]) AND deleted_at IS NULL`,
          [userIds],
        );
        if (r.rows[0]!.n !== new Set(userIds).size)
          throw new DomainError(
            'validation-failed',
            'An approver is not an employee of this school with a login',
            { status: 400 },
          );
      }
      const before = await loadPortalPolicy(c);
      const window = {
        mode: dto.window.mode,
        from: dto.window.from ?? null,
        to: dto.window.to ?? null,
        message: dto.window.message ?? null,
      };
      await c.query(
        `INSERT INTO profile_portal_policies (school_id, fields, proofs, edit_window, approval, updated_by)
         VALUES (app.current_school_id(), $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, app.current_user_id())
         ON CONFLICT (school_id) DO UPDATE SET fields = EXCLUDED.fields, proofs = EXCLUDED.proofs, edit_window = EXCLUDED.edit_window,
           approval = EXCLUDED.approval, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [
          JSON.stringify(dto.fields),
          JSON.stringify(dto.proofs),
          JSON.stringify(window),
          JSON.stringify(dto.approval),
        ],
      );
      const after = await loadPortalPolicy(c);
      await this.audit.stage(ctx, c, {
        action: 'people.portal_profile.save',
        entityType: 'profile_portal_policies',
        entityId: requireTenant(ctx).schoolId,
        before: summarise(before),
        after: summarise(after),
      });
      return after;
    });
  }

  // ---- the family's side ---------------------------------------------------------------------------
  /** The signed-in parent (or the student) may see this student; which portal they use. */
  private async familyOf(ctx: RequestContext, studentId: string): Promise<PortalAudience> {
    const v = await this.viewer.resolve(ctx, ENGAGEMENT.familyView);
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Student not found', { status: 404 });
    const r = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{ user_id: string | null }>(`SELECT user_id::text FROM students WHERE id = $1`, [
        studentId,
      ]),
    );
    return r.rows[0]?.user_id === ctx.user.id ? 'student' : 'parent';
  }

  async portalProfile(ctx: RequestContext, studentId: string) {
    const audience = await this.familyOf(ctx, studentId);
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const policy = await loadPortalPolicy(c);
      const lists = await loadProfileLists(c);
      const snap = await readStudentProfile(c, studentId, {
        academicYearId: tenant.academicYearId ?? null,
        showSensitive: true,
      });
      if (!snap) throw new DomainError('not-found', 'Student not found', { status: 404 });
      const levels = policy.fields[audience];
      const pending = await this.pendingFields(c, studentId);
      const win = windowState(policy.window);
      const sections = PROFILE_SECTIONS.map((s) => ({
        id: s.id,
        title: s.title,
        fields: PROFILE_FIELDS.filter((f) => f.section === s.id && levels[f.key] !== 'hidden').map(
          (f) => ({
            key: f.key,
            label: f.label,
            type: f.type,
            level: levels[f.key]!,
            value: snap.values[f.key] ?? null,
            options: f.list && EDIT_LEVELS.has(levels[f.key]!) ? optionsOf(f, lists) : null,
            help: f.help ?? null,
            required: Boolean(f.required),
            upper: Boolean(f.upper),
            when: f.when ?? null,
            proof: EDIT_LEVELS.has(levels[f.key]!) ? (policy.proofs[f.key] ?? null) : null,
            pending: pending.get(f.key) ?? null,
          }),
        ),
      })).filter((s) => s.fields.length > 0);
      const classTeacher = snap.enrolment
        ? await c.query<{ name: string }>(
            `SELECT emp.display_name AS name FROM teacher_assignments ta JOIN employees emp ON emp.id = ta.employee_id
              WHERE ta.class_section_id = $1 AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL LIMIT 1`,
            [snap.enrolment.classSectionId],
          )
        : { rows: [] as Array<{ name: string }> };
      return {
        studentId,
        audience,
        admissionNo: snap.admissionNo,
        name: snap.displayName,
        enrolment: snap.enrolment,
        classTeacher: classTeacher.rows[0]?.name ?? null,
        completeness: snap.completeness.percent,
        photos: {
          student: Boolean(snap.photos.student),
          father: Boolean(snap.photos.father),
          mother: Boolean(snap.photos.mother),
        },
        window: win,
        canEdit:
          win.open &&
          (sections.some((s) => s.fields.some((f) => EDIT_LEVELS.has(f.level))) ||
            PORTAL_PHOTOS.some((ph) => EDIT_LEVELS.has(levels[ph.key] ?? ''))),
        proofKinds: PROOF_KINDS.map((k) => ({ id: k, label: PROOF_LABEL[k] ?? k })),
        sections,
        photoFields: PORTAL_PHOTOS.filter((ph) => levels[ph.key] !== 'hidden').map((ph) => ({
          key: ph.key,
          party: ph.party,
          label: ph.label,
          level: levels[ph.key]!,
          pending: pending.has(ph.key)
            ? { requestId: pending.get(ph.key)!.requestId, since: pending.get(ph.key)!.since }
            : null,
        })),
        geography: await this.geography(c),
      };
    });
  }

  /** States with their country and cities with their state, so the portal form narrows the lists. */
  private async geography(c: PoolClient) {
    const r = await c.query<{ kind: string; name: string; parent: string | null }>(
      `SELECT 'state' AS kind, s.name, co.name AS parent FROM states s LEFT JOIN countries co ON co.id = s.country_id WHERE s.status = 'active'
       UNION ALL
       SELECT 'city', ci.name, st.name FROM cities ci LEFT JOIN states st ON st.id = ci.state_id WHERE ci.status = 'active'
       ORDER BY 1, 2`,
    );
    return {
      states: r.rows
        .filter((x) => x.kind === 'state')
        .map((x) => ({ name: x.name, country: x.parent })),
      cities: r.rows
        .filter((x) => x.kind === 'city')
        .map((x) => ({ name: x.name, state: x.parent })),
    };
  }

  /** Fields of this student waiting for approval: the value asked for and the request. */
  private async pendingFields(c: PoolClient, studentId: string) {
    const r = await c.query<{ id: string; changes: Record<string, ChangeItem>; created_at: Date }>(
      `SELECT id::text, changes, created_at FROM profile_change_requests
        WHERE student_id = $1 AND entity = 'profile' AND status = 'pending' ORDER BY created_at`,
      [studentId],
    );
    const out = new Map<string, { to: unknown; requestId: string; since: string }>();
    for (const row of r.rows)
      for (const [k, it] of Object.entries(row.changes))
        if ((it.status ?? 'pending') === 'pending')
          out.set(k, {
            to: plain(it, 'to'),
            requestId: row.id,
            since: row.created_at.toISOString(),
          });
    return out;
  }

  async submit(ctx: RequestContext, studentId: string, dto: SubmitPortalChangesDto) {
    const audience = await this.familyOf(ctx, studentId);
    return this.db.tenant(requireTenant(ctx), (c) =>
      this.submitIn(c, ctx, studentId, audience, dto),
    );
  }

  /** Validates, applies the "edit direct" fields and files one request per approval route. */
  async submitIn(
    c: PoolClient,
    ctx: RequestContext,
    studentId: string,
    audience: PortalAudience,
    dto: SubmitPortalChangesDto,
  ) {
    const policy = await loadPortalPolicy(c);
    const win = windowState(policy.window);
    if (!win.open)
      throw new DomainError(
        'engagement.profile.window_closed',
        win.message ?? 'Profile updates are closed',
        {
          status: 409,
        },
      );
    const levels = policy.fields[audience];
    const notAllowed = Object.keys(dto.changes).filter((k) => !EDIT_LEVELS.has(levels[k] ?? ''));
    if (notAllowed.length)
      throw new DomainError(
        'engagement.change.field_not_allowed',
        `These fields cannot be changed from the app: ${notAllowed.map(label).join(', ')}`,
        { status: 422, extra: { fields: notAllowed } },
      );
    const lists = await loadProfileLists(c);
    const photoKeys = Object.keys(dto.changes).filter((k) => PORTAL_PHOTO_BY_KEY.has(k));
    const fieldChanges = Object.fromEntries(
      Object.entries(dto.changes).filter(([k]) => !PORTAL_PHOTO_BY_KEY.has(k)),
    );
    const { values, errors } = Object.keys(fieldChanges).length
      ? validateChanges(fieldChanges, lists)
      : {
          values: {} as Record<string, string | number | null>,
          errors: {} as Record<string, string>,
        };
    for (const k of photoKeys) {
      const problem = await this.checkPhoto(c, dto.changes[k]!);
      if (problem) errors[k] = problem;
      else values[k] = dto.changes[k]!;
    }
    if (Object.keys(errors).length)
      throw new DomainError('validation-failed', 'Some fields are not valid', {
        status: 400,
        extra: { errors },
      });
    const current = await readStudentProfile(c, studentId, { showSensitive: true });
    if (!current) throw new DomainError('not-found', 'Student not found', { status: 404 });
    const onFile = (k: string): unknown => {
      const ph = PORTAL_PHOTO_BY_KEY.get(k);
      return ph ? (current.photos[ph.party] ?? null) : (current.values[k] ?? null);
    };
    const changed = Object.keys(values).filter((k) => onFile(k) !== (values[k] ?? null));
    if (!changed.length)
      throw new DomainError('validation-failed', 'Nothing to change: the values are the same', {
        status: 400,
      });
    const pending = await this.pendingFields(c, studentId);
    const busy = changed.filter((k) => pending.has(k));
    if (busy.length)
      throw new DomainError(
        'engagement.change.pending',
        `Already waiting for approval: ${busy.map(label).join(', ')}. Cancel that request to send a new value.`,
        { status: 409, extra: { fields: busy } },
      );

    // proofs: each kind a changed field needs must be attached, uploaded by this user
    const proofs = await this.checkProofs(c, dto.proofs);
    const needed = new Map<string, string[]>();
    for (const k of changed) {
      const kind = policy.proofs[k];
      if (kind) needed.set(kind, [...(needed.get(kind) ?? []), k]);
    }
    const missing = [...needed.entries()].filter(([kind]) => !proofs.some((p) => p.kind === kind));
    if (missing.length)
      throw new DomainError(
        'engagement.profile.proof_required',
        missing
          .map(
            ([kind, keys]) =>
              `Attach the ${PROOF_LABEL[kind] ?? kind} for ${keys.map(label).join(', ')}`,
          )
          .join('. '),
        {
          status: 400,
          extra: {
            errors: Object.fromEntries(
              missing.flatMap(([kind, keys]) =>
                keys.map((k) => [k, `Attach the ${PROOF_LABEL[kind] ?? kind}`]),
              ),
            ),
          },
        },
      );

    const submission = randomUUID();
    const direct = changed.filter((k) => levels[k] === 'edit_direct');
    const routed = changed.filter((k) => levels[k] === 'edit_approval');
    const proofsFor = (keys: string[]) => {
      const kinds = new Set(keys.map((k) => policy.proofs[k]).filter(Boolean));
      return proofs.filter((p) => kinds.has(p.kind));
    };
    const item = (k: string, status: ChangeItem['status']): ChangeItem => {
      const f = PROFILE_FIELD_BY_KEY.get(k);
      const from = onFile(k);
      const to = values[k] ?? null;
      return f?.sensitive
        ? {
            from: from === null ? null : encryptField(String(from)),
            to: to === null ? null : encryptField(String(to)),
            enc: true,
            status,
          }
        : { from, to, status };
    };
    const insert = async (
      keys: string[],
      route: ApprovalRoute,
      status: 'pending' | 'approved',
      attach: typeof proofs,
    ) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO profile_change_requests (school_id, student_id, requested_by_user_id, entity, entity_id, changes, reason, audience, route, proofs, submission, auto_applied, status, decided_at)
         VALUES (app.current_school_id(), $1, app.current_user_id(), 'profile', $1, $2::jsonb, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9::change_request_status, CASE WHEN $8 THEN now() END)
         RETURNING id::text`,
        [
          studentId,
          JSON.stringify(Object.fromEntries(keys.map((k) => [k, item(k, status)]))),
          dto.reason ?? null,
          audience,
          JSON.stringify(route),
          JSON.stringify(attach),
          submission,
          status === 'approved',
          status,
        ],
      );
      return r.rows[0]!.id;
    };

    const result: { applied: string[]; requests: string[]; pending: string[] } = {
      applied: [],
      requests: [],
      pending: routed,
    };
    if (direct.length) {
      await this.apply(c, studentId, Object.fromEntries(direct.map((k) => [k, values[k] ?? null])));
      const id = await insert(direct, [], 'approved', proofsFor(direct));
      await this.attachProofs(c, studentId, proofsFor(direct));
      await c.query(
        `INSERT INTO profile_change_actions (school_id, request_id, level, decision, fields, actor_id) VALUES (app.current_school_id(), $1, 1, 'auto', $2::jsonb, app.current_user_id())`,
        [id, JSON.stringify(Object.fromEntries(direct.map((k) => [k, 'approved'])))],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.profile.update_direct',
        entityType: 'students',
        entityId: studentId,
        before: maskSensitive(Object.fromEntries(direct.map((k) => [k, onFile(k)]))),
        after: maskSensitive(Object.fromEntries(direct.map((k) => [k, values[k] ?? null]))),
      });
      result.applied = direct;
      result.requests.push(id);
    }
    // one request per approval route, so each approver sees only what is theirs
    const groups = new Map<string, { route: ApprovalRoute; keys: string[] }>();
    for (const k of routed) {
      const route = routeFor(policy, k);
      const sig = routeSignature(route);
      const g = groups.get(sig) ?? { route, keys: [] };
      g.keys.push(k);
      groups.set(sig, g);
    }
    let first = true;
    for (const g of groups.values()) {
      // proofs nobody asked for travel with the first request so the office still sees them
      const attach = first
        ? [...proofsFor(g.keys), ...proofs.filter((p) => !needed.has(p.kind))]
        : proofsFor(g.keys);
      first = false;
      const id = await insert(g.keys, g.route, 'pending', attach);
      await this.audit.stage(ctx, c, {
        action: 'engagement.change_request.create',
        entityType: 'profile_change_requests',
        entityId: id,
        after: { entity: 'profile', fields: g.keys, route: routeSignature(g.route) },
      });
      result.requests.push(id);
    }
    return result;
  }

  private async checkProofs(c: PoolClient, given: SubmitPortalChangesDto['proofs']) {
    const out: Array<{ kind: string; fileId: string; fileName: string | null }> = [];
    for (const p of given) {
      if (!PROOF_KINDS.includes(p.kind as (typeof PROOF_KINDS)[number]))
        throw new DomainError('validation-failed', `Unknown document kind ${p.kind}`, {
          status: 400,
        });
      const f = await c.query<{ status: string; mine: boolean; original_name: string | null }>(
        `SELECT status::text, created_by = app.current_user_id() AS mine, original_name FROM files WHERE id = $1`,
        [p.fileId],
      );
      const row = f.rows[0];
      if (!row || !row.mine)
        throw new DomainError('not-found', 'Attached file not found', { status: 404 });
      if (row.status !== 'ready')
        throw new DomainError('file.not_ready', 'Upload the file before attaching it', {
          status: 409,
        });
      out.push({ kind: p.kind, fileId: p.fileId, fileName: row.original_name });
    }
    return out;
  }

  /** A photo a family sends must be its own upload, finished, an image and not too large. */
  private async checkPhoto(c: PoolClient, fileId: string): Promise<string | null> {
    if (!/^\d{1,18}$/.test(fileId)) return 'Upload the photo again';
    const f = await c.query<{
      status: string;
      mine: boolean;
      content_type: string;
      size_bytes: string;
    }>(
      `SELECT status::text, created_by = app.current_user_id() AS mine, content_type, size_bytes::text FROM files WHERE id = $1`,
      [fileId],
    );
    const row = f.rows[0];
    if (!row || !row.mine) return 'Upload the photo again';
    if (row.status !== 'ready') return 'The photo has not finished uploading';
    if (!PHOTO_TYPES.test(row.content_type)) return 'Send a JPG, PNG or WebP photo';
    if (Number(row.size_bytes) > PHOTO_MAX_BYTES) return 'The photo must be 5 MB or smaller';
    return null;
  }

  /** The family's requests for a student: what was asked, where it is, and each field's outcome. */
  async myRequests(ctx: RequestContext, studentId: string) {
    await this.familyOf(ctx, studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<RequestDb>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT_REQUEST is a constant; values are bound parameters
        `${SELECT_REQUEST} WHERE r.student_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
        [studentId],
      );
      const actions = await this.actionsOf(
        c,
        r.rows.map((x) => x.id),
      );
      return {
        data: r.rows.map((x) => ({
          ...toView(x, true),
          mine: x.requested_by_user_id === ctx.user.id,
          history: actions.get(x.id) ?? [],
        })),
      };
    });
  }

  async cancel(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const row = await this.find(c, id, true);
      if (row.requested_by_user_id !== ctx.user.id)
        throw new DomainError('not-found', 'Change request not found', { status: 404 });
      if (row.status !== 'pending')
        throw new DomainError('engagement.change.decided', 'This request was already decided', {
          status: 409,
        });
      await c.query(
        `UPDATE profile_change_requests SET status = 'cancelled', decided_at = now() WHERE id = $1`,
        [id],
      );
      await c.query(
        `INSERT INTO profile_change_actions (school_id, request_id, level, decision, actor_id) VALUES (app.current_school_id(), $1, $2, 'cancelled', app.current_user_id())`,
        [id, row.current_level],
      );
      await this.audit.stage(ctx, c, {
        action: 'engagement.change_request.cancel',
        entityType: 'profile_change_requests',
        entityId: id,
      });
      return toView(await this.find(c, id), true);
    });
  }

  /** A signed link to the student's or a parent's photo, for the portal's own pages. */
  async photo(ctx: RequestContext, studentId: string, party: string) {
    if (!['student', 'father', 'mother'].includes(party))
      throw new DomainError('not-found', 'Photo not found', { status: 404 });
    await this.familyOf(ctx, studentId);
    const snap = await this.db.tenant(requireTenant(ctx), (c) =>
      readStudentProfile(c, studentId, { showSensitive: false }),
    );
    const id = snap?.photos[party as 'student' | 'father' | 'mother'];
    if (!id) throw new DomainError('not-found', 'Photo not found', { status: 404 });
    return this.files.downloadUrl(ctx, id);
  }

  async requestPrint(ctx: RequestContext, studentId: string) {
    const audience = await this.familyOf(ctx, studentId);
    const snap = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query<{ admission_no: string }>(`SELECT admission_no FROM students WHERE id = $1`, [
        studentId,
      ]),
    );
    return this.reports.createRenderedForOwner(
      ctx,
      {
        dataset: 'student_profile',
        format: 'pdf',
        // the worker checks the family link again and prints only what this portal shows
        params: { studentId, audience },
        title: `Student profile ${snap.rows[0]?.admission_no ?? ''}`.trim(),
      },
      'engagement.profile.print',
    );
  }

  async exportStatus(ctx: RequestContext, exportId: string) {
    const own = await this.db.tenant(requireTenant(ctx), (c) =>
      c.query(`SELECT 1 FROM exports WHERE id = $1 AND requested_by = app.current_user_id()`, [
        exportId,
      ]),
    );
    if (!own.rowCount) throw new DomainError('not-found', 'Export not found', { status: 404 });
    return this.reports.status(ctx, exportId);
  }

  // ---- approvals -----------------------------------------------------------------------------------
  private async actor(c: PoolClient, ctx: RequestContext): Promise<Actor> {
    const roles = await c.query<{ role_id: string }>(
      `SELECT role_id::text FROM user_roles WHERE user_id = app.current_user_id() AND revoked_at IS NULL
          AND valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)`,
    );
    const sections = await c.query<{ id: string }>(
      `SELECT ta.class_section_id::text AS id FROM teacher_assignments ta JOIN employees e ON e.id = ta.employee_id
        WHERE e.user_id = app.current_user_id() AND ta.kind = 'class_teacher' AND ta.valid_to IS NULL`,
    );
    const p = ctx.permissions;
    return {
      userId: ctx.user.id,
      roleIds: new Set(roles.rows.map((x) => x.role_id)),
      sections: new Set(sections.rows.map((x) => x.id)),
      office: p?.has(ENGAGEMENT.changeDecide) ?? false,
      override: p?.has(PORTAL.override) ?? false,
      sensitive: p?.has('people.sensitive.view') ?? false,
    };
  }

  private matches(a: Approver | undefined, actor: Actor, row: RequestDb): boolean {
    if (!a) return false;
    if (a.kind === 'office') return actor.office;
    if (a.kind === 'class_teacher')
      return row.class_section_id !== null && actor.sections.has(row.class_section_id);
    if (a.kind === 'role') return actor.roleIds.has(a.roleId);
    return a.userId === actor.userId;
  }

  private canAct(actor: Actor, row: RequestDb): boolean {
    if (row.status !== 'pending') return false;
    if (actor.override) return true;
    const route = row.route.length ? row.route : [{ kind: 'office' as const }];
    return this.matches(route[row.current_level - 1], actor, row);
  }

  async inbox(ctx: RequestContext, q: InboxQueryDto) {
    const p = ctx.permissions;
    if (q.box !== 'mine' && !(p?.has(ENGAGEMENT.changeView) || p?.has(PORTAL.override)))
      throw new DomainError('forbidden', 'You may only see the requests routed to you', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const actor = await this.actor(c, ctx);
      const params: unknown[] = [];
      const where: string[] = [];
      where.push(
        q.box === 'decided'
          ? `r.status NOT IN ('pending') AND r.auto_applied = false`
          : `r.status = 'pending'`,
      );
      if (q.classSection) {
        params.push(q.classSection.toUpperCase());
        where.push(`upper(k.code || '-' || cs.name) = $${params.length}`);
      }
      if (q.q) {
        params.push(`%${q.q.toLowerCase()}%`);
        where.push(
          `(lower(s.display_name) LIKE $${params.length} OR lower(s.admission_no) LIKE $${params.length} OR lower(u.display_name) LIKE $${params.length})`,
        );
      }
      if (q.from) {
        params.push(q.from);
        where.push(`r.created_at >= $${params.length}::date`);
      }
      if (q.to) {
        params.push(q.to);
        where.push(`r.created_at < $${params.length}::date + 1`);
      }
      const r = await c.query<RequestDb>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT_REQUEST is a constant; where holds fixed fragments; values are bound parameters
        `${SELECT_REQUEST} WHERE ${where.join(' AND ')} ORDER BY ${q.box === 'decided' ? 'r.decided_at DESC NULLS LAST' : 'r.created_at'} LIMIT 2000`,
        params,
      );
      let rows = r.rows;
      if (q.section)
        rows = rows.filter((x) => Object.keys(x.changes).some((k) => sectionOf(k) === q.section));
      if (q.box === 'mine') rows = rows.filter((x) => this.canAct(actor, x));
      const total = rows.length;
      const page = rows.slice((q.page - 1) * q.size, q.page * q.size);
      const actions = await this.actionsOf(
        c,
        page.map((x) => x.id),
      );
      const awaitingMe =
        q.box === 'mine'
          ? total
          : (
              await c.query<RequestDb>(
                // eslint-disable-next-line no-restricted-syntax -- SELECT_REQUEST is a constant
                `${SELECT_REQUEST} WHERE r.status = 'pending' LIMIT 2000`,
              )
            ).rows.filter((x) => this.canAct(actor, x)).length;
      return {
        data: page.map((x) => ({
          ...toView(x, actor.sensitive),
          canAct: this.canAct(actor, x),
          history: actions.get(x.id) ?? [],
        })),
        page: { number: q.page, size: q.size, total },
        awaitingMe,
        canOverride: actor.override,
        canSeeAll: Boolean(p?.has(ENGAGEMENT.changeView) || p?.has(PORTAL.override)),
      };
    });
  }

  async decide(ctx: RequestContext, id: string, dto: DecideItemsDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const actor = await this.actor(c, ctx);
      const row = await this.decideIn(c, ctx, actor, id, dto);
      return { ...toView(row, actor.sensitive), canAct: this.canAct(actor, row) };
    });
  }

  /** A proof attached to a request, for whoever may decide or review it. */
  async proofUrl(ctx: RequestContext, id: string, fileId: string) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const actor = await this.actor(c, ctx);
      const r = await this.find(c, id);
      const reviewer =
        ctx.permissions?.has(ENGAGEMENT.changeView) || actor.override || this.canAct(actor, r);
      const photoFiles = Object.entries(r.changes)
        .filter(([k]) => PORTAL_PHOTO_BY_KEY.has(k))
        .flatMap(([, it]) => [it.from, it.to].map((v) => (v === null ? null : String(v))));
      if (!reviewer || !(r.proofs.some((p) => p.fileId === fileId) || photoFiles.includes(fileId)))
        throw new DomainError('not-found', 'Document not found', { status: 404 });
    });
    return this.files.downloadUrl(ctx, fileId);
  }

  /** Many requests the same way; each one stands alone, so one stale request never blocks the rest. */
  async bulkDecide(ctx: RequestContext, dto: BulkDecideDto) {
    const results: Array<{ id: string; ok: boolean; status?: string; error?: string }> = [];
    for (const id of [...new Set(dto.ids)]) {
      try {
        const row = await this.db.tenant(requireTenant(ctx), async (c) => {
          const actor = await this.actor(c, ctx);
          return this.decideIn(c, ctx, actor, id, { approve: dto.approve, note: dto.note });
        });
        results.push({ id, ok: true, status: row.status });
      } catch (error) {
        if (!(error instanceof DomainError)) throw error;
        results.push({ id, ok: false, error: error.message });
      }
    }
    return {
      done: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
      results,
    };
  }

  private async decideIn(
    c: PoolClient,
    ctx: RequestContext,
    actor: Actor,
    id: string,
    dto: DecideItemsDto,
  ): Promise<RequestDb> {
    const row = await this.find(c, id, true);
    if (row.status !== 'pending')
      throw new DomainError('engagement.change.decided', 'This request was already decided', {
        status: 409,
      });
    if (!this.canAct(actor, row))
      throw new DomainError(
        'engagement.change.not_assigned',
        'This request is waiting for another approver',
        { status: 403 },
      );
    const route = row.route.length ? row.route : [{ kind: 'office' as const }];
    const pendingKeys = Object.keys(row.changes).filter(
      (k) => (row.changes[k]!.status ?? 'pending') === 'pending',
    );
    const decision = new Map<string, boolean>();
    for (const k of pendingKeys) {
      const d = dto.fields?.[k] ?? dto.approve;
      if (d === undefined)
        throw new DomainError('validation-failed', `Decide ${label(k)} as well`, {
          status: 400,
        });
      decision.set(k, d);
    }
    // the decision is final at the last level, or when an administrator overrides the route
    const ownTurn = this.matches(route[row.current_level - 1], actor, row);
    const final = row.current_level >= route.length || actor.override;
    const accepted = pendingKeys.filter((k) => decision.get(k));
    const refused = pendingKeys.filter((k) => !decision.get(k));
    const changes = { ...row.changes };
    for (const k of refused)
      changes[k] = { ...changes[k]!, status: 'rejected', note: dto.note ?? null };
    if (accepted.length && final) {
      if (row.entity === 'profile') {
        await this.assertFresh(c, row, accepted);
        await this.apply(
          c,
          row.entity_id,
          Object.fromEntries(accepted.map((k) => [k, plain(changes[k]!, 'to') as string | null])),
        );
        await this.attachProofs(c, row.student_id, row.proofs);
      } else await this.applyLegacy(c, row.entity, row.entity_id, changes, accepted);
      for (const k of accepted) changes[k] = { ...changes[k]!, status: 'approved' };
    }
    const stillPending = accepted.length && !final;
    const statuses = Object.values(changes).map((x) => x.status ?? 'pending');
    const status = stillPending
      ? 'pending'
      : statuses.every((s) => s === 'approved')
        ? 'approved'
        : statuses.every((s) => s === 'rejected')
          ? 'rejected'
          : 'partially_approved';
    await c.query(
      `UPDATE profile_change_requests SET changes = $2::jsonb, status = $3::change_request_status, current_level = $4,
              decided_by = CASE WHEN $3 = 'pending' THEN decided_by ELSE app.current_user_id() END,
              decided_at = CASE WHEN $3 = 'pending' THEN decided_at ELSE now() END,
              decision_note = CASE WHEN $3 = 'pending' THEN decision_note ELSE $5 END
        WHERE id = $1`,
      [
        id,
        JSON.stringify(changes),
        status,
        stillPending ? Math.min(row.current_level + 1, 2) : row.current_level,
        dto.note ?? null,
      ],
    );
    await c.query(
      `INSERT INTO profile_change_actions (school_id, request_id, level, decision, fields, note, actor_id)
       VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, app.current_user_id())`,
      [
        id,
        row.current_level,
        actor.override && !ownTurn
          ? 'override'
          : !accepted.length
            ? 'rejected'
            : refused.length
              ? 'partial'
              : 'approved',
        JSON.stringify(
          Object.fromEntries(
            pendingKeys.map((k) => [k, decision.get(k) ? 'approved' : 'rejected']),
          ),
        ),
        dto.note ?? null,
      ],
    );
    await this.audit.stage(ctx, c, {
      action: !accepted.length
        ? 'engagement.change_request.reject'
        : refused.length
          ? 'engagement.change_request.partial'
          : 'engagement.change_request.approve',
      entityType:
        row.entity === 'guardian'
          ? 'guardians'
          : row.entity === 'profile'
            ? 'students'
            : 'students',
      entityId: row.entity_id,
      before: maskSensitive(
        Object.fromEntries(pendingKeys.map((k) => [k, plain(row.changes[k]!, 'from')])),
      ),
      after: {
        level: row.current_level,
        final,
        status,
        accepted: maskSensitive(
          Object.fromEntries(accepted.map((k) => [k, plain(row.changes[k]!, 'to')])),
        ),
        refused,
        note: dto.note ?? null,
      },
    });
    return this.find(c, id);
  }

  /** The value on file must still be the one the family saw; otherwise the office decides afresh. */
  private async assertFresh(c: PoolClient, row: RequestDb, keys: string[]) {
    const now = await readStudentProfile(c, row.entity_id, { showSensitive: true });
    if (!now) throw new DomainError('not-found', 'Student not found', { status: 404 });
    const stale = keys.filter((k) => {
      const ph = PORTAL_PHOTO_BY_KEY.get(k);
      const cur = ph ? (now.photos[ph.party] ?? null) : (now.values[k] ?? null);
      const from = plain(row.changes[k]!, 'from');
      const to = plain(row.changes[k]!, 'to');
      return String(cur ?? '') !== String(from ?? '') && String(cur ?? '') !== String(to ?? '');
    });
    if (stale.length)
      throw new DomainError(
        'engagement.change.stale',
        `Changed in the office since the request: ${stale.map(label).join(', ')}. Check the student and decide again.`,
        { status: 409, extra: { fields: stale } },
      );
  }

  /** Writes accepted values: profile fields through the profile writer, photos onto the records. */
  private async apply(c: PoolClient, studentId: string, values: Record<string, unknown>) {
    const fields = Object.fromEntries(
      Object.entries(values).filter(([k]) => !PORTAL_PHOTO_BY_KEY.has(k)),
    );
    if (Object.keys(fields).length) await this.write(c, studentId, fields);
    for (const [k, v] of Object.entries(values)) {
      const ph = PORTAL_PHOTO_BY_KEY.get(k);
      if (ph && typeof v === 'string') await this.applyPhoto(c, studentId, ph.party, v);
    }
  }

  /** The new photo replaces the student's or the parent's, and joins their documents. */
  private async applyPhoto(
    c: PoolClient,
    studentId: string,
    party: 'student' | 'father' | 'mother',
    fileId: string,
  ) {
    if (party === 'student') {
      await c.query(
        'UPDATE students SET photo_file_id = $2, updated_by = app.current_user_id(), updated_at = now() WHERE id = $1',
        [studentId, fileId],
      );
      await c.query(
        `INSERT INTO person_documents (school_id, person_type, person_id, kind, file_id, title, created_by)
         VALUES (app.current_school_id(), 'student', $1, 'photo', $2, 'Sent from the parent app', app.current_user_id())`,
        [studentId, fileId],
      );
      await c.query(
        `UPDATE students SET profile = profile || jsonb_build_object('student_photo_submitted', 'Yes') WHERE id = $1`,
        [studentId],
      );
      await refreshCompleteness(c, studentId);
      return;
    }
    const g = await c.query<{ id: string }>(
      `SELECT g.id::text FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id AND g.deleted_at IS NULL
        WHERE sg.student_id = $1 AND sg.relation::text = $2 ORDER BY sg.is_primary DESC, sg.id LIMIT 1`,
      [studentId, party],
    );
    const gid = g.rows[0]?.id;
    if (!gid)
      throw new DomainError(
        'validation-failed',
        `Add the ${party}'s name in the profile before the photo`,
        { status: 400 },
      );
    await c.query(
      'UPDATE guardians SET photo_file_id = $2, updated_by = app.current_user_id(), updated_at = now() WHERE id = $1',
      [gid, fileId],
    );
    await c.query(
      `INSERT INTO person_documents (school_id, person_type, person_id, kind, file_id, title, created_by)
       VALUES (app.current_school_id(), 'guardian', $1, 'photo', $2, 'Sent from the parent app', app.current_user_id())`,
      [gid, fileId],
    );
  }

  private async write(c: PoolClient, studentId: string, values: Record<string, unknown>) {
    try {
      await writeStudentProfile(c, studentId, values as Record<string, string | number | null>);
    } catch (error) {
      if (error instanceof ProfileWriteError)
        throw new DomainError('validation-failed', error.message, {
          status: 400,
          extra: { errors: error.errors },
        });
      throw error;
    }
    await refreshCompleteness(c, studentId);
  }

  /** Approved proofs join the student's documents (and tick the checklist item they stand for). */
  private async attachProofs(
    c: PoolClient,
    studentId: string,
    proofs: Array<{ kind: string; fileId: string; fileName?: string | null }>,
  ) {
    for (const p of proofs) {
      const exists = await c.query(
        `SELECT 1 FROM person_documents WHERE person_type = 'student' AND person_id = $1 AND file_id = $2 AND deleted_at IS NULL`,
        [studentId, p.fileId],
      );
      if (exists.rowCount) continue;
      await c.query(
        `INSERT INTO person_documents (school_id, person_type, person_id, kind, file_id, title, created_by)
         VALUES (app.current_school_id(), 'student', $1, $2::document_kind, $3, 'Sent with a profile change', app.current_user_id())`,
        [studentId, p.kind, p.fileId],
      );
      const key = CHECKLIST_BY_KIND[p.kind];
      if (key)
        await c.query(
          `UPDATE students SET profile = profile || jsonb_build_object($2::text, 'Yes') WHERE id = $1`,
          [studentId, key],
        );
    }
    if (proofs.length) await refreshCompleteness(c, studentId);
  }

  /** Requests made before the student 360 profile (entity student / guardian, fixed allow-list). */
  private async applyLegacy(
    c: PoolClient,
    entity: 'student' | 'guardian' | 'profile',
    id: string,
    changes: Record<string, ChangeItem>,
    keys: string[],
  ) {
    const table = entity === 'guardian' ? 'guardians' : 'students';
    const allowed: Record<string, string[]> = {
      students: [
        'blood_group',
        'house',
        'address.line1',
        'address.line2',
        'address.city',
        'address.pin',
        'details.emergency_contact',
      ],
      guardians: [
        'mobile',
        'email',
        'occupation',
        'address.line1',
        'address.line2',
        'address.city',
        'address.pin',
      ],
    };
    for (const field of keys) {
      if (!allowed[table]!.includes(field)) continue;
      const to = changes[field]!.to as string;
      const [col, key] = field.split('.') as [string, string | undefined];
      if (key)
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- table and column come from the allow-list above; values are bound parameters
          `UPDATE ${table} SET ${col} = jsonb_set(COALESCE(${col}, '{}'::jsonb), ARRAY[$2::text], to_jsonb($3::text), true), updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          [id, key, to],
        );
      else
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- table and column come from the allow-list above; values are bound parameters
          `UPDATE ${table} SET ${col} = $2, updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
          [id, to],
        );
    }
  }

  private async find(c: PoolClient, id: string, lock = false): Promise<RequestDb> {
    const r = await c.query<RequestDb>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT_REQUEST is a constant; the id is a bound parameter
      `${SELECT_REQUEST} WHERE r.id = $1${lock ? ' FOR UPDATE OF r' : ''}`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Change request not found', { status: 404 });
    return r.rows[0];
  }

  private async actionsOf(c: PoolClient, ids: string[]) {
    const out = new Map<
      string,
      Array<{
        level: number;
        decision: string;
        fields: Record<string, string>;
        note: string | null;
        actor: string | null;
        at: string;
      }>
    >();
    if (!ids.length) return out;
    const r = await c.query<{
      request_id: string;
      level: number;
      decision: string;
      fields: Record<string, string>;
      note: string | null;
      actor: string | null;
      created_at: Date;
    }>(
      `SELECT a.request_id::text, a.level, a.decision, a.fields, a.note, COALESCE(emp.display_name, u.display_name) AS actor, a.created_at
         FROM profile_change_actions a LEFT JOIN users u ON u.id = a.actor_id
         LEFT JOIN LATERAL (SELECT display_name FROM employees WHERE user_id = a.actor_id AND deleted_at IS NULL LIMIT 1) emp ON true
        WHERE a.request_id = ANY($1::bigint[]) ORDER BY a.created_at`,
      [ids],
    );
    for (const x of r.rows) {
      const list = out.get(x.request_id) ?? [];
      list.push({
        level: x.level,
        decision: x.decision,
        fields: x.fields,
        note: x.note,
        actor: x.actor,
        at: x.created_at.toISOString(),
      });
      out.set(x.request_id, list);
    }
    return out;
  }
}

/** The stored value, decrypted when it was kept encrypted. */
function plain(it: ChangeItem, side: 'from' | 'to'): unknown {
  const v = it[side];
  if (!it.enc || v === null || v === undefined) return v ?? null;
  return decryptField(String(v));
}

function maskSensitive(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => {
      const f = PROFILE_FIELD_BY_KEY.get(k);
      return [k, f?.sensitive && v ? maskValue(String(v), f.type) : v];
    }),
  );
}

/** A request as screens show it; sensitive numbers masked unless the viewer may see them. */
function toView(x: RequestDb, showSensitive: boolean) {
  const route = x.route.length ? x.route : x.auto_applied ? [] : [{ kind: 'office' as const }];
  const show = (k: string, it: ChangeItem, side: 'from' | 'to') => {
    const v = plain(it, side);
    const f = PROFILE_FIELD_BY_KEY.get(k);
    if (v === null || v === undefined) return null;
    return f?.sensitive && !showSensitive ? maskValue(String(v), f.type) : v;
  };
  return {
    id: x.id,
    studentId: x.student_id,
    studentName: x.student_name,
    admissionNo: x.admission_no,
    classSection: x.class_section,
    requestedBy: x.requested_by,
    audience: x.audience,
    entity: x.entity,
    reason: x.reason,
    status: x.status,
    autoApplied: x.auto_applied,
    level: x.current_level,
    levels: route.length,
    route: route.map((a) => ({ kind: a.kind, label: approverLabel(a) })),
    waitingFor:
      x.status === 'pending'
        ? approverLabel(route[x.current_level - 1] ?? { kind: 'office' })
        : null,
    items: Object.entries(x.changes).map(([k, it]) => ({
      key: k,
      label: label(k),
      section: sectionOf(k),
      photo: PORTAL_PHOTO_BY_KEY.has(k),
      from: show(k, it, 'from'),
      to: show(k, it, 'to'),
      status:
        it.status ??
        (x.status === 'pending' ? 'pending' : x.status === 'approved' ? 'approved' : 'rejected'),
      note: it.note ?? null,
    })),
    proofs: x.proofs.map((p) => ({
      kind: p.kind,
      label: PROOF_LABEL[p.kind] ?? p.kind,
      fileId: p.fileId,
      fileName: p.fileName ?? null,
    })),
    decidedBy: x.decided_by,
    decidedAt: x.decided_at?.toISOString() ?? null,
    decisionNote: x.decision_note,
    createdAt: x.created_at.toISOString(),
  };
}

function summarise(p: PortalPolicy) {
  const count = (a: 'parent' | 'student') =>
    Object.values(p.fields[a]).reduce<Record<string, number>>((acc, l) => {
      acc[l] = (acc[l] ?? 0) + 1;
      return acc;
    }, {});
  return {
    parent: count('parent'),
    student: count('student'),
    proofs: Object.keys(p.proofs).length,
    window: p.window,
    routes: {
      default: routeSignature(p.approval.default),
      sections: Object.fromEntries(
        Object.entries(p.approval.sections).map(([k, r]) => [k, routeSignature(r)]),
      ),
      fields: Object.keys(p.approval.fields).length,
    },
  };
}
