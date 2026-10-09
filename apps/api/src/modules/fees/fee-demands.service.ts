import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { FeeSetupService } from './fee-setup.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { ListDemandsQueryDto, SetProfileDto } from './fees.dto';

export interface ProfileRow {
  studentId: string;
  academicYearId: string;
  feeGroup: string;
  studentType: 'new' | 'old';
  transportSlabId: string | null;
  transportSlab: string | null;
  transportDisabled: boolean;
  discountId: string | null;
  discount: string | null;
  openingBalance: string;
  notes: string | null;
  /** 1, 2, 3, 4, 6 or 12 instalments for this student instead of the school's periods (S11). */
  instalmentsOverride: number | null;
  /** Sprint 14: hostel-ledger heads apply to hostellers */
  hosteller: boolean;
  /** True when no row exists yet and the defaults above would apply. */
  isDefault: boolean;
}

export interface DemandRow {
  id: string;
  periodId: string;
  periodName: string;
  sequence: number;
  instalment: number;
  headId: string;
  headCode: string;
  headName: string;
  gross: string;
  discount: string;
  net: string;
  paid: string;
  status: string;
  dueOn: string;
  source: string;
}

export interface DemandSummary {
  rows: DemandRow[];
  byInstalment: Array<{
    instalment: number;
    dueOn: string;
    net: string;
    paid: string;
    balance: string;
  }>;
  total: { net: string; paid: string; balance: string };
  lastRun: { id: string; ranAt: string; ranBy: string | null; rows: number; total: string } | null;
}

const PROFILE_SELECT = `SELECT p.student_id::text AS "studentId", p.academic_year_id::text AS "academicYearId", p.fee_group AS "feeGroup", p.student_type AS "studentType",
        p.transport_slab_id::text AS "transportSlabId", ts.name AS "transportSlab", p.transport_disabled AS "transportDisabled",
        p.discount_id::text AS "discountId", d.name AS discount, p.opening_balance::text AS "openingBalance", p.notes, p.instalments_override AS "instalmentsOverride", p.hosteller, false AS "isDefault"
   FROM student_fee_profiles p LEFT JOIN transport_slabs ts ON ts.id = p.transport_slab_id LEFT JOIN fee_discounts d ON d.id = p.discount_id`;

