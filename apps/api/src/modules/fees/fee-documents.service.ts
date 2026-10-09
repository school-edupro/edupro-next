import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { amountInWords } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { schoolHead } from '../attendance/register-file';
import { FeeLedgerService, type Ledger } from './fee-ledger.service';

export interface BillInstalment {
  label: string;
  dueOn: string;
  /** The class's challan (bill) date of the instalment, when set. */
  challanOn: string | null;
  ledger: string;
  /** Heads sharing a print name are one line. */
  lines: Array<{ head: string; fee: string; discount: string; paid: string; balance: string }>;
  balance: string;
  lateFee: string;
}
export interface FeeBill {
  school: { name: string; address: string };
  year: string;
  billDate: string;
  student: {
    id: string;
    name: string;
    admissionNo: string;
    section: string | null;
    guardian: string | null;
  };
  instalments: BillInstalment[];
  totals: { fee: string; lateFee: string; payable: string; payableWords: string };
}
export interface TaxCertificate {
  school: { name: string; address: string };
  financialYear: { id: string; name: string; from: string; to: string };
  student: {
    id: string;
    name: string;
    admissionNo: string;
    section: string | null;
    guardian: string | null;
  };
  rows: Array<{
    receivedOn: string;
    receiptNo: string | null;
    mode: string;
    head: string;
    amount: string;
  }>;
  total: string;
  totalWords: string;
  /** Other fee paid in the year that does not count (transport, late fee ...), for the reader's check. */
  otherPaid: string;
  issuedOn: string;
  /** The years the reader can choose from. */
  years: Array<{ id: string; name: string }>;
}
export interface FnfBill {
  school: { name: string; address: string };
  year: string;
  billDate: string;
  student: FeeBill['student'];
  lastMonth: { sequence: number; name: string };
  /** Charged up to the last month and still unpaid. */
  dues: Array<{ head: string; period: string; balance: string }>;
  lateFee: string;
  /** Paid against months after the last month: comes back. */
  paidAhead: Array<{ head: string; period: string; paid: string }>;
  /** Paid on refundable heads (security deposit). */
  refundable: Array<{ head: string; paid: string }>;
  advance: string;
  /** Months after the last month that will not be charged. */
  notCharged: string;
  totals: {
    payable: string;
    refundable: string;
    net: string;
    netWords: string;
    direction: 'pay' | 'refund' | 'nil';
  };
}

const fmt = (n: number) => n.toFixed(2);

