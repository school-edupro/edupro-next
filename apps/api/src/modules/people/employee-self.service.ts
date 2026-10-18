import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  EMPLOYEE_FIELDS,
  EMPLOYEE_SECTIONS,
  decryptField,
  employeeApproverLabel,
  employeeCompleteness,
  employeeEditable,
  employeeRouteFor,
  employeeRouteSignature,
  employeeWindowState,
  encryptField,
  loadEmployeeLists,
  loadEmployeePolicy,
  maskValue,
  readEmployeeProfile,
  refreshEmployeeCompleteness,
  validateEmployeeChanges,
  writeEmployeeProfile,
  type EmployeeApprover,
  type EmployeeRoute,
  type ProfileValues,
} from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { FilesService } from '../files/files.service';
import { ReportsService } from '../reports/reports.service';
import type {
  EmployeeChangesDto,
  EmployeePolicyDto,
  StaffBulkDto,
  StaffDecideDto,
  StaffInboxDto,
} from './employee-self.dto';
import { PEOPLE } from './people.permissions';

type Value = ProfileValues[string];
interface ChangeItem {
  from: Value;
  to: Value;
  status?: 'pending' | 'approved' | 'rejected';
  note?: string | null;
  enc?: true;
}
interface RequestRow {
  id: string;
  employee_id: string;
  changes: Record<string, ChangeItem>;
  reason: string | null;
  status: string;
  route: EmployeeRoute;
  current_level: number;
  proofs: Array<{ typeId: string; fileId: string; fileName: string | null }>;
  auto_applied: boolean;
  decided_at: Date | null;
  decision_note: string | null;
  created_at: Date;
  name: string;
  code: string;
  department: string | null;
  designation: string | null;
  profile: Record<string, unknown>;
}
const SELECT = `SELECT r.id::text, r.employee_id::text, r.changes, r.reason, r.status::text, r.route, r.current_level,
       r.proofs, r.auto_applied, r.decided_at, r.decision_note, r.created_at,
       e.display_name AS name, e.employee_code AS code, e.department, e.designation, e.profile
  FROM employee_change_requests r JOIN employees e ON e.id = r.employee_id`;
const FIELD = new Map(EMPLOYEE_FIELDS.map((f) => [f.key, f]));
const same = (a: Value, b: Value) => (a ?? '') === (b ?? '') || String(a ?? '') === String(b ?? '');

interface Actor {
  employeeId: string | null;
  roles: Set<string>;
  office: boolean;
  override: boolean;
  sensitive: boolean;
}

/**
 * Staff see and update their own profile from the staff app, as families do for students (0041 → 0186,
 * docs/design/33-people-dashboards.md): the school's policy says per field hidden / view / change with
 * approval / change at once, the proof a change needs, the window, and up to two approvers; the approvers
 * decide field by field; the employee downloads their profile as PDF.
 */
