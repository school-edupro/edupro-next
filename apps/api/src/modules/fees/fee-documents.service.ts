import { receiptLayoutPdf } from './receipt-layout-pdf';
import { receiptPdf } from './receipt-pdf';
import { billPdf } from './bill-pdf';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { amountInWords } from '@edupro/db';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { ViewerService } from '../academics/daily/viewer.service';
import { schoolHead } from '../attendance/register-file';
import { FeeLedgerService, type Ledger } from './fee-ledger.service';
import { STORAGE_DRIVER, type StorageDriver } from '../files/storage';

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
export interface BillStudent {
  id: string;
  name: string;
  admissionNo: string;
  section: string | null;
  guardian: string | null;
}
export interface FeeBill {
  school: { name: string; address: string };
  /** Contact lines and the logo of the bill's letterhead. */
  letterhead: {
    phone: string | null;
    email: string | null;
    website: string | null;
    logoFileId: string | null;
  };
  /** <school prefix>/<session>/<admission no>: the same every time the bill is printed. */
  billNo: string;
  year: string;
  /** The session's first and last months, for "April 2026 to March 2027". */
  session: { from: string; to: string };
  billDate: string;
  generatedAt: string;
  /** all = school and hostel fee; school or hostel = that fee only */
  ledger: 'all' | 'school' | 'hostel';
  /** the school's bill layout: the annual bill, or the instalment-wise one */
  layout: 'annual' | 'instalment';
  student: {
    id: string;
    name: string;
    admissionNo: string;
    section: string | null;
    guardian: string | null;
    dob: string | null;
    father: string | null;
    mother: string | null;
    route: string | null;
  };
  /** What the bill covers, head by head (print name), up to the last month in scope. */
  heads: Array<{ ledger: string; head: string; optional: boolean; amount: string }>;
  discount: string;
  headsThrough: string | null;
  /** The instalments of each fee, paid or not, with what is still to pay. */
  schedules: Array<{
    ledger: string;
    payPlan: string;
    rows: Array<{
      no: string;
      months: string;
      dueOn: string;
      payable: string;
      paid: string;
      balance: string;
      lateFee: string;
    }>;
  }>;
  /** Receipts of the session for the fee(s) on the bill. */
  receipts: Array<{
    receiptNo: string | null;
    mode: string;
    instrumentNo: string | null;
    receivedOn: string;
    amount: string;
    lateFee: string;
    bounceCharge: string;
    status: string;
    counted: boolean;
    finalAmount: string;
  }>;
  summary: {
    due: string;
    lateFee: string;
    received: string;
    refund: string;
    advance: string;
    balance: string;
    balanceWords: string;
  };
  notes: { bounceCharge: string; lateFeeMode: string; latePerDay: string | null };
  /** The instalments with something to pay, head by head (the earlier bill), kept for older callers. */
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
  student: BillStudent;
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
  /** The leaving date, when the pupil has left or a withdrawal is open. */
  leftOn: string | null;
  /** Receipts a refund by fee head can be raised from. */
  receipts: Array<{
    id: string;
    receiptNo: string | null;
    receivedOn: string;
    amount: string;
    refunded: string;
  }>;
  /** Refunds of the pupil this session (raised by the withdrawal or by hand), except rejected ones. */
  refunds: Array<{
    id: string;
    voucherNo: string | null;
    status: string;
    amount: string;
    reason: string;
    byWithdrawal: boolean;
  }>;
  refundsWaiting: string;
  /** Saved but not sent for approval yet. */
  refundsDraft: string;
  refundsPaid: string;
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
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  /**
   * What the receipt prints besides the money (the school's receipt layout): the letterhead (logo, contact,
   * board affiliation and school number), both parents, their mobiles, the pupil's address, category and
   * bus route / stop / slab, and the bounce charge of the pupil.
   */
  private async receiptParticulars(c: PoolClient, studentId: string | null, yearId: string) {
    const r = await c.query<{
      phone: string | null;
      email: string | null;
      website: string | null;
      logo: string | null;
      board: string | null;
      affiliation: string | null;
      school_no: string | null;
      father: string | null;
      mother: string | null;
      mobiles: string | null;
      address: string | null;
      category: string | null;
      route: string | null;
      stop: string | null;
      slab: string | null;
    }>(
      `SELECT NULLIF(sc.contact->>'phone', '') AS phone,
              NULLIF(COALESCE(NULLIF(sc.contact->>'accountsEmail', ''), sc.contact->>'email'), '') AS email,
              NULLIF(sc.contact->>'website', '') AS website, NULLIF(sc.branding->>'logoFileId', '') AS logo,
              sc.board, sc.affiliation_no AS affiliation, NULLIF(sc.branding->>'schoolNo', '') AS school_no,
              (SELECT concat_ws(' ', g.first_name, g.last_name) FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id AND sg.relation = 'father' AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS father,
              (SELECT concat_ws(' ', g.first_name, g.last_name) FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id AND sg.relation = 'mother' AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS mother,
              (SELECT string_agg(DISTINCT g.mobile, ' , ') FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                WHERE sg.student_id = s.id AND g.deleted_at IS NULL AND NULLIF(g.mobile, '') IS NOT NULL) AS mobiles,
              NULLIF(concat_ws(', ', NULLIF(s.address->>'line1', ''), NULLIF(s.address->>'line2', ''), NULLIF(s.address->>'area', ''),
                               NULLIF(s.address->>'city', ''), NULLIF(COALESCE(s.address->>'pincode', s.address->>'pin'), '')), '') AS address,
              s.category::text AS category,
              (SELECT r.name FROM student_route_assignments a JOIN transport_routes r ON r.id = a.route_id
                WHERE a.student_id = s.id AND a.academic_year_id = $2 ORDER BY (a.valid_to IS NULL) DESC, a.valid_from DESC NULLS LAST, a.id DESC LIMIT 1) AS route,
              (SELECT COALESCE(a.stop_name, st.name) FROM student_route_assignments a LEFT JOIN transport_stops st ON st.id = a.stop_id
                WHERE a.student_id = s.id AND a.academic_year_id = $2 ORDER BY (a.valid_to IS NULL) DESC, a.valid_from DESC NULLS LAST, a.id DESC LIMIT 1) AS stop,
              (SELECT sl.name FROM student_fee_profiles fp JOIN transport_slabs sl ON sl.id = fp.transport_slab_id
                WHERE fp.student_id = s.id AND fp.academic_year_id = $2 AND NOT COALESCE(fp.transport_disabled, false)) AS slab
         FROM schools sc LEFT JOIN students s ON s.id = $1 WHERE sc.id = app.current_school_id()`,
      // no pupil (a staff member paying a misc fee): the school's own letterhead only
      [studentId ?? null, yearId],
    );
    const x = r.rows[0];
    return {
      letterhead: {
        phone: x?.phone ?? null,
        email: x?.email ?? null,
        website: x?.website ?? null,
        logoFileId: x?.logo ?? null,
        affiliation: x?.affiliation
          ? `Affiliated to ${x.board ?? 'the'} Board${x.affiliation ? ` No: ${x.affiliation}` : ''}${x.school_no ? ` · School No: ${x.school_no}` : ''}`
          : null,
      },
      parents: [x?.father, x?.mother].filter(Boolean).join(' / ') || null,
      mobiles: x?.mobiles ?? null,
      address: x?.address ?? null,
      transport: studentId
        ? [x?.category, x?.route, x?.stop, x?.slab].map((v) => v ?? '').join(' / ')
        : undefined,
    };
  }

