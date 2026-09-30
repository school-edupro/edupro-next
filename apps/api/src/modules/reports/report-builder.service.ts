import { Injectable } from '@nestjs/common';
import {
  PDF_COLUMN_LIMIT,
  QUEUES,
  REPORT_FILTER_OPS,
  REPORT_SECTIONS,
  STUDENT_REPORT_FIELDS,
  loadProfileLists,
  loadStudentReportRows,
  shapeReport,
  validateReportSpec,
  type PoolClient,
  type ReportSpec,
  type TenantContext,
} from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import type {
  ExportReportDto,
  PreviewReportDto,
  SaveReportDto,
  ShareReportDto,
} from './report-builder.dto';

export const BUILDER = {
  use: 'reports.builder.use',
  manage: 'reports.builder.manage',
  studentView: 'people.student.view',
  sensitiveView: 'people.sensitive.view',
} as const;

export interface ReportDefinitionRow {
  id: string;
  name: string;
  description: string | null;
  dataset: string;
  spec: ReportSpec;
  ownerId: string;
  ownerName: string | null;
  isOwner: boolean;
  canEdit: boolean;
  canShare: boolean;
  sharedWithMe: boolean;
  shares: Array<{ userId: string | null; roleId: string | null; name: string; canEdit: boolean }>;
  lastRunAt: string | null;
  updatedAt: string;
}

interface DefDbRow {
  id: string;
  name: string;
  description: string | null;
  dataset: string;
  spec: ReportSpec;
  owner_id: string;
  owner_name: string | null;
  last_run_at: Date | null;
  updated_at: Date;
  share_edit: boolean | null;
  share_any: boolean | null;
}

const invalid = (messages: string[]) =>
  new DomainError('validation-failed', messages.join('; '), {
    status: 400,
    extra: { errors: messages },
  });

/**
 * Saved and shared student reports: definitions, access (owner, shared user or role, or manager),
 * live preview and branded Excel / PDF exports through the export pipeline.
 */
