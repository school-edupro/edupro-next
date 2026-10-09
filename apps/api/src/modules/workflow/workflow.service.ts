import { Injectable, Logger } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  ActDto,
  CancelDto,
  CommentDto,
  CreateDefinitionDto,
  ListInstancesQueryDto,
  ReassignDto,
  Resolver,
  UpdateDefinitionDto,
} from './workflow.dto';

export interface Level {
  level: number;
  name: string;
  resolver: Resolver;
  slaHours?: number;
  escalateTo?: Resolver;
  /** Approved by itself when the requester is one of its approvers; ignored on the last level. */
  autoIfRequester?: boolean;
}

export interface EventRow {
  id: string;
  stepId: string | null;
  kind: string;
  actor: string | null;
  note: string | null;
  detail: Record<string, unknown>;
  occurredAt: string;
}

export interface DefinitionRow {
  id: string;
  code: string;
  name: string;
  entityType: string;
  levels: Level[];
  /** Role codes that may raise the request; empty = by permission only. */
  creatorRoles: string[];
  status: 'active' | 'inactive';
  open: number;
}

export interface StepRow {
  id: string;
  instanceId: string;
  level: number;
  name: string;
  resolver: Resolver;
  assignees: Array<{ id: string; name: string }>;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  actedBy: string | null;
  actedAt: string | null;
  note: string | null;
  /** Sprint 17: SLA */
  dueAt: string | null;
  overdue: boolean;
  remindedAt: string | null;
  escalatedAt: string | null;
}

export interface InstanceRow {
  id: string;
  definitionId: string;
  definitionCode: string;
  definitionName: string;
  entityType: string;
  entityId: string;
  subject: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  currentLevel: number;
  requestedBy: string | null;
  requestedAt: string;
  completedAt: string | null;
  steps: StepRow[];
}

export interface InboxItem extends StepRow {
  instance: Omit<InstanceRow, 'steps'>;
}

/** Called when an instance completes; the domain module reacts (S9-01). */
export type CompletionHandler = (
  c: PoolClient,
  ctx: RequestContext,
  instance: InstanceRow,
  outcome: 'approved' | 'rejected',
) => Promise<void>;

const INSTANCE_SELECT = `SELECT i.id::text, i.definition_id::text, d.code AS definition_code, d.name AS definition_name, i.entity_type, i.entity_id::text, i.subject, i.payload,
        i.status::text, i.current_level, u.display_name AS requested_by, i.requested_at, i.completed_at
   FROM workflow_instances i JOIN workflow_definitions d ON d.id = i.definition_id LEFT JOIN users u ON u.id = i.requested_by`;

interface InstanceDb {
  id: string;
  definition_id: string;
  definition_code: string;
  definition_name: string;
  entity_type: string;
  entity_id: string;
  subject: string;
  payload: Record<string, unknown>;
  status: InstanceRow['status'];
  current_level: number;
  requested_by: string | null;
  requested_at: Date;
  completed_at: Date | null;
}

const toInstance = (r: InstanceDb, steps: StepRow[] = []): InstanceRow => ({
  id: r.id,
  definitionId: r.definition_id,
  definitionCode: r.definition_code,
  definitionName: r.definition_name,
  entityType: r.entity_type,
  entityId: r.entity_id,
  subject: r.subject,
  payload: r.payload,
  status: r.status,
  currentLevel: r.current_level,
  requestedBy: r.requested_by,
  requestedAt: r.requested_at.toISOString(),
  completedAt: r.completed_at ? r.completed_at.toISOString() : null,
  steps,
});

/**
 * Workflow engine v0 (S9-01): definitions with levels and resolvers, instances with one step per level,
 * an inbox of pending steps for the signed-in user, approve/reject moving the instance forward, and a
 * completion callback per entity type registered by the owning module.
 */
@Injectable()
export class WorkflowService {
  private readonly logger = new Logger(WorkflowService.name);
  private readonly handlers = new Map<string, CompletionHandler>();
  /** told when a step lands with people (push notifications to approvers) */
  private readonly assignListeners: Array<
    (c: PoolClient, ctx: RequestContext, userIds: string[], subject: string) => Promise<unknown>
  > = [];

  onAssign(
    listener: (
      c: PoolClient,
      ctx: RequestContext,
      userIds: string[],
      subject: string,
    ) => Promise<unknown>,
  ): void {
    this.assignListeners.push(listener);
  }

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  onComplete(entityType: string, handler: CompletionHandler): void {
    this.handlers.set(entityType, handler);
  }