/** Student fee profiles and demand generation (S8-06): app.generate_fee_demand does the arithmetic. */
@Injectable()
export class FeeDemandsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly setup: FeeSetupService,
  ) {}

  private year(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  private async findProfile(c: PoolClient, studentId: string, yearId: string): Promise<ProfileRow> {
    const r = await c.query<ProfileRow>(
      // eslint-disable-next-line no-restricted-syntax -- fixed SQL fragments assembled in code; values are bound parameters
      `${PROFILE_SELECT} WHERE p.student_id = $1 AND p.academic_year_id = $2`,
      [studentId, yearId],
    );
    if (r.rows[0]) return r.rows[0];
    const s = await c.query<{ is_new: boolean }>(
      `SELECT (s.admitted_on IS NOT NULL AND s.admitted_on >= y.start_date) AS is_new FROM students s CROSS JOIN academic_years y WHERE s.id = $1 AND y.id = $2 AND s.deleted_at IS NULL`,
      [studentId, yearId],
    );
    if (!s.rows[0]) throw new DomainError('not-found', 'Student not found');
    return {
      studentId,
      academicYearId: yearId,
      feeGroup: 'general',
      studentType: s.rows[0].is_new ? 'new' : 'old',
      transportSlabId: null,
      transportSlab: null,
      transportDisabled: false,
      discountId: null,
      discount: null,
      openingBalance: '0.00',
      instalmentsOverride: null,
      hosteller: false,
      notes: null,
      isDefault: true,
    };
  }

  async profile(ctx: RequestContext, studentId: string): Promise<ProfileRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, (c) => this.findProfile(c, studentId, yearId));
  }

  async setProfile(
    ctx: RequestContext,
    studentId: string,
    dto: SetProfileDto,
  ): Promise<ProfileRow> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.findProfile(c, studentId, yearId);
      // what decides the fee goes through the approval; only an approver sets it here
      const feeChanged =
        dto.feeGroup !== before.feeGroup ||
        dto.studentType !== before.studentType ||
        (dto.discountId ?? null) !== before.discountId ||
        dto.hosteller !== before.hosteller ||
        (dto.transportSlabId ?? null) !== before.transportSlabId ||
        dto.discounts !== undefined;
      if (feeChanged && !ctx.permissions?.has('fees.adjustment.approve'))
        throw new DomainError(
          'fees.approval_required',
          'Fee group, student type, discount, transport and hostel changes need approval: use “Request change”',
          { status: 403 },
        );
      await c.query(
        `INSERT INTO student_fee_profiles (school_id, student_id, academic_year_id, fee_group, student_type, transport_slab_id, transport_disabled, discount_id, opening_balance, notes, instalments_override, hosteller, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, app.current_user_id(), app.current_user_id())
         ON CONFLICT (student_id, academic_year_id) DO UPDATE SET fee_group = EXCLUDED.fee_group, student_type = EXCLUDED.student_type, transport_slab_id = EXCLUDED.transport_slab_id,
           transport_disabled = EXCLUDED.transport_disabled, discount_id = EXCLUDED.discount_id, opening_balance = EXCLUDED.opening_balance, notes = EXCLUDED.notes,
           instalments_override = EXCLUDED.instalments_override, hosteller = EXCLUDED.hosteller, updated_at = now(), updated_by = app.current_user_id()`,
        [
          studentId,
          yearId,
          dto.feeGroup,
          dto.studentType,
          dto.transportSlabId ?? null,
          dto.transportDisabled,
          dto.discountId ?? null,
          dto.openingBalance,
          dto.notes ?? null,
          dto.instalmentsOverride ?? null,
          dto.hosteller,
        ],
      );
      if (dto.discounts !== undefined)
        await this.setup.replaceStudentDiscounts(c, studentId, yearId, dto.discounts, null);
      const after = await this.findProfile(c, studentId, yearId);
      await this.audit.stage(ctx, c, {
        action: 'fees.profile.set',
        entityType: 'student_fee_profiles',
        entityId: studentId,
        before,
        after: dto.discounts === undefined ? after : { ...after, discounts: dto.discounts },
      });
      return after;
    });
  }

  async generate(
    ctx: RequestContext,
    studentId: string,
  ): Promise<{ runId: string; rows: number; total: string }> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ run_id: string; rows: number; total: string }>(
        `SELECT o_run_id::text AS run_id, o_rows AS rows, o_total::text AS total FROM app.generate_fee_demand($1, $2)`,
        [studentId, yearId],
      );
      const out = r.rows[0]!;
      await c.query(`SELECT app.apply_instalment_override($1, $2, $3)`, [
        studentId,
        yearId,
        out.run_id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'fees.demand.generate',
        entityType: 'fee_demand_runs',
        entityId: out.run_id,
        after: { studentId, rows: out.rows, total: out.total },
      });
      return { runId: out.run_id, rows: out.rows, total: out.total };
    });
  }

  /** Generates for every active student of a class; skips students the routine refuses and reports them. */
  async generateForClass(ctx: RequestContext, classId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    const students = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string; name: string }>(
        `SELECT s.id::text, s.display_name AS name FROM enrolments e JOIN students s ON s.id = e.student_id JOIN class_sections cs ON cs.id = e.class_section_id
          WHERE e.academic_year_id = $1 AND cs.class_id = $2 AND e.status = 'active' AND s.deleted_at IS NULL ORDER BY cs.name, e.roll_no`,
        [yearId, classId],
      );
      return r.rows;
    });
    const done: Array<{ studentId: string; name: string; rows: number; total: string }> = [];
    const skipped: Array<{ studentId: string; name: string; reason: string }> = [];
    for (const s of students) {
      try {
        const out = await this.db.tenant(tenant, async (c) => {
          const r = await c.query<{ run_id: string; rows: number; total: string }>(
            `SELECT o_run_id::text AS run_id, o_rows AS rows, o_total::text AS total FROM app.generate_fee_demand($1, $2)`,
            [s.id, yearId],
          );
          await c.query(`SELECT app.apply_instalment_override($1, $2, $3)`, [
            s.id,
            yearId,
            r.rows[0]!.run_id,
          ]);
          return r.rows[0]!;
        });
        done.push({ studentId: s.id, name: s.name, rows: out.rows, total: out.total });
      } catch (error) {
        skipped.push({ studentId: s.id, name: s.name, reason: (error as Error).message });
      }
    }
    await this.db.tenant(tenant, (c) =>
      this.audit.stage(ctx, c, {
        action: 'fees.demand.generate_class',
        entityType: 'fee_demand_runs',
        entityId: classId,
        after: { generated: done.length, skipped: skipped.length },
      }),
    );
    return {
      generated: done.length,
      skipped,
      total: done.reduce((s, d) => s + Number(d.total), 0).toFixed(2),
    };
  }

  async demands(
    ctx: RequestContext,
    studentId: string,
    q: ListDemandsQueryDto,
  ): Promise<DemandSummary> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      // a pupil outside the tenant (or deleted) is a 404, never an empty 200 (Sprint 16 VAPT retest)
      const known = await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
        studentId,
      ]);
      if (known.rowCount === 0)
        throw new DomainError('not-found', 'Student not found', { status: 404 });
      const params: unknown[] = [studentId, yearId];
      let where = 'd.student_id = $1 AND d.academic_year_id = $2';
      if (q.status) {
        params.push(q.status);
        where += ` AND d.status = $3::fee_demand_status`;
      }
      const r = await c.query<DemandRow>(
        // eslint-disable-next-line no-restricted-syntax -- where is built from fixed fragments; values are bound parameters
        `SELECT d.id::text, d.period_id::text AS "periodId", p.name AS "periodName", p.sequence, p.instalment, d.head_id::text AS "headId", h.code AS "headCode", h.name AS "headName",
                d.gross::text, d.discount::text, d.net::text, d.paid::text, d.status::text, d.due_on::text AS "dueOn", d.source
           FROM fee_demands d JOIN fee_periods p ON p.id = d.period_id JOIN fee_heads h ON h.id = d.head_id
          WHERE ${where} ORDER BY p.sequence, h.sort_order, h.code`,
        params,
      );
      const byInstalment = new Map<
        number,
        { instalment: number; dueOn: string; net: number; paid: number }
      >();
      let net = 0;
      let paid = 0;
      for (const d of r.rows) {
        const cur = byInstalment.get(d.instalment) ?? {
          instalment: d.instalment,
          dueOn: d.dueOn,
          net: 0,
          paid: 0,
        };
        cur.net += Number(d.net);
        cur.paid += Number(d.paid);
        if (d.dueOn < cur.dueOn) cur.dueOn = d.dueOn;
        byInstalment.set(d.instalment, cur);
        net += Number(d.net);
        paid += Number(d.paid);
      }
      const run = await c.query<{
        id: string;
        ran_at: Date;
        ran_by: string | null;
        rows: number;
        total: string;
      }>(
        `SELECT r.id::text, r.ran_at, u.display_name AS ran_by, r.rows, r.total::text FROM fee_demand_runs r LEFT JOIN users u ON u.id = r.ran_by
          WHERE r.student_id = $1 AND r.academic_year_id = $2 ORDER BY r.id DESC LIMIT 1`,
        [studentId, yearId],
      );
      return {
        rows: r.rows,
        byInstalment: [...byInstalment.values()]
          .sort((a, b) => a.instalment - b.instalment)
          .map((x) => ({
            instalment: x.instalment,
            dueOn: x.dueOn,
            net: x.net.toFixed(2),
            paid: x.paid.toFixed(2),
            balance: (x.net - x.paid).toFixed(2),
          })),
        total: { net: net.toFixed(2), paid: paid.toFixed(2), balance: (net - paid).toFixed(2) },
        lastRun: run.rows[0]
          ? {
              id: run.rows[0].id,
              ranAt: run.rows[0].ran_at.toISOString(),
              ranBy: run.rows[0].ran_by,
              rows: run.rows[0].rows,
              total: run.rows[0].total,
            }
          : null,
      };
    });
  }

  async classSummary(ctx: RequestContext, classId: string) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        student_id: string;
        name: string;
        admission_no: string;
        section: string;
        roll_no: number | null;
        net: string;
        paid: string;
        rows: number;
        profile: boolean;
        student_type: string;
        fee_group: string;
        discounts: string | null;
        gross: string;
        discount: string;
        transport: string;
        other: string;
        stale: boolean;
      }>(
        `SELECT s.id::text AS student_id, s.display_name AS name, s.admission_no, cl.code || '-' || cs.name AS section, e.roll_no,
                COALESCE((SELECT sum(net) FROM fee_demands d WHERE d.student_id = s.id AND d.academic_year_id = $1), 0)::text AS net,
                COALESCE((SELECT sum(paid) FROM fee_demands d WHERE d.student_id = s.id AND d.academic_year_id = $1), 0)::text AS paid,
                (SELECT count(*)::int FROM fee_demands d WHERE d.student_id = s.id AND d.academic_year_id = $1) AS rows,
                EXISTS (SELECT 1 FROM student_fee_profiles p WHERE p.student_id = s.id AND p.academic_year_id = $1) AS profile,
                -- what makes one pupil's total differ from another's
                COALESCE((SELECT p.student_type FROM student_fee_profiles p WHERE p.student_id = s.id AND p.academic_year_id = $1),
                         CASE WHEN s.admitted_on >= (SELECT start_date FROM academic_years WHERE id = $1) THEN 'new' ELSE 'old' END) AS student_type,
                COALESCE((SELECT p.fee_group FROM student_fee_profiles p WHERE p.student_id = s.id AND p.academic_year_id = $1), 'general') AS fee_group,
                (SELECT string_agg(DISTINCT x.name, ', ') FROM (
                   SELECT d.name FROM student_fee_profiles p JOIN fee_discounts d ON d.id = p.discount_id WHERE p.student_id = s.id AND p.academic_year_id = $1
                   UNION SELECT d.name FROM student_fee_discounts sd JOIN fee_discounts d ON d.id = sd.discount_id
                          WHERE sd.student_id = s.id AND sd.academic_year_id = $1 AND sd.status = 'active') x) AS discounts,
                COALESCE((SELECT sum(gross) FROM fee_demands d WHERE d.student_id = s.id AND d.academic_year_id = $1 AND d.source = 'structure'), 0)::text AS gross,
                COALESCE((SELECT sum(discount) FROM fee_demands d WHERE d.student_id = s.id AND d.academic_year_id = $1), 0)::text AS discount,
                COALESCE((SELECT sum(gross) FROM fee_demands d WHERE d.student_id = s.id AND d.academic_year_id = $1 AND d.source = 'transport'), 0)::text AS transport,
                COALESCE((SELECT sum(gross) FROM fee_demands d WHERE d.student_id = s.id AND d.academic_year_id = $1 AND d.source NOT IN ('structure', 'transport')), 0)::text AS other,
                -- the class structure was changed after this pupil's bill was last made
                COALESCE((SELECT max(r.ran_at) FROM fee_demand_runs r WHERE r.student_id = s.id AND r.academic_year_id = $1), 'epoch'::timestamptz)
                  < COALESCE((SELECT max(fs.updated_at) FROM fee_structures fs WHERE fs.academic_year_id = $1 AND fs.class_id = $2), 'epoch'::timestamptz) AS stale
           FROM enrolments e JOIN students s ON s.id = e.student_id JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes cl ON cl.id = cs.class_id
          WHERE e.academic_year_id = $1 AND cs.class_id = $2 AND e.status = 'active' AND s.deleted_at IS NULL ORDER BY cs.name, e.roll_no NULLS LAST, s.display_name`,
        [yearId, classId],
      );
      return r.rows.map((x) => ({
        studentId: x.student_id,
        name: x.name,
        admissionNo: x.admission_no,
        section: x.section,
        rollNo: x.roll_no,
        net: x.net,
        paid: x.paid,
        balance: (Number(x.net) - Number(x.paid)).toFixed(2),
        rows: x.rows,
        hasProfile: x.profile,
        studentType: x.student_type,
        feeGroup: x.fee_group,
        discounts: x.discounts,
        fee: x.gross,
        discount: x.discount,
        transport: x.transport,
        other: x.other,
        stale: x.stale,
      }));
    });
  }
}
