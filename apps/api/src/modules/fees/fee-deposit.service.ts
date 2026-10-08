import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { amountInWords } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { CreateDepositSlipDto, PendingInstrumentsQueryDto } from './fees.dto';

export interface Instrument {
  /** `p:<id>` for a fee receipt, `m:<id>` for a misc receipt. */
  key: string;
  receiptNo: string | null;
  receivedOn: string;
  payer: string;
  admissionNo: string | null;
  section: string | null;
  ledger: string;
  mode: string;
  instrumentNo: string | null;
  instrumentDate: string | null;
  bankName: string | null;
  amount: string;
}
export interface BankAccount {
  id: string;
  bank: string;
  accountName: string;
  accountNo: string;
  ifsc: string;
  branch: string | null;
  purpose: string;
}
export interface DepositSlip {
  id: string;
  slipNo: number;
  depositOn: string;
  account: BankAccount;
  instruments: number;
  total: string;
  remarks: string | null;
  status: 'open' | 'cancelled';
  createdBy: string | null;
  createdAt: string;
}

// one cheque or draft in hand: posted, not bounced or reversed
const INSTRUMENTS = `
  SELECT 'p:' || p.id AS key, p.receipt_no AS "receiptNo", p.received_on::text AS "receivedOn", s.display_name AS payer, s.admission_no AS "admissionNo",
         k.code || '-' || cs.name AS section, p.ledger::text AS ledger, p.mode, p.instrument_no AS "instrumentNo", p.instrument_date::text AS "instrumentDate",
         p.bank_name AS "bankName", p.amount::text AS amount, p.deposit_slip_id, p.academic_year_id, p.received_on, p.id
    FROM fee_payments p JOIN students s ON s.id = p.student_id
    LEFT JOIN enrolments e ON e.student_id = p.student_id AND e.academic_year_id = p.academic_year_id AND e.status = 'active'
    LEFT JOIN class_sections cs ON cs.id = e.class_section_id LEFT JOIN classes k ON k.id = cs.class_id
   WHERE p.mode IN ('cheque', 'dd') AND p.status IN ('posted', 'partly_refunded')
  UNION ALL
  SELECT 'm:' || m.id, m.receipt_no, m.received_on::text, m.payer_name, NULL, NULL, 'misc', m.mode, m.instrument_no, NULL, m.bank_name, m.amount::text,
         m.deposit_slip_id, m.academic_year_id, m.received_on, m.id
    FROM misc_receipts m WHERE m.mode IN ('cheque', 'dd') AND m.status = 'posted'`;

const ACCOUNT = `a.id::text, b.name AS bank, a.account_name AS "accountName", a.account_no AS "accountNo", a.ifsc, a.branch, a.purpose`;

