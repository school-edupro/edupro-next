import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { ReportsService } from '../reports/reports.service';
import { TemplatesService } from '../platform/templates/templates.service';
import type { SetLateFeeOverrideDto, SetPeriodLateFeeDto, SetReceiptSequenceDto } from './fees.dto';

export interface LateFee {
  amount: string;
  /** none, daywise, slab or override */
  mode: string;
  days: number;
  overridden: boolean;
  reason: string | null;
  periodId: string | null;
  /** Sprint 13: what receipts have already charged for this instalment, and what is still to collect. */
  posted: string;
  outstanding: string;
}

export interface LedgerInstalment {
  dueOn: string;
  /** Sprint 14: school or hostel; receipts settle one ledger at a time */
  ledger: string;
  label: string;
  instalment: number;
  sequences: number[];
  net: string;
  paid: string;
  balance: string;
  lateFee: LateFee;
  visibleFrom: string;
  visible: boolean;
  /** paid, overdue, due (visible, not yet overdue) or upcoming (not yet visible) */
  status: 'paid' | 'overdue' | 'due' | 'upcoming';
}

export interface LedgerPayment {
  id: string;
  receiptNo: string | null;
  receivedOn: string;
  amount: string;
  mode: string;
  reference: string | null;
  remarks: string | null;
  receivedBy: string | null;
  allocated: string;
  unallocated: string;
  intentId: string | null;
  /** Sprint 13 */
  lateFee: string;
  refunded: string;
  status: 'posted' | 'partly_refunded' | 'refunded' | 'bounced';
  instrumentNo: string | null;
  bankName: string | null;
  settled: boolean;
}

export interface LedgerRefund {
  id: string;
  paymentId: string;
  receiptNo: string | null;
  amount: string;
  reason: string;
  mode: string;
  status: string;
  requestedAt: string;
  paidOn: string | null;
}

export interface LedgerOverride {
  id: string;
  periodId: string;
  periodName: string;
  amount: string;
  reason: string;
  createdBy: string | null;
  createdAt: string;
}

export interface DemandDiff {
  added: Array<{ period: string; head: string; net: string; dueOn: string }>;
  removed: Array<{ period: string; head: string; net: string; dueOn: string }>;
  changed: Array<{
    period: string;
    head: string;
    before: { net: string; dueOn: string };
    after: { net: string; dueOn: string };
  }>;
  kept: number;
  totalBefore: string;
  totalAfter: string;
}

export interface Ledger {
  student: { id: string; name: string; admissionNo: string; section: string | null };
  year: { id: string; code: string; status: string };
  asOf: string;
  lateFeeMode: string;
  instalments: LedgerInstalment[];
  totals: {
    net: string;
    paid: string;
    balance: string;
    lateFee: string;
    lateFeePosted: string;
    lateFeeOutstanding: string;
    /** balance plus the late fee not yet collected */
    payable: string;
  };
  payments: LedgerPayment[];
  refunds: LedgerRefund[];
  overrides: LedgerOverride[];
  lastRun: {
    id: string;
    ranAt: string;
    ranBy: string | null;
    rows: number;
    total: string;
    diff: DemandDiff | null;
  } | null;
}

export interface ReceiptSequenceRow {
  ledger: string;
  financialYearId: string;
  financialYear: string;
  prefix: string;
  width: number;
  nextNo: number;
  issued: number;
  configured: boolean;
}

const fmt = (n: number) => n.toFixed(2);

/**
 * Sprint 12 fee ledger: instalment view with the late fee rule (app.late_fee), visibility, overrides,
 * receipts with numbers, demand regeneration with a diff, and receipt sequences per ledger and financial year.
 */
