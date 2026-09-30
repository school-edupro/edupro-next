import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { CreateYearDto, UpdateYearDto, YearStageType } from './platform.dto';

export type YearKind = 'academic' | 'financial';

export interface YearRow {
  id: string;
  kind: YearKind;
  code: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'planned' | 'active' | 'locked' | 'closed';
  locks: Record<string, boolean>;
}

interface YearDbRow {
  id: string;
  code: string;
  name: string;
  start_date: string;
  end_date: string;
  status: YearRow['status'];
  locks: Record<string, boolean>;
}

const table = (kind: YearKind) => (kind === 'academic' ? 'academic_years' : 'financial_years');
const cols = `id::text, code, name, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date, status, locks`;
const toRow = (kind: YearKind, x: YearDbRow): YearRow => ({
  id: x.id,
  kind,
  code: x.code,
  name: x.name,
  startDate: x.start_date,
  endDate: x.end_date,
  status: x.status,
  locks: x.locks ?? {},
});

/** Academic and financial years (ADR-003): create, edit / delete while planned, activate, stage locks, close, reopen. */
@Injectable()
export class YearsService {
  constructor(private readonly db: DbService) {}

  list(tenant: TenantContext): Promise<YearRow[]> {
    return this.db.tenant(tenant, async (c) => {
      const a = await c.query<YearDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
        `SELECT ${cols} FROM academic_years ORDER BY start_date DESC`,
      );
      const f = await c.query<YearDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- column list and select constants; values are bound parameters
        `SELECT ${cols} FROM financial_years ORDER BY start_date DESC`,
      );
      return [
        ...a.rows.map((x) => toRow('academic', x)),
        ...f.rows.map((x) => toRow('financial', x)),
      ];
    });
  }

  async get(
    tenant: TenantContext,
    kind: YearKind,
    id: string,
    client?: PoolClient,
  ): Promise<YearRow> {
    const run = async (c: PoolClient) => {
      // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum, never from input
      const r = await c.query<YearDbRow>(`SELECT ${cols} FROM ${table(kind)} WHERE id = $1`, [id]);
      if (!r.rows[0]) throw new DomainError('not-found', 'Year not found');
      return toRow(kind, r.rows[0]);
    };
    return client ? run(client) : this.db.tenant(tenant, run);
  }

  async create(ctx: RequestContext, dto: CreateYearDto): Promise<YearRow> {
    const tenant = requireTenant(ctx);
    const created = await this.db.tenant(tenant, async (c) => {
      const overlap = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
        `SELECT 1 FROM ${table(dto.kind)} WHERE daterange(start_date, end_date, '[]') && daterange($1::date, $2::date, '[]')`,
        [dto.startDate, dto.endDate],
      );
      if ((overlap.rowCount ?? 0) > 0)
        throw new DomainError('year.overlap', 'The dates overlap an existing year', {
          status: 409,
        });
      try {
        const r = await c.query<{ id: string }>(
          // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
          `INSERT INTO ${table(dto.kind)} (school_id, code, name, start_date, end_date, status, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, 'planned', app.current_user_id(), app.current_user_id()) RETURNING id::text`,
          [dto.code, dto.name, dto.startDate, dto.endDate],
        );
        return this.get(tenant, dto.kind, r.rows[0]!.id, c);
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Year ${dto.code} already exists`);
        throw error;
      }
    });
    ctx.audit = {
      action: 'platform.year.create',
      entityType: table(dto.kind),
      entityId: created.id,
      after: created,
    };
    return created;
  }

  /** Makes a planned year active; the previously active year becomes locked (its stages stay editable only by reopen). */
  async activate(ctx: RequestContext, kind: YearKind, id: string): Promise<YearRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, kind, id, c);
      if (before.status !== 'planned')
        throw new DomainError('year.not_planned', 'Only a planned year can be activated', {
          status: 409,
        });
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
        `UPDATE ${table(kind)} SET status = 'locked', locks = '{"attendance": true, "exams": true, "fees": true, "academics": true}'::jsonb, updated_by = app.current_user_id() WHERE status = 'active'`,
      );
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
        `UPDATE ${table(kind)} SET status = 'active', updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      return { before, after: await this.get(tenant, kind, id, c) };
    });
    ctx.audit = {
      action: 'platform.year.activate',
      entityType: table(kind),
      entityId: id,
      before: result.before,
      after: result.after,
    };
    return result.after;
  }

  async setStage(
    ctx: RequestContext,
    kind: YearKind,
    id: string,
    stage: YearStageType,
    locked: boolean,
    reason: string,
  ): Promise<YearRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, kind, id, c);
      if (before.status === 'closed')
        throw new DomainError('year.closed', 'A closed year cannot change', { status: 409 });
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
        `UPDATE ${table(kind)} SET locks = jsonb_set(COALESCE(locks, '{}'::jsonb), ARRAY[$2::text], to_jsonb($3::boolean), true),
                                   -- reopening a stage revives a locked year only when no other year of the kind is
                                   -- active (one active year per school); otherwise it stays locked with that stage open
                                   status = CASE WHEN status = 'locked' AND NOT $3::boolean
                                                  AND NOT EXISTS (SELECT 1 FROM ${table(kind)} o WHERE o.status = 'active' AND o.id <> $1)
                                                 THEN 'active' ELSE status END,
                                   updated_by = app.current_user_id()
          WHERE id = $1`,
        [id, stage, locked],
      );
      return { before, after: await this.get(tenant, kind, id, c) };
    });
    ctx.audit = {
      action: locked ? 'platform.year.lock' : 'platform.year.reopen',
      entityType: table(kind),
      entityId: id,
      before: result.before,
      after: { ...result.after, reason },
    };
    return result.after;
  }

  async close(ctx: RequestContext, kind: YearKind, id: string, reason: string): Promise<YearRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, kind, id, c);
      if (before.status === 'active')
        throw new DomainError('year.active', 'Activate another year before closing this one', {
          status: 409,
        });
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
        `UPDATE ${table(kind)} SET status = 'closed', updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      return { before, after: await this.get(tenant, kind, id, c) };
    });
    ctx.audit = {
      action: 'platform.year.close',
      entityType: table(kind),
      entityId: id,
      before: result.before,
      after: { ...result.after, reason },
    };
    return result.after;
  }

  /** Edits code, name and dates of a planned year; a year in use (active, locked, closed) keeps its identity. */
  async update(
    ctx: RequestContext,
    kind: YearKind,
    id: string,
    dto: UpdateYearDto,
  ): Promise<YearRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, kind, id, c);
      if (before.status !== 'planned')
        throw new DomainError('year.not_planned', 'Only a planned year can be edited', {
          status: 409,
        });
      const overlap = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
        `SELECT 1 FROM ${table(kind)} WHERE id <> $3 AND daterange(start_date, end_date, '[]') && daterange($1::date, $2::date, '[]')`,
        [dto.startDate, dto.endDate, id],
      );
      if ((overlap.rowCount ?? 0) > 0)
        throw new DomainError('year.overlap', 'The dates overlap an existing year', {
          status: 409,
        });
      try {
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
          `UPDATE ${table(kind)} SET code = $2, name = $3, start_date = $4, end_date = $5, updated_by = app.current_user_id()
            WHERE id = $1`,
          [id, dto.code, dto.name, dto.startDate, dto.endDate],
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Year ${dto.code} already exists`);
        throw error;
      }
      return { before, after: await this.get(tenant, kind, id, c) };
    });
    ctx.audit = {
      action: 'platform.year.update',
      entityType: table(kind),
      entityId: id,
      before: result.before,
      after: result.after,
    };
    return result.after;
  }

  /** Deletes a planned year that nothing references yet; anything already hanging off it blocks the delete. */
  async remove(ctx: RequestContext, kind: YearKind, id: string): Promise<{ deleted: true }> {
    const tenant = requireTenant(ctx);
    const before = await this.db.tenant(tenant, async (c) => {
      const row = await this.get(tenant, kind, id, c);
      if (row.status !== 'planned')
        throw new DomainError('year.not_planned', 'Only a planned year can be deleted', {
          status: 409,
        });
      await c.query('SAVEPOINT year_delete');
      try {
        // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
        await c.query(`DELETE FROM ${table(kind)} WHERE id = $1`, [id]);
      } catch (error) {
        await c.query('ROLLBACK TO SAVEPOINT year_delete');
        if ((error as { code?: string }).code === '23503')
          throw new DomainError(
            'year.in_use',
            'This year already has data (classes, fees or other records); it cannot be deleted',
            { status: 409 },
          );
        throw error;
      }
      return row;
    });
    ctx.audit = {
      action: 'platform.year.delete',
      entityType: table(kind),
      entityId: id,
      before,
    };
    return { deleted: true };
  }

  /**
   * Reopens a closed year: closed → locked. Its stages keep their locks, so the admin then reopens
   * only the stage that needs a correction. Needs a reason; audited.
   */
  async reopenYear(
    ctx: RequestContext,
    kind: YearKind,
    id: string,
    reason: string,
  ): Promise<YearRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, kind, id, c);
      if (before.status !== 'closed')
        throw new DomainError('year.not_closed', 'Only a closed year can be reopened', {
          status: 409,
        });
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
        `UPDATE ${table(kind)} SET status = 'locked', locks = '{"attendance": true, "exams": true, "fees": true, "academics": true}'::jsonb, updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      return { before, after: await this.get(tenant, kind, id, c) };
    });
    ctx.audit = {
      action: 'platform.year.reopen_year',
      entityType: table(kind),
      entityId: id,
      before: result.before,
      after: { ...result.after, reason },
    };
    return result.after;
  }

  /**
   * Makes a locked year the working year again (e.g. the next year was activated by mistake): the
   * currently active year of the kind becomes locked, the chosen one active. Needs a reason; audited.
   */
  async makeWorking(
    ctx: RequestContext,
    kind: YearKind,
    id: string,
    reason: string,
  ): Promise<YearRow> {
    const tenant = requireTenant(ctx);
    const result = await this.db.tenant(tenant, async (c) => {
      const before = await this.get(tenant, kind, id, c);
      if (before.status !== 'locked')
        throw new DomainError(
          'year.not_locked',
          before.status === 'planned'
            ? 'Use Activate for a planned year'
            : before.status === 'closed'
              ? 'Reopen the closed year first'
              : 'This year is already the working year',
          { status: 409 },
        );
      const demoted = await c.query<{ id: string; code: string }>(
        // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
        `UPDATE ${table(kind)} SET status = 'locked', locks = '{"attendance": true, "exams": true, "fees": true, "academics": true}'::jsonb, updated_by = app.current_user_id()
          WHERE status = 'active' RETURNING id::text, code`,
      );
      await c.query(
        // eslint-disable-next-line no-restricted-syntax -- table name comes from a two-value enum
        // the promoted year becomes the working year with every stage open; lock stages again as needed
        `UPDATE ${table(kind)} SET status = 'active', locks = '{}'::jsonb, updated_by = app.current_user_id() WHERE id = $1`,
        [id],
      );
      return {
        before,
        after: await this.get(tenant, kind, id, c),
        demoted: demoted.rows[0] ?? null,
      };
    });
    ctx.audit = {
      action: 'platform.year.make_working',
      entityType: table(kind),
      entityId: id,
      before: result.before,
      after: { ...result.after, reason, previousActive: result.demoted },
    };
    return result.after;
  }
}