/** Bank deposit slips for cheques and drafts (0100). */
@Injectable()
export class FeeDepositService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private year(ctx: RequestContext): string {
    const y = requireTenant(ctx).academicYearId;
    if (!y)
      throw new DomainError('year.not_selected', 'No academic year is active or selected', {
        status: 409,
      });
    return y;
  }

  async accounts(ctx: RequestContext): Promise<BankAccount[]> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<BankAccount>(
        // eslint-disable-next-line no-restricted-syntax -- ACCOUNT is a constant column list
        `SELECT ${ACCOUNT} FROM school_bank_accounts a JOIN banks b ON b.id = a.bank_id WHERE a.status = 'active' ORDER BY a.is_default DESC, a.account_name`,
      );
      return r.rows;
    });
  }

  /** Cheques and drafts of the working year that are on no slip yet. */
  async pending(ctx: RequestContext, q: PendingInstrumentsQueryDto): Promise<Instrument[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Instrument>(
        // eslint-disable-next-line no-restricted-syntax -- INSTRUMENTS is a constant; values are bound parameters
        `SELECT x.key, x."receiptNo", x."receivedOn", x.payer, x."admissionNo", x.section, x.ledger, x.mode, x."instrumentNo", x."instrumentDate", x."bankName", x.amount
           FROM (${INSTRUMENTS}) x
          WHERE x.deposit_slip_id IS NULL AND x.academic_year_id = $1
            AND ($2::date IS NULL OR x.received_on >= $2::date) AND ($3::date IS NULL OR x.received_on <= $3::date)
            AND ($4::text IS NULL OR x.ledger = $4)
          ORDER BY x.received_on, x.id LIMIT 500`,
        [yearId, q.from ?? null, q.to ?? null, q.ledger ?? null],
      );
      return r.rows;
    });
  }

  private async find(c: PoolClient, id: string): Promise<DepositSlip> {
    const r = await c.query<Omit<DepositSlip, 'account'> & BankAccount & { accountId: string }>(
      // eslint-disable-next-line no-restricted-syntax -- ACCOUNT is a constant column list
      `SELECT d.id::text AS "slipId", d.slip_no AS "slipNo", d.deposit_on::text AS "depositOn", d.instruments, d.total::text, d.remarks, d.status,
              u.display_name AS "createdBy", d.created_at::text AS "createdAt", ${ACCOUNT}
         FROM fee_deposit_slips d JOIN school_bank_accounts a ON a.id = d.bank_account_id JOIN banks b ON b.id = a.bank_id
         LEFT JOIN users u ON u.id = d.created_by WHERE d.id = $1`,
      [id],
    );
    const x = r.rows[0] as unknown as Record<string, unknown> | undefined;
    if (!x) throw new DomainError('not-found', 'Deposit slip not found', { status: 404 });
    return toSlip(x);
  }

  async list(ctx: RequestContext): Promise<DepositSlip[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- ACCOUNT is a constant column list
        `SELECT d.id::text AS "slipId", d.slip_no AS "slipNo", d.deposit_on::text AS "depositOn", d.instruments, d.total::text, d.remarks, d.status,
                u.display_name AS "createdBy", d.created_at::text AS "createdAt", ${ACCOUNT}
           FROM fee_deposit_slips d JOIN school_bank_accounts a ON a.id = d.bank_account_id JOIN banks b ON b.id = a.bank_id
           LEFT JOIN users u ON u.id = d.created_by
          WHERE d.academic_year_id = $1 ORDER BY d.slip_no DESC LIMIT 300`,
        [yearId],
      );
      return r.rows.map(toSlip);
    });
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const slip = await this.find(c, id);
      const lines = await c.query<Instrument>(
        // eslint-disable-next-line no-restricted-syntax -- INSTRUMENTS is a constant; the id is a bound parameter
        `SELECT x.key, x."receiptNo", x."receivedOn", x.payer, x."admissionNo", x.section, x.ledger, x.mode, x."instrumentNo", x."instrumentDate", x."bankName", x.amount
           FROM (${INSTRUMENTS.replace(/AND p\.status IN \('posted', 'partly_refunded'\)/, '').replace(/AND m\.status = 'posted'/, '')}) x
          WHERE x.deposit_slip_id = $1 ORDER BY x.received_on, x.id`,
        [id],
      );
      const school = await c.query<{ name: string }>(
        `SELECT name FROM schools WHERE id = app.current_school_id()`,
      );
      return {
        ...slip,
        school: school.rows[0]?.name ?? '',
        totalWords: amountInWords(slip.total),
        lines: lines.rows,
      };
    });
  }

  async create(ctx: RequestContext, dto: CreateDepositSlipDto): Promise<DepositSlip> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const acc = await c.query(
        `SELECT 1 FROM school_bank_accounts WHERE id = $1 AND status = 'active'`,
        [dto.bankAccountId],
      );
      if (acc.rowCount === 0)
        throw new DomainError('not-found', 'Bank account not found', { status: 404 });
      const payIds = dto.items.filter((k) => k.startsWith('p:')).map((k) => k.slice(2));
      const miscIds = dto.items.filter((k) => k.startsWith('m:')).map((k) => k.slice(2));
      // one slip number at a time per school
      await c.query(
        `SELECT pg_advisory_xact_lock(hashtext('fee_deposit_slip'), app.current_school_id()::int)`,
      );
      const no = await c.query<{ n: number }>(
        `SELECT COALESCE(max(slip_no), 0) + 1 AS n FROM fee_deposit_slips`,
      );
      const slip = await c.query<{ id: string }>(
        `INSERT INTO fee_deposit_slips (school_id, academic_year_id, slip_no, deposit_on, bank_account_id, remarks, created_by)
         VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5, app.current_user_id()) RETURNING id::text`,
        [yearId, no.rows[0]!.n, dto.depositOn, dto.bankAccountId, dto.remarks ?? null],
      );
      const id = slip.rows[0]!.id;
      const p = await c.query<{ amount: string }>(
        `UPDATE fee_payments SET deposit_slip_id = $1 WHERE id = ANY($2::bigint[]) AND deposit_slip_id IS NULL
            AND mode IN ('cheque', 'dd') AND status IN ('posted', 'partly_refunded') RETURNING amount::text`,
        [id, payIds],
      );
      const m = await c.query<{ amount: string }>(
        `UPDATE misc_receipts SET deposit_slip_id = $1 WHERE id = ANY($2::bigint[]) AND deposit_slip_id IS NULL
            AND mode IN ('cheque', 'dd') AND status = 'posted' RETURNING amount::text`,
        [id, miscIds],
      );
      const taken = [...p.rows, ...m.rows];
      if (taken.length !== dto.items.length)
        throw new DomainError(
          'fees.deposit_stale',
          'Some cheques are already on a slip, bounced or reversed; reload the list',
          { status: 409 },
        );
      const total = taken.reduce((a, x) => a + Number(x.amount), 0);
      await c.query(`UPDATE fee_deposit_slips SET instruments = $2, total = $3 WHERE id = $1`, [
        id,
        taken.length,
        total.toFixed(2),
      ]);
      await this.audit.stage(ctx, c, {
        action: 'fees.deposit_slip.create',
        entityType: 'fee_deposit_slips',
        entityId: id,
        after: { ...dto, slipNo: no.rows[0]!.n, total },
      });
      return this.find(c, id);
    });
  }

  /** Cancelling frees the cheques for another slip; the number is not reused. */
  async cancel(ctx: RequestContext, id: string): Promise<DepositSlip> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const slip = await this.find(c, id);
      if (slip.status === 'cancelled') return slip;
      await c.query(`UPDATE fee_payments SET deposit_slip_id = NULL WHERE deposit_slip_id = $1`, [
        id,
      ]);
      await c.query(`UPDATE misc_receipts SET deposit_slip_id = NULL WHERE deposit_slip_id = $1`, [
        id,
      ]);
      await c.query(
        `UPDATE fee_deposit_slips SET status = 'cancelled', cancelled_by = app.current_user_id(), cancelled_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.deposit_slip.cancel',
        entityType: 'fee_deposit_slips',
        entityId: id,
        after: { slipNo: slip.slipNo },
      });
      return this.find(c, id);
    });
  }
}

function toSlip(x: Record<string, unknown>): DepositSlip {
  return {
    id: String(x.slipId),
    slipNo: Number(x.slipNo),
    depositOn: String(x.depositOn),
    instruments: Number(x.instruments),
    total: String(x.total),
    remarks: (x.remarks as string | null) ?? null,
    status: x.status as DepositSlip['status'],
    createdBy: (x.createdBy as string | null) ?? null,
    createdAt: String(x.createdAt),
    account: {
      id: String(x.id),
      bank: String(x.bank),
      accountName: String(x.accountName),
      accountNo: String(x.accountNo),
      ifsc: String(x.ifsc),
      branch: (x.branch as string | null) ?? null,
      purpose: String(x.purpose),
    },
  };
}
