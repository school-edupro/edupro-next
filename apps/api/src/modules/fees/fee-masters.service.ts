import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  CreateDiscountDto,
  CreateHeadDto,
  CreateSlabDto,
  GeneratePeriodsDto,
  SetStructureDto,
  UpdateHeadDto,
} from './fees.dto';

export interface HeadRow {
  id: string;
  code: string;
  name: string;
  kind: 'regular' | 'transport' | 'opening_balance' | 'late_fee' | 'misc';
  ledger: string;
  isOptional: boolean;
  refundable: boolean;
  sortOrder: number;
  status: 'active' | 'inactive';
  /** Heads sharing this name print as one line on the bill and the receipt. */
  printGroup: string | null;
  /** Counts for the income-tax certificate (tuition). */
  taxCertificate: boolean;
}
export interface PeriodRow {
  id: string;
  sequence: number;
  name: string;
  month: number;
  year: number;
  instalment: number;
  dueOn: string;
  /** Sprint 12: slab-mode late fee after the due date, later slabs, and the family visibility date. */
  lateFeeAmount: string;
  slabs: Array<{ on: string; amount: string }>;
  visibleFrom: string | null;
}
export interface StructureRow {
  id: string;
  classId: string;
  headId: string;
  headCode: string;
  headName: string;
  feeGroup: string;
  studentType: 'all' | 'new' | 'old';
  amount: string;
  frequency: 'monthly' | 'quarterly' | 'half_yearly' | 'annual' | 'one_time';
  periods: number[] | null;
  /** Amount for the whole year for a regular student, for the class fee card. */
  annual: string;
}
export interface SlabRow {
  id: string;
  code: string;
  name: string;
  distanceFromKm: string | null;
  distanceToKm: string | null;
  monthlyAmount: string;
}
export interface DiscountRow {
  id: string;
  code: string;
  name: string;
  headId: string | null;
  headCode: string | null;
  percent: string | null;
  amount: string | null;
  appliesToTransport: boolean;
  status: 'active' | 'inactive';
}

const HEAD_COLS = `id::text, code, name, kind, ledger::text, is_optional AS "isOptional", refundable, sort_order AS "sortOrder", status, print_group AS "printGroup", tax_certificate AS "taxCertificate"`;
const PERIOD_COLS = `id::text, sequence, name, month, year, instalment, due_on::text AS "dueOn", late_fee_amount::text AS "lateFeeAmount", visible_from::text AS "visibleFrom",
  (SELECT jsonb_agg(jsonb_build_object('on', s.on_date::text, 'amount', s.amount::text) ORDER BY s.on_date)
     FROM (VALUES (late_slab_1_on, late_slab_1_amount), (late_slab_2_on, late_slab_2_amount), (late_slab_3_on, late_slab_3_amount)) AS s(on_date, amount)
    WHERE s.on_date IS NOT NULL) AS slabs_json`;
const SLAB_COLS = `id::text, code, name, distance_from_km::text AS "distanceFromKm", distance_to_km::text AS "distanceToKm", monthly_amount::text AS "monthlyAmount"`;

