import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { SetClassRulesDto, SetPaymentModeDto, StudentDiscountInput } from './fees.dto';

export interface ClassRulePeriod {
  periodId: string;
  sequence: number;
  name: string;
  /** The school's values, shown beside the class's own. */
  schoolDueOn: string;
  schoolLateFee: string;
  dueOn: string | null;
  lateFeeAmount: string | null;
  slabs: Array<{ on: string; amount: string }>;
  latePerDay: string | null;
}
export interface ClassRules {
  classId: string;
  bounceCharge: string | null;
  schoolBounceCharge: string;
  lateFeeMode: 'slab' | 'daywise';
  periods: ClassRulePeriod[];
}
export interface PaymentModeRow {
  code: string;
  label: string;
  atCounter: boolean;
  needReference: boolean;
  needInstrumentNo: boolean;
  needInstrumentDate: boolean;
  needBank: boolean;
}
export interface StudentDiscountRow {
  id: string;
  discountId: string;
  code: string;
  name: string;
  head: string | null;
  percent: string | null;
  amount: string | null;
  fromSeq: number;
  toSeq: number;
  fromName: string | null;
  toName: string | null;
}

const MODE_COLS = `code, label, at_counter AS "atCounter", need_reference AS "needReference", need_instrument_no AS "needInstrumentNo",
  need_instrument_date AS "needInstrumentDate", need_bank AS "needBank"`;

/**
 * Fee set-up, second pass: a class's own last dates, late fee and bounce charge; the payment mode
 * master; and the list of discounts a pupil holds month by month.
 */