@Injectable()
export class EmployeeSelfService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly files: FilesService,
  ) {}

  private async myEmployee(c: PoolClient): Promise<string> {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
    );
    if (!r.rows[0])
      throw new DomainError('people.not_staff', 'Only staff have an employee profile', {
        status: 404,
      });
    return r.rows[0].id;
  }

  // ---- the employee ------------------------------------------------------------------------------

  async mine(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const id = await this.myEmployee(c);
      const [policy, p, lists, docTypes, meta, pending] = await Promise.all([
        loadEmployeePolicy(c),
        readEmployeeProfile(c, id, true),
        loadEmployeeLists(c),
        c.query<{ id: string; name: string }>(
          `SELECT id::text, name FROM employee_document_types WHERE status = 'active' ORDER BY sort_order, name`,
        ),
        c.query<{ name: string; code: string; photo: string | null; status: string }>(
          `SELECT display_name AS name, employee_code AS code, photo_file_id::text AS photo, status::text
             FROM employees WHERE id = $1`,
          [id],
        ),
        c.query<{ changes: Record<string, ChangeItem> }>(
          `SELECT changes FROM employee_change_requests WHERE employee_id = $1 AND status = 'pending'`,
          [id],
        ),
      ]);
      const values = p!.values;
      const typeName = new Map(docTypes.rows.map((t) => [t.id, t.name]));
      const waiting: Record<string, Value> = {};
      for (const r of pending.rows)
        for (const [k, v] of Object.entries(r.changes))
          if (!v.status || v.status === 'pending')
            waiting[k] = v.enc && typeof v.to === 'string' ? decryptField(v.to) : v.to;
      const win = employeeWindowState(policy.window);
      const sections = EMPLOYEE_SECTIONS.map((s) => ({
        id: s.id,
        title: s.title,
        fields: EMPLOYEE_FIELDS.filter(
          (f) => f.section === s.id && policy.fields[f.key] !== 'hidden',
        ).map((f) => {
          const level = policy.fields[f.key]!;
          const editable = level === 'edit_approval' || level === 'edit_direct';
          const proof = policy.proofs[f.key];
          return {
            key: f.key,
            label: f.label,
            type: f.type,
            level,
            value:
              f.type === 'employee'
                ? (p!.approvers[String(values[f.key] ?? '')] ?? values[f.key] ?? null)
                : (values[f.key] ?? null),
            options: editable && f.list ? (lists[f.list] ?? null) : null,
            help: f.help ?? null,
            required: Boolean(f.required),
            upper: Boolean(f.upper),
            when: f.when ?? null,
            proof: proof ? { typeId: proof, name: typeName.get(proof) ?? 'Document' } : null,
            pending: k(waiting, f.key),
          };
        }),
      })).filter((s) => s.fields.length);
      return {
        employee: { id, ...meta.rows[0]! },
        sections,
        window: win,
        canEdit:
          win.open &&
          sections.some((s) =>
            s.fields.some((f) => f.level === 'edit_approval' || f.level === 'edit_direct'),
          ),
        completeness: employeeCompleteness(values),
        requests: await this.requestsOf(c, id),
      };
    });
  }

  private async requestsOf(c: PoolClient, employeeId: string) {
    const r = await c.query<RequestRow>(
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a fixed fragment; the id is bound
      `${SELECT} WHERE r.employee_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
      [employeeId],
    );
    const names = await this.names(
      c,
      r.rows.flatMap((x) => x.route),
    );
    return r.rows.map((x) => ({
      id: x.id,
      status: x.status,
      autoApplied: x.auto_applied,
      createdAt: x.created_at.toISOString(),
      decidedAt: x.decided_at?.toISOString() ?? null,
      note: x.decision_note,
      reason: x.reason,
      step:
        x.status === 'pending'
          ? {
              at: x.current_level,
              of: x.route.length,
              with: employeeApproverLabel(x.route[x.current_level - 1]!, names),
            }
          : null,
      fields: Object.entries(x.changes).map(([key, v]) => ({
        key,
        label: FIELD.get(key)?.label ?? key,
        from: v.enc && typeof v.from === 'string' ? decryptField(v.from) : v.from,
        to: v.enc && typeof v.to === 'string' ? decryptField(v.to) : v.to,
        status: v.status ?? 'pending',
        note: v.note ?? null,
      })),
    }));
  }

  private async names(c: PoolClient, route: EmployeeApprover[]) {
    const out: Record<string, string> = {};
    const roles = route
      .filter((a) => a.kind === 'role')
      .map((a) => (a as { roleCode: string }).roleCode);
    const emps = route
      .filter((a) => a.kind === 'employee')
      .map((a) => (a as { employeeId: string }).employeeId);
    if (roles.length) {
      const r = await c.query<{ code: string; name: string }>(
        `SELECT code, name FROM roles WHERE code = ANY($1::text[]) AND (school_id IS NULL OR school_id = app.current_school_id())`,
        [roles],
      );
      for (const x of r.rows) out[`role:${x.code}`] = x.name;
    }
    if (emps.length) {
      const r = await c.query<{ id: string; name: string }>(
        `SELECT id::text, display_name AS name FROM employees WHERE id = ANY($1::bigint[])`,
        [emps],
      );
      for (const x of r.rows) out[`employee:${x.id}`] = x.name;
    }
    return out;
  }

  async submit(ctx: RequestContext, dto: EmployeeChangesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const id = await this.myEmployee(c);
      const policy = await loadEmployeePolicy(c);
      const win = employeeWindowState(policy.window);
      if (!win.open)
        throw new DomainError(
          'people.profile.window_closed',
          win.message ?? 'Profile updates are closed',
          {
            status: 409,
          },
        );
      const errors: Record<string, string> = {};
      for (const k of Object.keys(dto.changes)) {
        const f = FIELD.get(k);
        const level = policy.fields[k];
        if (!f || !employeeEditable(f) || (level !== 'edit_approval' && level !== 'edit_direct'))
          errors[k] = 'This field cannot be changed here';
      }
      if (Object.keys(errors).length)
        throw new DomainError(
          'people.profile.field_not_allowed',
          'Some fields cannot be changed here',
          {
            status: 422,
            extra: { errors },
          },
        );
      const lists = await loadEmployeeLists(c);
      const v = await validateEmployeeChanges(c, dto.changes, lists, id);
      if (Object.keys(v.errors).length)
        throw new DomainError('validation-failed', 'Some values were not accepted', {
          status: 400,
          extra: { errors: Object.entries(v.errors).map(([path, message]) => ({ path, message })) },
        });
      const current = (await readEmployeeProfile(c, id, true))!.values;
      const changed = Object.entries(v.values).filter(([k, val]) => !same(current[k] ?? null, val));
      if (!changed.length)
        throw new DomainError('people.profile.no_change', 'Nothing differs from what is on file', {
          status: 400,
        });
      // a field already waiting cannot be asked for again
      const waiting = await c.query<{ changes: Record<string, ChangeItem> }>(
        `SELECT changes FROM employee_change_requests WHERE employee_id = $1 AND status = 'pending'`,
        [id],
      );
      const busy = new Set(
        waiting.rows.flatMap((r) =>
          Object.entries(r.changes)
            .filter(([, x]) => !x.status || x.status === 'pending')
            .map(([k]) => k),
        ),
      );
      const clash = changed.map(([k]) => k).filter((k) => busy.has(k));
      if (clash.length)
        throw new DomainError(
          'people.change.pending',
          `Already waiting for approval: ${clash.map((k) => FIELD.get(k)?.label ?? k).join(', ')}`,
          { status: 409 },
        );
      // proofs: the employee's own ready uploads, every needed document attached
      const proofs = await this.checkProofs(c, dto.proofs);
      const have = new Set(proofs.map((x) => x.typeId));
      const missing = changed
        .filter(([k]) => policy.proofs[k] && !have.has(policy.proofs[k]!))
        .map(([k]) => k);
      if (missing.length)
        throw new DomainError(
          'people.profile.proof_required',
          'Attach the document each change needs',
          {
            status: 400,
            extra: {
              errors: missing.map((k) => ({
                path: k,
                message: 'Attach the document this change needs',
              })),
            },
          },
        );
      const item = (k: string, val: Value): ChangeItem => {
        const sensitive = Boolean(FIELD.get(k)?.sensitive);
        const from = current[k] ?? null;
        return sensitive
          ? {
              from: from === null ? null : encryptField(String(from)),
              to: val === null ? null : encryptField(String(val)),
              enc: true,
            }
          : { from, to: val };
      };
      const submission = randomUUID();
      const direct = changed.filter(([k]) => policy.fields[k] === 'edit_direct');
      const toApprove = changed.filter(([k]) => policy.fields[k] === 'edit_approval');
      const applied: string[] = [];
      if (direct.length) {
        await writeEmployeeProfile(c, id, Object.fromEntries(direct));
        await refreshEmployeeCompleteness(c, id);
        const r = await c.query<{ id: string }>(
          `INSERT INTO employee_change_requests (school_id, employee_id, requested_by_user_id, changes, reason, status,
                  route, auto_applied, submission, decided_at)
           VALUES (app.current_school_id(), $1, app.current_user_id(), $2::jsonb, $3, 'approved', '[]', true, $4, now())
           RETURNING id::text`,
          [
            id,
            JSON.stringify(
              Object.fromEntries(
                direct.map(([k, val]) => [k, { ...item(k, val), status: 'approved' }]),
              ),
            ),
            dto.reason ?? null,
            submission,
          ],
        );
        await c.query(
          `INSERT INTO employee_change_actions (school_id, request_id, level, decision, actor_id) VALUES (app.current_school_id(), $1, 1, 'auto', app.current_user_id())`,
          [r.rows[0]!.id],
        );
        await this.attachProofs(
          c,
          id,
          proofs.filter((pr) => direct.some(([k]) => policy.proofs[k] === pr.typeId)),
        );
        applied.push(...direct.map(([k]) => k));
        await this.audit.stage(ctx, c, {
          action: 'people.employee.self_update_direct',
          entityType: 'employees',
          entityId: id,
          after: { fields: applied },
        });
      }
      // one request per set of approvers
      const groups = new Map<string, { route: EmployeeRoute; items: Array<[string, Value]> }>();
      for (const [k, val] of toApprove) {
        const route = employeeRouteFor(policy, k);
        const sig = employeeRouteSignature(route);
        const g = groups.get(sig) ?? { route, items: [] };
        g.items.push([k, val]);
        groups.set(sig, g);
      }
      const requests: string[] = [];
      let first = true;
      for (const g of groups.values()) {
        const mine = proofs.filter((pr) => g.items.some(([k]) => policy.proofs[k] === pr.typeId));
        // proofs not asked for by any field travel with the first request
        const extra = first
          ? proofs.filter((pr) => !Object.values(policy.proofs).includes(pr.typeId))
          : [];
        const r = await c.query<{ id: string }>(
          `INSERT INTO employee_change_requests (school_id, employee_id, requested_by_user_id, changes, reason, route, proofs, submission)
           VALUES (app.current_school_id(), $1, app.current_user_id(), $2::jsonb, $3, $4::jsonb, $5::jsonb, $6) RETURNING id::text`,
          [
            id,
            JSON.stringify(
              Object.fromEntries(
                g.items.map(([k, val]) => [k, { ...item(k, val), status: 'pending' }]),
              ),
            ),
            dto.reason ?? null,
            JSON.stringify(g.route),
            JSON.stringify([...mine, ...extra]),
            submission,
          ],
        );
        requests.push(r.rows[0]!.id);
        first = false;
      }
      if (requests.length)
        await this.audit.stage(ctx, c, {
          action: 'people.employee_change_request.create',
          entityType: 'employees',
          entityId: id,
          after: { requests, fields: toApprove.map(([k]) => k) },
        });
      return { applied, requests, pending: toApprove.map(([k]) => k) };
    });
  }

  private async checkProofs(c: PoolClient, list: Array<{ typeId: string; fileId: string }>) {
    const out: Array<{ typeId: string; fileId: string; fileName: string | null }> = [];
    for (const p of list) {
      const f = await c.query<{ name: string | null }>(
        `SELECT original_name AS name FROM files
          WHERE id = $1 AND created_by = app.current_user_id() AND status = 'ready' AND deleted_at IS NULL
            AND content_type IN ('application/pdf', 'image/png', 'image/jpeg', 'image/webp')`,
        [p.fileId],
      );
      const t = await c.query(
        `SELECT 1 FROM employee_document_types WHERE id = $1 AND status = 'active'`,
        [p.typeId],
      );
      if (!f.rows[0] || !t.rowCount)
        throw new DomainError(
          'validation-failed',
          'Attach your own PDF or image for each document',
          { status: 400 },
        );
      out.push({ ...p, fileName: f.rows[0].name });
    }
    return out;
  }

  /** Proofs of an accepted change become the employee's documents. */
  private async attachProofs(
    c: PoolClient,
    employeeId: string,
    proofs: Array<{ typeId: string; fileId: string }>,
  ) {
    for (const p of proofs) {
      await c.query(
        `UPDATE files SET owner_entity_type = 'employee', owner_entity_id = $2::text, classification = 'personal' WHERE id = $1`,
        [p.fileId, employeeId],
      );
      await c.query(
        `INSERT INTO employee_documents (school_id, employee_id, type_id, file_id, remarks, created_by)
         SELECT app.current_school_id(), $1, $2, $3, 'Sent with a profile change', app.current_user_id()
          WHERE NOT EXISTS (SELECT 1 FROM employee_documents WHERE file_id = $3 AND deleted_at IS NULL)`,
        [employeeId, p.typeId, p.fileId],
      );
    }
  }

  async cancel(ctx: RequestContext, requestId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const id = await this.myEmployee(c);
      const r = await c.query(
        `UPDATE employee_change_requests SET status = 'cancelled', decided_at = now()
          WHERE id = $1 AND employee_id = $2 AND status = 'pending'`,
        [requestId, id],
      );
      if (!r.rowCount)
        throw new DomainError(
          'people.change.not_pending',
          'Only a request still waiting is withdrawn',
          { status: 409 },
        );
      await c.query(
        `INSERT INTO employee_change_actions (school_id, request_id, level, decision, actor_id)
         VALUES (app.current_school_id(), $1, 1, 'cancelled', app.current_user_id())`,
        [requestId],
      );
      return { status: 'cancelled' };
    });
  }

  /** My profile as PDF: my ID numbers in full, only the fields the school shows staff. */
  async print(ctx: RequestContext) {
    const meta = await this.db.tenant(requireTenant(ctx), async (c) => {
      const id = await this.myEmployee(c);
      const r = await c.query<{ code: string }>(
        'SELECT employee_code AS code FROM employees WHERE id = $1',
        [id],
      );
      return { id, code: r.rows[0]!.code };
    });
    return this.reports.createRenderedForOwner(
      ctx,
      {
        dataset: 'employee_profile',
        format: 'pdf',
        params: { employeeId: meta.id, self: true },
        title: `Employee profile ${meta.code}`,
      },
      'people.employee.self_print',
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

  // ---- the policy --------------------------------------------------------------------------------

  async policy(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const [p, types, roles, staff] = await Promise.all([
        loadEmployeePolicy(c),
        c.query<{ id: string; name: string }>(
          `SELECT id::text, name FROM employee_document_types WHERE status = 'active' ORDER BY sort_order, name`,
        ),
        c.query<{ code: string; name: string }>(
          `SELECT code, name FROM roles WHERE (school_id IS NULL OR school_id = app.current_school_id()) AND deleted_at IS NULL
              AND code NOT IN ('parent', 'student', 'support_engineer', 'erp_support') ORDER BY name`,
        ),
        c.query<{ id: string; name: string; code: string }>(
          `SELECT id::text, display_name AS name, employee_code AS code FROM employees
            WHERE deleted_at IS NULL AND status = 'active' AND user_id IS NOT NULL ORDER BY display_name`,
        ),
      ]);
      return {
        policy: p,
        sections: EMPLOYEE_SECTIONS,
        fields: EMPLOYEE_FIELDS.map((f) => ({
          key: f.key,
          section: f.section,
          label: f.label,
          sensitive: Boolean(f.sensitive),
          editable: employeeEditable(f),
        })),
        documentTypes: types.rows,
        roles: roles.rows,
        staff: staff.rows,
      };
    });
  }

  async savePolicy(ctx: RequestContext, dto: EmployeePolicyDto) {
    for (const k of [
      ...Object.keys(dto.fields),
      ...Object.keys(dto.proofs),
      ...Object.keys(dto.approval.fields),
    ])
      if (!FIELD.has(k))
        throw new DomainError('validation-failed', `Unknown field ${k}`, { status: 400 });
    for (const k of Object.keys(dto.approval.sections))
      if (!EMPLOYEE_SECTIONS.some((s) => s.id === k))
        throw new DomainError('validation-failed', `Unknown section ${k}`, { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO employee_portal_policies (school_id, fields, proofs, edit_window, approval, updated_by)
         VALUES (app.current_school_id(), $1::jsonb, $2::jsonb, $3::jsonb, $4::jsonb, app.current_user_id())
         ON CONFLICT (school_id) DO UPDATE SET fields = EXCLUDED.fields, proofs = EXCLUDED.proofs,
                edit_window = EXCLUDED.edit_window, approval = EXCLUDED.approval, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [
          JSON.stringify(dto.fields),
          JSON.stringify(dto.proofs),
          JSON.stringify(dto.window),
          JSON.stringify(dto.approval),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'people.staff_profile.save',
        entityType: 'employee_portal_policies',
        entityId: requireTenant(ctx).schoolId,
      });
      return loadEmployeePolicy(c);
    });
  }

  // ---- approvals ---------------------------------------------------------------------------------

  private async actor(c: PoolClient, ctx: RequestContext): Promise<Actor> {
    const e = await c.query<{ id: string }>(
      `SELECT id::text FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
    );
    const roles = await c.query<{ code: string }>(
      `SELECT r.code FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.user_id = app.current_user_id() AND ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL
          AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
    );
    const p = ctx.permissions;
    return {
      employeeId: e.rows[0]?.id ?? null,
      roles: new Set(roles.rows.map((x) => x.code)),
      office: p?.has(PEOPLE.employeeEdit) ?? false,
      override: p?.has(PEOPLE.staffChangeOverride) ?? false,
      sensitive: p?.has(PEOPLE.sensitiveView) ?? false,
    };
  }

  /** Is this approver the actor, for this employee? */
  private matches(a: EmployeeApprover, actor: Actor, profile: Record<string, unknown>): boolean {
    switch (a.kind) {
      case 'office':
        return actor.office;
      case 'hod':
        return !!actor.employeeId && String(profile.acr_hod ?? '') === actor.employeeId;
      case 'l1':
        return !!actor.employeeId && String(profile.approver_l1 ?? '') === actor.employeeId;
      case 'l2':
        return !!actor.employeeId && String(profile.approver_l2 ?? '') === actor.employeeId;
      case 'role':
        return actor.roles.has(a.roleCode);
      case 'employee':
        return actor.employeeId === a.employeeId;
    }
  }
  private canAct(r: RequestRow, actor: Actor) {
    if (r.status !== 'pending' || actor.employeeId === r.employee_id) return false;
    const step = r.route[r.current_level - 1];
    return actor.override || (!!step && this.matches(step, actor, r.profile));
  }

  async inbox(ctx: RequestContext, q: StaffInboxDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const actor = await this.actor(c, ctx);
      const seeAll = actor.override || actor.office;
      const box = seeAll ? q.box : 'mine';
      const r = await c.query<RequestRow>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a fixed fragment; values are bound
        `${SELECT}
          WHERE ($1 = 'decided' AND r.status <> 'pending' AND NOT r.auto_applied OR $1 <> 'decided' AND r.status = 'pending')
            AND ($2::text IS NULL OR e.display_name ILIKE '%' || $2 || '%' OR e.employee_code ILIKE '%' || $2 || '%')
            AND ($3::text IS NULL OR lower(e.department) = lower($3::text))
          ORDER BY r.created_at DESC LIMIT 500`,
        [box, q.q || null, q.department || null],
      );
      const rows = box === 'mine' ? r.rows.filter((x) => this.canAct(x, actor)) : r.rows;
      const awaiting = r.rows.filter((x) => this.canAct(x, actor)).length;
      const page = rows.slice((q.page - 1) * q.size, q.page * q.size);
      const names = await this.names(
        c,
        page.flatMap((x) => x.route),
      );
      return {
        data: page.map((x) => this.view(x, actor, names)),
        total: rows.length,
        page: q.page,
        awaitingMe: awaiting,
        canSeeAll: seeAll,
        canOverride: actor.override,
      };
    });
  }

  private view(r: RequestRow, actor: Actor, names: Record<string, string>) {
    const show = (v: Value, enc?: true) => {
      if (!enc || typeof v !== 'string') return v;
      const plain = decryptField(v);
      return plain === null ? null : actor.sensitive ? plain : maskValue(plain);
    };
    return {
      id: r.id,
      employee: {
        id: r.employee_id,
        name: r.name,
        code: r.code,
        department: r.department,
        designation: r.designation,
      },
      status: r.status,
      reason: r.reason,
      createdAt: r.created_at.toISOString(),
      decidedAt: r.decided_at?.toISOString() ?? null,
      note: r.decision_note,
      route: r.route.map((a, i) => ({
        label: employeeApproverLabel(a, names),
        done: i < r.current_level - 1 || r.status !== 'pending',
      })),
      step: r.current_level,
      proofs: r.proofs,
      canAct: this.canAct(r, actor),
      fields: Object.entries(r.changes).map(([key, v]) => ({
        key,
        label: FIELD.get(key)?.label ?? key,
        from: show(v.from, v.enc),
        to: show(v.to, v.enc),
        status: v.status ?? 'pending',
        note: v.note ?? null,
      })),
    };
  }

  async decide(ctx: RequestContext, id: string, dto: StaffDecideDto) {
    return this.db.tenant(requireTenant(ctx), (c) => this.decideIn(c, ctx, id, dto));
  }

  async bulk(ctx: RequestContext, dto: StaffBulkDto) {
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const id of dto.ids) {
      try {
        await this.db.tenant(requireTenant(ctx), (c) =>
          this.decideIn(c, ctx, id, { approve: dto.approve, note: dto.note }),
        );
        results.push({ id, ok: true });
      } catch (e) {
        results.push({ id, ok: false, error: e instanceof Error ? e.message : 'failed' });
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
    id: string,
    dto: { approve?: boolean; fields?: Record<string, boolean>; note?: string | null },
  ) {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a fixed fragment; the id is bound
    const r = (await c.query<RequestRow>(`${SELECT} WHERE r.id = $1 FOR UPDATE OF r`, [id]))
      .rows[0];
    if (!r) throw new DomainError('not-found', 'Request not found', { status: 404 });
    if (r.status !== 'pending')
      throw new DomainError('people.change.decided', 'This request is already decided', {
        status: 409,
      });
    const actor = await this.actor(c, ctx);
    if (!this.canAct(r, actor))
      throw new DomainError('people.change.not_assigned', 'This request is not with you', {
        status: 403,
      });
    const keys = Object.entries(r.changes)
      .filter(([, v]) => !v.status || v.status === 'pending')
      .map(([k]) => k);
    const decision: Record<string, boolean> = {};
    for (const k of keys) {
      const d = dto.fields?.[k] ?? dto.approve;
      if (d === undefined)
        throw new DomainError('validation-failed', `Decide ${FIELD.get(k)?.label ?? k}`, {
          status: 400,
        });
      decision[k] = d;
    }
    const refused = keys.filter((k) => !decision[k]);
    if (refused.length && !(dto.note ?? '').trim())
      throw new DomainError('validation-failed', 'Say why when refusing', { status: 400 });
    const step = r.route[r.current_level - 1];
    const asStep = !!step && this.matches(step, actor, r.profile);
    // the last step decides; so does one who may override, at any step
    const final = r.current_level >= r.route.length || actor.override;
    const accepted = keys.filter((k) => decision[k]);
    const changes = { ...r.changes };
    for (const k of refused)
      changes[k] = { ...changes[k]!, status: 'rejected', note: dto.note ?? null };
    if (accepted.length && final) {
      const now = (await readEmployeeProfile(c, r.employee_id, true))!.values;
      const plain = (v: Value, enc?: true) => (enc && typeof v === 'string' ? decryptField(v) : v);
      const values: ProfileValues = {};
      for (const k of accepted) {
        const it = changes[k]!;
        const from = plain(it.from, it.enc);
        const to = plain(it.to, it.enc);
        // the record changed since the request: neither what was asked from nor what is asked for
        if (!same(now[k] ?? null, from) && !same(now[k] ?? null, to))
          throw new DomainError(
            'people.change.stale',
            `${FIELD.get(k)?.label ?? k} changed since this request; refuse it and ask again`,
            { status: 409 },
          );
        values[k] = to;
        changes[k] = { ...it, status: 'approved' };
      }
      await writeEmployeeProfile(c, r.employee_id, values);
      await refreshEmployeeCompleteness(c, r.employee_id);
      await this.attachProofs(c, r.employee_id, r.proofs);
    }
    const allDone = final || !accepted.length;
    const status = !allDone
      ? 'pending'
      : accepted.length && refused.length
        ? 'partially_approved'
        : accepted.length
          ? 'approved'
          : 'rejected';
    await c.query(
      `UPDATE employee_change_requests SET changes = $2::jsonb, status = $3::change_request_status,
              current_level = $4, decided_by = CASE WHEN $3 <> 'pending' THEN app.current_user_id() END,
              decided_at = CASE WHEN $3 <> 'pending' THEN now() END, decision_note = $5
        WHERE id = $1`,
      [
        id,
        JSON.stringify(changes),
        status,
        allDone ? r.current_level : r.current_level + 1,
        dto.note ?? null,
      ],
    );
    await c.query(
      `INSERT INTO employee_change_actions (school_id, request_id, level, decision, fields, note, actor_id)
       VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, app.current_user_id())`,
      [
        id,
        r.current_level,
        actor.override && !asStep
          ? 'override'
          : !accepted.length
            ? 'rejected'
            : refused.length
              ? 'partial'
              : 'approved',
        JSON.stringify(
          Object.fromEntries(keys.map((k) => [k, decision[k] ? 'approved' : 'rejected'])),
        ),
        dto.note ?? null,
      ],
    );
    await this.audit.stage(ctx, c, {
      action: `people.employee_change_request.${status === 'pending' ? 'forward' : status === 'partially_approved' ? 'partial' : status === 'approved' ? 'approve' : 'reject'}`,
      entityType: 'employee_change_requests',
      entityId: id,
      after: { accepted, refused },
    });
    return { status, nextStep: status === 'pending' ? r.current_level + 1 : null };
  }

  /** A proof file of a request, for its reviewers (a signed download address). */
  async proofUrl(ctx: RequestContext, id: string, fileId: string) {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- SELECT is a fixed fragment; the id is bound
      const r = (await c.query<RequestRow>(`${SELECT} WHERE r.id = $1`, [id])).rows[0];
      if (!r || !r.proofs.some((p) => p.fileId === fileId))
        throw new DomainError('not-found', 'Document not found', { status: 404 });
      const actor = await this.actor(c, ctx);
      if (!actor.office && !actor.override && !this.canAct(r, actor))
        throw new DomainError('not-found', 'Document not found', { status: 404 });
    });
    return this.files.downloadUrl(ctx, fileId);
  }
}

const k = (o: Record<string, Value>, key: string): Value | undefined =>
  key in o ? o[key] : undefined;
