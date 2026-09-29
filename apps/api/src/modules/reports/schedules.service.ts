import { Injectable } from '@nestjs/common';
import { datasetOrNull, isValidCron, nextCronRun, rendererOrNull } from '@edupro/db';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ReportsService } from './reports.service';

export const SCHEDULES = { manage: 'reports.schedule.manage' } as const;

export const ScheduleSchema = z.object({
  name: z.string().trim().min(2).max(120),
  dataset: z.string().trim().max(60),
  format: z.enum(['xlsx', 'csv', 'pdf', 'xml']).default('xlsx'),
  params: z.record(z.string(), z.unknown()).default({}),
  cron: z.string().trim().max(60),
  recipientRoles: z
    .array(z.string().regex(/^[a-z_]{2,40}$/))
    .max(10)
    .default([]),
  recipientAddresses: z.array(z.string().trim().max(120)).max(20).default([]),
  channel: z.enum(['whatsapp', 'email']).default('whatsapp'),
});
export class ScheduleDto extends createZodDto(ScheduleSchema) {}

export const ScheduleStatusSchema = z.object({ status: z.enum(['active', 'inactive']) });
export class ScheduleStatusDto extends createZodDto(ScheduleStatusSchema) {}

export interface ScheduleRow {
  id: string;
  name: string;
  dataset: string;
  datasetTitle: string;
  format: string;
  params: Record<string, unknown>;
  cron: string;
  recipientRoles: string[];
  recipientAddresses: string[];
  channel: string;
  owner: string | null;
  status: 'active' | 'inactive';
  lastRunAt: string | null;
  lastExportId: string | null;
  nextRunAt: string | null;
}

const COLS = `s.id::text, s.name, s.dataset, s.format, s.params, s.cron, s.recipient_roles, s.recipient_addresses, s.channel::text, u.display_name AS owner, s.status::text, s.last_run_at, s.last_export_id::text, s.next_run_at`;
const toRow = (r: Record<string, unknown>): ScheduleRow => ({
  id: String(r.id),
  name: String(r.name),
  dataset: String(r.dataset),
  datasetTitle:
    datasetOrNull(String(r.dataset))?.title ??
    rendererOrNull(String(r.dataset))?.title ??
    String(r.dataset),
  format: String(r.format),
  params: (r.params as Record<string, unknown>) ?? {},
  cron: String(r.cron),
  recipientRoles: (r.recipient_roles as string[]) ?? [],
  recipientAddresses: (r.recipient_addresses as string[]) ?? [],
  channel: String(r.channel),
  owner: (r.owner as string | null) ?? null,
  status: r.status as ScheduleRow['status'],
  lastRunAt: r.last_run_at ? new Date(r.last_run_at as string).toISOString() : null,
  lastExportId: (r.last_export_id as string | null) ?? null,
  nextRunAt: r.next_run_at ? new Date(r.next_run_at as string).toISOString() : null,
});

/** Sprint 19: scheduled reports — the hourly workers job runs the due ones as their owner. */
@Injectable()
export class SchedulesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
  ) {}

  async list(ctx: RequestContext): Promise<ScheduleRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
        `SELECT ${COLS} FROM report_schedules s LEFT JOIN users u ON u.id = s.owner_id ORDER BY s.name`,
      );
      return r.rows.map(toRow);
    });
  }

  private validate(ctx: RequestContext, dto: ScheduleDto) {
    const def = datasetOrNull(dto.dataset) ?? rendererOrNull(dto.dataset);
    if (!def) throw new DomainError('validation-failed', 'Unknown dataset', { status: 400 });
    if (!ctx.permissions?.has(def.permission))
      throw new DomainError('permission-denied', `${def.title} requires ${def.permission}`, {
        status: 403,
      });
    if (!isValidCron(dto.cron))
      throw new DomainError(
        'validation-failed',
        'The schedule must be a five-field cron, e.g. "0 7 * * 1"',
        { status: 400 },
      );
    if (dto.recipientRoles.length === 0 && dto.recipientAddresses.length === 0)
      throw new DomainError('validation-failed', 'Name at least one recipient role or address', {
        status: 400,
      });
  }

  async create(ctx: RequestContext, dto: ScheduleDto): Promise<ScheduleRow> {
    this.validate(ctx, dto);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO report_schedules (school_id, name, dataset, format, params, cron, recipient_roles, recipient_addresses, channel, owner_id, next_run_at)
         VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, $5, $6::text[], $7::text[], $8::comms_channel, app.current_user_id(), $9::timestamptz) RETURNING id::text`,
        [
          dto.name,
          dto.dataset,
          dto.format,
          JSON.stringify(dto.params),
          dto.cron,
          dto.recipientRoles,
          dto.recipientAddresses,
          dto.channel,
          nextCronRun(dto.cron, new Date())?.toISOString() ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'reports.schedule.create',
        entityType: 'report_schedules',
        entityId: r.rows[0]!.id,
        after: dto,
      });
      return toRow(
        (
          await c.query<Record<string, unknown>>(
            // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
            `SELECT ${COLS} FROM report_schedules s LEFT JOIN users u ON u.id = s.owner_id WHERE s.id = $1`,
            [r.rows[0]!.id],
          )
        ).rows[0]!,
      );
    });
  }

  async setStatus(ctx: RequestContext, id: string, dto: ScheduleStatusDto): Promise<void> {
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE report_schedules SET status = $2::row_status, updated_at = now() WHERE id = $1`,
        [id, dto.status],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Schedule not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'reports.schedule.status',
        entityType: 'report_schedules',
        entityId: id,
        after: dto,
      });
    });
  }

  /** Runs a schedule now as the caller (the export service checks the dataset permission). */
  async runNow(ctx: RequestContext, id: string) {
    const row = await this.db.tenant(
      requireTenant(ctx),
      async (c) =>
        (
          await c.query<Record<string, unknown>>(
            // eslint-disable-next-line no-restricted-syntax -- fixed SELECT fragment constant; values are bound parameters
            `SELECT ${COLS} FROM report_schedules s LEFT JOIN users u ON u.id = s.owner_id WHERE s.id = $1`,
            [id],
          )
        ).rows[0],
    );
    if (!row) throw new DomainError('not-found', 'Schedule not found', { status: 404 });
    const s = toRow(row);
    const exp = await this.reports.create(
      ctx,
      {
        dataset: s.dataset,
        format: s.format as 'xlsx' | 'csv' | 'pdf' | 'xml',
        params: s.params,
        title: s.name,
      },
      'reports.schedule.run',
    );
    await this.db.tenant(requireTenant(ctx), (c) =>
      c.query(
        `UPDATE report_schedules SET last_run_at = now(), last_export_id = $2, next_run_at = $3::timestamptz WHERE id = $1`,
        [id, exp.id, nextCronRun(s.cron, new Date())?.toISOString() ?? null],
      ),
    );
    return { exportId: exp.id, status: exp.status };
  }
}