@Injectable()
export class FeeSetupService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private year(ctx: RequestContext): string {
    const tenant = requireTenant(ctx);
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  // ---- class rules ------------------------------------------------------------------------------
  async classRules(ctx: RequestContext, classId: string): Promise<ClassRules> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const cls = await c.query(`SELECT 1 FROM classes WHERE id = $1`, [classId]);
      if (cls.rowCount === 0)
        throw new DomainError('not-found', 'Class not found', { status: 404 });
      const p = await c.query<
        Omit<ClassRulePeriod, 'slabs'> & { slabs: ClassRulePeriod['slabs'] | null }
      >(
        `SELECT fp.id::text AS "periodId", fp.sequence, fp.name, fp.due_on::text AS "schoolDueOn", fp.late_fee_amount::text AS "schoolLateFee",
                r.due_on::text AS "dueOn", r.late_fee_amount::text AS "lateFeeAmount", r.late_per_day::text AS "latePerDay",
                (SELECT jsonb_agg(jsonb_build_object('on', s.on_date::text, 'amount', s.amount::text) ORDER BY s.on_date)
                   FROM (VALUES (r.late_slab_1_on, r.late_slab_1_amount), (r.late_slab_2_on, r.late_slab_2_amount), (r.late_slab_3_on, r.late_slab_3_amount)) AS s(on_date, amount)
                  WHERE s.on_date IS NOT NULL) AS slabs
           FROM fee_periods fp LEFT JOIN fee_period_class_rules r ON r.period_id = fp.id AND r.class_id = $2
          WHERE fp.academic_year_id = $1 ORDER BY fp.sequence`,
        [yearId, classId],
      );
      const extra = await c.query<{
        bounce: string | null;
        school: string | null;
        mode: string | null;
      }>(
        `SELECT (SELECT bounce_charge::text FROM fee_class_charges WHERE academic_year_id = $1 AND class_id = $2) AS bounce,
                app.setting('fees.bounce_charge') #>> '{}' AS school, app.setting('fees.late_fee_mode') #>> '{}' AS mode`,
        [yearId, classId],
      );
      return {
        classId,
        bounceCharge: extra.rows[0]?.bounce ?? null,
        schoolBounceCharge: extra.rows[0]?.school ?? '0',
        lateFeeMode: extra.rows[0]?.mode === 'slab' ? 'slab' : 'daywise',
        periods: p.rows.map((r) => ({ ...r, slabs: r.slabs ?? [] })),
      };
    });
  }

  /**
   * Saves the class's own values. A row with nothing of its own is removed (back to the school's).
   * Unpaid and part-paid bills of the class move to the new last date at once.
   */
  async setClassRules(
    ctx: RequestContext,
    classId: string,
    dto: SetClassRulesDto,
  ): Promise<ClassRules> {
    const yearId = this.year(ctx);
    await this.db.tenant(requireTenant(ctx), async (c) => {
      const cls = await c.query(`SELECT 1 FROM classes WHERE id = $1`, [classId]);
      if (cls.rowCount === 0)
        throw new DomainError('not-found', 'Class not found', { status: 404 });
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      for (const p of dto.periods) {
        const own = await c.query(
          `SELECT 1 FROM fee_periods WHERE id = $1 AND academic_year_id = $2`,
          [p.periodId, yearId],
        );
        if (own.rowCount === 0)
          throw new DomainError('not-found', 'Fee period not found', { status: 404 });
        const slabs = [...p.slabs].sort((a, b) => a.on.localeCompare(b.on));
        const lateFee = p.lateFeeAmount ?? (slabs.length > 0 ? 0 : null);
        const empty = !p.dueOn && lateFee === null && (p.latePerDay ?? null) === null;
        if (empty) {
          await c.query(
            `DELETE FROM fee_period_class_rules WHERE period_id = $1 AND class_id = $2`,
            [p.periodId, classId],
          );
        } else {
          await c.query(
            `INSERT INTO fee_period_class_rules (school_id, period_id, class_id, due_on, late_fee_amount, late_slab_1_on, late_slab_1_amount,
                    late_slab_2_on, late_slab_2_amount, late_slab_3_on, late_slab_3_amount, late_per_day, updated_by)
             VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5::date, $6, $7::date, $8, $9::date, $10, $11, app.current_user_id())
             ON CONFLICT (period_id, class_id) DO UPDATE SET due_on = EXCLUDED.due_on, late_fee_amount = EXCLUDED.late_fee_amount,
               late_slab_1_on = EXCLUDED.late_slab_1_on, late_slab_1_amount = EXCLUDED.late_slab_1_amount,
               late_slab_2_on = EXCLUDED.late_slab_2_on, late_slab_2_amount = EXCLUDED.late_slab_2_amount,
               late_slab_3_on = EXCLUDED.late_slab_3_on, late_slab_3_amount = EXCLUDED.late_slab_3_amount,
               late_per_day = EXCLUDED.late_per_day, updated_at = now(), updated_by = app.current_user_id()`,
            [
              p.periodId,
              classId,
              p.dueOn ?? null,
              lateFee === null ? null : lateFee.toFixed(2),
              slabs[0]?.on ?? null,
              slabs[0] ? slabs[0].amount.toFixed(2) : null,
              slabs[1]?.on ?? null,
              slabs[1] ? slabs[1].amount.toFixed(2) : null,
              slabs[2]?.on ?? null,
              slabs[2] ? slabs[2].amount.toFixed(2) : null,
              p.latePerDay ?? null,
            ],
          );
        }
        // bills not yet settled follow the last date now in force for the class
        await c.query(
          `UPDATE fee_demands d SET due_on = app.fee_due_on(fp.id, $2, fp.due_on), updated_at = now()
             FROM fee_periods fp
            WHERE fp.id = $1 AND d.period_id = fp.id AND d.status IN ('pending', 'partial')
              AND d.due_on IS DISTINCT FROM app.fee_due_on(fp.id, $2, fp.due_on)
              AND d.student_id IN (SELECT e.student_id FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                                    WHERE cs.class_id = $2 AND e.academic_year_id = $3 AND e.status = 'active')`,
          [p.periodId, classId, yearId],
        );
      }
      if (dto.bounceCharge !== undefined) {
        if (dto.bounceCharge === null)
          await c.query(
            `DELETE FROM fee_class_charges WHERE academic_year_id = $1 AND class_id = $2`,
            [yearId, classId],
          );
        else
          await c.query(
            `INSERT INTO fee_class_charges (school_id, academic_year_id, class_id, bounce_charge, updated_by)
             VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id())
             ON CONFLICT (academic_year_id, class_id) DO UPDATE SET bounce_charge = EXCLUDED.bounce_charge, updated_at = now(), updated_by = app.current_user_id()`,
            [yearId, classId, dto.bounceCharge.toFixed(2)],
          );
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.class_rules.set',
        entityType: 'classes',
        entityId: classId,
        after: dto,
      });
    });
    return this.classRules(ctx, classId);
  }

  /** The bounce charge for a pupil: the class's own, else null (the caller falls back to the school's). */
  async bounceChargeFor(c: PoolClient, studentId: string, yearId: string): Promise<number | null> {
    const r = await c.query<{ v: string }>(
      `SELECT cc.bounce_charge::text AS v
         FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
         JOIN fee_class_charges cc ON cc.class_id = cs.class_id AND cc.academic_year_id = e.academic_year_id
        WHERE e.student_id = $1 AND e.academic_year_id = $2
        ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1`,
      [studentId, yearId],
    );
    return r.rows[0] ? Number(r.rows[0].v) : null;
  }

  // ---- payment modes ----------------------------------------------------------------------------
  async paymentModesWith(c: PoolClient): Promise<PaymentModeRow[]> {
    await c.query(`SELECT app.fee_seed_payment_modes()`);
    const r = await c.query<PaymentModeRow>(
      // eslint-disable-next-line no-restricted-syntax -- column list constant; no values interpolated
      `SELECT ${MODE_COLS} FROM fee_payment_modes ORDER BY sort_order, code`,
    );
    return r.rows;
  }

  async paymentModes(ctx: RequestContext): Promise<PaymentModeRow[]> {
    return this.db.tenant(requireTenant(ctx), (c) => this.paymentModesWith(c));
  }

  async setPaymentMode(
    ctx: RequestContext,
    code: string,
    dto: SetPaymentModeDto,
  ): Promise<PaymentModeRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.fee_seed_payment_modes()`);
      // the gateway mode is never typed at the counter
      const atCounter = code === 'online' ? false : dto.atCounter;
      const r = await c.query(
        `UPDATE fee_payment_modes SET label = $2, at_counter = $3, need_reference = $4, need_instrument_no = $5, need_instrument_date = $6, need_bank = $7,
                updated_at = now(), updated_by = app.current_user_id() WHERE code = $1`,
        [
          code,
          dto.label,
          atCounter,
          dto.needReference,
          dto.needInstrumentNo,
          dto.needInstrumentDate,
          dto.needBank,
        ],
      );
      if (r.rowCount === 0)
        throw new DomainError('not-found', 'Payment mode not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'fees.payment_mode.set',
        entityType: 'fee_payment_modes',
        entityId: code,
        after: { ...dto, atCounter },
      });
      return this.paymentModesWith(c);
    });
  }

  /** The counter's check before a receipt is posted: the mode is offered and its fields are filled. */
  async assertModeFields(
    c: PoolClient,
    input: {
      mode: string;
      reference?: string | null;
      instrumentNo?: string | null;
      instrumentDate?: string | null;
      bankName?: string | null;
    },
  ): Promise<void> {
    const modes = await this.paymentModesWith(c);
    const m = modes.find((x) => x.code === input.mode);
    if (!m) return;
    if (!m.atCounter)
      throw new DomainError('fees.mode_not_offered', `${m.label} is not accepted at the counter`, {
        status: 409,
      });
    const missing: string[] = [];
    if (m.needReference && !input.reference?.trim()) missing.push('reference number');
    if (m.needInstrumentNo && !input.instrumentNo?.trim()) missing.push('cheque / draft number');
    if (m.needInstrumentDate && !input.instrumentDate) missing.push('cheque / draft date');
    if (m.needBank && !input.bankName?.trim()) missing.push('bank name');
    // a cheque or draft without its number keeps the error the counter has always shown
    if (m.needInstrumentNo && !input.instrumentNo?.trim())
      throw new DomainError('fees.instrument_required', `${m.label} needs: ${missing.join(', ')}`, {
        status: 400,
      });
    if (missing.length > 0)
      throw new DomainError(
        'fees.mode_fields_required',
        `${m.label} needs: ${missing.join(', ')}`,
        {
          status: 422,
        },
      );
  }

  // ---- a pupil's discounts ----------------------------------------------------------------------
  async studentDiscountsWith(
    c: PoolClient,
    studentId: string,
    yearId: string,
  ): Promise<StudentDiscountRow[]> {
    const r = await c.query<StudentDiscountRow>(
      `SELECT s.id::text, s.discount_id::text AS "discountId", d.code, d.name, h.name AS head, d.percent::text, d.amount::text,
              s.from_seq AS "fromSeq", s.to_seq AS "toSeq",
              (SELECT name FROM fee_periods WHERE academic_year_id = s.academic_year_id AND sequence = s.from_seq) AS "fromName",
              (SELECT name FROM fee_periods WHERE academic_year_id = s.academic_year_id AND sequence = s.to_seq) AS "toName"
         FROM student_fee_discounts s JOIN fee_discounts d ON d.id = s.discount_id LEFT JOIN fee_heads h ON h.id = d.head_id
        WHERE s.student_id = $1 AND s.academic_year_id = $2 AND s.status = 'active' ORDER BY s.from_seq, d.name`,
      [studentId, yearId],
    );
    return r.rows;
  }

  async studentDiscounts(ctx: RequestContext, studentId: string): Promise<StudentDiscountRow[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), (c) =>
      this.studentDiscountsWith(c, studentId, yearId),
    );
  }

  /** Replaces the pupil's list: what is there is closed, the new list is written. */
  async replaceStudentDiscounts(
    c: PoolClient,
    studentId: string,
    yearId: string,
    list: StudentDiscountInput[],
    changeId: string | null,
  ): Promise<void> {
    for (const d of list) {
      const ok = await c.query(
        `SELECT 1 FROM fee_discounts WHERE id = $1 AND academic_year_id = $2 AND status = 'active'`,
        [d.discountId, yearId],
      );
      if (ok.rowCount === 0)
        throw new DomainError('not-found', 'Discount not found in this year', { status: 404 });
    }
    await c.query(
      `UPDATE student_fee_discounts SET status = 'removed', removed_at = now(), removed_by = app.current_user_id()
        WHERE student_id = $1 AND academic_year_id = $2 AND status = 'active'`,
      [studentId, yearId],
    );
    for (const d of list)
      await c.query(
        `INSERT INTO student_fee_discounts (school_id, student_id, academic_year_id, discount_id, from_seq, to_seq, change_id, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id())`,
        [studentId, yearId, d.discountId, d.fromSeq, d.toSeq, changeId],
      );
  }
}
