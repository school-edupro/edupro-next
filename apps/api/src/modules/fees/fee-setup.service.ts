import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type {
  AddPaymentModeDto,
  SetClassRulesDto,
  SetPaymentModeDto,
  StudentDiscountInput,
} from './fees.dto';

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
  /** The school's quarter number and the class's own (null = the school's). */
  schoolInstalment: number;
  instalment: number | null;
  startOn: string | null;
  challanOn: string | null;
  bounceCharge: string | null;
  feePay: boolean;
  show: boolean;
}
export interface ClassRules {
  classId: string;
  bounceCharge: string | null;
  schoolBounceCharge: string;
  /** What is in force for the class, and the class's own choice (null = the school's). */
  lateFeeMode: 'slab' | 'daywise';
  classLateMode: 'slab' | 'daywise' | null;
  classLatePerDay: string | null;
  lateMax: string | null;
  schoolLatePerDay: string;
  periods: ClassRulePeriod[];
}
export interface PaymentModeRow {
  code: string;
  /** The built-in kind it works like; a built-in mode is its own kind. */
  kind: string;
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

const MODE_COLS = `code, kind, label, at_counter AS "atCounter", need_reference AS "needReference", need_instrument_no AS "needInstrumentNo",
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
                fp.instalment AS "schoolInstalment", r.instalment, r.start_on::text AS "startOn", r.challan_on::text AS "challanOn",
                r.bounce_charge::text AS "bounceCharge", COALESCE(r.fee_pay, true) AS "feePay", COALESCE(r.show, true) AS show,
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
        class_mode: 'slab' | 'daywise' | null;
        class_per_day: string | null;
        late_max: string | null;
        school_per_day: string | null;
      }>(
        `SELECT cc.bounce_charge::text AS bounce, cc.late_mode AS class_mode, cc.late_per_day::text AS class_per_day, cc.late_max::text AS late_max,
                app.setting('fees.bounce_charge') #>> '{}' AS school, app.setting('fees.late_fee_mode') #>> '{}' AS mode,
                app.setting('fees.late_fee_per_day') #>> '{}' AS school_per_day
           FROM (SELECT 1) one LEFT JOIN fee_class_charges cc ON cc.academic_year_id = $1 AND cc.class_id = $2`,
        [yearId, classId],
      );
      const x = extra.rows[0];
      return {
        classId,
        bounceCharge: x?.bounce ?? null,
        schoolBounceCharge: x?.school ?? '0',
        lateFeeMode: (x?.class_mode ?? x?.mode) === 'slab' ? 'slab' : 'daywise',
        classLateMode: x?.class_mode ?? null,
        classLatePerDay: x?.class_per_day ?? null,
        lateMax: x?.late_max ?? null,
        schoolLatePerDay: x?.school_per_day ?? '0',
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
        const empty =
          !p.dueOn &&
          lateFee === null &&
          (p.latePerDay ?? null) === null &&
          (p.instalment ?? null) === null &&
          !p.startOn &&
          !p.challanOn &&
          (p.bounceCharge ?? null) === null &&
          p.feePay !== false &&
          p.show !== false;
        if (empty) {
          await c.query(
            `DELETE FROM fee_period_class_rules WHERE period_id = $1 AND class_id = $2`,
            [p.periodId, classId],
          );
        } else {
          await c.query(
            `INSERT INTO fee_period_class_rules (school_id, period_id, class_id, due_on, late_fee_amount, late_slab_1_on, late_slab_1_amount,
                    late_slab_2_on, late_slab_2_amount, late_slab_3_on, late_slab_3_amount, late_per_day,
                    instalment, start_on, challan_on, bounce_charge, fee_pay, show, updated_by)
             VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5::date, $6, $7::date, $8, $9::date, $10, $11,
                     $12, $13::date, $14::date, $15, $16, $17, app.current_user_id())
             ON CONFLICT (period_id, class_id) DO UPDATE SET due_on = EXCLUDED.due_on, late_fee_amount = EXCLUDED.late_fee_amount,
               late_slab_1_on = EXCLUDED.late_slab_1_on, late_slab_1_amount = EXCLUDED.late_slab_1_amount,
               late_slab_2_on = EXCLUDED.late_slab_2_on, late_slab_2_amount = EXCLUDED.late_slab_2_amount,
               late_slab_3_on = EXCLUDED.late_slab_3_on, late_slab_3_amount = EXCLUDED.late_slab_3_amount,
               late_per_day = EXCLUDED.late_per_day, instalment = EXCLUDED.instalment, start_on = EXCLUDED.start_on, challan_on = EXCLUDED.challan_on,
               bounce_charge = EXCLUDED.bounce_charge, fee_pay = EXCLUDED.fee_pay, show = EXCLUDED.show, updated_at = now(), updated_by = app.current_user_id()`,
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
              p.instalment ?? null,
              p.startOn ?? null,
              p.challanOn ?? null,
              p.bounceCharge ?? null,
              p.feePay !== false,
              p.show !== false,
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
      // the class's own bounce charge and way of charging late fee; a row with nothing of its own goes
      if (
        dto.bounceCharge !== undefined ||
        dto.lateMode !== undefined ||
        dto.latePerDay !== undefined ||
        dto.lateMax !== undefined
      ) {
        await c.query(
          `INSERT INTO fee_class_charges (school_id, academic_year_id, class_id, bounce_charge, late_mode, late_per_day, late_max, updated_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, app.current_user_id())
           ON CONFLICT (academic_year_id, class_id) DO UPDATE SET
             bounce_charge = CASE WHEN $7 THEN EXCLUDED.bounce_charge ELSE fee_class_charges.bounce_charge END,
             late_mode = CASE WHEN $8 THEN EXCLUDED.late_mode ELSE fee_class_charges.late_mode END,
             late_per_day = CASE WHEN $9 THEN EXCLUDED.late_per_day ELSE fee_class_charges.late_per_day END,
             late_max = CASE WHEN $10 THEN EXCLUDED.late_max ELSE fee_class_charges.late_max END,
             updated_at = now(), updated_by = app.current_user_id()`,
          [
            yearId,
            classId,
            dto.bounceCharge ?? null,
            dto.lateMode ?? null,
            dto.latePerDay ?? null,
            dto.lateMax ?? null,
            dto.bounceCharge !== undefined,
            dto.lateMode !== undefined,
            dto.latePerDay !== undefined,
            dto.lateMax !== undefined,
          ],
        );
        await c.query(
          `DELETE FROM fee_class_charges WHERE academic_year_id = $1 AND class_id = $2
              AND bounce_charge IS NULL AND late_mode IS NULL AND late_per_day IS NULL AND late_max IS NULL`,
          [yearId, classId],
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

  /** The bounce charge for a pupil: this month's own for the class, then the class's, else null (the school's). */
  async bounceChargeFor(c: PoolClient, studentId: string, yearId: string): Promise<number | null> {
    const r = await c.query<{ v: string | null }>(
      `SELECT COALESCE(
                (SELECT cr.bounce_charge FROM fee_period_class_rules cr JOIN fee_periods fp ON fp.id = cr.period_id
                  WHERE cr.class_id = k.class_id AND fp.academic_year_id = $2 AND cr.bounce_charge IS NOT NULL
                    AND make_date(fp.year, fp.month, 1) <= CURRENT_DATE ORDER BY fp.sequence DESC LIMIT 1),
                (SELECT cc.bounce_charge FROM fee_class_charges cc WHERE cc.class_id = k.class_id AND cc.academic_year_id = $2))::text AS v
         FROM (SELECT cs.class_id FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                WHERE e.student_id = $1 AND e.academic_year_id = $2 ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) k`,
      [studentId, yearId],
    );
    return r.rows[0]?.v != null ? Number(r.rows[0].v) : null;
  }

  /** Copies one class's whole calendar (months, late fee choice, bounce charge) onto other classes. */
  async cloneClassRules(ctx: RequestContext, classId: string, toClassIds: string[]) {
    const yearId = this.year(ctx);
    const targets = [...new Set(toClassIds)].filter((id) => id !== classId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const ok = await c.query(`SELECT id FROM classes WHERE id = ANY($1::bigint[])`, [
        [classId, ...targets],
      ]);
      if (ok.rowCount !== targets.length + 1)
        throw new DomainError('not-found', 'Class not found', { status: 404 });
      for (const to of targets) {
        await c.query(
          `DELETE FROM fee_period_class_rules r USING fee_periods fp WHERE fp.id = r.period_id AND fp.academic_year_id = $1 AND r.class_id = $2`,
          [yearId, to],
        );
        await c.query(
          `INSERT INTO fee_period_class_rules (school_id, period_id, class_id, due_on, late_fee_amount, late_slab_1_on, late_slab_1_amount, late_slab_2_on,
                  late_slab_2_amount, late_slab_3_on, late_slab_3_amount, late_per_day, instalment, start_on, challan_on, bounce_charge, fee_pay, show, updated_by)
           SELECT r.school_id, r.period_id, $3, r.due_on, r.late_fee_amount, r.late_slab_1_on, r.late_slab_1_amount, r.late_slab_2_on, r.late_slab_2_amount,
                  r.late_slab_3_on, r.late_slab_3_amount, r.late_per_day, r.instalment, r.start_on, r.challan_on, r.bounce_charge, r.fee_pay, r.show, app.current_user_id()
             FROM fee_period_class_rules r JOIN fee_periods fp ON fp.id = r.period_id WHERE fp.academic_year_id = $1 AND r.class_id = $2`,
          [yearId, classId, to],
        );
        await c.query(
          `DELETE FROM fee_class_charges WHERE academic_year_id = $1 AND class_id = $2`,
          [yearId, to],
        );
        await c.query(
          `INSERT INTO fee_class_charges (school_id, academic_year_id, class_id, bounce_charge, late_mode, late_per_day, late_max, updated_by)
           SELECT school_id, academic_year_id, $3, bounce_charge, late_mode, late_per_day, late_max, app.current_user_id()
             FROM fee_class_charges WHERE academic_year_id = $1 AND class_id = $2`,
          [yearId, classId, to],
        );
        // bills not yet settled follow the last dates now in force for the class
        await c.query(
          `UPDATE fee_demands d SET due_on = app.fee_due_on(fp.id, $2, fp.due_on), updated_at = now()
             FROM fee_periods fp
            WHERE fp.academic_year_id = $1 AND d.period_id = fp.id AND d.status IN ('pending', 'partial')
              AND d.due_on IS DISTINCT FROM app.fee_due_on(fp.id, $2, fp.due_on)
              AND d.student_id IN (SELECT e.student_id FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                                    WHERE cs.class_id = $2 AND e.academic_year_id = $1 AND e.status = 'active')`,
          [yearId, to],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.class_rules.clone',
        entityType: 'classes',
        entityId: classId,
        after: { toClassIds: targets },
      });
      return { cloned: targets.length };
    });
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

  /** The school's own mode: a name and the built-in kind it works like. */
  async addPaymentMode(ctx: RequestContext, dto: AddPaymentModeDto): Promise<PaymentModeRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.fee_seed_payment_modes()`);
      const base = dto.label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 24);
      const code = `x_${base || 'mode'}`;
      const dup = await c.query(
        `SELECT 1 FROM fee_payment_modes WHERE code = $1 OR lower(label) = lower($2)`,
        [code, dto.label],
      );
      if (dup.rowCount)
        throw new DomainError('conflict', `A payment mode named "${dto.label}" already exists`, {
          status: 409,
        });
      await c.query(
        `INSERT INTO fee_payment_modes (school_id, code, kind, label, at_counter, need_reference, need_instrument_no, need_instrument_date, need_bank, sort_order, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, true, $4, $5, $6, $7, 50, app.current_user_id())`,
        [
          code,
          dto.kind,
          dto.label,
          dto.needReference,
          // a mode that works like a cheque or a draft always needs its number
          dto.needInstrumentNo || dto.kind === 'cheque' || dto.kind === 'dd',
          dto.needInstrumentDate,
          dto.needBank,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.payment_mode.add',
        entityType: 'fee_payment_modes',
        entityId: code,
        after: dto,
      });
      return this.paymentModesWith(c);
    });
  }

  /** Only a mode the school added can be removed; receipts already made keep its name. */
  async removePaymentMode(ctx: RequestContext, code: string): Promise<PaymentModeRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(`DELETE FROM fee_payment_modes WHERE code = $1 AND code <> kind`, [
        code,
      ]);
      if (r.rowCount === 0)
        throw new DomainError('not-found', 'Only a mode added by the school can be removed', {
          status: 404,
        });
      await this.audit.stage(ctx, c, {
        action: 'fees.payment_mode.remove',
        entityType: 'fee_payment_modes',
        entityId: code,
        after: { code },
      });
      return this.paymentModesWith(c);
    });
  }

  /**
   * The counter's check before a receipt is posted: the mode is offered and its fields are filled.
   * Returns the school's own name of the mode when the cashier chose one the school added.
   */
  async assertModeFields(
    c: PoolClient,
    input: {
      mode: string;
      modeCode?: string | null;
      reference?: string | null;
      instrumentNo?: string | null;
      instrumentDate?: string | null;
      bankName?: string | null;
    },
  ): Promise<string | null> {
    const modes = await this.paymentModesWith(c);
    const own = input.modeCode
      ? modes.find((x) => x.code === input.modeCode && x.kind === input.mode)
      : undefined;
    if (input.modeCode && !own)
      throw new DomainError('fees.mode_invalid', 'This payment mode is not set up', {
        status: 422,
      });
    const m = own ?? modes.find((x) => x.code === input.mode);
    if (!m) return null;
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
    return own ? own.label : null;
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
