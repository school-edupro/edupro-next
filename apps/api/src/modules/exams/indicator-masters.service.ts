import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { UpsertIndicatorAreaDto, UpsertIndicatorScaleDto } from './exams.dto';

/** How many items of live sets an area or a scale is used by (a scale: as a set's levels or a heading's). */
const AREA_USE = `(SELECT count(*)::int FROM indicators i JOIN indicator_sets s ON s.id = i.set_id AND s.deleted_at IS NULL
                    WHERE lower(btrim(i.area)) = lower(a.name))`;
const SCALE_USE = `((SELECT count(*) FROM indicator_sets s WHERE s.deleted_at IS NULL AND s.grades = a.levels)
                  + (SELECT count(*) FROM indicators i JOIN indicator_sets s ON s.id = i.set_id AND s.deleted_at IS NULL
                      WHERE i.levels = a.levels))::int`;

const unique = (error: unknown) => (error as { code?: string }).code === '23505';

/**
 * Indicator areas and level scales (docs/design/65): the school's lists the set editor picks from. An
 * area's order is the order cards print and teachers see the areas; renaming one renames it in every
 * set. A scale's levels are fixed once a set uses them (entries keep the level's words); add a new one.
 */
@Injectable()
export class IndicatorMastersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  async areas(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- AREA_USE / SCALE_USE are fixed fragments of this file
        `SELECT a.id::text, a.name, a.sort_order AS "sortOrder", a.status::text, ${AREA_USE} AS items
           FROM indicator_areas a ORDER BY a.sort_order, lower(a.name)`,
      );
      return { data: r.rows };
    });
  }

  async upsertArea(ctx: RequestContext, dto: UpsertIndicatorAreaDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let id = dto.id ?? null;
      try {
        if (id) {
          const old = await c.query<{ name: string }>(
            `SELECT name FROM indicator_areas WHERE id = $1`,
            [id],
          );
          if (!old.rowCount) throw new DomainError('not-found', 'Area not found', { status: 404 });
          await c.query(
            `UPDATE indicator_areas SET name = $2, sort_order = COALESCE($3, sort_order), status = $4::row_status, updated_at = now(), updated_by = app.current_user_id()
              WHERE id = $1`,
            [id, dto.name, dto.sortOrder ?? null, dto.status],
          );
          // a new name is the area's name in every set
          if (old.rows[0]!.name !== dto.name)
            await c.query(`UPDATE indicators SET area = $2 WHERE lower(btrim(area)) = lower($1)`, [
              old.rows[0]!.name,
              dto.name,
            ]);
        } else {
          const r = await c.query<{ id: string }>(
            `INSERT INTO indicator_areas (school_id, name, sort_order, status, updated_by)
             VALUES (app.current_school_id(), $1, COALESCE($2, (SELECT COALESCE(max(sort_order), 0) + 10 FROM indicator_areas)), $3::row_status, app.current_user_id())
             RETURNING id::text`,
            [dto.name, dto.sortOrder ?? null, dto.status],
          );
          id = r.rows[0]!.id;
        }
      } catch (error) {
        if (unique(error))
          throw new DomainError('exams.area_exists', `The area "${dto.name}" is in the list`, {
            status: 409,
          });
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.indicator_area.upsert',
        entityType: 'indicator_areas',
        entityId: id,
        after: dto,
      });
      return { id };
    });
  }

  async scales(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- AREA_USE / SCALE_USE are fixed fragments of this file
        `SELECT a.id::text, a.name, a.levels, a.sort_order AS "sortOrder", a.status::text, ${SCALE_USE} AS used
           FROM indicator_scales a ORDER BY a.sort_order, lower(a.name)`,
      );
      return { data: r.rows };
    });
  }

  async upsertScale(ctx: RequestContext, dto: UpsertIndicatorScaleDto) {
    if (new Set(dto.levels.map((l) => l.toLowerCase())).size !== dto.levels.length)
      throw new DomainError('validation-failed', 'A level is written twice', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let id = dto.id ?? null;
      try {
        if (id) {
          const old = await c.query<{ levels: string[]; used: number }>(
            // eslint-disable-next-line no-restricted-syntax -- AREA_USE / SCALE_USE are fixed fragments of this file
            `SELECT a.levels, ${SCALE_USE} AS used FROM indicator_scales a WHERE a.id = $1`,
            [id],
          );
          if (!old.rowCount) throw new DomainError('not-found', 'Scale not found', { status: 404 });
          const was = old.rows[0]!;
          if (was.used > 0 && was.levels.join('|') !== dto.levels.join('|'))
            throw new DomainError(
              'exams.scale_in_use',
              'Sets use these levels and entries keep their words: add a new scale instead',
              { status: 409, extra: { used: was.used } },
            );
          await c.query(
            `UPDATE indicator_scales SET name = $2, levels = $3, sort_order = COALESCE($4, sort_order), status = $5::row_status, updated_at = now(), updated_by = app.current_user_id()
              WHERE id = $1`,
            [id, dto.name, dto.levels, dto.sortOrder ?? null, dto.status],
          );
        } else {
          const r = await c.query<{ id: string }>(
            `INSERT INTO indicator_scales (school_id, name, levels, sort_order, status, updated_by)
             VALUES (app.current_school_id(), $1, $2, COALESCE($3, (SELECT COALESCE(max(sort_order), 0) + 10 FROM indicator_scales)), $4::row_status, app.current_user_id())
             RETURNING id::text`,
            [dto.name, dto.levels, dto.sortOrder ?? null, dto.status],
          );
          id = r.rows[0]!.id;
        }
      } catch (error) {
        if (unique(error))
          throw new DomainError(
            'exams.scale_exists',
            'A scale with this name or these levels is in the list',
            { status: 409 },
          );
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'exams.indicator_scale.upsert',
        entityType: 'indicator_scales',
        entityId: id,
        after: dto,
      });
      return { id };
    });
  }
}