/** Printed fee papers: the fee bill, the income-tax certificate and the provisional bill of a withdrawal. */
@Injectable()
export class FeeDocumentsService {
  constructor(
    private readonly db: DbService,
    private readonly ledger: FeeLedgerService,
    private readonly viewer: ViewerService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  private async head(c: PoolClient, studentId: string, yearId: string) {
    const r = await c.query<{
      guardian: string | null;
      section: string | null;
      name: string;
      admission_no: string;
    }>(
      `SELECT (SELECT concat_ws(' ', g.first_name, g.last_name) FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS guardian,
              (SELECT k.name || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                WHERE e.student_id = s.id AND e.academic_year_id = $2 ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) AS section,
              s.display_name AS name, s.admission_no
         FROM students s WHERE s.id = $1 AND s.deleted_at IS NULL`,
      [studentId, yearId],
    );
    const x = r.rows[0];
    if (!x) throw new DomainError('not-found', 'Student not found', { status: 404 });
    return {
      school: await schoolHead(c),
      student: {
        id: studentId,
        name: x.name,
        admissionNo: x.admission_no,
        section: x.section,
        guardian: x.guardian,
      },
    };
  }

  // ---- receipt as it prints -----------------------------------------------------------------------
  async receiptView(ctx: RequestContext, paymentId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await c.query<{
        id: string;
        student_id: string;
        academic_year_id: string;
        year: string;
        receipt_no: string | null;
        received_on: string;
        amount: string;
        late_fee: string;
        refunded: string;
        status: string;
        mode: string;
        mode_kind: string;
        ledger: string;
        reference: string | null;
        instrument_no: string | null;
        instrument_date: string | null;
        bank_name: string | null;
        remarks: string | null;
        received_by: string | null;
        deposit_account: string | null;
        allocated: string;
      }>(
        `SELECT p.id::text, p.student_id::text, p.academic_year_id::text, y.code AS year, p.receipt_no, p.received_on::text, p.amount::text, p.late_fee::text,
                p.refunded::text, p.status, COALESCE(p.mode_label, p.mode) AS mode, p.mode AS mode_kind, p.ledger::text, p.reference, p.instrument_no,
                p.instrument_date::text, p.bank_name, p.remarks, COALESCE(u.display_name, 'Online') AS received_by,
                (SELECT b.name || ', A/c …' || right(a.account_no, 4) FROM school_bank_accounts a JOIN banks b ON b.id = a.bank_id WHERE a.id = p.bank_account_id) AS deposit_account,
                COALESCE((SELECT sum(a.amount) FROM fee_payment_allocations a WHERE a.payment_id = p.id), 0)::text AS allocated
           FROM fee_payments p JOIN academic_years y ON y.id = p.academic_year_id LEFT JOIN users u ON u.id = p.received_by WHERE p.id = $1`,
        [paymentId],
      );
      const r = p.rows[0];
      if (!r) throw new DomainError('not-found', 'Receipt not found', { status: 404 });
      const head = await this.head(c, r.student_id, r.academic_year_id);
      const lines = await c.query<{ head: string; period: string; amount: string }>(
        `SELECT head, period, amount::numeric(12,2)::text AS amount FROM (
           SELECT COALESCE(NULLIF(h.print_group, ''), h.name) AS head,
                  CASE WHEN min(fp.sequence) = max(fp.sequence) THEN min(fp.name)
                       ELSE split_part(min(fp.name) FILTER (WHERE fp.sequence = x.lo), ' ', 1) || ' – ' || min(fp.name) FILTER (WHERE fp.sequence = x.hi) END AS period,
                  sum(a.amount) AS amount, min(fp.sequence) AS seq, min(h.sort_order) AS ord
             FROM fee_payment_allocations a JOIN fee_demands d ON d.id = a.demand_id JOIN fee_heads h ON h.id = d.head_id JOIN fee_periods fp ON fp.id = d.period_id
             CROSS JOIN LATERAL (SELECT min(fp2.sequence) AS lo, max(fp2.sequence) AS hi
                                   FROM fee_payment_allocations a2 JOIN fee_demands d2 ON d2.id = a2.demand_id JOIN fee_periods fp2 ON fp2.id = d2.period_id
                                  WHERE a2.payment_id = a.payment_id AND d2.due_on = d.due_on) x
            WHERE a.payment_id = $1
            GROUP BY COALESCE(NULLIF(h.print_group, ''), h.name), d.due_on, x.lo, x.hi
         ) t ORDER BY seq, ord`,
        [paymentId],
      );
      const advance = Math.max(
        Number(r.amount) - Number(r.late_fee) - Number(r.refunded) - Number(r.allocated),
        0,
      );
      return {
        ...head,
        year: r.year,
        id: r.id,
        receiptNo: r.receipt_no,
        receivedOn: r.received_on,
        amount: r.amount,
        amountWords: amountInWords(r.amount),
        lateFee: r.late_fee,
        advance: fmt(advance),
        refunded: r.refunded,
        status: r.status,
        mode: r.mode,
        modeKind: r.mode_kind,
        feeType: r.ledger,
        reference: r.reference,
        instrumentNo: r.instrument_no,
        instrumentDate: r.instrument_date,
        bankName: r.bank_name,
        remarks: r.remarks,
        receivedBy: r.received_by,
        depositAccount: r.deposit_account,
        lines: lines.rows,
      };
    });
  }

  // ---- fee bill ---------------------------------------------------------------------------------
  /** What is payable now: every instalment with a balance that is due up to the date (default: visible to the family). */
  async bill(ctx: RequestContext, studentId: string, upTo?: string): Promise<FeeBill> {
    const yearId = this.year(ctx);
    const ledger: Ledger = await this.ledger.ledger(ctx, studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const head = await this.head(c, studentId, yearId);
      const lines = await c.query<{
        due_on: string;
        ledger: string;
        head: string;
        gross: string;
        discount: string;
        paid: string;
        net: string;
      }>(
        `SELECT d.due_on::text, d.ledger::text AS ledger, COALESCE(NULLIF(h.print_group, ''), h.name) AS head,
                sum(d.gross)::text AS gross, sum(d.discount)::text AS discount, sum(d.paid)::text AS paid, sum(d.net)::text AS net
           FROM fee_demands d JOIN fee_heads h ON h.id = d.head_id
          WHERE d.student_id = $1 AND d.academic_year_id = $2 AND d.status IN ('pending', 'partial', 'paid')
          GROUP BY d.due_on, d.ledger, COALESCE(NULLIF(h.print_group, ''), h.name)
          ORDER BY d.due_on, min(h.sort_order)`,
        [studentId, yearId],
      );
      const due = ledger.instalments.filter(
        (i) =>
          Number(i.balance) + Number(i.lateFee.outstanding) > 0 &&
          (upTo ? i.dueOn <= upTo : i.visible),
      );
      const instalments: BillInstalment[] = due.map((i) => ({
        label: i.label,
        dueOn: i.dueOn,
        challanOn: i.challanOn,
        ledger: i.ledger,
        lines: lines.rows
          .filter((l) => l.due_on === i.dueOn && l.ledger === i.ledger)
          .map((l) => ({
            head: l.head,
            fee: l.gross,
            discount: l.discount,
            paid: l.paid,
            balance: fmt(Number(l.net) - Number(l.paid)),
          })),
        balance: i.balance,
        lateFee: i.lateFee.outstanding,
      }));
      const fee = instalments.reduce((a, i) => a + Number(i.balance), 0);
      const late = instalments.reduce((a, i) => a + Number(i.lateFee), 0);
      return {
        ...head,
        year: ledger.year.code,
        billDate: ledger.asOf,
        instalments,
        totals: {
          fee: fmt(fee),
          lateFee: fmt(late),
          payable: fmt(fee + late),
          payableWords: amountInWords(fmt(Math.max(fee + late, 0))),
        },
      };
    });
  }

  /** The bills of a class or a section, for printing in one go. Pupils who owe nothing are left out. */
  async bills(
    ctx: RequestContext,
    q: { classId?: string; sectionId?: string; upTo?: string },
  ): Promise<FeeBill[]> {
    const yearId = this.year(ctx);
    if (!q.classId && !q.sectionId)
      throw new DomainError('validation-failed', 'Choose a class or a section', { status: 422 });
    const ids = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT e.student_id::text AS id
           FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN students s ON s.id = e.student_id
          WHERE e.academic_year_id = $1 AND e.status = 'active' AND s.deleted_at IS NULL AND s.status = 'active'
            AND ($2::bigint IS NULL OR cs.class_id = $2::bigint) AND ($3::bigint IS NULL OR cs.id = $3::bigint)
          ORDER BY cs.name, e.roll_no NULLS LAST, s.display_name LIMIT 400`,
        [yearId, q.classId ?? null, q.sectionId ?? null],
      );
      return r.rows.map((x) => x.id);
    });
    const out: FeeBill[] = [];
    for (const id of ids) {
      const b = await this.bill(ctx, id, q.upTo);
      if (b.instalments.length > 0) out.push(b);
    }
    return out;
  }

  // ---- income-tax certificate ---------------------------------------------------------------------
  private async certificate(ctx: RequestContext, studentId: string, financialYearId?: string) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c): Promise<TaxCertificate> => {
      const fy = await c.query<{ id: string; name: string; start_date: string; end_date: string }>(
        `SELECT id::text, name, start_date::text, end_date::text FROM financial_years
          WHERE ($1::bigint IS NOT NULL AND id = $1::bigint) OR ($1::bigint IS NULL AND CURRENT_DATE BETWEEN start_date AND end_date)
          ORDER BY start_date DESC LIMIT 1`,
        [financialYearId ?? null],
      );
      const f = fy.rows[0];
      if (!f) throw new DomainError('not-found', 'Financial year not found', { status: 404 });
      const head = await this.head(c, studentId, tenant.academicYearId ?? '0');
      // allocations are already net of refunds; cancelled and bounced receipts do not count
      const rows = await c.query<TaxCertificate['rows'][number] & { tax: boolean }>(
        `SELECT p.received_on::text AS "receivedOn", p.receipt_no AS "receiptNo", p.mode, h.name AS head, sum(a.amount)::text AS amount, h.tax_certificate AS tax
           FROM fee_payment_allocations a JOIN fee_payments p ON p.id = a.payment_id JOIN fee_demands d ON d.id = a.demand_id JOIN fee_heads h ON h.id = d.head_id
          WHERE p.student_id = $1 AND p.received_on BETWEEN $2::date AND $3::date AND p.status NOT IN ('reversed', 'bounced')
          GROUP BY p.received_on, p.receipt_no, p.mode, h.name, h.tax_certificate, p.id
         HAVING sum(a.amount) > 0
          ORDER BY p.received_on, p.id, h.name`,
        [studentId, f.start_date, f.end_date],
      );
      const counted = rows.rows.filter((r) => r.tax);
      const total = counted.reduce((a, r) => a + Number(r.amount), 0);
      const other = rows.rows.filter((r) => !r.tax).reduce((a, r) => a + Number(r.amount), 0);
      const today = await c.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
      const years = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM financial_years WHERE start_date <= CURRENT_DATE ORDER BY start_date DESC LIMIT 10`,
      );
      return {
        ...head,
        financialYear: { id: f.id, name: f.name, from: f.start_date, to: f.end_date },
        rows: counted.map(({ tax: _tax, ...r }) => r),
        total: fmt(total),
        totalWords: amountInWords(fmt(total)),
        otherPaid: fmt(other),
        issuedOn: today.rows[0]!.d,
        years: years.rows,
      };
    });
  }

  async taxCertificate(ctx: RequestContext, studentId: string, financialYearId?: string) {
    return this.certificate(ctx, studentId, financialYearId);
  }

  /** A parent's own child only. */
  async myTaxCertificate(ctx: RequestContext, studentId: string, financialYearId?: string) {
    const v = await this.viewer.resolve(ctx, 'fees.family.view');
    if (v.kind !== 'family' || !v.students.some((s) => s.id === studentId))
      throw new DomainError('not-found', 'Student not found', { status: 404 });
    return this.certificate(ctx, studentId, financialYearId);
  }

  // ---- provisional bill of a withdrawal (full and final) ---------------------------------------------
  /**
   * What a leaving pupil owes or gets back if the last month charged is the given one: unpaid fee up to
   * that month and late fine are payable; fee already paid for later months, refundable heads and any
   * advance come back. Nothing is posted: the accountant settles it with a receipt or a refund.
   */
  async fnf(ctx: RequestContext, studentId: string, lastSeq?: number): Promise<FnfBill> {
    const yearId = this.year(ctx);
    const ledger = await this.ledger.ledger(ctx, studentId);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const head = await this.head(c, studentId, yearId);
      const periods = await c.query<{
        sequence: number;
        name: string;
        month: number;
        year: number;
      }>(
        `SELECT sequence, name, month, year FROM fee_periods WHERE academic_year_id = $1 ORDER BY sequence`,
        [yearId],
      );
      if (periods.rows.length === 0)
        throw new DomainError('fees.no_periods', 'The year has no fee calendar', { status: 409 });
      const now = await c.query<{ m: number; y: number }>(
        `SELECT extract(month FROM CURRENT_DATE)::int AS m, extract(year FROM CURRENT_DATE)::int AS y`,
      );
      const current =
        periods.rows.find((p) => p.month === now.rows[0]!.m && p.year === now.rows[0]!.y) ??
        periods.rows[periods.rows.length - 1]!;
      const last = periods.rows.find((p) => p.sequence === lastSeq) ?? current;
      const rows = await c.query<{
        head: string;
        period: string;
        sequence: number;
        net: string;
        paid: string;
        refundable: boolean;
      }>(
        `SELECT h.name AS head, fp.name AS period, fp.sequence, d.net::text, d.paid::text, h.refundable
           FROM fee_demands d JOIN fee_heads h ON h.id = d.head_id JOIN fee_periods fp ON fp.id = d.period_id
          WHERE d.student_id = $1 AND d.academic_year_id = $2 AND d.status IN ('pending', 'partial', 'paid')
          ORDER BY fp.sequence, h.sort_order`,
        [studentId, yearId],
      );
      const dues = rows.rows
        .filter((r) => r.sequence <= last.sequence && Number(r.net) - Number(r.paid) > 0)
        .map((r) => ({
          head: r.head,
          period: r.period,
          balance: fmt(Number(r.net) - Number(r.paid)),
        }));
      const paidAhead = rows.rows
        .filter((r) => r.sequence > last.sequence && Number(r.paid) > 0 && !r.refundable)
        .map((r) => ({ head: r.head, period: r.period, paid: r.paid }));
      const refundableMap = new Map<string, number>();
      for (const r of rows.rows.filter((x) => x.refundable && Number(x.paid) > 0))
        refundableMap.set(r.head, (refundableMap.get(r.head) ?? 0) + Number(r.paid));
      const refundable = [...refundableMap].map(([h, paid]) => ({ head: h, paid: fmt(paid) }));
      const notCharged = rows.rows
        .filter((r) => r.sequence > last.sequence)
        .reduce((a, r) => a + Math.max(Number(r.net) - Number(r.paid), 0), 0);
      const adv = await c.query<{ v: string }>(
        `SELECT COALESCE(sum(p.amount - p.late_fee - p.refunded - COALESCE((SELECT sum(a.amount) FROM fee_payment_allocations a WHERE a.payment_id = p.id), 0)), 0)::text AS v
           FROM fee_payments p WHERE p.student_id = $1 AND p.academic_year_id = $2 AND p.status IN ('posted', 'partly_refunded')`,
        [studentId, yearId],
      );
      const advance = Math.max(Number(adv.rows[0]?.v ?? 0), 0);
      const late = Number(ledger.totals.lateFeeOutstanding);
      const payable = dues.reduce((a, d) => a + Number(d.balance), 0) + late;
      const back =
        paidAhead.reduce((a, d) => a + Number(d.paid), 0) +
        refundable.reduce((a, d) => a + Number(d.paid), 0) +
        advance;
      const net = payable - back;
      return {
        ...head,
        year: ledger.year.code,
        billDate: ledger.asOf,
        lastMonth: { sequence: last.sequence, name: last.name },
        dues,
        lateFee: fmt(late),
        paidAhead,
        refundable,
        advance: fmt(advance),
        notCharged: fmt(notCharged),
        totals: {
          payable: fmt(payable),
          refundable: fmt(back),
          net: fmt(Math.abs(net)),
          netWords: amountInWords(fmt(Math.abs(net))),
          direction: net > 0.004 ? 'pay' : net < -0.004 ? 'refund' : 'nil',
        },
      };
    });
  }
}
