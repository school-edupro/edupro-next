import { Injectable } from '@nestjs/common';
import {
  QUEUES,
  datasetOrNull,
  rendererOrNull,
  type PoolClient,
  type TenantContext,
} from '@edupro/db';
import { ScopePolicy } from '../../common/access/scope.policy';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { OutboxService } from '../../common/jobs/outbox.service';
import { FilesService } from '../files/files.service';
import type { CreateExportDto, ExportFormat, ListExportsQueryDto } from './reports.dto';

export type ExportStatus = 'queued' | 'running' | 'ready' | 'failed' | 'expired';

export interface ExportRow {
  id: string;
  dataset: string;
  format: ExportFormat;
  title: string;
  params: Record<string, unknown>;
  status: ExportStatus;
  fileId: string | null;
  rowCount: number | null;
  error: string | null;
  requestedBy: string | null;
  requestedByName: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string;
  downloadCount: number;
}

interface ExportDbRow {
  id: string;
  dataset: string;
  format: ExportFormat;
  title: string;
  params: Record<string, unknown>;
  status: ExportStatus;
  file_id: string | null;
  row_count: number | null;
  error: string | null;
  requested_by: string | null;
  requested_by_name: string | null;
  requested_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  expires_at: Date;
  download_count: number;
}

const SELECT = `SELECT e.id::text, e.dataset, e.format, e.title, e.params, e.status, e.file_id::text, e.row_count, e.error,
         e.requested_by::text, u.display_name AS requested_by_name, e.requested_at, e.started_at, e.finished_at, e.expires_at, e.download_count
    FROM exports e LEFT JOIN users u ON u.id = e.requested_by`;

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);
const toRow = (x: ExportDbRow): ExportRow => ({
  id: x.id,
  dataset: x.dataset,
  format: x.format,
  title: x.title,
  params: x.params,
  status: x.status,
  fileId: x.file_id,
  rowCount: x.row_count,
  error: x.error,
  requestedBy: x.requested_by,
  requestedByName: x.requested_by_name,
  requestedAt: x.requested_at.toISOString(),
  startedAt: iso(x.started_at),
  finishedAt: iso(x.finished_at),
  expiresAt: x.expires_at.toISOString(),
  downloadCount: x.download_count,
});