/**
 * The areas a set's items name, as the list spells them (a new one joins the end of the list, so a set
 * saved through the API or a ready-made set fills it): lower-case name → the list's name.
 */
export async function listAreas(c: PoolClient, names: string[]): Promise<Map<string, string>> {
  const wanted = [
    ...new Map(
      names
        .map((n) => n.trim())
        .filter((n) => n.length >= 2)
        .map((n) => [n.toLowerCase(), n]),
    ).values(),
  ];
  if (!wanted.length) return new Map();
  await c.query(
    `INSERT INTO indicator_areas (school_id, name, sort_order, updated_by)
     SELECT app.current_school_id(), x.name,
            (SELECT COALESCE(max(sort_order), 0) FROM indicator_areas) + x.n::int * 10, app.current_user_id()
       FROM unnest($1::text[]) WITH ORDINALITY AS x(name, n)
      WHERE NOT EXISTS (SELECT 1 FROM indicator_areas a WHERE lower(a.name) = lower(x.name))
     ON CONFLICT DO NOTHING`,
    [wanted],
  );
  const r = await c.query<{ name: string }>(
    `SELECT name FROM indicator_areas WHERE lower(name) = ANY($1::text[])`,
    [wanted.map((w) => w.toLowerCase())],
  );
  return new Map(r.rows.map((x) => [x.name.toLowerCase(), x.name]));
}

/** The level lists a set uses join the school's scales when new (named by their levels). */
export async function listScales(c: PoolClient, lists: string[][]): Promise<void> {
  for (const levels of lists)
    await c.query(
      `INSERT INTO indicator_scales (school_id, name, levels, sort_order, updated_by)
       SELECT app.current_school_id(), left(array_to_string($1::text[], ' / '), 60), $1::text[],
              (SELECT COALESCE(max(sort_order), 0) + 10 FROM indicator_scales), app.current_user_id()
        WHERE NOT EXISTS (SELECT 1 FROM indicator_scales WHERE levels = $1::text[])
       ON CONFLICT DO NOTHING`,
      [levels],
    );
}
