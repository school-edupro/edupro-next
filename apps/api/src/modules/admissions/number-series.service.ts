import { Injectable } from '@nestjs/common';
import type { AdmissionCondition, PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { numberTaken, seriesText, type SeriesKind } from './number-series';
import type { NumberSeriesDto } from './scores.dto';

/**
 * Number series of admission (docs/design/48, part 5): for Registration no. and for Admission no., a
 * series per session and class (or every class), and optionally form answers (round, student type,
 * board), each with a prefix, the next number and its digits. Two series of a session may not make the
 * same numbers, and a series may not start on a number already given.
 */
@Injectable()
export class AdmissionNumberSeriesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private async listWith(c: PoolClient) {
    const r = await c.query<{
      id: string;
      kind: SeriesKind;
      cycle_id: string;
      cycle_name: string;
      class_id: string | null;
      class_name: string | null;
      conditions: AdmissionCondition[];
      name: string;
      prefix: string;
      next_no: string;
      digits: number;
      last_given: string | null;
      given: number;
    }>(
      `SELECT s.id::text, s.kind, s.cycle_id::text, y.name AS cycle_name, s.class_id::text, cl.name AS class_name,
              s.conditions, s.name, s.prefix, s.next_no::text, s.digits, s.last_given, s.given
         FROM admission_number_series s JOIN admission_cycles y ON y.id = s.cycle_id
         LEFT JOIN classes cl ON cl.id = s.class_id
        WHERE s.status = 'active' AND y.deleted_at IS NULL
        ORDER BY y.opens_at DESC, s.kind DESC, cl.display_order NULLS FIRST, s.id`,
    );
    return r.rows.map((x) => ({
      id: x.id,
      kind: x.kind,
      cycleId: x.cycle_id,
      cycleName: x.cycle_name,
      classId: x.class_id,
      className: x.class_name,
      conditions: x.conditions,
      name: x.name,
      prefix: x.prefix,
      nextNo: Number(x.next_no),
      digits: x.digits,
      next: seriesText(x.prefix, x.next_no, x.digits),
      lastGiven: x.last_given,
      given: x.given,
    }));
  }

  async list(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cycles = await c.query<{ id: string; name: string; code: string }>(
        `SELECT id::text, name, code FROM admission_cycles WHERE deleted_at IS NULL ORDER BY opens_at DESC`,
      );
      const classes = await c.query<{ cycle_id: string; id: string; name: string }>(
        `SELECT k.cycle_id::text, cl.id::text, cl.name FROM admission_class_criteria k JOIN classes cl ON cl.id = k.class_id
          ORDER BY cl.display_order, cl.name`,
      );
      return {
        series: await this.listWith(c),
        cycles: cycles.rows.map((y) => ({
          id: y.id,
          name: y.name,
          // the default when no series matches: APP/<code>/00001 and the school's admission series
          defaultRegistration: `APP/${y.code}/00001`,
          classes: classes.rows
            .filter((k) => k.cycle_id === y.id)
            .map((k) => ({ id: k.id, name: k.name })),
        })),
      };
    });
  }

  async save(ctx: RequestContext, id: string | null, dto: NumberSeriesDto) {
    if (id && !/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Series not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const y = await c.query(
        `SELECT 1 FROM admission_cycles WHERE id = $1 AND deleted_at IS NULL`,
        [dto.cycleId],
      );
      if (!y.rows.length)
        throw new DomainError('validation-failed', 'Choose a session', { status: 400 });
      if (dto.classId) {
        const k = await c.query(
          `SELECT 1 FROM admission_class_criteria WHERE cycle_id = $1 AND class_id = $2`,
          [dto.cycleId, dto.classId],
        );
        if (!k.rows.length)
          throw new DomainError('validation-failed', 'The class is not in that session', {
            status: 400,
          });
      }
      const next = seriesText(dto.prefix, dto.nextNo, dto.digits);
      // two series of a session making the same numbers would give one twice
      const others = (await this.listWith(c)).filter(
        (s) => s.id !== id && s.kind === dto.kind && s.cycleId === dto.cycleId,
      );
      const clash = others.find((s) => {
        const a = dto.prefix.toLowerCase();
        const b = s.prefix.toLowerCase();
        return (
          (a.startsWith(b) || b.startsWith(a)) && a.length + dto.digits === b.length + s.digits
        );
      });
      if (clash)
        throw new DomainError(
          'conflict',
          `“${clash.name}” makes numbers like ${clash.next} too: give this series another prefix`,
          { status: 409 },
        );
      if (await numberTaken(c, dto.kind, next)) {
        // changing only the name of a series in use keeps its next number
        const same = id
          ? await c.query(
              `SELECT 1 FROM admission_number_series WHERE id = $1 AND prefix = $2 AND next_no = $3 AND digits = $4`,
              [id, dto.prefix, dto.nextNo, dto.digits],
            )
          : { rows: [] };
        if (!same.rows.length)
          throw new DomainError(
            'conflict',
            `${next} is given already: start the series after the last number given`,
            { status: 409 },
          );
      }
      const params = [
        dto.kind,
        dto.cycleId,
        dto.classId ?? null,
        dto.name,
        JSON.stringify(dto.conditions),
        dto.prefix,
        dto.nextNo,
        dto.digits,
      ];
      const r = id
        ? await c.query<{ id: string }>(
            `UPDATE admission_number_series SET kind = $1, cycle_id = $2, class_id = $3, name = $4, conditions = $5::jsonb,
                    prefix = $6, next_no = $7, digits = $8, updated_at = now()
              WHERE id = $9 AND status = 'active' RETURNING id::text`,
            [...params, id],
          )
        : await c.query<{ id: string }>(
            `INSERT INTO admission_number_series (school_id, kind, cycle_id, class_id, name, conditions, prefix, next_no, digits)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5::jsonb, $6, $7, $8) RETURNING id::text`,
            params,
          );
      if (!r.rows[0]) throw new DomainError('not-found', 'Series not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: `admissions.number_series.${id ? 'update' : 'create'}`,
        entityType: 'admission_number_series',
        entityId: r.rows[0].id,
        after: { kind: dto.kind, name: dto.name, next },
      });
      return { series: await this.listWith(c) };
    });
  }

  async archive(ctx: RequestContext, id: string) {
    if (!/^\d{1,18}$/.test(id))
      throw new DomainError('not-found', 'Series not found', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE admission_number_series SET status = 'inactive', updated_at = now() WHERE id = $1 AND status = 'active'`,
        [id],
      );
      if (!r.rowCount) throw new DomainError('not-found', 'Series not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'admissions.number_series.archive',
        entityType: 'admission_number_series',
        entityId: id,
      });
      return { series: await this.listWith(c) };
    });
  }
}
