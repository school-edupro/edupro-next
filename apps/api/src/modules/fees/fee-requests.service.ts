/* eslint-disable no-restricted-syntax -- SQL fragments here are constants assembled in code (column lists, fixed WHERE parts); every value is a bound parameter */
import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { assertPeriodOpen } from '../ops/ops.service';
import { FeeSetupService } from './fee-setup.service';
import type {
  CollectionUploadDto,
  DecideChangeDto,
  ListChangeRequestsQueryDto,
  RequestChangeDto,
  SettlementUploadDto,
} from './fees.dto';

export interface ChangeRequestRow {
  id: string;
  kind: 'late_fee' | 'transfer' | 'date_change';
  status: string;
  student: string;
  admissionNo: string;
  receiptNo: string | null;
  receiptAmount: string | null;
  receivedOn: string | null;
  clearedOn: string | null;
  period: string | null;
  ledger: string | null;
  amount: string | null;
  toStudent: string | null;
  toAdmissionNo: string | null;
  newReceivedOn: string | null;
  newClearedOn: string | null;
  batchId: string | null;
  reason: string;
  requestedBy: string | null;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  decisionNote: string | null;
  result: Record<string, unknown> | null;
}
export interface CollectionRow {
  row: number;
  admissionNo: string;
  studentId: string | null;
  name: string | null;
  section: string | null;
  amount: number;
  mode: string;
  receivedOn: string;
  ledger: 'school' | 'hostel';
  reference: string | null;
  instrumentNo: string | null;
  instrumentDate: string | null;
  bankName: string | null;
  remarks: string | null;
  error: string | null;
}

const SELECT = `
  SELECT r.id::text, r.kind, r.status::text, s.display_name AS student, s.admission_no AS "admissionNo", p.receipt_no AS "receiptNo", p.amount::text AS "receiptAmount",
         p.received_on::text AS "receivedOn", p.cleared_on::text AS "clearedOn", fp.name AS period, r.ledger::text AS ledger, r.amount::text AS amount,
         t.display_name AS "toStudent", t.admission_no AS "toAdmissionNo", r.new_received_on::text AS "newReceivedOn", r.new_cleared_on::text AS "newClearedOn",
         r.batch_id::text AS "batchId", r.reason, ru.display_name AS "requestedBy", r.requested_at::text AS "requestedAt", du.display_name AS "decidedBy",
         r.decided_at::text AS "decidedAt", r.decision_note AS "decisionNote", r.result
    FROM fee_change_requests r JOIN students s ON s.id = r.student_id
    LEFT JOIN fee_payments p ON p.id = r.payment_id LEFT JOIN fee_periods fp ON fp.id = r.period_id LEFT JOIN students t ON t.id = r.to_student_id
    LEFT JOIN users ru ON ru.id = r.requested_by LEFT JOIN users du ON du.id = r.decided_by`;

const SETTLE_HEADERS = ['Receipt no.', 'Settlement date', 'New receipt date'];
const COLLECT_HEADERS = [
  'Admission no.',
  'Amount',
  'Mode',
  'Date',
  'Fee type',
  'Reference no.',
  'Cheque / DD no.',
  'Cheque date',
  'Bank',
  'Remarks',
];
const MODES = ['cash', 'cheque', 'dd', 'upi', 'card', 'bank'];