@Injectable()
export class ReportBuilderService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly scopes: ScopePolicy,
    private readonly audit: AuditService,
  ) {}

  private me(ctx: RequestContext): string {
    const u = requireTenant(ctx).userId;
    if (!u) throw new DomainError('permission-denied', 'Sign in first', { status: 403 });
    return u;
  }
  private manager(ctx: RequestContext) {
    return ctx.permissions?.has(BUILDER.manage) ?? false;
  }

  /** Columns and filters the builder offers, with drop-down options for filter values. */
  async fields(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const showSensitive = ctx.permissions?.has(BUILDER.sensitiveView) ?? false;
    return this.db.tenant(tenant, async (c) => {
      const lists = await loadProfileLists(c);
      const sections = await c.query<{ label: string }>(
        `SELECT c.code || '-' || cs.name AS label FROM class_sections cs JOIN classes c ON c.id = cs.class_id
          WHERE cs.academic_year_id = $1 AND cs.deleted_at IS NULL ORDER BY c.code, cs.name`,
        [tenant.academicYearId ?? null],
      );
      const years = await c.query<{ id: string; code: string; status: string }>(
        `SELECT id::text, code, status::text FROM academic_years ORDER BY start_date DESC`,
      );
      return {
        sections: REPORT_SECTIONS,
        fields: STUDENT_REPORT_FIELDS.map((f) => ({
          ...f,
          options:
            f.key === 'class_section'
              ? sections.rows.map((s) => s.label)
              : f.key === 'student_status'
                ? ['Active', 'Inactive']
                : f.list
                  ? (lists[f.list] ?? null)
                  : null,
          masked: Boolean(f.sensitive) && !showSensitive,
        })),
        ops: REPORT_FILTER_OPS,
        pdfColumnLimit: PDF_COLUMN_LIMIT,
        years: years.rows,
        canManage: this.manager(ctx),
      };
    });
  }

  private async myRoleIds(c: PoolClient, userId: string): Promise<string[]> {
    const r = await c.query<{ id: string }>(
      `SELECT DISTINCT role_id::text AS id FROM user_roles
        WHERE user_id = $1 AND revoked_at IS NULL AND valid_from <= CURRENT_DATE
          AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)`,
      [userId],
    );
    return r.rows.map((x) => x.id);
  }

  private async rows(c: PoolClient, ctx: RequestContext, id?: string): Promise<DefDbRow[]> {
    const me = this.me(ctx);
    const roles = await this.myRoleIds(c, me);
    const r = await c.query<DefDbRow>(
      `SELECT d.id::text, d.name, d.description, d.dataset, d.spec, d.owner_id::text, u.display_name AS owner_name,
              d.last_run_at, d.updated_at,
              bool_or(s.can_edit) AS share_edit, bool_or(s.id IS NOT NULL) AS share_any
         FROM report_definitions d
         LEFT JOIN users u ON u.id = d.owner_id
         LEFT JOIN report_shares s ON s.report_id = d.id
              AND (s.user_id = $1 OR s.role_id = ANY($2::bigint[]))
        WHERE d.status = 'active' AND ($3::bigint IS NULL OR d.id = $3::bigint)
        GROUP BY d.id, u.display_name
       HAVING d.owner_id = $1 OR bool_or(s.id IS NOT NULL) OR $4::boolean
        ORDER BY d.updated_at DESC`,
      [me, roles, id ?? null, this.manager(ctx)],
    );
    return r.rows;
  }

  private async sharesOf(c: PoolClient, id: string) {
    const r = await c.query<{
      user_id: string | null;
      role_id: string | null;
      name: string;
      can_edit: boolean;
    }>(
      `SELECT s.user_id::text, s.role_id::text, COALESCE(u.display_name, ro.name, '') AS name, s.can_edit
         FROM report_shares s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN roles ro ON ro.id = s.role_id
        WHERE s.report_id = $1 ORDER BY 3`,
      [id],
    );
    return r.rows.map((x) => ({
      userId: x.user_id,
      roleId: x.role_id,
      name: x.name,
      canEdit: x.can_edit,
    }));
  }

  private toRow(
    ctx: RequestContext,
    x: DefDbRow,
    shares: ReportDefinitionRow['shares'],
  ): ReportDefinitionRow {
    const me = this.me(ctx);
    const isOwner = x.owner_id === me;
    return {
      id: x.id,
      name: x.name,
      description: x.description,
      dataset: x.dataset,
      spec: x.spec,
      ownerId: x.owner_id,
      ownerName: x.owner_name,
      isOwner,
      canEdit: isOwner || this.manager(ctx) || Boolean(x.share_edit),
      canShare: isOwner || this.manager(ctx),
      sharedWithMe: !isOwner && Boolean(x.share_any),
      shares,
      lastRunAt: x.last_run_at?.toISOString() ?? null,
      updatedAt: x.updated_at.toISOString(),
    };
  }

  async list(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const rows = await this.rows(c, ctx);
      const out = rows.map((x) => this.toRow(ctx, x, []));
      return {
        mine: out.filter((x) => x.isOwner),
        shared: out.filter((x) => x.sharedWithMe),
        others: out.filter((x) => !x.isOwner && !x.sharedWithMe),
      };
    });
  }

  private async load(c: PoolClient, ctx: RequestContext, id: string): Promise<ReportDefinitionRow> {
    const x = (await this.rows(c, ctx, id))[0];
    if (!x) throw new DomainError('not-found', 'Report not found');
    const row = this.toRow(ctx, x, []);
    row.shares = row.canShare ? await this.sharesOf(c, id) : [];
    return row;
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.load(c, ctx, id));
  }

  private check(spec: ReportSpec) {
    const errors = validateReportSpec(spec);
    if (errors.length) throw invalid(errors);
  }

  async create(ctx: RequestContext, dto: SaveReportDto) {
    this.check(dto.spec as ReportSpec);
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO report_definitions (school_id, name, description, spec, owner_id, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3::jsonb, app.current_user_id(), app.current_user_id(), app.current_user_id())
           RETURNING id::text`,
          [dto.name, dto.description ?? null, JSON.stringify(dto.spec)],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `You already have a report named "${dto.name}"`);
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'reports.builder.create',
        entityType: 'report_definitions',
        entityId: id,
        after: {
          name: dto.name,
          columns: dto.spec.columns.length,
          filters: dto.spec.filters.length,
        },
      });
      return this.load(c, ctx, id);
    });
  }

  async update(ctx: RequestContext, id: string, dto: SaveReportDto) {
    this.check(dto.spec as ReportSpec);
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.load(c, ctx, id);
      if (!before.canEdit)
        throw new DomainError('permission-denied', 'This report is shared with you as view only', {
          status: 403,
        });
      try {
        await c.query(
          `UPDATE report_definitions SET name = $2, description = $3, spec = $4::jsonb, updated_at = now(),
                  updated_by = app.current_user_id() WHERE id = $1`,
          [id, dto.name, dto.description ?? null, JSON.stringify(dto.spec)],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `The owner already has a report named "${dto.name}"`);
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'reports.builder.update',
        entityType: 'report_definitions',
        entityId: id,
        before: { name: before.name, spec: before.spec },
        after: { name: dto.name, spec: dto.spec },
      });
      return this.load(c, ctx, id);
    });
  }

  /** Save as: a copy owned by the caller (works for reports shared as view only too). */
  async copy(ctx: RequestContext, id: string, name?: string) {
    const src = await this.get(ctx, id);
    return this.create(ctx, {
      name: (name ?? `${src.name} (copy)`).slice(0, 120),
      description: src.description,
      spec: src.spec,
    } as SaveReportDto);
  }

  async remove(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.load(c, ctx, id);
      if (!before.canShare)
        throw new DomainError('permission-denied', 'Only the owner can delete this report', {
          status: 403,
        });
      await c.query(
        `UPDATE report_definitions SET status = 'inactive', updated_at = now(), updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'reports.builder.delete',
        entityType: 'report_definitions',
        entityId: id,
        before: { name: before.name },
      });
      return { deleted: true };
    });
  }

  /** Replaces the share list: named users and roles, each view only or can edit. */
  async share(ctx: RequestContext, id: string, dto: ShareReportDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.load(c, ctx, id);
      if (!before.canShare)
        throw new DomainError('permission-denied', 'Only the owner can share this report', {
          status: 403,
        });
      const userIds = dto.shares.filter((s) => s.userId).map((s) => s.userId!);
      if (userIds.length) {
        const ok = await c.query<{ id: string }>(
          `SELECT user_id::text AS id FROM user_school_memberships WHERE user_id = ANY($1::bigint[])`,
          [userIds],
        );
        const known = new Set(ok.rows.map((x) => x.id));
        const unknown = userIds.filter((u) => !known.has(u));
        if (unknown.length)
          throw invalid([`Not a member of this school: user ${unknown.join(', ')}`]);
      }
      const roleIds = dto.shares.filter((s) => s.roleId).map((s) => s.roleId!);
      if (roleIds.length) {
        const ok = await c.query<{ id: string }>(
          `SELECT id::text FROM roles WHERE id = ANY($1::bigint[]) AND (school_id IS NULL OR school_id = app.current_school_id())
             AND status = 'active' AND deleted_at IS NULL`,
          [roleIds],
        );
        if (ok.rows.length !== new Set(roleIds).size)
          throw invalid(['Unknown role in the share list']);
      }
      await c.query('DELETE FROM report_shares WHERE report_id = $1', [id]);
      for (const s of dto.shares)
        await c.query(
          `INSERT INTO report_shares (school_id, report_id, user_id, role_id, can_edit, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, app.current_user_id())
           ON CONFLICT DO NOTHING`,
          [id, s.userId ?? null, s.roleId ?? null, s.canEdit],
        );
      const after = await this.load(c, ctx, id);
      await this.audit.stage(ctx, c, {
        action: 'reports.builder.share',
        entityType: 'report_definitions',
        entityId: id,
        before: { shares: before.shares },
        after: { shares: after.shares },
      });
      return after;
    });
  }

  /** Users and roles the owner can share with. */
  async shareOptions(ctx: RequestContext, q?: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const users = await c.query<{ id: string; name: string; detail: string | null }>(
        `SELECT u.id::text, u.display_name AS name, COALESCE(u.email::text, u.mobile) AS detail
           FROM user_school_memberships m JOIN users u ON u.id = m.user_id
          WHERE m.person_type::text IN ('employee', 'staff') AND u.id <> app.current_user_id()
            AND ($1::text IS NULL OR u.display_name ILIKE '%' || $1 || '%' OR u.email::text ILIKE '%' || $1 || '%')
          ORDER BY u.display_name LIMIT 50`,
        [q && q.length >= 2 ? q : null],
      );
      const roles = await c.query<{ id: string; name: string; code: string }>(
        `SELECT id::text, name, code FROM roles
          WHERE (school_id IS NULL OR school_id = app.current_school_id()) AND status = 'active' AND deleted_at IS NULL
            AND code NOT IN ('parent', 'student')
          ORDER BY name`,
      );
      return { users: users.rows, roles: roles.rows };
    });
  }

  /** Year, section scope and ID-number visibility for the caller. */
  private async context(
    ctx: RequestContext,
    c: PoolClient,
    tenant: TenantContext,
    spec: ReportSpec,
  ) {
    if (!ctx.permissions?.has(BUILDER.studentView))
      throw new DomainError(
        'permission-denied',
        'Running student reports needs people.student.view',
        { status: 403 },
      );
    const yearId = spec.options.academicYearId ?? tenant.academicYearId ?? null;
    if (!yearId) throw invalid(['Choose an academic year']);
    const y = await c.query<{ code: string }>('SELECT code FROM academic_years WHERE id = $1', [
      yearId,
    ]);
    if (!y.rows[0]) throw invalid(['Unknown academic year']);
    const sectionIds = await this.scopes.filter(tenant, BUILDER.studentView, 'class_section');
    return {
      academicYearId: yearId,
      academicYear: y.rows[0].code,
      sectionIds,
      showSensitive: ctx.permissions?.has(BUILDER.sensitiveView) ?? false,
    };
  }

  /** Live preview of an unsaved or saved spec: the first rows and the total. */
  async preview(ctx: RequestContext, dto: PreviewReportDto) {
    const spec = dto.spec as ReportSpec;
    this.check(spec);
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const run = await this.context(ctx, c, tenant, spec);
      const loaded = await loadStudentReportRows(c, {
        academicYearId: run.academicYearId,
        sectionIds: run.sectionIds,
        includeInactive: spec.options.includeInactive ?? false,
        showSensitive: run.showSensitive,
      });
      const shaped = shapeReport(loaded, spec);
      return {
        columns: shaped.columns,
        rows: shaped.rows.slice(0, dto.limit),
        total: shaped.total,
        filtersText: shaped.filtersText,
        academicYear: run.academicYear,
      };
    });
  }

  /** Queues a branded Excel or PDF of a saved report through the export pipeline. */
  async export(ctx: RequestContext, id: string, dto: ExportReportDto) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const def = await this.load(c, ctx, id);
      const errors = validateReportSpec(def.spec, dto.format);
      if (errors.length) throw invalid(errors);
      const run = await this.context(ctx, c, tenant, def.spec);
      const params = {
        definitionId: id,
        name: def.name,
        description: def.description,
        spec: def.spec,
        academicYearId: run.academicYearId,
        academicYear: run.academicYear,
        sectionIds: run.sectionIds,
        showSensitive: run.showSensitive,
      };
      const r = await c.query<{ id: string }>(
        `INSERT INTO exports (school_id, dataset, format, params, title, requested_by, request_id)
         VALUES (app.current_school_id(), 'report_builder', $1, $2::jsonb, $3, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [dto.format, JSON.stringify(params), def.name],
      );
      const exportId = r.rows[0]!.id;
      await this.outbox.enqueue(c, ctx, QUEUES.exports, 'export.generate', { exportId });
      await c.query('UPDATE report_definitions SET last_run_at = now() WHERE id = $1', [id]);
      await this.audit.stage(ctx, c, {
        action: 'reports.builder.export',
        entityType: 'exports',
        entityId: exportId,
        after: { report: id, name: def.name, format: dto.format, fullIds: run.showSensitive },
      });
      return { exportId, format: dto.format };
    });
  }
}