  // ---- definitions ------------------------------------------------------------------------------
  async definitions(ctx: RequestContext): Promise<DefinitionRow[]> {
    return this.db.tenant(requireTenant(ctx), (c) => this.definitionsWith(c));
  }

  /** Reads through the caller's client so create/update can return the row inside their transaction. */
  private async definitionsWith(c: PoolClient): Promise<DefinitionRow[]> {
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      entity_type: string;
      levels: Level[];
      creator_roles: string[];
      status: DefinitionRow['status'];
      open: number;
    }>(
      `SELECT d.id::text, d.code, d.name, d.entity_type, d.levels, d.creator_roles, d.status, (SELECT count(*)::int FROM workflow_instances i WHERE i.definition_id = d.id AND i.status = 'pending') AS open
         FROM workflow_definitions d WHERE d.deleted_at IS NULL ORDER BY d.entity_type, d.code`,
    );
    return r.rows.map((x) => ({
      id: x.id,
      code: x.code,
      name: x.name,
      entityType: x.entity_type,
      levels: x.levels,
      creatorRoles: x.creator_roles,
      status: x.status,
      open: x.open,
    }));
  }

  async createDefinition(ctx: RequestContext, dto: CreateDefinitionDto): Promise<DefinitionRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, creator_roles, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5::text[], app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [dto.code, dto.name, dto.entityType, JSON.stringify(dto.levels), dto.creatorRoles],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Workflow "${dto.code}" already exists`);
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'workflow.definition.create',
        entityType: 'workflow_definitions',
        entityId: id,
        after: dto,
      });
      return (await this.definitionsWith(c)).find((d) => d.id === id)!;
    });
  }

  async updateDefinition(
    ctx: RequestContext,
    id: string,
    dto: UpdateDefinitionDto,
  ): Promise<DefinitionRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const sets: string[] = ['updated_at = now()', 'updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (col: string, value: unknown, cast = '') => {
        params.push(value);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.levels !== undefined) set('levels', JSON.stringify(dto.levels), '::jsonb');
      if (dto.status !== undefined) set('status', dto.status, '::row_status');
      if (dto.creatorRoles !== undefined) set('creator_roles', dto.creatorRoles, '::text[]');
      params.push(id);
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- sets holds fixed column assignments; values are bound parameters
        `UPDATE workflow_definitions SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL`,
        params,
      );
      if (r.rowCount === 0) throw new DomainError('not-found', 'Workflow not found');
      await this.audit.stage(ctx, c, {
        action: 'workflow.definition.edit',
        entityType: 'workflow_definitions',
        entityId: id,
        after: dto,
      });
      return (await this.definitionsWith(c)).find((d) => d.id === id)!;
    });
  }

  /** Installs the default definitions a school starts with (admission approval: coordinator, then admin). */
  async installDefaults(ctx: RequestContext): Promise<DefinitionRow[]> {
    const defaults: Array<Omit<CreateDefinitionDto, 'creatorRoles'>> = [
      {
        code: 'admission_approval',
        name: 'Admission approval',
        entityType: 'application',
        levels: [
          {
            level: 1,
            name: 'Academic Coordinator review',
            resolver: { kind: 'role', roleCode: 'academic_coordinator' },
            slaHours: 48,
          },
          {
            level: 2,
            name: 'Principal approval',
            resolver: { kind: 'role', roleCode: 'school_admin' },
            slaHours: 48,
          },
        ],
      },
      {
        code: 'lesson_plan_approval',
        name: 'Lesson plan approval',
        entityType: 'lesson_plan',
        levels: [
          {
            level: 1,
            name: 'Academic Coordinator review',
            resolver: { kind: 'role', roleCode: 'academic_coordinator' },
            slaHours: 48,
          },
          {
            level: 2,
            name: 'Vice Principal review',
            resolver: { kind: 'position', designation: 'Vice Principal' },
            slaHours: 48,
          },
          {
            level: 3,
            name: 'Principal approval',
            resolver: { kind: 'role', roleCode: 'school_admin' },
            slaHours: 48,
          },
        ],
      },
      {
        code: 'message_approval',
        name: 'Message approval',
        entityType: 'message_request',
        levels: [
          {
            level: 1,
            name: 'Principal approval',
            resolver: { kind: 'role', roleCode: 'school_admin' },
            slaHours: 24,
          },
        ],
      },
      {
        // Sprint 14: a fee category, discount or hostel change requested by the accounts desk
        code: 'fee_profile_change',
        name: 'Fee category and discount change',
        entityType: 'fee_profile_change',
        levels: [
          {
            level: 1,
            name: 'Fee in-charge',
            resolver: { kind: 'role', roleCode: 'accountant' },
            slaHours: 24,
            autoIfRequester: true,
          },
          {
            level: 2,
            name: 'Principal approval',
            resolver: { kind: 'role', roleCode: 'school_admin' },
            slaHours: 48,
          },
        ],
      },
      // Sprint 19: the last approval flows on the engine
      {
        code: 'appointment_request',
        name: 'Appointment request',
        entityType: 'appointment_request',
        levels: [
          {
            level: 1,
            name: 'Class teacher confirms',
            resolver: { kind: 'role', roleCode: 'class_teacher' },
            slaHours: 48,
            escalateTo: { kind: 'role', roleCode: 'academic_coordinator' },
          },
        ],
      },
      // gate passes keep their own approval levels since 0069 (GatePassService)
      {
        code: 'cctv_request',
        name: 'CCTV footage request',
        entityType: 'cctv_request',
        levels: [
          {
            level: 1,
            name: 'School admin decides',
            resolver: { kind: 'role', roleCode: 'school_admin' },
            slaHours: 72,
          },
        ],
      },
      {
        code: 'employee_query',
        name: 'Employee query',
        entityType: 'employee_query',
        levels: [
          {
            level: 1,
            name: 'Coordinator answers',
            resolver: { kind: 'role', roleCode: 'academic_coordinator' },
            slaHours: 72,
            escalateTo: { kind: 'role', roleCode: 'school_admin' },
          },
        ],
      },
      {
        // Sprint 13: a family's bus request (join, change stop, leave) is approved by the office
        code: 'transport_request',
        name: 'Transport request',
        entityType: 'transport_request',
        levels: [
          {
            level: 1,
            name: 'Transport in-charge approval',
            resolver: { kind: 'role', roleCode: 'school_admin' },
            slaHours: 72,
          },
        ],
      },
    ];
    await this.db.tenant(requireTenant(ctx), async (c) => {
      for (const d of defaults)
        await c.query(
          `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, created_by, updated_by)
           SELECT app.current_school_id(), $1, $2, $3, $4::jsonb, app.current_user_id(), app.current_user_id()
            WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE code = $1 AND deleted_at IS NULL)`,
          [d.code, d.name, d.entityType, JSON.stringify(d.levels)],
        );
    });
    return this.definitions(ctx);
  }

  /** What the editor offers: roles, designations in use and staff who can sign in. */
  async options(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const roles = await c.query<{ code: string; name: string }>(
        `SELECT DISTINCT ON (r.code) r.code, r.name FROM roles r
          WHERE (r.school_id IS NULL OR r.school_id = app.current_school_id()) AND r.code NOT IN ('parent', 'student')
          ORDER BY r.code, r.school_id NULLS LAST`,
      );
      const designations = await c.query<{ d: string }>(
        `SELECT DISTINCT designation AS d FROM employees WHERE deleted_at IS NULL AND status = 'active' AND designation IS NOT NULL AND designation <> '' ORDER BY 1 LIMIT 200`,
      );
      const people = await c.query<{ id: string; name: string }>(
        `SELECT u.id::text, e.display_name || COALESCE(' · ' || NULLIF(e.designation, ''), '') AS name
           FROM employees e JOIN users u ON u.id = e.user_id
          WHERE e.deleted_at IS NULL AND e.status = 'active' ORDER BY e.display_name LIMIT 500`,
      );
      return {
        roles: roles.rows.sort((a, b) => a.name.localeCompare(b.name)),
        designations: designations.rows.map((x) => x.d),
        people: people.rows,
      };
    });
  }

  // ---- resolvers --------------------------------------------------------------------------------
  async resolveAssignees(
    c: PoolClient,
    resolver: Resolver,
    requestedBy: string | null,
  ): Promise<string[]> {
    if (resolver.kind === 'named_user') return [resolver.userId];
    if (resolver.kind === 'any_of') {
      const r = await c.query<{ id: string }>(
        `SELECT DISTINCT ur.user_id::text AS id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.school_id = app.current_school_id() AND r.code = ANY($1::text[]) AND ur.revoked_at IS NULL
            AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
         UNION
         SELECT m.user_id::text FROM user_school_memberships m
          WHERE m.school_id = app.current_school_id() AND m.user_id = ANY($2::bigint[]) AND m.deleted_at IS NULL AND m.status = 'active'`,
        [resolver.roleCodes, resolver.userIds],
      );
      return r.rows.map((x) => x.id);
    }
    if (resolver.kind === 'role') {
      const r = await c.query<{ id: string }>(
        `SELECT DISTINCT ur.user_id::text AS id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.school_id = app.current_school_id() AND r.code = $1 AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
        [resolver.roleCode],
      );
      return r.rows.map((x) => x.id);
    }
    if (resolver.kind === 'position') {
      const r = await c.query<{ id: string }>(
        `SELECT DISTINCT user_id::text AS id FROM employees WHERE designation ILIKE $1 AND user_id IS NOT NULL AND status = 'active' AND deleted_at IS NULL`,
        [resolver.designation],
      );
      return r.rows.map((x) => x.id);
    }
    // approver chain: walk the requester's reporting line
    if (!requestedBy) return [];
    const r = await c.query<{ id: string }>(
      `WITH RECURSIVE chain AS (
         SELECT e.id, e.user_id, p.reports_to_employee_id, 0 AS depth FROM employees e
           LEFT JOIN postings p ON p.employee_id = e.id AND p.academic_year_id = app.current_academic_year_id()
          WHERE e.user_id = $1 AND e.deleted_at IS NULL
         UNION ALL
         SELECT m.id, m.user_id, mp.reports_to_employee_id, chain.depth + 1 FROM chain
           JOIN employees m ON m.id = chain.reports_to_employee_id
           LEFT JOIN postings mp ON mp.employee_id = m.id AND mp.academic_year_id = app.current_academic_year_id()
          WHERE chain.depth < 5)
       SELECT user_id::text AS id FROM chain WHERE depth = $2 AND user_id IS NOT NULL`,
      [requestedBy, resolver.depth],
    );
    return r.rows.map((x) => x.id);
  }

  // ---- instances --------------------------------------------------------------------------------
  private async stepsOf(c: PoolClient, instanceId: string): Promise<StepRow[]> {
    const r = await c.query<{
      id: string;
      instance_id: string;
      level: number;
      name: string;
      resolver: Resolver;
      assignees: Array<{ id: string; name: string }>;
      status: StepRow['status'];
      acted_by: string | null;
      acted_at: Date | null;
      note: string | null;
      due_at: Date | null;
      reminded_at: Date | null;
      escalated_at: Date | null;
    }>(
      `SELECT s.id::text, s.instance_id::text, s.level, s.name, s.resolver, s.status::text, ub.display_name AS acted_by, s.acted_at, s.note,
              s.due_at, s.reminded_at, s.escalated_at,
              COALESCE((SELECT jsonb_agg(jsonb_build_object('id', u.id::text, 'name', u.display_name)) FROM users u WHERE u.id = ANY(s.assignee_user_ids)), '[]'::jsonb) AS assignees
         FROM workflow_steps s LEFT JOIN users ub ON ub.id = s.acted_by WHERE s.instance_id = $1 ORDER BY s.level`,
      [instanceId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      instanceId: x.instance_id,
      level: x.level,
      name: x.name,
      resolver: x.resolver,
      assignees: x.assignees,
      status: x.status,
      actedBy: x.acted_by,
      actedAt: x.acted_at ? x.acted_at.toISOString() : null,
      note: x.note,
      dueAt: x.due_at ? x.due_at.toISOString() : null,
      overdue: x.status === 'pending' && x.due_at !== null && x.due_at.getTime() < Date.now(),
      remindedAt: x.reminded_at ? x.reminded_at.toISOString() : null,
      escalatedAt: x.escalated_at ? x.escalated_at.toISOString() : null,
    }));
  }

  async instanceWith(c: PoolClient, id: string): Promise<InstanceRow | null> {
    // eslint-disable-next-line no-restricted-syntax -- INSTANCE_SELECT is a constant; values are bound parameters
    const r = await c.query<InstanceDb>(`${INSTANCE_SELECT} WHERE i.id = $1`, [id]);
    if (!r.rows[0]) return null;
    return toInstance(r.rows[0], await this.stepsOf(c, id));
  }

  /** Starts an instance inside the caller's transaction (the domain module owns the transaction). */
  async start(
    c: PoolClient,
    ctx: RequestContext,
    input: {
      definitionCode: string;
      entityType: string;
      entityId: string;
      subject: string;
      payload?: Record<string, unknown>;
    },
  ): Promise<InstanceRow> {
    const def = await c.query<{ id: string; levels: Level[]; creator_roles: string[] }>(
      `SELECT id::text, levels, creator_roles FROM workflow_definitions WHERE code = $1 AND entity_type = $2 AND status = 'active' AND deleted_at IS NULL`,
      [input.definitionCode, input.entityType],
    );
    if (!def.rows[0])
      throw new DomainError(
        'workflow.definition_missing',
        `No active workflow "${input.definitionCode}"; install the defaults first`,
        { status: 409 },
      );
    // the workflow names who may raise it; an empty list leaves it to the permissions
    if (def.rows[0].creator_roles.length > 0) {
      const mine = await c.query(
        `SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = app.current_user_id() AND ur.school_id = app.current_school_id() AND r.code = ANY($1::text[])
            AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE) LIMIT 1`,
        [def.rows[0].creator_roles],
      );
      if (mine.rowCount === 0)
        throw new DomainError(
          'workflow.creator_not_allowed',
          'Your role cannot raise this request; ask the office to raise it',
          { status: 403 },
        );
    }
    let id: string;
    try {
      const r = await c.query<{ id: string }>(
        `INSERT INTO workflow_instances (school_id, definition_id, entity_type, entity_id, subject, payload, requested_by, request_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
        [
          def.rows[0].id,
          input.entityType,
          input.entityId,
          input.subject,
          JSON.stringify(input.payload ?? {}),
        ],
      );
      id = r.rows[0]!.id;
    } catch (error) {
      if ((error as { code?: string }).code === '23505')
        throw new DomainError(
          'workflow.already_pending',
          'An approval is already pending for this item',
          { status: 409 },
        );
      throw error;
    }
    const requester = ctx.user.id;
    let firstAssignees: string[] = [];
    for (const level of [...def.rows[0].levels].sort((a, b) => a.level - b.level)) {
      const assignees = await this.resolveAssignees(c, level.resolver, requester);
      if (assignees.length === 0)
        throw new DomainError(
          'workflow.no_assignee',
          `Nobody can approve level ${level.level} (${level.name}); check the workflow definition`,
          { status: 409 },
        );
      // the first level's clock starts now; later levels start when they become current (act())
      const first = level.level === Math.min(...def.rows[0].levels.map((l) => l.level));
      if (first) firstAssignees = assignees;
      await c.query(
        `INSERT INTO workflow_steps (school_id, instance_id, level, name, resolver, assignee_user_ids, due_at)
         VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5::bigint[], CASE WHEN $6::boolean AND $7::int IS NOT NULL THEN now() + make_interval(hours => $7::int) END)`,
        [
          id,
          level.level,
          level.name,
          JSON.stringify(level.resolver),
          assignees,
          first,
          level.slaHours ?? null,
        ],
      );
    }
    await this.event(c, id, null, 'started', ctx.user.id, null, { subject: input.subject });
    // a level marked "autoIfRequester" is approved by itself when its approver raised the request;
    // the last level always needs somebody to act
    const ordered = [...def.rows[0].levels].sort((a, b) => a.level - b.level);
    let waiting = firstAssignees;
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const level = ordered[i]!;
      if (!level.autoIfRequester) break;
      const mine = await this.resolveAssignees(c, level.resolver, requester);
      if (!mine.includes(requester)) break;
      const next = ordered[i + 1]!;
      const step = await c.query<{ id: string }>(
        `UPDATE workflow_steps SET status = 'approved', acted_by = app.current_user_id(), acted_at = now(), note = 'Raised by this level''s approver'
          WHERE instance_id = $1 AND level = $2 RETURNING id::text`,
        [id, level.level],
      );
      await c.query(
        `UPDATE workflow_instances SET current_level = $2, updated_at = now() WHERE id = $1`,
        [id, next.level],
      );
      await c.query(
        `UPDATE workflow_steps SET due_at = CASE WHEN $3::int IS NOT NULL THEN now() + make_interval(hours => $3::int) END WHERE instance_id = $1 AND level = $2`,
        [id, next.level, next.slaHours ?? null],
      );
      await this.event(c, id, step.rows[0]?.id ?? null, 'approved', ctx.user.id, null, {
        level: level.level,
        auto: true,
      });
      waiting = await this.resolveAssignees(c, next.resolver, requester);
    }
    for (const l of this.assignListeners) await l(c, ctx, waiting, input.subject);
    await this.audit.stage(ctx, c, {
      action: 'workflow.instance.started',
      entityType: 'workflow_instances',
      entityId: id,
      after: {
        definition: input.definitionCode,
        entityType: input.entityType,
        entityId: input.entityId,
        subject: input.subject,
      },
    });
    return (await this.instanceWith(c, id))!;
  }

  /** History line of an instance (Sprint 17). */
  private async event(
    c: PoolClient,
    instanceId: string,
    stepId: string | null,
    kind: string,
    actorId: string | null,
    note: string | null,
    detail: Record<string, unknown> = {},
  ): Promise<void> {
    await c.query(
      `INSERT INTO workflow_events (school_id, instance_id, step_id, kind, actor_id, note, detail) VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::jsonb)`,
      [instanceId, stepId, kind, actorId, note, JSON.stringify(detail)],
    );
  }

  /** Steps the user may act on: assigned, or delegated to them by an assignee (active delegation). */
  static readonly MAY_ACT = `(app.current_user_id() = ANY(s.assignee_user_ids)
       OR EXISTS (SELECT 1 FROM delegations d WHERE d.to_user_id = app.current_user_id() AND d.from_user_id = ANY(s.assignee_user_ids)
                     AND d.revoked_at IS NULL AND now() BETWEEN d.starts_at AND d.ends_at))`;

  async inbox(ctx: RequestContext): Promise<InboxItem[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<InstanceDb & { step_id: string }>(
        // eslint-disable-next-line no-restricted-syntax -- INSTANCE_SELECT is a constant; values are bound parameters
        `${INSTANCE_SELECT.replace('SELECT i.id::text', 'SELECT s.id::text AS step_id, i.id::text')}
           JOIN workflow_steps s ON s.instance_id = i.id AND s.level = i.current_level AND s.status = 'pending'
          WHERE i.status = 'pending' AND ${WorkflowService.MAY_ACT} ORDER BY s.due_at NULLS LAST, i.requested_at`,
      );
      const items: InboxItem[] = [];
      for (const row of r.rows) {
        const steps = await this.stepsOf(c, row.id);
        const step = steps.find((s) => s.id === row.step_id)!;
        const instance = toInstance(row);
        delete (instance as { steps?: StepRow[] }).steps;
        items.push({ ...step, instance });
      }
      return items;
    });
  }

  async instances(
    ctx: RequestContext,
    q: ListInstancesQueryDto,
  ): Promise<{ rows: InstanceRow[]; total: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where: string[] = ['TRUE'];
      const params: unknown[] = [];
      if (q.entityType) {
        params.push(q.entityType);
        where.push(`i.entity_type = $${params.length}`);
      }
      if (q.entityId) {
        params.push(q.entityId);
        where.push(`i.entity_id = $${params.length}`);
      }
      if (q.status) {
        params.push(q.status);
        where.push(`i.status = $${params.length}::workflow_status`);
      }
      const whereSql = where.join(' AND ');
      const total = await c.query<{ n: string }>(
        // eslint-disable-next-line no-restricted-syntax -- whereSql is a conjunction of fixed fragments; values are bound parameters
        `SELECT count(*)::text AS n FROM workflow_instances i WHERE ${whereSql}`,
        params,
      );
      params.push(q.size, (q.page - 1) * q.size);
      const r = await c.query<InstanceDb>(
        // eslint-disable-next-line no-restricted-syntax -- INSTANCE_SELECT is a constant; whereSql holds fixed fragments; values are bound parameters
        `${INSTANCE_SELECT} WHERE ${whereSql} ORDER BY i.requested_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      const rows: InstanceRow[] = [];
      for (const x of r.rows) rows.push(toInstance(x, await this.stepsOf(c, x.id)));
      return { rows, total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  async get(ctx: RequestContext, id: string): Promise<InstanceRow> {
    const row = await this.db.tenant(requireTenant(ctx), (c) => this.instanceWith(c, id));
    if (!row) throw new DomainError('not-found', 'Workflow instance not found');
    return row;
  }

  async act(
    ctx: RequestContext,
    stepId: string,
    outcome: 'approved' | 'rejected',
    dto: ActDto,
  ): Promise<InstanceRow> {
    const tenant: TenantContext = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const s = await c.query<{
        id: string;
        instance_id: string;
        level: number;
        status: string;
        assignees: string[];
      }>(
        `SELECT id::text, instance_id::text, level, status::text, assignee_user_ids::text[] AS assignees FROM workflow_steps WHERE id = $1 FOR UPDATE`,
        [stepId],
      );
      const step = s.rows[0];
      if (!step) throw new DomainError('not-found', 'Step not found');
      if (step.status !== 'pending')
        throw new DomainError('workflow.step_closed', 'This step has already been decided', {
          status: 409,
        });
      let delegatedFrom: string | null = null;
      if (!step.assignees.includes(ctx.user.id)) {
        const d = await c.query<{ from_user_id: string }>(
          `SELECT d.from_user_id::text FROM delegations d WHERE d.to_user_id = app.current_user_id() AND d.from_user_id = ANY($1::bigint[])
             AND d.revoked_at IS NULL AND now() BETWEEN d.starts_at AND d.ends_at LIMIT 1`,
          [step.assignees],
        );
        if (!d.rows[0])
          throw new DomainError('workflow.not_assignee', 'This step is not assigned to you', {
            status: 403,
          });
        delegatedFrom = d.rows[0].from_user_id;
      }
      const inst = await c.query<{ status: string; current_level: number }>(
        `SELECT status::text, current_level FROM workflow_instances WHERE id = $1 FOR UPDATE`,
        [step.instance_id],
      );
      if (inst.rows[0]!.status !== 'pending' || inst.rows[0]!.current_level !== step.level)
        throw new DomainError('workflow.not_current', 'The instance is not waiting on this step', {
          status: 409,
        });
      await c.query(
        `UPDATE workflow_steps SET status = $2::step_status, acted_by = app.current_user_id(), acted_at = now(), note = $3 WHERE id = $1`,
        [stepId, outcome, dto.note ?? null],
      );
      let completed: 'approved' | 'rejected' | null = null;
      if (outcome === 'rejected') {
        await c.query(
          `UPDATE workflow_steps SET status = 'skipped' WHERE instance_id = $1 AND status = 'pending'`,
          [step.instance_id],
        );
        await c.query(
          `UPDATE workflow_instances SET status = 'rejected', completed_at = now(), completed_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
          [step.instance_id],
        );
        completed = 'rejected';
      } else {
        const next = await c.query<{ level: number }>(
          `SELECT level FROM workflow_steps WHERE instance_id = $1 AND status = 'pending' ORDER BY level LIMIT 1`,
          [step.instance_id],
        );
        if (next.rows[0]) {
          await c.query(
            `UPDATE workflow_instances SET current_level = $2, updated_at = now() WHERE id = $1`,
            [step.instance_id, next.rows[0].level],
          );
          // the next level's SLA clock starts now
          await c.query(
            `UPDATE workflow_steps s SET due_at = now() + make_interval(hours => (l.value->>'slaHours')::int)
               FROM workflow_instances i JOIN workflow_definitions d ON d.id = i.definition_id
               CROSS JOIN LATERAL jsonb_array_elements(d.levels) AS l(value)
              WHERE s.instance_id = i.id AND i.id = $1 AND s.level = $2 AND (l.value->>'level')::int = s.level AND l.value ? 'slaHours'`,
            [step.instance_id, next.rows[0].level],
          );
        } else {
          await c.query(
            `UPDATE workflow_instances SET status = 'approved', completed_at = now(), completed_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
            [step.instance_id],
          );
          completed = 'approved';
        }
      }
      await this.event(c, step.instance_id, stepId, outcome, ctx.user.id, dto.note ?? null, {
        level: step.level,
        ...(delegatedFrom ? { delegatedFrom } : {}),
      });
      if (delegatedFrom)
        await this.event(c, step.instance_id, stepId, 'delegated', ctx.user.id, null, {
          from: delegatedFrom,
        });
      const instance = (await this.instanceWith(c, step.instance_id))!;
      await this.audit.stage(ctx, c, {
        action: `workflow.step.${outcome}`,
        entityType: 'workflow_instances',
        entityId: step.instance_id,
        after: {
          step: step.level,
          outcome,
          note: dto.note ?? null,
          instanceStatus: instance.status,
        },
      });
      if (completed) {
        const handler = this.handlers.get(instance.entityType);
        if (handler) await handler(c, ctx, instance, completed);
        else this.logger.warn(`no completion handler for ${instance.entityType}`);
      }
      return instance;
    });
  }

  // ---- Sprint 17: cancel, reassign, comment, history --------------------------------------------
  async cancel(ctx: RequestContext, instanceId: string, dto: CancelDto): Promise<InstanceRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cur = await c.query<{
        status: string;
        requested_by: string | null;
        entity_type: string;
      }>(
        `SELECT status::text, requested_by::text, entity_type FROM workflow_instances WHERE id = $1 FOR UPDATE`,
        [instanceId],
      );
      const row = cur.rows[0];
      if (!row) throw new DomainError('not-found', 'Instance not found', { status: 404 });
      if (row.status !== 'pending')
        throw new DomainError('workflow.not_pending', `The approval is already ${row.status}`, {
          status: 409,
        });
      const mayManage = ctx.permissions?.has('workflow.instance.cancel') === true;
      if (row.requested_by !== ctx.user.id && !mayManage)
        throw new DomainError(
          'permission-denied',
          'Only the requester or a workflow manager may cancel',
          {
            status: 403,
          },
        );
      await c.query(
        `UPDATE workflow_steps SET status = 'skipped' WHERE instance_id = $1 AND status = 'pending'`,
        [instanceId],
      );
      await c.query(
        `UPDATE workflow_instances SET status = 'cancelled', cancel_reason = $2, completed_at = now(), completed_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [instanceId, dto.reason],
      );
      await this.event(c, instanceId, null, 'cancelled', ctx.user.id, dto.reason);
      const instance = (await this.instanceWith(c, instanceId))!;
      await this.audit.stage(ctx, c, {
        action: 'workflow.instance.cancelled',
        entityType: 'workflow_instances',
        entityId: instanceId,
        after: { reason: dto.reason },
      });
      // the owning module treats a cancellation like a rejection (the entity goes back to its author)
      const handler = this.handlers.get(instance.entityType);
      if (handler) await handler(c, ctx, instance, 'rejected');
      return instance;
    });
  }

  async reassign(ctx: RequestContext, stepId: string, dto: ReassignDto): Promise<InstanceRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await c.query<{ instance_id: string; status: string; assignees: string[] }>(
        `SELECT instance_id::text, status::text, assignee_user_ids::text[] AS assignees FROM workflow_steps WHERE id = $1 FOR UPDATE`,
        [stepId],
      );
      const step = s.rows[0];
      if (!step) throw new DomainError('not-found', 'Step not found', { status: 404 });
      if (step.status !== 'pending')
        throw new DomainError('workflow.step_closed', 'This step has already been decided', {
          status: 409,
        });
      const members = await c.query<{ id: string }>(
        `SELECT user_id::text AS id FROM user_school_memberships WHERE user_id = ANY($1::bigint[]) AND status = 'active' AND deleted_at IS NULL`,
        [dto.userIds],
      );
      if (members.rows.length !== new Set(dto.userIds).size)
        throw new DomainError(
          'validation-failed',
          'Every assignee must be an active member of this school',
          {
            status: 400,
          },
        );
      await c.query(`UPDATE workflow_steps SET assignee_user_ids = $2::bigint[] WHERE id = $1`, [
        stepId,
        dto.userIds,
      ]);
      await this.event(c, step.instance_id, stepId, 'reassigned', ctx.user.id, dto.note ?? null, {
        from: step.assignees,
        to: dto.userIds,
      });
      await this.audit.stage(ctx, c, {
        action: 'workflow.step.reassigned',
        entityType: 'workflow_instances',
        entityId: step.instance_id,
        before: { assignees: step.assignees },
        after: { assignees: dto.userIds, note: dto.note ?? null },
      });
      return (await this.instanceWith(c, step.instance_id))!;
    });
  }

  async comment(ctx: RequestContext, instanceId: string, dto: CommentDto): Promise<EventRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const exists = await c.query('SELECT 1 FROM workflow_instances WHERE id = $1', [instanceId]);
      if (!exists.rows[0])
        throw new DomainError('not-found', 'Instance not found', { status: 404 });
      await this.event(c, instanceId, null, 'comment', ctx.user.id, dto.note);
      return this.historyOf(c, instanceId);
    });
  }

  async history(ctx: RequestContext, instanceId: string): Promise<EventRow[]> {
    return this.db.tenant(requireTenant(ctx), (c) => this.historyOf(c, instanceId));
  }

  private async historyOf(c: PoolClient, instanceId: string): Promise<EventRow[]> {
    const r = await c.query<{
      id: string;
      step_id: string | null;
      kind: string;
      actor: string | null;
      note: string | null;
      detail: Record<string, unknown>;
      occurred_at: Date;
    }>(
      `SELECT e.id::text, e.step_id::text, e.kind, u.display_name AS actor, e.note, e.detail, e.occurred_at
         FROM workflow_events e LEFT JOIN users u ON u.id = e.actor_id WHERE e.instance_id = $1 ORDER BY e.id`,
      [instanceId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      stepId: x.step_id,
      kind: x.kind,
      actor: x.actor,
      note: x.note,
      detail: x.detail,
      occurredAt: x.occurred_at.toISOString(),
    }));
  }
}