/**
 * Export requests (S3-03). The API checks the dataset permission and narrows the parameters to the
 * caller's data scopes; the worker generates the file under the same tenant context.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DbService,
    private readonly outbox: OutboxService,
    private readonly scopes: ScopePolicy,
    private readonly files: FilesService,
    private readonly audit: AuditService,
  ) {}

  /** Permission and scope narrowing shared by exports and live rows. */
  private async prepare(ctx: RequestContext, datasetId: string, input: Record<string, unknown>) {
    const tenant = requireTenant(ctx);
    const dataset = datasetOrNull(datasetId);
    if (!dataset) throw new DomainError('not-found', 'Unknown dataset');
    if (!ctx.permissions?.has(dataset.permission)) {
      throw new DomainError(
        'permission-denied',
        `Exporting ${dataset.title} requires ${dataset.permission}`,
        {
          status: 403,
          extra: { permission: dataset.permission },
        },
      );
    }
    const params: Record<string, unknown> = { ...input };
    if (dataset.scope === 'class_section') {
      const allowed = await this.scopes.filter(tenant, dataset.permission, 'class_section');
      if (allowed !== null) {
        const requested = Array.isArray(params.sectionIds) ? params.sectionIds.map(String) : null;
        params.sectionIds = requested ? requested.filter((id) => allowed.includes(id)) : allowed;
        if ((params.sectionIds as string[]).length === 0) params.sectionIds = ['-1'];
      }
    }
    if (params.academicYearId === undefined && tenant.academicYearId)
      params.academicYearId = tenant.academicYearId;
    return { tenant, dataset, params };
  }

  /** Sprint 15: run a dataset live for a screen, capped; the same definition the export renders. */
  async rows(
    ctx: RequestContext,
    datasetId: string,
    input: Record<string, unknown>,
    limit: number,
  ) {
    const { tenant, dataset, params } = await this.prepare(ctx, datasetId, input);
    const cap = Math.min(limit, dataset.maxRows);
    const q = dataset.query(params);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- the dataset text is a constant of the registry; values are bound
        `${q.text} LIMIT ${String(cap + 1)}`,
        q.values,
      );
      // DATE columns arrive as local-midnight Date objects; hand the screen plain YYYY-MM-DD strings
      const dateKeys = dataset.columns.filter((c) => c.type === 'date').map((c) => c.key);
      const rows = r.rows.slice(0, cap).map((row) => {
        for (const k of dateKeys) {
          const v = row[k];
          if (v instanceof Date)
            row[k] =
              `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
        }
        return row;
      });
      return {
        dataset: dataset.id,
        title: dataset.title,
        columns: dataset.columns,
        params,
        rows,
        truncated: r.rows.length > cap,
      };
    });
  }

  async create(
    ctx: RequestContext,
    dto: CreateExportDto,
    auditAction = 'reports.export.create',
  ): Promise<ExportRow> {
    const renderer = rendererOrNull(dto.dataset);
    if (renderer) return this.createRendered(ctx, dto, renderer.id, auditAction);
    const { tenant, dataset, params } = await this.prepare(ctx, dto.dataset, dto.params);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO exports (school_id, dataset, format, params, title, requested_by, request_id)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [dataset.id, dto.format, JSON.stringify(params), dto.title ?? dataset.title],
      );
      const id = r.rows[0]!.id;
      await this.outbox.enqueue(c, ctx, QUEUES.exports, 'export.generate', { exportId: id });
      const row = await this.get(tenant, id, c);
      await this.audit.stage(ctx, c, {
        action: auditAction,
        entityType: 'exports',
        entityId: id,
        after: { id, dataset: row.dataset, format: row.format, params: row.params },
      });
      return row;
    });
  }

  /** Document renderers (ID cards, later receipts and report cards): always PDF, parameters name the entity. */
  /**
   * Sprint 14: a rendered export the caller owns (a family's own receipt). The ownership check is the
   * caller's; the renderer permission is not required because the document is theirs by construction.
   */
  async createRenderedForOwner(
    ctx: RequestContext,
    dto: CreateExportDto,
    auditAction: string,
  ): Promise<ExportRow> {
    const renderer = rendererOrNull(dto.dataset);
    if (!renderer) throw new DomainError('not-found', 'Unknown renderer');
    return this.createRendered(ctx, dto, renderer.id, auditAction, true);
  }

  private async createRendered(
    ctx: RequestContext,
    dto: CreateExportDto,
    rendererId: string,
    auditAction: string,
    owned = false,
  ): Promise<ExportRow> {
    const tenant = requireTenant(ctx);
    const renderer = rendererOrNull(rendererId)!;
    if (!owned && !ctx.permissions?.has(renderer.permission)) {
      throw new DomainError(
        'permission-denied',
        `${renderer.title} requires ${renderer.permission}`,
        {
          status: 403,
          extra: { permission: renderer.permission },
        },
      );
    }
    for (const key of renderer.requiredParams) {
      // ids are numeric strings; other required parameters (such as the document entity) are short slugs
      const pattern = key.endsWith('Id') ? /^[0-9]{1,18}$/ : /^[a-z_]{1,40}$/;
      if (!pattern.test(String(dto.params[key] ?? ''))) {
        throw new DomainError('validation-failed', `${key} is required for ${renderer.title}`, {
          status: 400,
        });
      }
    }
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO exports (school_id, dataset, format, params, title, requested_by, request_id)
         VALUES (app.current_school_id(), $1, 'pdf', $2::jsonb, $3, app.current_user_id(), app.current_request_id())
         RETURNING id::text`,
        [renderer.id, JSON.stringify(dto.params), dto.title ?? renderer.title],
      );
      const id = r.rows[0]!.id;
      await this.outbox.enqueue(c, ctx, QUEUES.exports, 'export.generate', { exportId: id });
      const row = await this.get(tenant, id, c);
      await this.audit.stage(ctx, c, {
        action: auditAction,
        entityType: 'exports',
        entityId: id,
        after: { id, dataset: row.dataset, format: row.format, params: row.params },
      });
      return row;
    });
  }

  list(
    tenant: TenantContext,
    q: ListExportsQueryDto,
    mineOnly = false,
  ): Promise<{ rows: ExportRow[]; total: number }> {
    return this.db.tenant(tenant, async (c) => {
      const where =
        ' WHERE ($1::export_status IS NULL OR e.status = $1::export_status)' +
        ' AND ($2::boolean = false OR e.requested_by = app.current_user_id())';
      const params: unknown[] = [q.status ?? null, q.mine === 'true' || mineOnly];
      const total = await c.query<{ n: string }>(
        'SELECT count(*)::text AS n FROM exports e' + where,
        params,
      );
      const r = await c.query<ExportDbRow>(
        SELECT + where + ' ORDER BY e.requested_at DESC LIMIT $3 OFFSET $4',
        [...params, q.size, (q.page - 1) * q.size],
      );
      return { rows: r.rows.map(toRow), total: Number(total.rows[0]?.n ?? 0) };
    });
  }

  async get(tenant: TenantContext, id: string, client?: PoolClient): Promise<ExportRow> {
    const run = async (c: PoolClient) => {
      const r = await c.query<ExportDbRow>(SELECT + ' WHERE e.id = $1', [id]);
      if (!r.rows[0]) throw new DomainError('not-found', 'Export not found');
      return toRow(r.rows[0]);
    };
    return client ? run(client) : this.db.tenant(tenant, run);
  }

  /** Status plus a signed download URL once the file is ready. Each URL issue counts as a download. */
  async status(ctx: RequestContext, id: string) {
    const tenant = requireTenant(ctx);
    const row = await this.get(tenant, id);
    if (row.status !== 'ready' || !row.fileId) return { export: row, download: null };
    const { download } = await this.files.downloadUrl(ctx, row.fileId);
    await this.db.tenant(tenant, (c) =>
      c.query('UPDATE exports SET download_count = download_count + 1 WHERE id = $1', [id]),
    );
    return { export: row, download };
  }
}