const toPeriod = ({
  slabs_json,
  ...p
}: PeriodRow & { slabs_json: PeriodRow['slabs'] | null }): PeriodRow => ({
  ...p,
  slabs: slabs_json ?? [],
});

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Fee masters (S8-06): heads, periods of the year, class structures, transport slabs and discounts. */
@Injectable()
export class FeeMastersService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private year(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  // ---- heads ----------------------------------------------------------------------------------
  async heads(ctx: RequestContext): Promise<HeadRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<HeadRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SQL fragments assembled in code; values are bound parameters
        `SELECT ${HEAD_COLS} FROM fee_heads WHERE deleted_at IS NULL ORDER BY sort_order, code`,
      );
      return r.rows;
    });
  }

  async createHead(ctx: RequestContext, dto: CreateHeadDto): Promise<HeadRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      let row: HeadRow;
      try {
        const r = await c.query<HeadRow>(
          // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
          `INSERT INTO fee_heads (school_id, code, name, kind, ledger, is_optional, refundable, sort_order, print_group, tax_certificate, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3::fee_head_kind, $4::ledger_type, $5, $6, $7, $8, $9, app.current_user_id(), app.current_user_id()) RETURNING ${HEAD_COLS}`,
          [
            dto.code,
            dto.name,
            dto.kind,
            dto.ledger,
            dto.isOptional,
            dto.refundable,
            dto.sortOrder,
            dto.printGroup || null,
            dto.taxCertificate,
          ],
        );
        row = r.rows[0]!;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Fee head "${dto.code}" already exists`);
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.head.create',
        entityType: 'fee_heads',
        entityId: row.id,
        after: row,
      });
      return row;
    });
  }

  async updateHead(ctx: RequestContext, id: string, dto: UpdateHeadDto): Promise<HeadRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const sets: string[] = ['updated_at = now()', 'updated_by = app.current_user_id()'];
      const params: unknown[] = [];
      const set = (col: string, value: unknown, cast = '') => {
        params.push(value);
        sets.push(`${col} = $${params.length}${cast}`);
      };
      if (dto.name !== undefined) set('name', dto.name);
      if (dto.kind !== undefined) set('kind', dto.kind, '::fee_head_kind');
      if (dto.ledger !== undefined) set('ledger', dto.ledger, '::ledger_type');
      if (dto.isOptional !== undefined) set('is_optional', dto.isOptional);
      if (dto.refundable !== undefined) set('refundable', dto.refundable);
      if (dto.sortOrder !== undefined) set('sort_order', dto.sortOrder);
      if (dto.status !== undefined) set('status', dto.status, '::row_status');
      if (dto.printGroup !== undefined) set('print_group', dto.printGroup || null);
      if (dto.taxCertificate !== undefined) set('tax_certificate', dto.taxCertificate);
      params.push(id);
      const r = await c.query<HeadRow>(
        // eslint-disable-next-line no-restricted-syntax -- sets holds fixed column assignments; values are bound parameters
        `UPDATE fee_heads SET ${sets.join(', ')} WHERE id = $${params.length} AND deleted_at IS NULL RETURNING ${HEAD_COLS}`,
        params,
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Fee head not found');
      await this.audit.stage(ctx, c, {
        action: 'fees.head.edit',
        entityType: 'fee_heads',
        entityId: id,
        after: r.rows[0],
      });
      return r.rows[0];
    });
  }

  // ---- periods --------------------------------------------------------------------------------
  async periods(ctx: RequestContext): Promise<PeriodRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<PeriodRow & { slabs_json: PeriodRow['slabs'] | null }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SQL fragments assembled in code; values are bound parameters
        `SELECT ${PERIOD_COLS} FROM fee_periods WHERE academic_year_id = $1 ORDER BY sequence`,
        [yearId],
      );
      return r.rows.map(toPeriod);
    });
  }

  /** Twelve periods from the year's first month; instalment numbers follow monthsPerInstalment. */
  async generatePeriods(ctx: RequestContext, dto: GeneratePeriodsDto): Promise<PeriodRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const y = await c.query<{ start_date: string }>(
        `SELECT start_date::text FROM academic_years WHERE id = $1`,
        [yearId],
      );
      if (!y.rows[0]) throw new DomainError('not-found', 'Academic year not found');
      const demands = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM fee_demands WHERE academic_year_id = $1`,
        [yearId],
      );
      if (Number(demands.rows[0]?.n ?? 0) > 0)
        throw new DomainError(
          'fees.periods_in_use',
          'Demands exist for this year; periods cannot be regenerated',
          { status: 409 },
        );
      await c.query(`DELETE FROM fee_periods WHERE academic_year_id = $1`, [yearId]);
      const [sy, sm] = y.rows[0].start_date.split('-').map(Number) as [number, number, number];
      for (let i = 0; i < 12; i += 1) {
        const m0 = sm - 1 + i;
        const month = (m0 % 12) + 1;
        const year = sy + Math.floor(m0 / 12);
        const instalment = Math.floor(i / dto.monthsPerInstalment) + 1;
        // an instalment falls due on dueDay of its first month
        const firstOfInstalment = i - (i % dto.monthsPerInstalment);
        const dm0 = sm - 1 + firstOfInstalment;
        const dueOn = `${sy + Math.floor(dm0 / 12)}-${String((dm0 % 12) + 1).padStart(2, '0')}-${String(dto.dueDay).padStart(2, '0')}`;
        await c.query(
          `INSERT INTO fee_periods (school_id, academic_year_id, sequence, name, month, year, instalment, due_on) VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7::date)`,
          [yearId, i + 1, `${MONTHS[month - 1]} ${year}`, month, year, instalment, dueOn],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.periods.generate',
        entityType: 'fee_periods',
        entityId: yearId,
        after: dto,
      });
      const r = await c.query<PeriodRow & { slabs_json: PeriodRow['slabs'] | null }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SQL fragments assembled in code; values are bound parameters
        `SELECT ${PERIOD_COLS} FROM fee_periods WHERE academic_year_id = $1 ORDER BY sequence`,
        [yearId],
      );
      return r.rows.map(toPeriod);
    });
  }

  // ---- structures -----------------------------------------------------------------------------
  private structureSelect(where: string): string {
    // eslint-disable-next-line no-restricted-syntax -- fixed SQL fragments assembled in code; values are bound parameters
    return `SELECT fs.id::text, fs.class_id::text AS "classId", fs.head_id::text AS "headId", h.code AS "headCode", h.name AS "headName", fs.fee_group AS "feeGroup",
                   fs.student_type AS "studentType", fs.amount::text, fs.frequency, fs.periods,
                   (CASE WHEN fs.amounts IS NOT NULL THEN (SELECT COALESCE(sum(a), 0) FROM unnest(fs.amounts) a) ELSE fs.amount * CASE WHEN fs.periods IS NOT NULL THEN cardinality(fs.periods) WHEN fs.frequency = 'monthly' THEN 12 WHEN fs.frequency = 'quarterly' THEN 4 WHEN fs.frequency = 'half_yearly' THEN 2 ELSE 1 END END)::text AS annual
              FROM fee_structures fs JOIN fee_heads h ON h.id = fs.head_id
             WHERE ${where} ORDER BY fs.fee_group, fs.student_type, h.sort_order, h.code`;
  }

  async structures(ctx: RequestContext, classId?: string): Promise<StructureRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const params: unknown[] = [yearId];
      let where = 'fs.academic_year_id = $1';
      if (classId) {
        params.push(classId);
        where += ' AND fs.class_id = $2';
      }
      const r = await c.query<StructureRow>(this.structureSelect(where), params);
      return r.rows;
    });
  }

  /** Replaces the structure of one class and fee group for the working year. */
  async setStructure(
    ctx: RequestContext,
    classId: string,
    dto: SetStructureDto,
  ): Promise<StructureRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const cls = await c.query(`SELECT 1 FROM classes WHERE id = $1 AND deleted_at IS NULL`, [
        classId,
      ]);
      if (cls.rowCount === 0) throw new DomainError('not-found', 'Class not found');
      await c.query(
        `DELETE FROM fee_structures WHERE academic_year_id = $1 AND class_id = $2 AND fee_group = $3`,
        [yearId, classId, dto.feeGroup],
      );
      for (const e of dto.entries)
        await c.query(
          `INSERT INTO fee_structures (school_id, academic_year_id, class_id, head_id, fee_group, student_type, amount, frequency, periods, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7::fee_frequency, $8, app.current_user_id(), app.current_user_id())
           ON CONFLICT (academic_year_id, class_id, head_id, fee_group, student_type) DO UPDATE SET amount = EXCLUDED.amount, frequency = EXCLUDED.frequency, periods = EXCLUDED.periods`,
          [
            yearId,
            classId,
            e.headId,
            dto.feeGroup,
            e.studentType,
            e.amount,
            e.frequency,
            e.periods ?? null,
          ],
        );
      await this.audit.stage(ctx, c, {
        action: 'fees.structure.set',
        entityType: 'fee_structures',
        entityId: classId,
        after: { feeGroup: dto.feeGroup, entries: dto.entries.length },
      });
      const r = await c.query<StructureRow>(
        this.structureSelect('fs.academic_year_id = $1 AND fs.class_id = $2'),
        [yearId, classId],
      );
      return r.rows;
    });
  }

  // ---- slabs and discounts ---------------------------------------------------------------------
  async slabs(ctx: RequestContext): Promise<SlabRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<SlabRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed SQL fragments assembled in code; values are bound parameters
        `SELECT ${SLAB_COLS} FROM transport_slabs WHERE academic_year_id = $1 ORDER BY distance_from_km NULLS FIRST, code`,
        [yearId],
      );
      return r.rows;
    });
  }

  async createSlab(ctx: RequestContext, dto: CreateSlabDto): Promise<SlabRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      try {
        const r = await c.query<SlabRow>(
          // eslint-disable-next-line no-restricted-syntax -- column list constant; values are bound parameters
          `INSERT INTO transport_slabs (school_id, academic_year_id, code, name, distance_from_km, distance_to_km, monthly_amount)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6) RETURNING ${SLAB_COLS}`,
          [
            yearId,
            dto.code,
            dto.name,
            dto.distanceFromKm ?? null,
            dto.distanceToKm ?? null,
            dto.monthlyAmount,
          ],
        );
        await this.audit.stage(ctx, c, {
          action: 'fees.slab.create',
          entityType: 'transport_slabs',
          entityId: r.rows[0]!.id,
          after: r.rows[0],
        });
        return r.rows[0]!;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Slab "${dto.code}" already exists`);
        throw error;
      }
    });
  }

  async discounts(ctx: RequestContext): Promise<DiscountRow[]> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<DiscountRow>(
        `SELECT d.id::text, d.code, d.name, d.head_id::text AS "headId", h.code AS "headCode", d.percent::text, d.amount::text, d.applies_to_transport AS "appliesToTransport", d.status
           FROM fee_discounts d LEFT JOIN fee_heads h ON h.id = d.head_id WHERE d.academic_year_id = $1 ORDER BY d.code`,
        [yearId],
      );
      return r.rows;
    });
  }

  async createDiscount(ctx: RequestContext, dto: CreateDiscountDto): Promise<DiscountRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      let id: string;
      try {
        const r = await c.query<{ id: string }>(
          `INSERT INTO fee_discounts (school_id, academic_year_id, code, name, head_id, percent, amount, applies_to_transport)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7) RETURNING id::text`,
          [
            yearId,
            dto.code,
            dto.name,
            dto.headId ?? null,
            dto.percent ?? null,
            dto.amount ?? null,
            dto.appliesToTransport,
          ],
        );
        id = r.rows[0]!.id;
      } catch (error) {
        if ((error as { code?: string }).code === '23505')
          throw new DomainError('conflict', `Discount "${dto.code}" already exists`);
        throw error;
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.discount.create',
        entityType: 'fee_discounts',
        entityId: id,
        after: dto,
      });
      const r = await c.query<DiscountRow>(
        `SELECT d.id::text, d.code, d.name, d.head_id::text AS "headId", h.code AS "headCode", d.percent::text, d.amount::text, d.applies_to_transport AS "appliesToTransport", d.status
           FROM fee_discounts d LEFT JOIN fee_heads h ON h.id = d.head_id WHERE d.id = $1`,
        [id],
      );
      return r.rows[0]!;
    });
  }
}