@Injectable()
export class FeeLedgerService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
    private readonly templates: TemplatesService,
    private readonly viewer: ViewerService,
  ) {}

  /**
   * Sprint 13: the family's view. Each child's ledger with only the instalments the school has made
   * visible, receipts and refunds, and the payable amount an online payment may cover.
   */
  async mine(ctx: RequestContext): Promise<{
    children: Array<
      Ledger & {
        payableNow: string;
        hidden: number;
      }
    >;
  }> {
    const v = await this.viewer.resolve(ctx, 'fees.family.view');
    if (v.kind !== 'family') return { children: [] };
    const children = [];
    for (const s of v.students) {
      let ledger: Ledger;
      try {
        ledger = await this.ledger(ctx, s.id);
      } catch (error) {
        if (error instanceof DomainError && error.status === 404) continue;
        throw error;
      }
      const visible = ledger.instalments.filter((i) => i.visible);
      const payableNow = visible.reduce(
        (sum, i) => sum + Number(i.balance) + Number(i.lateFee.outstanding),
        0,
      );
      children.push({
        ...ledger,
        instalments: visible,
        hidden: ledger.instalments.length - visible.length,
        payableNow: fmt(Math.max(payableNow, 0)),
        lastRun: null,
        overrides: [],
      });
    }
    return { children };
  }

  private year(tenant: TenantContext): string {
    if (!tenant.academicYearId)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return tenant.academicYearId;
  }

  async ledger(ctx: RequestContext, studentId: string, asOf?: string): Promise<Ledger> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const st = await c.query<{
        id: string;
        name: string;
        admission_no: string;
        section: string | null;
      }>(
        `SELECT s.id::text, s.display_name AS name, s.admission_no,
                (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                  WHERE e.student_id = s.id AND e.academic_year_id = $2 ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) AS section
           FROM students s WHERE s.id = $1 AND s.deleted_at IS NULL`,
        [studentId, yearId],
      );
      if (!st.rows[0]) throw new DomainError('not-found', 'Student not found', { status: 404 });
      const y = await c.query<{ id: string; code: string; status: string }>(
        `SELECT id::text, code, status::text FROM academic_years WHERE id = $1`,
        [yearId],
      );
      const day = await c.query<{ as_of: string; mode: string; days_before: number }>(
        `SELECT COALESCE($1::date, CURRENT_DATE)::text AS as_of,
                COALESCE(app.setting('fees.late_fee_mode') #>> '{}', 'daywise') AS mode,
                COALESCE((app.setting('fees.instalment_visible_days_before') #>> '{}')::int, 30) AS days_before`,
        [asOf ?? null],
      );
      const { as_of: asOfDate, mode, days_before: daysBefore } = day.rows[0]!;
      const periods = await c.query<{
        id: string;
        sequence: number;
        name: string;
        instalment: number;
        due_on: string;
        visible_from: string | null;
      }>(
        `SELECT id::text, sequence, name, instalment, due_on::text, visible_from::text FROM fee_periods WHERE academic_year_id = $1 ORDER BY sequence`,
        [yearId],
      );
      const bySeq = new Map(periods.rows.map((p) => [p.sequence, p]));
      const groups = await c.query<{
        due_on: string;
        ledger: string;
        sequences: number[];
        instalment: number;
        net: string;
        paid: string;
      }>(
        `SELECT d.due_on::text, d.ledger::text AS ledger, array_agg(DISTINCT p.sequence ORDER BY p.sequence) AS sequences, min(p.instalment)::int AS instalment,
                sum(d.net)::text AS net, sum(d.paid)::text AS paid
           FROM fee_demands d JOIN fee_periods p ON p.id = d.period_id
          WHERE d.student_id = $1 AND d.academic_year_id = $2 AND d.status IN ('pending', 'partial', 'paid')
          GROUP BY d.due_on, d.ledger ORDER BY d.due_on, d.ledger`,
        [studentId, yearId],
      );
      const instalments: LedgerInstalment[] = [];
      let totNet = 0;
      let totPaid = 0;
      let totLate = 0;
      let totPosted = 0;
      let totOutstanding = 0;
      for (const g of groups.rows) {
        const lf = await c.query<{
          o_amount: string;
          o_mode: string;
          o_days: number;
          o_overridden: boolean;
          o_reason: string | null;
          o_period_id: string | null;
          posted: string;
        }>(
          `SELECT o_amount::text, o_mode, o_days, o_overridden, o_reason, o_period_id::text, app.late_fee_posted($1, $2, $3::date)::text AS posted
             FROM app.late_fee($1, $2, $3::date, $4::date)`,
          [studentId, yearId, g.due_on, asOfDate],
        );
        const l = lf.rows[0]!;
        if (g.ledger !== 'school') {
          // the late fee rule belongs to the school ledger; hostel instalments carry none (Sprint 14)
          l.o_amount = '0';
          l.o_mode = 'none';
          l.o_days = 0;
          l.posted = '0';
        }
        const first = bySeq.get(g.sequences[0]!);
        const last = bySeq.get(g.sequences[g.sequences.length - 1]!);
        const anchor =
          periods.rows.find((p) => p.due_on === g.due_on && p.sequence === g.sequences[0]) ??
          periods.rows.find((p) => p.due_on === g.due_on) ??
          first;
        const visibleFrom =
          anchor?.visible_from ?? shiftDate(g.due_on, -Math.max(0, Number(daysBefore)));
        const net = Number(g.net);
        const paid = Number(g.paid);
        const balance = net - paid;
        const late = Number(l.o_amount);
        const posted = Number(l.posted);
        const outstanding = Math.max(late - posted, 0);
        totNet += net;
        totPaid += paid;
        totLate += late;
        totPosted += posted;
        totOutstanding += outstanding;
        const visible = visibleFrom <= asOfDate;
        const status: LedgerInstalment['status'] =
          balance <= 0 ? 'paid' : asOfDate > g.due_on ? 'overdue' : visible ? 'due' : 'upcoming';
        instalments.push({
          dueOn: g.due_on,
          ledger: g.ledger,
          label:
            first && last && first.sequence !== last.sequence
              ? `${short(first.name)} – ${short(last.name)}`
              : (first?.name ?? g.due_on),
          instalment: g.instalment,
          sequences: g.sequences,
          net: fmt(net),
          paid: fmt(paid),
          balance: fmt(balance),
          lateFee: {
            amount: Number(l.o_amount).toFixed(2),
            mode: l.o_mode,
            days: l.o_days,
            overridden: l.o_overridden,
            reason: l.o_reason,
            periodId: l.o_period_id,
            posted: fmt(posted),
            outstanding: fmt(outstanding),
          },
          visibleFrom,
          visible,
          status,
        });
      }
      const payments = await this.paymentsWith(c, studentId, yearId);
      const refunds = await c.query<Record<string, unknown>>(
        `SELECT r.id::text, r.payment_id::text AS "paymentId", p.receipt_no AS "receiptNo", r.amount::text, r.reason, r.mode, r.status::text, r.requested_at AS "requestedAt", r.paid_on::text AS "paidOn"
           FROM fee_refunds r JOIN fee_payments p ON p.id = r.payment_id
          WHERE p.student_id = $1 AND p.academic_year_id = $2 ORDER BY r.requested_at DESC`,
        [studentId, yearId],
      );
      const overrides = await c.query<LedgerOverride>(
        `SELECT o.id::text, o.period_id::text AS "periodId", p.name AS "periodName", o.amount::text, o.reason, u.display_name AS "createdBy", o.created_at::text AS "createdAt"
           FROM fee_late_fee_overrides o JOIN fee_periods p ON p.id = o.period_id LEFT JOIN users u ON u.id = o.created_by
          WHERE o.student_id = $1 AND o.academic_year_id = $2 AND o.revoked_at IS NULL ORDER BY p.sequence`,
        [studentId, yearId],
      );
      const run = await c.query<{
        id: string;
        ran_at: Date;
        ran_by: string | null;
        rows: number;
        total: string;
        diff: DemandDiff | null;
      }>(
        `SELECT r.id::text, r.ran_at, u.display_name AS ran_by, r.rows, r.total::text, r.diff FROM fee_demand_runs r LEFT JOIN users u ON u.id = r.ran_by
          WHERE r.student_id = $1 AND r.academic_year_id = $2 ORDER BY r.id DESC LIMIT 1`,
        [studentId, yearId],
      );
      return {
        student: {
          id: st.rows[0].id,
          name: st.rows[0].name,
          admissionNo: st.rows[0].admission_no,
          section: st.rows[0].section,
        },
        year: y.rows[0]!,
        asOf: asOfDate,
        lateFeeMode: mode,
        instalments,
        totals: {
          net: fmt(totNet),
          paid: fmt(totPaid),
          balance: fmt(totNet - totPaid),
          lateFee: fmt(totLate),
          lateFeePosted: fmt(totPosted),
          lateFeeOutstanding: fmt(totOutstanding),
          payable: fmt(totNet - totPaid + totOutstanding),
        },
        payments,
        refunds: refunds.rows.map((r) => ({
          ...r,
          requestedAt: (r.requestedAt as Date).toISOString(),
        })) as unknown as LedgerRefund[],
        overrides: overrides.rows,
        lastRun: run.rows[0]
          ? {
              id: run.rows[0].id,
              ranAt: run.rows[0].ran_at.toISOString(),
              ranBy: run.rows[0].ran_by,
              rows: run.rows[0].rows,
              total: run.rows[0].total,
              diff: run.rows[0].diff,
            }
          : null,
      };
    });
  }

  /** Sprint 14: a family queues the PDF of one of its own receipts (own export, no template permission needed). */
  async myReceiptPdf(ctx: RequestContext, paymentId: string) {
    const tenant = requireTenant(ctx);
    const v = await this.viewer.resolve(ctx, 'fees.family.view');
    if (v.kind !== 'family')
      throw new DomainError('permission-denied', 'Families only', { status: 403 });
    const info = await this.db.tenant(tenant, async (c) => {
      const p = await c.query<{ receipt_no: string | null; student_id: string; student: string }>(
        `SELECT p.receipt_no, p.student_id::text, s.display_name AS student FROM fee_payments p JOIN students s ON s.id = p.student_id WHERE p.id = $1`,
        [paymentId],
      );
      if (!p.rows[0] || !v.students.some((s) => s.id === p.rows[0]!.student_id))
        throw new DomainError('not-found', 'Receipt not found', { status: 404 });
      const template = await this.templates.activeOfKind(c, 'fee_receipt');
      if (!template)
        throw new DomainError(
          'fees.no_receipt_template',
          'The school has not set up a receipt template yet',
          {
            status: 409,
          },
        );
      return { receiptNo: p.rows[0].receipt_no, student: p.rows[0].student, template };
    });
    const exp = await this.reports.createRenderedForOwner(
      ctx,
      {
        dataset: 'document',
        format: 'pdf',
        params: { templateId: info.template.id, entity: 'fee_receipt', entityId: paymentId },
        title: `Receipt ${info.receiptNo ?? paymentId} · ${info.student}`,
      },
      'fees.receipt.render_family',
    );
    return { exportId: exp.id, receiptNo: info.receiptNo, status: exp.status };
  }

  /** Status and download link of one of the caller's own exports. */
  async myExportStatus(ctx: RequestContext, exportId: string) {
    const tenant = requireTenant(ctx);
    const own = await this.db.tenant(tenant, (c) =>
      c.query(`SELECT 1 FROM exports WHERE id = $1 AND requested_by = app.current_user_id()`, [
        exportId,
      ]),
    );
    if (!own.rowCount) throw new DomainError('not-found', 'Export not found', { status: 404 });
    return this.reports.status(ctx, exportId);
  }

  private async paymentsWith(
    c: PoolClient,
    studentId: string,
    yearId: string,
  ): Promise<LedgerPayment[]> {
    const r = await c.query<{
      id: string;
      receipt_no: string | null;
      received_on: string;
      amount: string;
      mode: string;
      reference: string | null;
      remarks: string | null;
      received_by: string | null;
      allocated: string;
      intent_id: string | null;
      late_fee: string;
      refunded: string;
      status: LedgerPayment['status'];
      instrument_no: string | null;
      bank_name: string | null;
      settled: boolean;
    }>(
      `SELECT p.id::text, p.receipt_no, p.received_on::text, p.amount::text, p.mode, p.reference, p.remarks, u.display_name AS received_by, p.intent_id::text,
              COALESCE((SELECT sum(a.amount) FROM fee_payment_allocations a WHERE a.payment_id = p.id), 0)::text AS allocated,
              p.late_fee::text, p.refunded::text, p.status, p.instrument_no, p.bank_name, (p.settlement_line_id IS NOT NULL) AS settled
         FROM fee_payments p LEFT JOIN users u ON u.id = p.received_by
        WHERE p.student_id = $1 AND p.academic_year_id = $2 ORDER BY p.received_on DESC, p.id DESC`,
      [studentId, yearId],
    );
    return r.rows.map((x) => ({
      id: x.id,
      receiptNo: x.receipt_no,
      receivedOn: x.received_on,
      amount: x.amount,
      mode: x.mode,
      reference: x.reference,
      remarks: x.remarks,
      receivedBy: x.received_by,
      allocated: x.allocated,
      // the advance: what neither the instalments nor the late fee nor a refund took
      unallocated: fmt(
        Math.max(
          Number(x.amount) - Number(x.allocated) - Number(x.late_fee) - Number(x.refunded),
          0,
        ),
      ),
      intentId: x.intent_id,
      lateFee: x.late_fee,
      refunded: x.refunded,
      status: x.status,
      instrumentNo: x.instrument_no,
      bankName: x.bank_name,
      settled: x.settled,
    }));
  }

  // ---- late fee overrides ------------------------------------------------------------------------
  async setLateFeeOverride(ctx: RequestContext, studentId: string, dto: SetLateFeeOverrideDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const p = await c.query<{ name: string }>(
        `SELECT name FROM fee_periods WHERE id = $1 AND academic_year_id = $2`,
        [dto.periodId, yearId],
      );
      if (!p.rows[0])
        throw new DomainError('not-found', 'Fee period not found in this year', { status: 404 });
      const s = await c.query(`SELECT 1 FROM students WHERE id = $1 AND deleted_at IS NULL`, [
        studentId,
      ]);
      if (s.rowCount === 0)
        throw new DomainError('not-found', 'Student not found', { status: 404 });
      const before = await c.query<{ id: string; amount: string; reason: string }>(
        `UPDATE fee_late_fee_overrides SET revoked_at = now(), revoked_by = app.current_user_id()
          WHERE student_id = $1 AND academic_year_id = $2 AND period_id = $3 AND revoked_at IS NULL RETURNING id::text, amount::text, reason`,
        [studentId, yearId, dto.periodId],
      );
      const r = await c.query<{ id: string }>(
        `INSERT INTO fee_late_fee_overrides (school_id, student_id, academic_year_id, period_id, amount, reason, created_by, request_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
        [studentId, yearId, dto.periodId, dto.amount.toFixed(2), dto.reason],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.late_fee.override',
        entityType: 'fee_late_fee_overrides',
        entityId: r.rows[0]!.id,
        before: before.rows[0] ?? null,
        after: { studentId, period: p.rows[0].name, amount: dto.amount, reason: dto.reason },
      });
      return { id: r.rows[0]!.id, replaced: before.rows[0]?.id ?? null };
    });
  }

  async revokeLateFeeOverride(ctx: RequestContext, studentId: string, overrideId: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string; amount: string; reason: string }>(
        `UPDATE fee_late_fee_overrides SET revoked_at = now(), revoked_by = app.current_user_id()
          WHERE id = $1 AND student_id = $2 AND revoked_at IS NULL RETURNING id::text, amount::text, reason`,
        [overrideId, studentId],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Override not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'fees.late_fee.override_revoke',
        entityType: 'fee_late_fee_overrides',
        entityId: overrideId,
        before: r.rows[0],
      });
      return { ok: true };
    });
  }

  // ---- period late fee slabs and visibility (masters) --------------------------------------------
  async setPeriodLateFee(ctx: RequestContext, periodId: string, dto: SetPeriodLateFeeDto) {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const slabs = [...dto.slabs].sort((a, b) => a.on.localeCompare(b.on));
      const r = await c.query<{ id: string; name: string }>(
        `UPDATE fee_periods SET late_fee_amount = $3, late_slab_1_on = $4::date, late_slab_1_amount = $5, late_slab_2_on = $6::date, late_slab_2_amount = $7,
                late_slab_3_on = $8::date, late_slab_3_amount = $9, visible_from = $10::date
          WHERE id = $1 AND academic_year_id = $2 RETURNING id::text, name`,
        [
          periodId,
          yearId,
          dto.lateFeeAmount.toFixed(2),
          slabs[0]?.on ?? null,
          slabs[0] ? slabs[0].amount.toFixed(2) : null,
          slabs[1]?.on ?? null,
          slabs[1] ? slabs[1].amount.toFixed(2) : null,
          slabs[2]?.on ?? null,
          slabs[2] ? slabs[2].amount.toFixed(2) : null,
          dto.visibleFrom ?? null,
        ],
      );
      if (!r.rows[0]) throw new DomainError('not-found', 'Fee period not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'fees.period.late_fee',
        entityType: 'fee_periods',
        entityId: periodId,
        after: { period: r.rows[0].name, ...dto, slabs },
      });
      return { ok: true };
    });
  }

  // ---- regeneration with diff --------------------------------------------------------------------
  async regenerate(
    ctx: RequestContext,
    studentId: string,
  ): Promise<{ runId: string; rows: number; total: string; diff: DemandDiff }> {
    const tenant = requireTenant(ctx);
    const yearId = this.year(tenant);
    return this.db.tenant(tenant, async (c) => {
      const before = await this.snapshot(c, studentId, yearId);
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
      const after = await this.snapshot(c, studentId, yearId);
      const diff = diffSnapshots(before, after);
      await c.query(`UPDATE fee_demand_runs SET diff = $2::jsonb WHERE id = $1`, [
        out.run_id,
        JSON.stringify(diff),
      ]);
      await this.audit.stage(ctx, c, {
        action: 'fees.demand.regenerate',
        entityType: 'fee_demand_runs',
        entityId: out.run_id,
        after: {
          studentId,
          rows: out.rows,
          total: out.total,
          added: diff.added.length,
          removed: diff.removed.length,
          changed: diff.changed.length,
        },
      });
      return { runId: out.run_id, rows: out.rows, total: out.total, diff };
    });
  }

  private async snapshot(c: PoolClient, studentId: string, yearId: string) {
    const r = await c.query<{
      key: string;
      period: string;
      head: string;
      net: string;
      due_on: string;
    }>(
      `SELECT p.sequence || '|' || h.code AS key, p.name AS period, h.code AS head, d.net::text, d.due_on::text
         FROM fee_demands d JOIN fee_periods p ON p.id = d.period_id JOIN fee_heads h ON h.id = d.head_id
        WHERE d.student_id = $1 AND d.academic_year_id = $2 AND d.status <> 'cancelled' ORDER BY p.sequence, h.sort_order`,
      [studentId, yearId],
    );
    return r.rows;
  }

  // ---- receipt sequences -------------------------------------------------------------------------
  async receiptSequences(ctx: RequestContext): Promise<ReceiptSequenceRow[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        ledger: string;
        fy_id: string;
        fy_code: string;
        prefix: string | null;
        width: number | null;
        next_no: string | null;
        issued: string;
      }>(
        `SELECT l.ledger::text, fy.id::text AS fy_id, fy.code AS fy_code, s.prefix, s.width, s.next_no::text,
                (SELECT count(*)::text FROM fee_payments p WHERE p.financial_year_id = fy.id AND p.ledger = l.ledger AND p.receipt_no IS NOT NULL) AS issued
           FROM financial_years fy
           CROSS JOIN (SELECT unnest(enum_range(NULL::ledger_type)) AS ledger) l
           LEFT JOIN receipt_sequences s ON s.financial_year_id = fy.id AND s.ledger_type = l.ledger
          WHERE fy.status <> 'planned' OR s.id IS NOT NULL
          ORDER BY fy.start_date DESC, l.ledger`,
      );
      const defaults: Record<string, string> = {
        school: 'TF',
        hostel: 'HF',
        misc: 'MF',
        admission: 'ADM',
      };
      return r.rows.map((x) => ({
        ledger: x.ledger,
        financialYearId: x.fy_id,
        financialYear: x.fy_code,
        prefix: x.prefix ?? `${defaults[x.ledger] ?? x.ledger.toUpperCase()}/${x.fy_code}/`,
        width: x.width ?? 6,
        nextNo: Number(x.next_no ?? 1),
        issued: Number(x.issued),
        configured: x.prefix !== null,
      }));
    });
  }

  async setReceiptSequence(ctx: RequestContext, dto: SetReceiptSequenceDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const fy = await c.query<{ code: string }>(`SELECT code FROM financial_years WHERE id = $1`, [
        dto.financialYearId,
      ]);
      if (!fy.rows[0])
        throw new DomainError('not-found', 'Financial year not found', { status: 404 });
      const existing = await c.query<{ id: string; next_no: string; prefix: string }>(
        `SELECT id::text, next_no::text, prefix FROM receipt_sequences WHERE ledger_type = $1::ledger_type AND financial_year_id = $2 FOR UPDATE`,
        [dto.ledger, dto.financialYearId],
      );
      if (existing.rows[0] && Number(existing.rows[0].next_no) > 1)
        throw new DomainError(
          'fees.receipts_issued',
          'Receipts have been issued in this sequence; the prefix and numbering cannot change',
          { status: 409 },
        );
      await c.query(
        `INSERT INTO receipt_sequences (school_id, ledger_type, financial_year_id, prefix, next_no, width)
         VALUES (app.current_school_id(), $1::ledger_type, $2, $3, $4, $5)
         ON CONFLICT (school_id, ledger_type, financial_year_id) DO UPDATE SET prefix = EXCLUDED.prefix, next_no = EXCLUDED.next_no, width = EXCLUDED.width, updated_at = now()`,
        [dto.ledger, dto.financialYearId, dto.prefix, dto.startAt, dto.width],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.receipt_sequence.set',
        entityType: 'receipt_sequences',
        entityId: `${dto.ledger}:${fy.rows[0].code}`,
        before: existing.rows[0] ?? null,
        after: dto,
      });
      return { ok: true };
    });
  }

  // ---- receipt PDF -------------------------------------------------------------------------------
  async receiptPdf(ctx: RequestContext, paymentId: string) {
    const tenant = requireTenant(ctx);
    const info = await this.db.tenant(tenant, async (c) => {
      const p = await c.query<{ receipt_no: string | null; student: string }>(
        `SELECT p.receipt_no, s.display_name AS student FROM fee_payments p JOIN students s ON s.id = p.student_id WHERE p.id = $1`,
        [paymentId],
      );
      if (!p.rows[0]) throw new DomainError('not-found', 'Payment not found', { status: 404 });
      const template = await this.templates.activeOfKind(c, 'fee_receipt');
      if (!template)
        throw new DomainError(
          'fees.no_receipt_template',
          'No active fee receipt template; install the default templates under System → Templates',
          { status: 409 },
        );
      return { receiptNo: p.rows[0].receipt_no, student: p.rows[0].student, template };
    });
    const exp = await this.reports.create(
      ctx,
      {
        dataset: 'document',
        format: 'pdf',
        params: { templateId: info.template.id, entity: 'fee_receipt', entityId: paymentId },
        title: `Receipt ${info.receiptNo ?? paymentId} · ${info.student}`,
      },
      'fees.receipt.render',
    );
    return { exportId: exp.id, receiptNo: info.receiptNo };
  }
}

/** "April 2026" → "Apr 2026" */
const short = (name: string) => name.replace(/^([A-Za-z]{3})[A-Za-z]* /, '$1 ');

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function diffSnapshots(
  before: Array<{ key: string; period: string; head: string; net: string; due_on: string }>,
  after: Array<{ key: string; period: string; head: string; net: string; due_on: string }>,
): DemandDiff {
  const b = new Map(before.map((r) => [r.key, r]));
  const a = new Map(after.map((r) => [r.key, r]));
  const diff: DemandDiff = {
    added: [],
    removed: [],
    changed: [],
    kept: 0,
    totalBefore: fmt(before.reduce((s, r) => s + Number(r.net), 0)),
    totalAfter: fmt(after.reduce((s, r) => s + Number(r.net), 0)),
  };
  for (const [key, row] of a) {
    const old = b.get(key);
    if (!old)
      diff.added.push({ period: row.period, head: row.head, net: row.net, dueOn: row.due_on });
    else if (Number(old.net) !== Number(row.net) || old.due_on !== row.due_on)
      diff.changed.push({
        period: row.period,
        head: row.head,
        before: { net: old.net, dueOn: old.due_on },
        after: { net: row.net, dueOn: row.due_on },
      });
    else diff.kept += 1;
  }
  for (const [key, row] of b)
    if (!a.has(key))
      diff.removed.push({ period: row.period, head: row.head, net: row.net, dueOn: row.due_on });
  return diff;
}