  /** The latest fee receipt of the school (and its pupil), for the layout preview; nothing before the first. */
  async layoutSample(
    ctx: RequestContext,
  ): Promise<{ paymentId: string | null; studentId: string | null }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ id: string; student_id: string }>(
        `SELECT p.id::text AS id, p.student_id::text AS student_id FROM fee_payments p WHERE p.status IN ('posted', 'partly_refunded') ORDER BY p.id DESC LIMIT 1`,
      );
      return { paymentId: r.rows[0]?.id ?? null, studentId: r.rows[0]?.student_id ?? null };
    });
  }

  /** The school's bill and receipt layouts and the receipt copies printed (Fee setup -> Receipt numbers). */
  private async layoutOf(c: PoolClient) {
    const r = await c.query<{ bill: string | null; receipt: string | null; copies: string | null }>(
      `SELECT app.setting('fees.bill_layout') #>> '{}' AS bill, app.setting('fees.receipt_layout') #>> '{}' AS receipt,
              app.setting('fees.receipt_copies') #>> '{}' AS copies`,
    );
    const x = r.rows[0];
    const copies = x?.copies ?? 'parent_school';
    return {
      bill: (x?.bill === 'instalment' ? 'instalment' : 'annual') as 'annual' | 'instalment',
      receipt: (x?.receipt === 'classic' ? 'classic' : 'two_panel') as 'two_panel' | 'classic',
      copies:
        copies === 'parent'
          ? ['Parent copy']
          : copies === 'parent_school_office'
            ? ['Parent copy', 'School copy', 'Office copy']
            : ['Parent copy', 'School copy'],
    };
  }

  /** The bounce charge raised for a bounced receipt (the approved adjustment), else nothing. */
  private async bounceChargeOf(c: PoolClient, paymentId: string): Promise<string> {
    const r = await c.query<{ v: string | null }>(
      `SELECT sum(charge)::numeric(12,2)::text AS v FROM fee_adjustments WHERE payment_id = $1 AND kind = 'bounce' AND status = 'approved'`,
      [paymentId],
    );
    return r.rows[0]?.v ?? '0.00';
  }

  /** The instalments a receipt paid, named as the pay plan names them: Q1, H2, Annual, or the months. */
  private async instalmentLabel(c: PoolClient, paymentId: string) {
    const r = await c.query<{ plan: string; nos: number[]; months: string[] }>(
      `WITH p AS (SELECT student_id, academic_year_id, ledger FROM fee_payments WHERE id = $1),
            k AS (SELECT (SELECT cs.class_id FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id
                           WHERE e.student_id = p.student_id AND e.academic_year_id = p.academic_year_id
                           ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1) AS class_id FROM p),
            n AS (SELECT d.due_on, dense_rank() OVER (ORDER BY d.due_on) AS no
                    FROM fee_demands d, p WHERE d.student_id = p.student_id AND d.academic_year_id = p.academic_year_id
                     AND d.ledger = p.ledger AND d.status IN ('pending', 'partial', 'paid'))
       SELECT (SELECT CASE WHEN p.ledger = 'hostel'
                           THEN app.fee_hostel_plan(p.student_id, p.academic_year_id, app.fee_pay_plan(p.student_id, p.academic_year_id, k.class_id))
                           ELSE app.fee_pay_plan(p.student_id, p.academic_year_id, k.class_id) END FROM p, k) AS plan,
              COALESCE((SELECT array_agg(DISTINCT n.no ORDER BY n.no) FROM fee_payment_allocations a JOIN fee_demands d ON d.id = a.demand_id
                          JOIN (SELECT DISTINCT due_on, no FROM n) n ON n.due_on = d.due_on WHERE a.payment_id = $1), '{}') AS nos,
              COALESCE((SELECT array_agg(fp.name ORDER BY fp.sequence) FROM (SELECT DISTINCT fp.id, fp.name, fp.sequence
                          FROM fee_payment_allocations a JOIN fee_demands d ON d.id = a.demand_id JOIN fee_periods fp ON fp.id = d.period_id
                         WHERE a.payment_id = $1) fp), '{}') AS months`,
      [paymentId],
    );
    const x = r.rows[0];
    if (!x || x.nos.length === 0) return null;
    const prefix: Record<string, string> = { quarterly: 'Q', half_yearly: 'H' };
    if (x.plan === 'yearly') return 'Annual';
    if (prefix[x.plan]) return x.nos.map((n) => `${prefix[x.plan]}${n}`).join(', ');
    const m = x.months.map((v) => v.split(' ')[0]!.slice(0, 3));
    return m.length > 3 ? `${m[0]} – ${m[m.length - 1]}` : m.join(', ');
  }

  /** The payer block of a staff member's misc receipt. */
  private async staffHead(c: PoolClient, employeeId: string) {
    const r = await c.query<{ name: string; code: string; designation: string | null }>(
      `SELECT display_name AS name, employee_code AS code, designation FROM employees WHERE id = $1`,
      [employeeId],
    );
    const x = r.rows[0];
    if (!x) throw new DomainError('not-found', 'Staff member not found', { status: 404 });
    return {
      school: await schoolHead(c),
      student: {
        id: employeeId,
        name: x.name,
        admissionNo: x.code,
        section: x.designation,
        guardian: null,
        kind: 'employee' as const,
      },
    };
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
  /** The receipt as a PDF made at once: one page per copy. Sent as base64 for the web apps to stream. */
  async receiptFile(ctx: RequestContext, paymentId: string, copies?: string[]) {
    const r = await this.receiptView(ctx, paymentId);
    // the school's layout and copies, unless the caller names the copies (a parent gets the parent copy)
    const which = copies ?? r.copies;
    const bytes =
      r.layout === 'classic'
        ? await receiptPdf(r, which)
        : await receiptLayoutPdf(r, which, await this.logo(ctx, r.letterhead.logoFileId));
    return {
      filename: `receipt-${(r.receiptNo ?? paymentId).replace(/[^A-Za-z0-9]+/g, '-')}.pdf`,
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
    };
  }

  /** The fee bill of the whole session as a PDF, in the school's bill layout. */
  async billFile(
    ctx: RequestContext,
    studentId: string,
    ledgerOf: 'all' | 'school' | 'hostel' = 'all',
  ) {
    const b = await this.bill(ctx, studentId, '9999-12-31', ledgerOf);
    const bytes = await billPdf(b, await this.logo(ctx, b.letterhead.logoFileId));
    return {
      filename: `fee-bill-${b.billNo.replace(/[^A-Za-z0-9]+/g, '-')}${ledgerOf === 'all' ? '' : `-${ledgerOf}`}.pdf`,
      contentType: 'application/pdf',
      base64: bytes.toString('base64'),
    };
  }

  /** The school's logo for a printed paper (PNG or JPEG); nothing when there is none or it cannot be read. */
  private async logo(ctx: RequestContext, fileId: string | null) {
    if (!fileId || !/^\d{1,18}$/.test(fileId)) return null;
    try {
      const f = await this.db.tenant(requireTenant(ctx), async (c) => {
        const r = await c.query<{ object_key: string; content_type: string }>(
          `SELECT object_key, content_type FROM files WHERE id = $1 AND deleted_at IS NULL`,
          [fileId],
        );
        return r.rows[0];
      });
      if (!f) return null;
      return { contentType: f.content_type, bytes: await this.storage.read(f.object_key) };
    } catch {
      return null;
    }
  }

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
        ...(await this.receiptParticulars(c, r.student_id, r.academic_year_id)),
        instalment: await this.instalmentLabel(c, r.id),
        bounceCharge: r.status === 'bounced' ? await this.bounceChargeOf(c, r.id) : '0.00',
        ...(await this.layoutOf(c).then((l) => ({ layout: l.receipt, copies: l.copies }))),
      };
    });
  }

  /** A misc receipt of a pupil in the same shape as a fee receipt, so it prints on the same sheet. */
  async miscReceiptView(ctx: RequestContext, receiptId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const p = await c.query<{
        id: string;
        student_id: string | null;
        employee_id: string | null;
        academic_year_id: string;
        year: string;
        receipt_no: string;
        received_on: string;
        amount: string;
        refunded: string;
        status: string;
        mode: string;
        reference: string | null;
        instrument_no: string | null;
        bank_name: string | null;
        remarks: string | null;
        received_by: string | null;
        head: string;
        title: string | null;
        payer_kind: string;
        payer_name: string;
        payer_mobile: string | null;
      }>(
        `SELECT m.id::text, m.student_id::text, m.employee_id::text, m.academic_year_id::text, y.code AS year, m.receipt_no, m.received_on::text, m.amount::text,
                m.payer_kind::text, m.payer_name, m.payer_mobile,
                m.refunded::text, m.status, m.mode, m.reference, m.instrument_no, m.bank_name, m.remarks, u.display_name AS received_by,
                h.name AS head, f.title
           FROM misc_receipts m JOIN academic_years y ON y.id = m.academic_year_id JOIN fee_heads h ON h.id = m.head_id
           LEFT JOIN misc_fee_students l ON l.id = m.misc_fee_student_id LEFT JOIN misc_fees f ON f.id = l.misc_fee_id
           LEFT JOIN users u ON u.id = m.received_by WHERE m.id = $1`,
        [receiptId],
      );
      const r = p.rows[0];
      if (!r) throw new DomainError('not-found', 'Receipt not found', { status: 404 });
      // a staff member's misc fee (0216): their code and designation in the pupil's place; someone outside
      // the school (a library book sale, 0220): the name and mobile only
      const outsider = !r.student_id && !r.employee_id;
      const head = r.student_id
        ? await this.head(c, r.student_id, r.academic_year_id)
        : r.employee_id
          ? await this.staffHead(c, r.employee_id)
          : {
              school: await schoolHead(c),
              student: {
                id: '',
                name: r.payer_name,
                admissionNo: '',
                section: null,
                guardian: null,
                kind: 'other' as const,
              },
            };
      return {
        ...head,
        year: r.year,
        id: r.id,
        receiptNo: r.receipt_no,
        receivedOn: r.received_on,
        amount: r.amount,
        amountWords: amountInWords(r.amount),
        lateFee: '0.00',
        advance: '0.00',
        refunded: r.refunded,
        status: r.status,
        mode: r.mode.toUpperCase(),
        modeKind: r.mode,
        feeType: 'misc',
        reference: r.reference,
        instrumentNo: r.instrument_no,
        instrumentDate: null,
        bankName: r.bank_name,
        remarks: r.remarks && r.remarks !== r.title ? r.remarks : null,
        receivedBy: r.received_by,
        depositAccount: null,
        lines: [{ head: r.title ?? r.head, period: r.title ? r.head : '', amount: r.amount }],
        ...(await this.receiptParticulars(c, r.student_id, r.academic_year_id)),
        ...(r.student_id
          ? {}
          : outsider
            ? { mobiles: r.payer_mobile, address: null }
            : {
                mobiles:
                  (
                    await c.query<{ m: string | null }>(
                      `SELECT mobile AS m FROM employees WHERE id = $1`,
                      [r.employee_id],
                    )
                  ).rows[0]?.m ?? null,
              }),
        instalment: r.title ?? null,
        bounceCharge: '0.00',
        ...(await this.layoutOf(c).then((l) => ({ layout: l.receipt, copies: l.copies }))),
      };
    });
  }

  // ---- fee bill ---------------------------------------------------------------------------------
  /**
   * The fee bill of a pupil: the heads of the session (or up to a date), the instalment schedule with
   * what is paid and what is left, the receipts, and the balance. `ledger` keeps it to school or hostel
   * fee. Without `upTo`, the instalments to pay are those open to the family.
   */
  async bill(
    ctx: RequestContext,
    studentId: string,
    upTo?: string,
    ledgerOf: 'all' | 'school' | 'hostel' = 'all',
  ): Promise<FeeBill> {
    const yearId = this.year(ctx);
    const ledger: Ledger = await this.ledger.ledger(ctx, studentId);
    const onBill = (l: string) => ledgerOf === 'all' || l === ledgerOf;
    const inScope = (dueOn: string) => !upTo || dueOn <= upTo;
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
      const heads = await c.query<{
        ledger: string;
        head: string;
        optional: boolean;
        gross: string;
        discount: string;
      }>(
        `SELECT d.ledger::text AS ledger, COALESCE(NULLIF(h.print_group, ''), h.name) AS head, bool_and(h.is_optional) AS optional,
                sum(d.gross)::text AS gross, sum(d.discount)::text AS discount
           FROM fee_demands d JOIN fee_heads h ON h.id = d.head_id
          WHERE d.student_id = $1 AND d.academic_year_id = $2 AND d.status IN ('pending', 'partial', 'paid')
            AND ($3::date IS NULL OR d.due_on <= $3::date) AND ($4::text = 'all' OR d.ledger::text = $4)
          GROUP BY d.ledger, COALESCE(NULLIF(h.print_group, ''), h.name)
          ORDER BY (d.ledger <> 'school'), bool_and(h.is_optional), min(h.sort_order)`,
        [studentId, yearId, upTo ?? null, ledgerOf],
      );
      const extra = await c.query<{
        dob: string | null;
        father: string | null;
        mother: string | null;
        route: string | null;
        phone: string | null;
        email: string | null;
        website: string | null;
        logo: string | null;
        prefix: string;
        year_from: string;
        year_to: string;
        through: string | null;
        late_per_day: string | null;
        now: string;
      }>(
        `SELECT s.dob::text,
                (SELECT concat_ws(' ', g.first_name, g.last_name) FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                  WHERE sg.student_id = s.id AND sg.relation = 'father' AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS father,
                (SELECT concat_ws(' ', g.first_name, g.last_name) FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
                  WHERE sg.student_id = s.id AND sg.relation = 'mother' AND g.deleted_at IS NULL ORDER BY sg.is_primary DESC, sg.id LIMIT 1) AS mother,
                (SELECT concat_ws(' / ', r.name, COALESCE(a.stop_name, st.name)) FROM student_route_assignments a JOIN transport_routes r ON r.id = a.route_id
                   LEFT JOIN transport_stops st ON st.id = a.stop_id
                  WHERE a.student_id = s.id AND a.academic_year_id = $2 AND (a.valid_to IS NULL OR a.valid_to >= CURRENT_DATE)
                  ORDER BY a.valid_from DESC NULLS LAST, a.id DESC LIMIT 1) AS route,
                NULLIF(sc.contact->>'phone', '') AS phone, NULLIF(COALESCE(NULLIF(sc.contact->>'accountsEmail', ''), sc.contact->>'email'), '') AS email,
                NULLIF(sc.contact->>'website', '') AS website, NULLIF(sc.branding->>'logoFileId', '') AS logo,
                COALESCE(NULLIF(sc.branding->>'prefix', ''), sc.code) AS prefix,
                to_char(y.start_date, 'FMMonth YYYY') AS year_from, to_char(y.end_date, 'FMMonth YYYY') AS year_to,
                (SELECT to_char(make_date(fp.year, fp.month, 1), 'FMMonth YYYY') FROM fee_periods fp
                  WHERE fp.academic_year_id = $2 AND ($3::date IS NULL OR make_date(fp.year, fp.month, 1) <= $3::date)
                  ORDER BY fp.sequence DESC LIMIT 1) AS through,
                COALESCE((SELECT cc.late_per_day FROM fee_class_charges cc JOIN class_sections cs ON cs.class_id = cc.class_id JOIN enrolments e ON e.class_section_id = cs.id
                           WHERE e.student_id = s.id AND e.academic_year_id = $2 AND cc.academic_year_id = $2 ORDER BY (e.status = 'active') DESC, e.id DESC LIMIT 1),
                         NULLIF(app.setting('fees.late_fee_per_day') #>> '{}', '')::numeric)::text AS late_per_day,
                to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI:SS') AS now
           FROM students s JOIN schools sc ON sc.id = app.current_school_id() JOIN academic_years y ON y.id = $2
          WHERE s.id = $1`,
        [studentId, yearId, upTo ?? null],
      );
      const x = extra.rows[0]!;
      const due = ledger.instalments.filter(
        (i) =>
          onBill(i.ledger) &&
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
      // the schedule: every instalment of the fee(s) in scope, numbered as the plan names them
      const plans: Record<string, string> = {
        school: ledger.fee.payPlan,
        hostel: ledger.fee.hostelPayPlan,
      };
      const prefix: Record<string, string> = { quarterly: 'Q', half_yearly: 'H', yearly: 'Annual' };
      const schedules = (['school', 'hostel'] as const)
        .filter((l) => onBill(l))
        .map((l) => {
          const rows = ledger.instalments.filter((i) => i.ledger === l && inScope(i.dueOn));
          const p = plans[l] ?? 'monthly';
          return {
            ledger: l,
            payPlan: p,
            rows: rows.map((i, n) => ({
              no: p === 'yearly' ? 'Annual' : prefix[p] ? `${prefix[p]}${n + 1}` : `${n + 1}`,
              months: i.label,
              dueOn: i.dueOn,
              payable: i.net,
              paid: i.paid,
              balance: i.balance,
              lateFee: i.lateFee.outstanding,
            })),
          };
        })
        .filter((s) => s.rows.length > 0);
      const shown = ledger.payments.filter(
        (p) => onBill(p.ledger) && (p.status as string) !== 'reversed',
      );
      const counted = (p: (typeof shown)[number]) => p.status !== 'bounced';
      const receipts = shown
        .slice()
        .reverse()
        .map((p) => ({
          receiptNo: p.receiptNo,
          mode: p.mode,
          instrumentNo: p.instrumentNo ?? p.reference,
          receivedOn: p.receivedOn,
          amount: fmt(Number(p.amount) - Number(p.lateFee)),
          lateFee: p.lateFee,
          bounceCharge: p.status === 'bounced' ? ledger.bounceCharge : '0.00',
          status: p.status,
          counted: counted(p),
          finalAmount: counted(p) ? p.amount : '0.00',
        }));
      const scheduled = schedules.flatMap((s) => s.rows);
      const net = scheduled.reduce((a, r) => a + Number(r.payable), 0);
      const balance = scheduled.reduce((a, r) => a + Number(r.balance), 0);
      const lateOpen = scheduled.reduce((a, r) => a + Number(r.lateFee), 0);
      const latePosted = shown.filter(counted).reduce((a, p) => a + Number(p.lateFee), 0);
      const received = shown.filter(counted).reduce((a, p) => a + Number(p.amount), 0);
      const refund = shown.reduce((a, p) => a + Number(p.refunded), 0);
      const payable = balance + lateOpen;
      // what was taken and is not on the instalments in scope: advance, or paid ahead of the date
      const advance = Math.max(received - refund - (net - balance) - latePosted, 0);
      return {
        ...head,
        letterhead: { phone: x.phone, email: x.email, website: x.website, logoFileId: x.logo },
        billNo: `${x.prefix}/${ledger.year.code}/${head.student.admissionNo}`,
        year: ledger.year.code,
        session: { from: x.year_from, to: x.year_to },
        billDate: ledger.asOf,
        generatedAt: x.now,
        ledger: ledgerOf,
        layout: (await this.layoutOf(c)).bill,
        student: {
          ...head.student,
          dob: x.dob,
          father: x.father ?? ledger.student.father,
          mother: x.mother,
          route: x.route,
        },
        heads: heads.rows.map((h) => ({
          ledger: h.ledger,
          head: h.head,
          optional: h.optional,
          amount: h.gross,
        })),
        discount: fmt(heads.rows.reduce((a, h) => a + Number(h.discount), 0)),
        headsThrough: x.through,
        schedules,
        receipts,
        summary: {
          due: fmt(net + latePosted + lateOpen),
          lateFee: fmt(latePosted + lateOpen),
          received: fmt(received),
          refund: fmt(refund),
          advance: fmt(advance),
          balance: fmt(payable),
          balanceWords: amountInWords(fmt(Math.max(payable, 0))),
        },
        notes: {
          bounceCharge: ledger.bounceCharge,
          lateFeeMode: ledger.lateFeeMode,
          latePerDay: x.late_per_day,
        },
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
    q: {
      classId?: string;
      sectionId?: string;
      upTo?: string;
      ledger?: 'all' | 'school' | 'hostel';
    },
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
      const b = await this.bill(ctx, id, q.upTo, q.ledger ?? 'all');
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
      // a pupil who has left (or is leaving) is charged up to the month of the leaving date
      const left = await c.query<{ d: string | null }>(
        `SELECT COALESCE((SELECT s.left_on FROM students s WHERE s.id = $1 AND s.status <> 'active'),
                         (SELECT w.leaving_on FROM student_withdrawals w WHERE w.student_id = $1 AND w.status IN ('requested', 'cleared') ORDER BY w.id DESC LIMIT 1))::text AS d`,
        [studentId],
      );
      const leaving = left.rows[0]?.d
        ? periods.rows.find(
            (p) =>
              p.year === Number(left.rows[0]!.d!.slice(0, 4)) &&
              p.month === Number(left.rows[0]!.d!.slice(5, 7)),
          )
        : undefined;
      const last = periods.rows.find((p) => p.sequence === lastSeq) ?? leaving ?? current;
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
        .filter((r) => r.sequence > last.sequence && Number(r.paid) > 0)
        .map((r) => ({ head: r.head, period: r.period, paid: r.paid }));
      // nothing is refunded by a head's "refundable" tick alone: a deposit is raised by fee head below
      const refundable: Array<{ head: string; paid: string }> = [];
      const receipts = await c.query<{
        id: string;
        receiptNo: string | null;
        receivedOn: string;
        amount: string;
        refunded: string;
      }>(
        `SELECT p.id::text, p.receipt_no AS "receiptNo", p.received_on::text AS "receivedOn", p.amount::text, p.refunded::text
           FROM fee_payments p WHERE p.student_id = $1 AND p.academic_year_id = $2 AND p.status IN ('posted', 'partly_refunded')
          ORDER BY p.received_on, p.id`,
        [studentId, yearId],
      );
      const refunds = await c.query<{
        id: string;
        voucherNo: string | null;
        status: string;
        amount: string;
        reason: string;
        byWithdrawal: boolean;
      }>(
        `SELECT r.id::text, r.voucher_no AS "voucherNo", r.status::text, r.amount::text, r.reason, r.withdrawal_id IS NOT NULL AS "byWithdrawal"
           FROM fee_refunds r LEFT JOIN fee_payments p ON p.id = r.payment_id
          WHERE COALESCE(r.student_id, p.student_id) = $1 AND COALESCE(r.academic_year_id, p.academic_year_id) = $2 AND r.status <> 'rejected'
          ORDER BY r.id`,
        [studentId, yearId],
      );
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
        leftOn: left.rows[0]?.d ?? null,
        receipts: receipts.rows,
        refunds: refunds.rows,
        refundsWaiting: fmt(
          refunds.rows
            .filter((r) => ['requested', 'approved'].includes(r.status))
            .reduce((a, r) => a + Number(r.amount), 0),
        ),
        refundsDraft: fmt(
          refunds.rows
            .filter((r) => r.status === 'draft')
            .reduce((a, r) => a + Number(r.amount), 0),
        ),
        refundsPaid: fmt(
          refunds.rows.filter((r) => r.status === 'paid').reduce((a, r) => a + Number(r.amount), 0),
        ),
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
