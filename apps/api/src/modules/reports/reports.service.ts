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
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
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
    // parameters are data: no control characters, and date-named keys must look like dates
    for (const [k, v] of Object.entries(params)) {
      if (typeof v === 'string' && /[\u0000-\u001f]/.test(v))
        throw new DomainError('validation-failed', `Parameter ${k} carries control characters`, {
          status: 400,
        });
      if (
        typeof v === 'string' &&
        /^(from|to|asOf|date|onDate)$/.test(k) &&
        v !== '' &&
        !/^\d{4}-\d{2}-\d{2}$/.test(v)
      )
        throw new DomainError('validation-failed', `Parameter ${k} must be YYYY-MM-DD`, {
          status: 400,
        });
    }
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

  /**
   * A list report made at once and handed back, with no background worker: the same dataset, the same
   * rights and the same parameters as a queued export. Excel and PDF carry the school's head; CSV is
   * the bare table. Rendered documents and the Tally XML still go through the queue.
   */
  async instant(ctx: RequestContext, dto: CreateExportDto) {
    if (rendererOrNull(dto.dataset) || !['xlsx', 'csv', 'pdf'].includes(dto.format))
      throw new DomainError(
        'reports.not_instant',
        'This export is prepared in the background: find it under Reports → Export centre',
        { status: 409 },
      );
    const { tenant, dataset, params } = await this.prepare(ctx, dto.dataset, dto.params);
    const year = typeof params.academicYearId === 'string' ? params.academicYearId : null;
    const query = dataset.query(params);
    const limit = Math.min(dataset.maxRows, 50_000);
    const { rows, head } = await this.db.tenant(
      { ...tenant, academicYearId: year ?? tenant.academicYearId },
      async (c) => {
        const r = await c.query<Record<string, unknown>>(
          // eslint-disable-next-line no-restricted-syntax -- the text is the dataset's own fixed query; the limit is a number computed here
          `${query.text} LIMIT ${String(limit)}`,
          query.values,
        );
        await this.audit.stage(ctx, c, {
          action: 'reports.export.instant',
          entityType: 'exports',
          entityId: dataset.id,
          after: { dataset: dataset.id, format: dto.format, params, rows: r.rows.length },
        });
        return { rows: r.rows, head: await schoolHead(c) };
      },
    );
    const title = dto.title ?? dataset.title;
    const slug =
      title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'report';
    const ist = (v: unknown, time: boolean) => {
      const d = v instanceof Date ? v : new Date(String(v));
      if (Number.isNaN(d.getTime())) return String(v);
      // a plain date is a calendar day already; a moment is shown in Indian time
      if (!time && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v))
        return v.split('-').reverse().join('/');
      return d.toLocaleString('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        ...(time ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
      });
    };
    const cell = (v: unknown, type: string | undefined): string | number => {
      if (v === null || v === undefined) return '';
      if (type === 'number') return Number.isFinite(Number(v)) ? Number(v) : String(v);
      if (type === 'date') return ist(v, false);
      if (type === 'datetime') return ist(v, true);
      if (type === 'json' || typeof v === 'object')
        return v instanceof Date ? ist(v, true) : JSON.stringify(v);
      return String(v);
    };
    if (dto.format === 'csv') {
      const esc = (x: string | number) => {
        const t = String(x);
        return /[",\n\r]/.test(t) ? `"${t.replaceAll('"', '""')}"` : t;
      };
      const lines = [
        dataset.columns.map((c) => esc(c.header)).join(','),
        ...rows.map((r) => dataset.columns.map((c) => esc(cell(r[c.key], c.type))).join(',')),
      ];
      // the mark at the start lets Excel on Windows open Devanagari correctly
      return {
        filename: `${slug}.csv`,
        contentType: 'text/csv; charset=utf-8',
        bytes: Buffer.from(`\uFEFF${lines.join('\r\n')}\r\n`, 'utf8'),
      };
    }
    const said = Object.entries(params)
      .filter(([k, v]) => typeof v === 'string' && v !== '' && k !== 'academicYearId')
      .map(
        ([k, v]) =>
          `${k}: ${/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v).split('-').reverse().join('/') : String(v)}`,
      );
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: title,
        details: [[...said, `${String(rows.length)} row(s)`].join(' · '), generatedOn()],
        legend: rows.length >= limit ? `Only the first ${String(limit)} rows are shown.` : '',
        columns: dataset.columns.map((c) => ({
          label: c.header,
          width: c.width ?? 16,
          right: c.type === 'number',
        })),
        rows: rows.map((r) => dataset.columns.map((c) => cell(r[c.key], c.type))),
        filename: slug,
      },
      dto.format as 'xlsx' | 'pdf',
    );
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
    // a builder report run with full ID numbers opens only for its requester or a sensitive-data viewer
    if (
      (row.dataset === 'report_builder' || row.dataset === 'student_profile') &&
      (row.params as { showSensitive?: boolean }).showSensitive &&
      row.requestedBy !== (tenant.userId ?? null) &&
      !ctx.permissions?.has('people.sensitive.view')
    )
      throw new DomainError('not-found', 'Export not found');
    if (row.status !== 'ready' || !row.fileId) return { export: row, download: null };
    const { download } = await this.files.downloadUrl(ctx, row.fileId);
    await this.db.tenant(tenant, (c) =>
      c.query('UPDATE exports SET download_count = download_count + 1 WHERE id = $1', [id]),
    );
    return { export: row, download };
  }
}