/** 2026-10-08, 08-10-2026 or 08/10/2026 → 2026-10-08; anything else is null. */
const toDate = (v: string): string | null => {
  const s = v.trim();
  if (s === '') return null;
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}`;
  return null;
};

/**
 * Fee changes that wait for approval (0101): late-fee waiver, a receipt moved to another pupil, a
 * receipt or settlement date corrected (one, or many from Excel), and collections uploaded from Excel.
 */
@Injectable()
export class FeeRequestsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly setup: FeeSetupService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  private async find(c: PoolClient, id: string): Promise<ChangeRequestRow> {
    const r = await c.query<ChangeRequestRow>(`${SELECT} WHERE r.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Request not found', { status: 404 });
    return r.rows[0];
  }

  async list(ctx: RequestContext, q: ListChangeRequestsQueryDto): Promise<ChangeRequestRow[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<ChangeRequestRow>(
        `${SELECT} WHERE r.academic_year_id = $1 AND ($2::text IS NULL OR r.status::text = $2) AND ($3::text IS NULL OR r.kind = $3)
          ORDER BY (r.status = 'pending') DESC, r.requested_at DESC LIMIT 500`,
        [yearId, q.status ?? null, q.kind ?? null],
      );
      return r.rows;
    });
  }

  private async receipt(c: PoolClient, receiptNo: string) {
    const r = await c.query<{
      id: string;
      student_id: string;
      status: string;
      refunded: string;
      ledger: string;
      received_on: string;
      financial_year_id: string | null;
      academic_year_id: string;
    }>(
      `SELECT id::text, student_id::text, status, refunded::text, ledger::text, received_on::text, financial_year_id::text, academic_year_id::text
         FROM fee_payments WHERE receipt_no = $1`,
      [receiptNo.trim()],
    );
    if (!r.rows[0])
      throw new DomainError('not-found', `Receipt ${receiptNo} not found`, { status: 404 });
    return r.rows[0];
  }

  private async studentByAdmission(c: PoolClient, admissionNo: string): Promise<string> {
    const r = await c.query<{ id: string }>(
      `SELECT id::text FROM students WHERE lower(admission_no) = lower($1) AND deleted_at IS NULL`,
      [admissionNo.trim()],
    );
    if (!r.rows[0])
      throw new DomainError('not-found', `No pupil with admission number ${admissionNo}`, {
        status: 404,
      });
    return r.rows[0].id;
  }

  /** Checks a date correction and returns what is stored; the same check runs again on approval. */
  private async checkDates(
    c: PoolClient,
    pay: Awaited<ReturnType<FeeRequestsService['receipt']>>,
    newReceivedOn: string | null,
    newClearedOn: string | null,
  ): Promise<void> {
    if (!newReceivedOn && !newClearedOn)
      throw new DomainError(
        'validation-failed',
        'Give the new receipt date or the settlement date',
        {
          status: 422,
        },
      );
    if (['reversed', 'bounced'].includes(pay.status))
      throw new DomainError('fees.already_reversed', 'The receipt is cancelled or bounced', {
        status: 409,
      });
    if (newReceivedOn) {
      const today = await c.query<{ future: boolean; same_fy: boolean }>(
        `SELECT ($1::date > CURRENT_DATE) AS future,
                EXISTS (SELECT 1 FROM financial_years f WHERE f.id = $2::bigint AND $1::date BETWEEN f.start_date AND f.end_date) AS same_fy`,
        [newReceivedOn, pay.financial_year_id],
      );
      if (today.rows[0]!.future)
        throw new DomainError('validation-failed', 'The receipt date cannot be in the future', {
          status: 422,
        });
      if (pay.financial_year_id && !today.rows[0]!.same_fy)
        throw new DomainError(
          'fees.date_other_year',
          'The new date is in another financial year; the receipt number belongs to its own year',
          { status: 422 },
        );
      // a closed month takes no change, at the old date or the new one
      await assertPeriodOpen(c, pay.ledger, pay.received_on);
      await assertPeriodOpen(c, pay.ledger, newReceivedOn);
    }
  }

  async request(ctx: RequestContext, dto: RequestChangeDto): Promise<ChangeRequestRow> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      let studentId: string;
      let paymentId: string | null = null;
      let toStudentId: string | null = null;
      if (dto.kind === 'late_fee') {
        studentId = dto.studentId ?? (await this.studentByAdmission(c, dto.admissionNo!));
        const p = await c.query(
          `SELECT 1 FROM fee_periods WHERE id = $1 AND academic_year_id = $2`,
          [dto.periodId, yearId],
        );
        if (p.rowCount === 0)
          throw new DomainError('not-found', 'Fee month not found in this year', { status: 404 });
      } else {
        const pay = await this.receipt(c, dto.receiptNo!);
        paymentId = pay.id;
        studentId = pay.student_id;
        if (dto.kind === 'transfer') {
          toStudentId = await this.studentByAdmission(c, dto.toAdmissionNo!);
          if (toStudentId === studentId)
            throw new DomainError(
              'validation-failed',
              'The receipt already belongs to this pupil',
              {
                status: 422,
              },
            );
          if (pay.status !== 'posted' || Number(pay.refunded) > 0)
            throw new DomainError(
              'fees.transfer_not_possible',
              'Only a receipt that is not cancelled, bounced or refunded can be moved',
              { status: 409 },
            );
        } else {
          await this.checkDates(c, pay, dto.newReceivedOn ?? null, dto.newClearedOn ?? null);
        }
      }
      const open = await c.query(
        `SELECT 1 FROM fee_change_requests WHERE status = 'pending' AND kind = $1 AND student_id = $2
            AND payment_id IS NOT DISTINCT FROM $3::bigint AND period_id IS NOT DISTINCT FROM $4::bigint`,
        [dto.kind, studentId, paymentId, dto.kind === 'late_fee' ? dto.periodId : null],
      );
      if (open.rowCount)
        throw new DomainError(
          'fees.change_open',
          'The same request is already waiting for approval',
          { status: 409 },
        );
      const r = await c.query<{ id: string }>(
        `INSERT INTO fee_change_requests (school_id, academic_year_id, kind, student_id, payment_id, period_id, ledger, amount, to_student_id, new_received_on, new_cleared_on, reason, requested_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::ledger_type, $7, $8, $9::date, $10::date, $11, app.current_user_id()) RETURNING id::text`,
        [
          yearId,
          dto.kind,
          studentId,
          paymentId,
          dto.kind === 'late_fee' ? dto.periodId : null,
          dto.kind === 'late_fee' ? (dto.ledger ?? 'school') : null,
          dto.kind === 'late_fee' ? dto.amount!.toFixed(2) : null,
          toStudentId,
          dto.kind === 'date_change' ? (dto.newReceivedOn ?? null) : null,
          dto.kind === 'date_change' ? (dto.newClearedOn ?? null) : null,
          dto.reason,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.change.request',
        entityType: 'fee_change_requests',
        entityId: r.rows[0]!.id,
        after: dto,
      });
      return this.find(c, r.rows[0]!.id);
    });
  }

  private async apply(c: PoolClient, id: string): Promise<Record<string, unknown>> {
    const q = await c.query<{
      kind: string;
      student_id: string;
      academic_year_id: string;
      payment_id: string | null;
      period_id: string | null;
      ledger: string | null;
      amount: string | null;
      to_student_id: string | null;
      new_received_on: string | null;
      new_cleared_on: string | null;
      reason: string;
    }>(
      `SELECT kind, student_id::text, academic_year_id::text, payment_id::text, period_id::text, ledger::text, amount::text, to_student_id::text,
              new_received_on::text, new_cleared_on::text, reason FROM fee_change_requests WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const r = q.rows[0]!;
    if (r.kind === 'late_fee') {
      await c.query(
        `UPDATE fee_late_fee_overrides SET revoked_at = now(), revoked_by = app.current_user_id()
          WHERE student_id = $1 AND academic_year_id = $2 AND period_id = $3 AND ledger = $4::ledger_type AND revoked_at IS NULL`,
        [r.student_id, r.academic_year_id, r.period_id, r.ledger],
      );
      const o = await c.query<{ id: string }>(
        `INSERT INTO fee_late_fee_overrides (school_id, student_id, academic_year_id, period_id, ledger, amount, reason, created_by, request_id)
         VALUES (app.current_school_id(), $1, $2, $3, $4::ledger_type, $5, $6, app.current_user_id(), app.current_request_id()) RETURNING id::text`,
        [r.student_id, r.academic_year_id, r.period_id, r.ledger, r.amount, r.reason],
      );
      return { overrideId: o.rows[0]!.id };
    }
    const p = await c.query<{
      receipt_no: string | null;
      amount: string;
      received_on: string;
      mode: string;
      reference: string | null;
      instrument_no: string | null;
      instrument_date: string | null;
      bank_name: string | null;
      ledger: string;
      cleared_on: string | null;
      deposit_slip_id: string | null;
      status: string;
      refunded: string;
      late_fee: string;
      financial_year_id: string | null;
      student_id: string;
      academic_year_id: string;
      id: string;
    }>(
      `SELECT id::text, receipt_no, amount::text, received_on::text, mode, reference, instrument_no, instrument_date::text, bank_name, ledger::text, cleared_on::text,
              deposit_slip_id::text, status, refunded::text, late_fee::text, financial_year_id::text, student_id::text, academic_year_id::text
         FROM fee_payments WHERE id = $1 FOR UPDATE`,
      [r.payment_id],
    );
    const pay = p.rows[0]!;
    if (r.kind === 'date_change') {
      await this.checkDates(c, pay, r.new_received_on, r.new_cleared_on);
      await c.query(
        `UPDATE fee_payments SET received_on = COALESCE($2::date, received_on), cleared_on = COALESCE($3::date, cleared_on) WHERE id = $1`,
        [pay.id, r.new_received_on, r.new_cleared_on],
      );
      return {
        receivedOn: { from: pay.received_on, to: r.new_received_on ?? pay.received_on },
        clearedOn: { from: pay.cleared_on, to: r.new_cleared_on ?? pay.cleared_on },
      };
    }
    // transfer: the receipt is cancelled on the first pupil and posted again, same date and mode, on the other
    if (pay.status !== 'posted' || Number(pay.refunded) > 0)
      throw new DomainError(
        'fees.transfer_not_possible',
        'The receipt has been cancelled, bounced or refunded since the request',
        { status: 409 },
      );
    await assertPeriodOpen(c, pay.ledger, pay.received_on);
    const names = await c.query<{ id: string; label: string }>(
      `SELECT id::text, display_name || ' (' || admission_no || ')' AS label FROM students WHERE id = ANY($1::bigint[])`,
      [[pay.student_id, r.to_student_id]],
    );
    const label = (sid: string | null) => names.rows.find((n) => n.id === sid)?.label ?? '';
    await c.query(`SELECT app.reverse_fee_payment($1, 'reversed', $2, 0, NULL)`, [
      pay.id,
      `Moved to ${label(r.to_student_id)}: ${r.reason}`.slice(0, 300),
    ]);
    const n = await c.query<{ o_payment_id: string; o_receipt_no: string | null }>(
      `SELECT o_payment_id::text, o_receipt_no FROM app.post_receipt($1, $2, $3, $4::date, $5, $6, $7, $8, $9::date, $10, NULL, $11::ledger_type, $12, false)`,
      [
        r.to_student_id,
        pay.academic_year_id,
        pay.amount,
        pay.received_on,
        pay.mode,
        pay.reference,
        `Moved from receipt ${pay.receipt_no ?? pay.id} of ${label(pay.student_id)}`.slice(0, 300),
        pay.instrument_no,
        pay.instrument_date,
        pay.bank_name,
        pay.ledger,
        // late fee is taken on the new receipt only if the cashier took it on the first one
        Number(pay.late_fee) > 0,
      ],
    );
    // the money did not move at the bank: its clearing date and deposit slip follow the new receipt
    await c.query(
      `UPDATE fee_payments SET cleared_on = $2::date, deposit_slip_id = $3 WHERE id = $1`,
      [n.rows[0]!.o_payment_id, pay.cleared_on, pay.deposit_slip_id],
    );
    await c.query(`UPDATE fee_payments SET deposit_slip_id = NULL WHERE id = $1`, [pay.id]);
    return { newPaymentId: n.rows[0]!.o_payment_id, newReceiptNo: n.rows[0]!.o_receipt_no };
  }

  private async decideWith(
    ctx: RequestContext,
    c: PoolClient,
    id: string,
    dto: DecideChangeDto,
  ): Promise<void> {
    const before = await this.find(c, id);
    if (before.status !== 'pending')
      throw new DomainError('fees.change_decided', 'This request has already been decided', {
        status: 409,
      });
    let result: Record<string, unknown> = {};
    if (dto.outcome === 'approved') {
      try {
        result = await this.apply(c, id);
      } catch (error) {
        const e = error as { message?: string };
        if (e.message === 'fees.already_reversed' || e.message === 'fees.reversal_after_refund')
          throw new DomainError(e.message, 'The receipt can no longer be moved', { status: 409 });
        throw error;
      }
    }
    await c.query(
      `UPDATE fee_change_requests SET status = $2::workflow_status, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3, result = $4::jsonb WHERE id = $1`,
      [id, dto.outcome, dto.note ?? null, JSON.stringify(result)],
    );
    await this.audit.stage(ctx, c, {
      action: `fees.change.${dto.outcome}`,
      entityType: 'fee_change_requests',
      entityId: id,
      before: { status: before.status },
      after: { kind: before.kind, note: dto.note, ...result },
    });
  }

  async decide(ctx: RequestContext, id: string, dto: DecideChangeDto): Promise<ChangeRequestRow> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.decideWith(ctx, c, id, dto);
      return this.find(c, id);
    });
  }

  /** Every waiting row of one Excel file, approved or rejected together. */
  async decideBatch(ctx: RequestContext, batchId: string, dto: DecideChangeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const ids = await c.query<{ id: string }>(
        `SELECT id::text FROM fee_change_requests WHERE batch_id = $1::uuid AND status = 'pending' ORDER BY id`,
        [batchId],
      );
      if (ids.rowCount === 0)
        throw new DomainError('not-found', 'Nothing is waiting in this file', { status: 404 });
      for (const r of ids.rows) await this.decideWith(ctx, c, r.id, dto);
      return { decided: ids.rowCount ?? 0, outcome: dto.outcome };
    });
  }

  // ---- settlement dates from Excel ----------------------------------------------------------------
  async settlementFormat() {
    return {
      filename: 'fee-settlement-dates-format.xlsx',
      bytes: await templateSheet({
        sheet: 'Settlement',
        columns: [
          { header: SETTLE_HEADERS[0]!, width: 24, required: true },
          { header: SETTLE_HEADERS[1]!, width: 18 },
          { header: SETTLE_HEADERS[2]!, width: 18 },
        ],
        guide: [
          'One receipt in each row. Type the receipt number exactly as printed.',
          'Settlement date: the day the bank credited the money (DD-MM-YYYY). Leave empty if only the receipt date changes.',
          'New receipt date: only when the receipt was dated wrongly. It must be in the same financial year and in an open month.',
          'The rows are shown for checking and go to the school admin for approval; nothing changes before that.',
        ],
      }),
    };
  }

  /** Reads the file; good rows become requests of one batch, bad rows are returned with the reason. */
  async settlementUpload(ctx: RequestContext, dto: SettlementUploadDto) {
    const yearId = this.year(ctx);
    const sheet = await readSheet(dto.fileBase64, SETTLE_HEADERS);
    if (!sheet.length)
      throw new DomainError('validation-failed', 'The file has no rows', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const batchId = randomUUID();
      const bad: Array<{ row: number; receiptNo: string; error: string }> = [];
      let good = 0;
      for (const line of sheet) {
        const receiptNo = line.cells[SETTLE_HEADERS[0]!]!.trim();
        const cleared = toDate(line.cells[SETTLE_HEADERS[1]!]!);
        const received = toDate(line.cells[SETTLE_HEADERS[2]!]!);
        const fail = (error: string) => bad.push({ row: line.row, receiptNo, error });
        if (!receiptNo) {
          fail('No receipt number');
          continue;
        }
        if (
          (line.cells[SETTLE_HEADERS[1]!]!.trim() && !cleared) ||
          (line.cells[SETTLE_HEADERS[2]!]!.trim() && !received)
        ) {
          fail('Date not understood; use DD-MM-YYYY');
          continue;
        }
        try {
          await c.query('SAVEPOINT settle_row');
          const pay = await this.receipt(c, receiptNo);
          await this.checkDates(c, pay, received, cleared);
          await c.query(
            `INSERT INTO fee_change_requests (school_id, academic_year_id, kind, student_id, payment_id, new_received_on, new_cleared_on, batch_id, reason, requested_by)
             VALUES (app.current_school_id(), $1, 'date_change', $2, $3, $4::date, $5::date, $6::uuid, $7, app.current_user_id())`,
            [yearId, pay.student_id, pay.id, received, cleared, batchId, dto.reason],
          );
          await c.query('RELEASE SAVEPOINT settle_row');
          good += 1;
        } catch (error) {
          await c.query('ROLLBACK TO SAVEPOINT settle_row');
          if (!(error instanceof DomainError)) throw error;
          fail(error.message);
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'fees.settlement.upload',
        entityType: 'fee_change_requests',
        entityId: batchId,
        after: { rows: sheet.length, good, bad: bad.length, reason: dto.reason },
      });
      return { batchId: good > 0 ? batchId : null, rows: sheet.length, good, bad };
    });
  }

  // ---- collection from Excel ------------------------------------------------------------------------
  async collectionFormat() {
    return {
      filename: 'fee-collection-format.xlsx',
      bytes: await templateSheet({
        sheet: 'Collection',
        columns: [
          { header: COLLECT_HEADERS[0]!, width: 18, required: true },
          { header: COLLECT_HEADERS[1]!, width: 12, required: true },
          { header: COLLECT_HEADERS[2]!, width: 12, required: true },
          { header: COLLECT_HEADERS[3]!, width: 14, required: true },
          { header: COLLECT_HEADERS[4]!, width: 12 },
          { header: COLLECT_HEADERS[5]!, width: 20 },
          { header: COLLECT_HEADERS[6]!, width: 16 },
          { header: COLLECT_HEADERS[7]!, width: 14 },
          { header: COLLECT_HEADERS[8]!, width: 18 },
          { header: COLLECT_HEADERS[9]!, width: 28 },
        ],
        guide: [
          'One payment in each row. Admission no., Amount, Mode and Date are compulsory.',
          'Mode: cash, cheque, dd, upi, card or bank. Date: the day the money was received (DD-MM-YYYY).',
          'Fee type: regular or hostel; empty means regular.',
          'Fill reference / cheque number / cheque date / bank as your payment mode set-up demands.',
          'The rows are checked and shown first. Receipts are made only after the school admin approves the file.',
        ],
      }),
    };
  }

  private async uploadWith(c: PoolClient, id: string) {
    const r = await c.query<Record<string, unknown>>(
      `SELECT u.id::text, u.file_name AS "fileName", u.rows, u.total_rows AS "totalRows", u.good_rows AS "goodRows", u.total_amount::text AS "totalAmount", u.status,
              u.reason, up.display_name AS "uploadedBy", u.uploaded_at::text AS "uploadedAt", du.display_name AS "decidedBy", u.decided_at::text AS "decidedAt",
              u.decision_note AS "decisionNote", u.receipts
         FROM fee_collection_uploads u LEFT JOIN users up ON up.id = u.uploaded_by LEFT JOIN users du ON du.id = u.decided_by WHERE u.id = $1`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Upload not found', { status: 404 });
    return r.rows[0];
  }

  async collectionUploads(ctx: RequestContext) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        `SELECT u.id::text, u.file_name AS "fileName", u.total_rows AS "totalRows", u.good_rows AS "goodRows", u.total_amount::text AS "totalAmount", u.status,
                u.reason, up.display_name AS "uploadedBy", u.uploaded_at::text AS "uploadedAt", du.display_name AS "decidedBy", u.decided_at::text AS "decidedAt"
           FROM fee_collection_uploads u LEFT JOIN users up ON up.id = u.uploaded_by LEFT JOIN users du ON du.id = u.decided_by
          WHERE u.academic_year_id = $1 AND u.status <> 'cancelled' ORDER BY u.id DESC LIMIT 100`,
        [yearId],
      );
      return r.rows;
    });
  }

  async collectionUpload(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), (c) => this.uploadWith(c, id));
  }

  /** Reads and checks the file; it is kept as a draft for the uploader to look at. */
  async collectionVerify(ctx: RequestContext, dto: CollectionUploadDto) {
    const yearId = this.year(ctx);
    const sheet = await readSheet(dto.fileBase64, COLLECT_HEADERS);
    if (!sheet.length)
      throw new DomainError('validation-failed', 'The file has no rows', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(`SELECT app.assert_year_open($1, 'fees')`, [yearId]);
      const numbers = sheet.map((r) => r.cells[COLLECT_HEADERS[0]!]!.trim().toLowerCase());
      const found = await c.query<{
        key: string;
        id: string;
        name: string;
        section: string | null;
      }>(
        `SELECT lower(s.admission_no) AS key, s.id::text, s.display_name AS name,
                (SELECT k.code || '-' || cs.name FROM enrolments e JOIN class_sections cs ON cs.id = e.class_section_id JOIN classes k ON k.id = cs.class_id
                  WHERE e.student_id = s.id AND e.academic_year_id = $2 AND e.status = 'active' LIMIT 1) AS section
           FROM students s WHERE lower(s.admission_no) = ANY($1::text[]) AND s.deleted_at IS NULL`,
        [numbers, yearId],
      );
      const byNo = new Map(found.rows.map((f) => [f.key, f]));
      const modes = await this.setup.paymentModesWith(c);
      const rows: CollectionRow[] = [];
      for (const line of sheet) {
        const cell = (i: number) => line.cells[COLLECT_HEADERS[i]!]!.trim();
        const st = byNo.get(cell(0).toLowerCase());
        const amount = Number(cell(1).replace(/,/g, ''));
        const mode = cell(2).toLowerCase();
        const receivedOn = toDate(cell(3));
        const type = cell(4).toLowerCase();
        const row: CollectionRow = {
          row: line.row,
          admissionNo: cell(0),
          studentId: st?.id ?? null,
          name: st?.name ?? null,
          section: st?.section ?? null,
          amount: Number.isFinite(amount) ? amount : 0,
          mode,
          receivedOn: receivedOn ?? cell(3),
          ledger: type === 'hostel' ? 'hostel' : 'school',
          reference: cell(5) || null,
          instrumentNo: cell(6) || null,
          instrumentDate: toDate(cell(7)),
          bankName: cell(8) || null,
          remarks: cell(9) || null,
          error: null,
        };
        const m = modes.find((x) => x.code === mode);
        if (!st) row.error = 'Admission number not found';
        else if (!st.section) row.error = 'The pupil has no class this year';
        else if (!(amount > 0)) row.error = 'Amount must be more than 0';
        else if (!MODES.includes(mode) || !m)
          row.error = 'Mode must be cash, cheque, dd, upi, card or bank';
        else if (!m.atCounter) row.error = `${m.label} is not accepted at the counter`;
        else if (!receivedOn) row.error = 'Date not understood; use DD-MM-YYYY';
        else if (type && !['regular', 'school', 'hostel'].includes(type))
          row.error = 'Fee type must be regular or hostel';
        else if (cell(7) && !row.instrumentDate)
          row.error = 'Cheque date not understood; use DD-MM-YYYY';
        else {
          const missing = [
            m.needReference && !row.reference ? 'reference no.' : '',
            m.needInstrumentNo && !row.instrumentNo ? 'cheque / DD no.' : '',
            m.needInstrumentDate && !row.instrumentDate ? 'cheque date' : '',
            m.needBank && !row.bankName ? 'bank' : '',
          ].filter(Boolean);
          if (missing.length) row.error = `${m.label} needs: ${missing.join(', ')}`;
          else {
            const future = await c.query<{ f: boolean }>(`SELECT ($1::date > CURRENT_DATE) AS f`, [
              receivedOn,
            ]);
            if (future.rows[0]!.f) row.error = 'The date is in the future';
          }
        }
        rows.push(row);
      }
      const good = rows.filter((r) => !r.error);
      const ins = await c.query<{ id: string }>(
        `INSERT INTO fee_collection_uploads (school_id, academic_year_id, file_name, rows, total_rows, good_rows, total_amount, uploaded_by)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, $4, $5, $6, app.current_user_id()) RETURNING id::text`,
        [
          yearId,
          dto.fileName ?? null,
          JSON.stringify(rows),
          rows.length,
          good.length,
          good.reduce((a, r) => a + r.amount, 0).toFixed(2),
        ],
      );
      return this.uploadWith(c, ins.rows[0]!.id);
    });
  }

  /** The uploader sends a checked file for approval, or drops it. Only a file with no bad row can go. */
  async collectionSubmit(
    ctx: RequestContext,
    id: string,
    action: 'submit' | 'cancel',
    reason?: string,
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const u = await this.uploadWith(c, id);
      if (u.status !== 'draft')
        throw new DomainError(
          'fees.upload_not_draft',
          'This file has already been sent or dropped',
          {
            status: 409,
          },
        );
      if (action === 'submit') {
        if (Number(u.goodRows) !== Number(u.totalRows) || Number(u.totalRows) === 0)
          throw new DomainError(
            'fees.upload_has_errors',
            'Correct the rows marked in red in the Excel file and upload it again',
            { status: 409 },
          );
        if (!reason || reason.trim().length < 3)
          throw new DomainError('validation-failed', 'Give the reason for the upload', {
            status: 422,
          });
      }
      await c.query(
        `UPDATE fee_collection_uploads SET status = $2, reason = COALESCE($3, reason) WHERE id = $1`,
        [id, action === 'submit' ? 'pending' : 'cancelled', reason ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: `fees.collection_upload.${action}`,
        entityType: 'fee_collection_uploads',
        entityId: id,
        after: { rows: u.totalRows, amount: u.totalAmount, reason },
      });
      return this.uploadWith(c, id);
    });
  }

  /** Approval posts every row as a receipt, all or none; a rejection posts nothing. */
  async collectionDecide(ctx: RequestContext, id: string, dto: DecideChangeDto) {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const lock = await c.query<{
        status: string;
        rows: CollectionRow[];
        academic_year_id: string;
      }>(
        `SELECT status, rows, academic_year_id::text FROM fee_collection_uploads WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const u = lock.rows[0];
      if (!u) throw new DomainError('not-found', 'Upload not found', { status: 404 });
      if (u.status !== 'pending')
        throw new DomainError('fees.upload_not_pending', 'This file is not waiting for approval', {
          status: 409,
        });
      const receipts: Array<{ row: number; receiptNo: string | null; paymentId: string }> = [];
      if (dto.outcome === 'approved') {
        if (u.academic_year_id !== yearId)
          throw new DomainError(
            'fees.upload_other_year',
            'Switch to the year of the upload first',
            {
              status: 409,
            },
          );
        for (const r of u.rows) {
          try {
            await assertPeriodOpen(c, r.ledger, r.receivedOn);
            await this.setup.assertModeFields(c, r);
            const p = await c.query<{ o_payment_id: string; o_receipt_no: string | null }>(
              `SELECT o_payment_id::text, o_receipt_no FROM app.post_receipt($1, $2, $3, $4::date, $5, $6, $7, $8, $9::date, $10, NULL, $11::ledger_type, true, true)`,
              [
                r.studentId,
                yearId,
                r.amount.toFixed(2),
                r.receivedOn,
                r.mode,
                r.reference,
                r.remarks ?? `Excel upload ${id}`,
                r.instrumentNo,
                r.instrumentDate,
                r.bankName,
                r.ledger,
              ],
            );
            receipts.push({
              row: r.row,
              receiptNo: p.rows[0]!.o_receipt_no,
              paymentId: p.rows[0]!.o_payment_id,
            });
          } catch (error) {
            const e = error as { message?: string };
            throw new DomainError(
              'fees.upload_row_failed',
              `Row ${r.row} (${r.admissionNo}) could not be posted: ${e.message ?? 'error'}. Nothing was posted.`,
              { status: 409 },
            );
          }
        }
      }
      await c.query(
        `UPDATE fee_collection_uploads SET status = $2, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3, receipts = $4::jsonb WHERE id = $1`,
        [
          id,
          dto.outcome === 'approved' ? 'posted' : 'rejected',
          dto.note ?? null,
          JSON.stringify(receipts),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: `fees.collection_upload.${dto.outcome}`,
        entityType: 'fee_collection_uploads',
        entityId: id,
        after: { receipts: receipts.length, note: dto.note },
      });
      return this.uploadWith(c, id);
    });
  }
}
