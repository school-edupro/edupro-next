import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ENV, type Env } from '../../config/env';
import { ViewerService } from '../academics/daily/viewer.service';
import { SettingsService } from '../platform/settings.service';
import { ReportsService } from '../reports/reports.service';
import type {
  BreachDto,
  BreachUpdateDto,
  DsrListDto,
  DsrStatusDto,
  EraseDto,
  MyDsrDto,
  OfficeDsrDto,
} from './dsr.dto';

type Row = Record<string, unknown>;
const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export interface DsrRow {
  id: string;
  kind: string;
  principalKind: string;
  principalId: string;
  principal: string | null;
  requestedBy: string | null;
  channel: string;
  detail: string | null;
  status: string;
  receivedOn: string;
  dueOn: string;
  overdue: boolean;
  handledBy: string | null;
  outcome: string | null;
  exportId: string | null;
  exportStatus: string | null;
  changeRequestId: string | null;
  completedAt: string | null;
}

/**
 * Sprint 20: data-principal requests under the DPDP Act (access, correction, erasure, grievance), the
 * breach log and the retention run history. Design note 17 section 2.
 */
@Injectable()
export class DsrService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly viewer: ViewerService,
    private readonly settings: SettingsService,
    private readonly reports: ReportsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private static readonly SELECT = `SELECT r.id::text, r.kind, r.principal_kind, r.principal_id::text, r.channel, r.detail, r.status, r.received_on::text, r.due_on::text,
       (r.status IN ('received', 'in_progress') AND r.due_on < CURRENT_DATE) AS overdue, r.outcome, r.export_id::text, r.change_request_id::text, r.completed_at,
       rb.display_name AS requested_by, hb.display_name AS handled_by, e.status::text AS export_status,
       CASE r.principal_kind WHEN 'student' THEN (SELECT display_name FROM students WHERE id = r.principal_id)
                             WHEN 'guardian' THEN (SELECT display_name FROM guardians WHERE id = r.principal_id)
                             ELSE (SELECT display_name FROM employees WHERE id = r.principal_id) END AS principal
  FROM data_subject_requests r
  LEFT JOIN users rb ON rb.id = r.requested_by_user
  LEFT JOIN users hb ON hb.id = r.handled_by
  LEFT JOIN exports e ON e.id = r.export_id`;

  private toRow(x: Row): DsrRow {
    return {
      id: String(x.id),
      kind: String(x.kind),
      principalKind: String(x.principal_kind),
      principalId: String(x.principal_id),
      principal: (x.principal as string | null) ?? null,
      requestedBy: (x.requested_by as string | null) ?? null,
      channel: String(x.channel),
      detail: (x.detail as string | null) ?? null,
      status: String(x.status),
      receivedOn: String(x.received_on),
      dueOn: String(x.due_on),
      overdue: Boolean(x.overdue),
      handledBy: (x.handled_by as string | null) ?? null,
      outcome: (x.outcome as string | null) ?? null,
      exportId: (x.export_id as string | null) ?? null,
      exportStatus: (x.export_status as string | null) ?? null,
      changeRequestId: (x.change_request_id as string | null) ?? null,
      completedAt: iso(x.completed_at),
    };
  }

  private async dueDays(ctx: RequestContext): Promise<number> {
    const s = (await this.settings.current(requireTenant(ctx))).find(
      (x) => x.key === 'privacy.dsr_days',
    );
    const n = Number(s?.value ?? 30);
    return Number.isFinite(n) && n > 0 ? n : 30;
  }

  private async insert(
    ctx: RequestContext,
    c: PoolClient,
    v: {
      kind: string;
      principalKind: string;
      principalId: string;
      channel: string;
      detail: string | null;
      dueDays: number;
    },
  ): Promise<DsrRow> {
    const r = await c.query<{ id: string }>(
      `INSERT INTO data_subject_requests (school_id, kind, principal_kind, principal_id, requested_by_user, channel, detail, due_on, request_id)
       VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id(), $4, $5, CURRENT_DATE + $6::int, app.current_request_id()) RETURNING id::text`,
      [v.kind, v.principalKind, v.principalId, v.channel, v.detail, v.dueDays],
    );
    const id = r.rows[0]!.id;
    await this.audit.stage(ctx, c, {
      action: 'privacy.dsr.create',
      entityType: 'data_subject_requests',
      entityId: id,
      after: { kind: v.kind, principalKind: v.principalKind, principalId: v.principalId },
    });
    return (await this.one(c, id))!;
  }

  private async one(c: PoolClient, id: string): Promise<DsrRow | null> {
    // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
    const r = await c.query<Row>(`${DsrService.SELECT} WHERE r.id = $1`, [id]);
    return r.rows[0] ? this.toRow(r.rows[0]) : null;
  }

  // ---- family / staff self-service -----------------------------------------------------------------
  /** Which principal the caller is: a guardian or an employee, or one of the guardian's children. */
  private async selfPrincipal(
    ctx: RequestContext,
    studentId?: string,
  ): Promise<{ kind: 'student' | 'guardian' | 'employee'; id: string }> {
    const v = await this.viewer.resolve(ctx, 'engagement.family.view').catch(() => null);
    if (studentId) {
      if (!v || v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
        throw new DomainError('not-found', 'Student not found', { status: 404 });
      return { kind: 'student', id: studentId };
    }
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const g = await c.query<{ id: string }>(
        `SELECT id::text FROM guardians WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
      );
      if (g.rows[0]) return { kind: 'guardian' as const, id: g.rows[0].id };
      const e = await c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
      );
      if (e.rows[0]) return { kind: 'employee' as const, id: e.rows[0].id };
      const s = await c.query<{ id: string }>(
        `SELECT id::text FROM students WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
      );
      if (s.rows[0]) return { kind: 'student' as const, id: s.rows[0].id };
      throw new DomainError('not-found', 'No person record is linked to this sign-in', {
        status: 404,
      });
    });
  }

  async createMine(ctx: RequestContext, dto: MyDsrDto): Promise<DsrRow> {
    const principal = await this.selfPrincipal(ctx, dto.studentId);
    const dueDays = await this.dueDays(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const open = await c.query(
        `SELECT 1 FROM data_subject_requests WHERE kind = $1 AND principal_kind = $2 AND principal_id = $3 AND status IN ('received', 'in_progress')`,
        [dto.kind, principal.kind, principal.id],
      );
      if (open.rowCount)
        throw new DomainError('conflict', 'A request of this kind is already open', {
          status: 409,
        });
      return this.insert(ctx, c, {
        kind: dto.kind,
        principalKind: principal.kind,
        principalId: principal.id,
        channel: 'parent_app',
        detail: dto.detail,
        dueDays,
      });
    });
  }

  async mine(ctx: RequestContext): Promise<DsrRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        `${DsrService.SELECT} WHERE r.requested_by_user = app.current_user_id() ORDER BY r.created_at DESC LIMIT 50`,
      );
      return r.rows.map((x) => this.toRow(x));
    });
  }

  /** The family downloads the access report of its own request once the office completed it. */
  async myExport(ctx: RequestContext, id: string) {
    const row = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ export_id: string | null }>(
        `SELECT export_id::text FROM data_subject_requests WHERE id = $1 AND requested_by_user = app.current_user_id() AND status = 'completed'`,
        [id],
      );
      return r.rows[0] ?? null;
    });
    if (!row?.export_id)
      throw new DomainError('not-found', 'No report is available for this request', {
        status: 404,
      });
    return this.reports.status(ctx, row.export_id);
  }

  // ---- office ---------------------------------------------------------------------------------------
  async list(ctx: RequestContext, q: DsrListDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row & { total: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        `${DsrService.SELECT.replace('SELECT r.id::text', 'SELECT count(*) OVER () AS total, r.id::text')}
          WHERE ($1::text IS NULL OR r.status = $1) AND ($2::text IS NULL OR r.kind = $2)
          ORDER BY (r.status IN ('received', 'in_progress')) DESC, r.due_on, r.id LIMIT $3 OFFSET $4`,
        [q.status ?? null, q.kind ?? null, q.size, (q.page - 1) * q.size],
      );
      return {
        data: r.rows.map((x) => this.toRow(x)),
        page: { page: q.page, size: q.size, total: Number(r.rows[0]?.total ?? 0) },
      };
    });
  }

  async createOffice(ctx: RequestContext, dto: OfficeDsrDto): Promise<DsrRow> {
    const dueDays = await this.dueDays(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const table =
        dto.principalKind === 'student'
          ? 'students'
          : dto.principalKind === 'guardian'
            ? 'guardians'
            : 'employees';
      // eslint-disable-next-line no-restricted-syntax -- table name chosen from a fixed allow-list above
      const exists = await c.query(`SELECT 1 FROM ${table} WHERE id = $1 AND deleted_at IS NULL`, [
        dto.principalId,
      ]);
      if (!exists.rowCount) throw new DomainError('not-found', 'Person not found', { status: 404 });
      return this.insert(ctx, c, {
        kind: dto.kind,
        principalKind: dto.principalKind,
        principalId: dto.principalId,
        channel: dto.channel,
        detail: dto.detail ?? null,
        dueDays,
      });
    });
  }

  /**
   * Moves a request along. Completing an access request queues the access report (rendered by the
   * workers under the office user); completing an erasure needs `erase()` instead.
   */
  async setStatus(ctx: RequestContext, id: string, dto: DsrStatusDto): Promise<DsrRow> {
    const before = await this.db.tenant(requireTenant(ctx), (c) => this.one(c, id));
    if (!before) throw new DomainError('not-found', 'Request not found', { status: 404 });
    if (before.status === 'completed' || before.status === 'refused')
      throw new DomainError('conflict', 'The request is already closed', { status: 409 });
    if (before.kind === 'erasure' && dto.status === 'completed')
      throw new DomainError('conflict', 'Erasure completes through the erase action', {
        status: 409,
      });
    let exportId: string | null = null;
    if (before.kind === 'access' && dto.status === 'completed') {
      const exp = await this.reports.createRenderedForOwner(
        ctx,
        {
          dataset: 'dsr_access',
          format: 'pdf',
          params: { requestId: id },
          title: `Personal data report · ${before.principal ?? before.principalId}`,
        },
        'privacy.dsr.render',
      );
      exportId = exp.id;
    }
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `UPDATE data_subject_requests SET status = $2, outcome = COALESCE($3, outcome), handled_by = app.current_user_id(),
                export_id = COALESCE($4, export_id), change_request_id = COALESCE($5, change_request_id),
                completed_at = CASE WHEN $2 IN ('completed', 'refused') THEN now() ELSE completed_at END, updated_at = now()
          WHERE id = $1`,
        [id, dto.status, dto.outcome ?? null, exportId, dto.changeRequestId ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: `privacy.dsr.${dto.status}`,
        entityType: 'data_subject_requests',
        entityId: id,
        before: { status: before.status },
        after: { status: dto.status, outcome: dto.outcome ?? null, exportId },
      });
      return (await this.one(c, id))!;
    });
  }

  /** Erasure: the SECURITY DEFINER routine anonymises the person; refusals surface as 409 with the hint. */
  async erase(ctx: RequestContext, id: string, dto: EraseDto): Promise<DsrRow & { touched: Row }> {
    const req = await this.db.tenant(requireTenant(ctx), (c) => this.one(c, id));
    if (!req) throw new DomainError('not-found', 'Request not found', { status: 404 });
    if (req.kind !== 'erasure' || req.status === 'completed' || req.status === 'refused')
      throw new DomainError('conflict', 'Only an open erasure request can be erased', {
        status: 409,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let touched: Row;
      try {
        const r = await c.query<{ touched: Row }>(
          `SELECT app.erase_principal($1, $2::bigint, $3) AS touched`,
          [req.principalKind, req.principalId, dto.reason],
        );
        touched = r.rows[0]!.touched;
      } catch (error) {
        const e = error as { code?: string; message?: string; hint?: string };
        if (e.code === 'P0001')
          throw new DomainError(e.message ?? 'erasure-refused', e.hint ?? 'Erasure refused', {
            status: 409,
          });
        throw error;
      }
      await c.query(
        `UPDATE data_subject_requests SET status = 'completed', outcome = $2, handled_by = app.current_user_id(), completed_at = now(), updated_at = now() WHERE id = $1`,
        [id, `Erased: ${dto.reason}`],
      );
      await this.audit.stage(ctx, c, {
        action: 'privacy.dsr.erase',
        entityType:
          req.principalKind === 'student'
            ? 'students'
            : req.principalKind === 'guardian'
              ? 'guardians'
              : 'employees',
        entityId: req.principalId,
        after: { requestId: id, reason: dto.reason, touched },
      });
      return { ...(await this.one(c, id))!, touched };
    });
  }

  // ---- retention runs -------------------------------------------------------------------------------
  async retentionRuns(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        policy: string;
        keep_days: number;
        affected: number;
        ran_at: Date;
      }>(
        `SELECT DISTINCT ON (policy) policy, keep_days, affected, ran_at FROM retention_runs ORDER BY policy, ran_at DESC`,
      );
      const totals = await c.query<{ policy: string; total: string }>(
        `SELECT policy, sum(affected)::text AS total FROM retention_runs WHERE ran_at >= now() - interval '30 days' GROUP BY policy`,
      );
      const byPolicy = new Map(totals.rows.map((t) => [t.policy, Number(t.total)]));
      return r.rows.map((x) => ({
        policy: x.policy,
        keepDays: x.keep_days,
        lastAffected: x.affected,
        lastRunAt: x.ran_at.toISOString(),
        last30Days: byPolicy.get(x.policy) ?? 0,
      }));
    });
  }

  // ---- breach log -----------------------------------------------------------------------------------
  private static readonly BREACH = `SELECT b.id::text, b.title, b.detected_at, b.description, b.data_classes, b.principals_affected, b.status,
       b.board_notified_at, b.principals_notified_at, b.actions, b.closed_at, b.created_at, rb.display_name AS reported_by, ow.display_name AS owner
  FROM breach_log b LEFT JOIN users rb ON rb.id = b.reported_by LEFT JOIN users ow ON ow.id = b.owner`;

  private toBreach(x: Row) {
    return {
      id: String(x.id),
      title: String(x.title),
      detectedAt: iso(x.detected_at)!,
      description: String(x.description),
      dataClasses: (x.data_classes as string[]) ?? [],
      principalsAffected: Number(x.principals_affected),
      status: String(x.status),
      boardNotifiedAt: iso(x.board_notified_at),
      principalsNotifiedAt: iso(x.principals_notified_at),
      actions: (x.actions as string | null) ?? null,
      closedAt: iso(x.closed_at),
      createdAt: iso(x.created_at)!,
      reportedBy: (x.reported_by as string | null) ?? null,
      owner: (x.owner as string | null) ?? null,
      /** hours since detection until the Board notice went out (or until now while open) */
      hoursToBoardNotice: Math.round(
        ((x.board_notified_at ? new Date(x.board_notified_at as string).getTime() : Date.now()) -
          new Date(x.detected_at as string).getTime()) /
          36e5,
      ),
    };
  }

  async breaches(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Row>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        `${DsrService.BREACH} ORDER BY (b.status <> 'closed') DESC, b.detected_at DESC LIMIT 200`,
      );
      return r.rows.map((x) => this.toBreach(x));
    });
  }

  async recordBreach(ctx: RequestContext, dto: BreachDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO breach_log (school_id, title, detected_at, reported_by, description, data_classes, principals_affected, owner, request_id)
         VALUES (app.current_school_id(), $1, $2::timestamptz, app.current_user_id(), $3, $4::text[], $5, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
        [dto.title, dto.detectedAt, dto.description, dto.dataClasses, dto.principalsAffected],
      );
      const id = r.rows[0]!.id;
      await this.audit.stage(ctx, c, {
        action: 'privacy.breach.record',
        entityType: 'breach_log',
        entityId: id,
        after: { title: dto.title, detectedAt: dto.detectedAt },
      });
      // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
      const row = await c.query<Row>(`${DsrService.BREACH} WHERE b.id = $1`, [id]);
      return this.toBreach(row.rows[0]!);
    });
  }

  async updateBreach(ctx: RequestContext, id: string, dto: BreachUpdateDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE breach_log SET status = COALESCE($2, status), actions = COALESCE($3, actions),
                principals_affected = COALESCE($4, principals_affected),
                board_notified_at = CASE WHEN $5::boolean THEN COALESCE(board_notified_at, now()) ELSE board_notified_at END,
                principals_notified_at = CASE WHEN $6::boolean THEN COALESCE(principals_notified_at, now()) ELSE principals_notified_at END,
                closed_at = CASE WHEN $2 = 'closed' THEN COALESCE(closed_at, now()) ELSE closed_at END,
                owner = app.current_user_id(), updated_at = now()
          WHERE id = $1`,
        [
          id,
          dto.status ?? null,
          dto.actions ?? null,
          dto.principalsAffected ?? null,
          dto.boardNotified ?? false,
          dto.principalsNotified ?? false,
        ],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Breach not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'privacy.breach.update',
        entityType: 'breach_log',
        entityId: id,
        after: dto as Row,
      });
      // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
      const row = await c.query<Row>(`${DsrService.BREACH} WHERE b.id = $1`, [id]);
      return this.toBreach(row.rows[0]!);
    });
  }

  /** The parent-app link families see in the access report footer. */
  parentAppUrl(): string {
    return this.env.PARENT_APP_URL;
  }
}
