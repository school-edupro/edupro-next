import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { amountInWords } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { generatedOn, registerFile, schoolHead } from '../attendance/register-file';
import type {
  CreateDepositSlipDto,
  ListDepositSlipsQueryDto,
  PendingInstrumentsQueryDto,
} from './fees.dto';

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
  /** Drawn on the same bank as the account chosen (a transfer); null when no account was named. */
  sameBank?: boolean | null;
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
  /** transfer = cheques of the account's own bank; clearing = other banks; null = not separated. */
  kind: 'transfer' | 'clearing' | null;
}

/**
 * Two bank names mean the same bank: compared without case, spaces, dots and a closing "Ltd" / "Limited",
 * and one may be the short form inside the other ("HDFC" and "HDFC Bank").
 */
export function sameBank(a: string | null | undefined, b: string | null | undefined): boolean {
  const norm = (v: string) =>
    v
      .toLowerCase()
      .replace(/\b(ltd|limited|the)\b/g, '')
      .replace(/[^a-z0-9]/g, '');
  const x = norm(a ?? '');
  const y = norm(b ?? '');
  if (x.length < 3 || y.length < 3) return false;
  return x === y || x.includes(y) || y.includes(x);
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
      if (!q.bankAccountId) return r.rows;
      const bank = await this.bankOf(c, q.bankAccountId);
      const rows = r.rows.map((x) => ({ ...x, sameBank: sameBank(x.bankName, bank) }));
      return q.drawee === 'same'
        ? rows.filter((x) => x.sameBank)
        : q.drawee === 'other'
          ? rows.filter((x) => !x.sameBank)
          : rows;
    });
  }

  private async bankOf(c: PoolClient, accountId: string): Promise<string> {
    const r = await c.query<{ bank: string }>(
      `SELECT b.name AS bank FROM school_bank_accounts a JOIN banks b ON b.id = a.bank_id WHERE a.id = $1 AND a.status = 'active'`,
      [accountId],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Bank account not found', { status: 404 });
    return r.rows[0].bank;
  }

  /** How many cheques and drafts one slip may hold (0 = no limit). */
  async limit(ctx: RequestContext): Promise<{ limit: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => ({ limit: await this.limitIn(c) }));
  }

  private async limitIn(c: PoolClient): Promise<number> {
    const r = await c.query<{ v: string | null }>(
      `SELECT app.setting('fees.deposit_slip_limit') #>> '{}' AS v`,
    );
    const n = Number(r.rows[0]?.v ?? 0);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 500) : 0;
  }

  async setLimit(ctx: RequestContext, limit: number): Promise<{ limit: number }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const before = await this.limitIn(c);
      // as SettingsService.set: close the open row, replace today's, insert the new value
      await c.query(
        `UPDATE school_settings SET valid_to = CURRENT_DATE - 1, updated_by = app.current_user_id()
          WHERE key = 'fees.deposit_slip_limit' AND valid_to IS NULL AND valid_from < CURRENT_DATE`,
      );
      await c.query(
        `DELETE FROM school_settings WHERE key = 'fees.deposit_slip_limit' AND valid_from = CURRENT_DATE`,
      );
      await c.query(
        `INSERT INTO school_settings (school_id, key, value, valid_from, created_by, updated_by)
         VALUES (app.current_school_id(), 'fees.deposit_slip_limit', $1::jsonb, CURRENT_DATE, app.current_user_id(), app.current_user_id())`,
        [JSON.stringify(limit)],
      );
      await this.audit.stage(ctx, c, {
        action: 'fees.deposit_slip.limit',
        entityType: 'school_settings',
        entityId: 'fees.deposit_slip_limit',
        before: { limit: before },
        after: { limit },
      });
      return { limit };
    });
  }

  private async find(c: PoolClient, id: string): Promise<DepositSlip> {
    const r = await c.query<Omit<DepositSlip, 'account'> & BankAccount & { accountId: string }>(
      // eslint-disable-next-line no-restricted-syntax -- ACCOUNT is a constant column list
      `SELECT d.id::text AS "slipId", d.slip_no AS "slipNo", d.deposit_on::text AS "depositOn", d.instruments, d.total::text, d.remarks, d.status, d.kind,
              u.display_name AS "createdBy", d.created_at::text AS "createdAt", ${ACCOUNT}
         FROM fee_deposit_slips d JOIN school_bank_accounts a ON a.id = d.bank_account_id JOIN banks b ON b.id = a.bank_id
         LEFT JOIN users u ON u.id = d.created_by WHERE d.id = $1`,
      [id],
    );
    const x = r.rows[0] as unknown as Record<string, unknown> | undefined;
    if (!x) throw new DomainError('not-found', 'Deposit slip not found', { status: 404 });
    return toSlip(x);
  }

  /** The cheques and drafts in hand as filtered, as Excel or PDF: checked before any slip is made. */
  async pendingFile(ctx: RequestContext, q: PendingInstrumentsQueryDto, format: 'xlsx' | 'pdf') {
    const rows = await this.pending(ctx, q);
    const { head, bank } = await this.db.tenant(requireTenant(ctx), async (c) => ({
      head: await schoolHead(c),
      bank: q.bankAccountId ? await this.bankOf(c, q.bankAccountId) : null,
    }));
    const d = (v: string | null) => (v ? v.slice(0, 10).split('-').reverse().join('-') : '');
    const total = rows.reduce((a, x) => a + Number(x.amount), 0);
    const marked = rows.some((x) => x.sameBank !== undefined && x.sameBank !== null);
    return registerFile(
      {
        school: head.name,
        address: head.address,
        report: 'Cheques and drafts in hand (not yet on a deposit slip)',
        details: [
          [
            q.from || q.to
              ? `Received ${d(q.from ?? null) || '…'} to ${d(q.to ?? null) || '…'}`
              : 'All dates',
            q.ledger ? `Fee type: ${q.ledger}` : 'All fee types',
            bank ? `For deposit into ${bank}` : '',
            q.drawee ? (q.drawee === 'same' ? 'Same bank only' : 'Other banks only') : '',
            `${String(rows.length)} in hand`,
            `Rs. ${total.toFixed(2)}`,
          ]
            .filter(Boolean)
            .join(' · '),
          generatedOn(),
        ],
        legend: '',
        columns: [
          { label: 'Sr', width: 4, right: true },
          { label: 'Received on', width: 9 },
          { label: 'Receipt no.', width: 16 },
          { label: 'From', width: 20 },
          { label: 'Admission no.', width: 10 },
          { label: 'Class', width: 8 },
          { label: 'Fee type', width: 8 },
          { label: 'Mode', width: 7 },
          { label: 'Cheque / DD no.', width: 11 },
          { label: 'Cheque date', width: 9 },
          { label: 'Drawn on', width: 18 },
          ...(marked ? [{ label: 'Same bank / other', width: 12 }] : []),
          { label: 'Amount', width: 11, right: true },
        ],
        rows: [
          ...rows.map((x, i) => [
            i + 1,
            d(x.receivedOn),
            x.receiptNo ?? '',
            x.payer,
            x.admissionNo ?? '',
            x.section ?? '',
            x.ledger,
            x.mode.toUpperCase(),
            x.instrumentNo ?? '',
            d(x.instrumentDate),
            x.bankName ?? '',
            ...(marked ? [x.sameBank ? 'Same bank (transfer)' : 'Other bank (clearing)'] : []),
            Number(x.amount),
          ]),
          [
            '',
            'Total',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            ...(marked ? [''] : []),
            Number(total.toFixed(2)),
          ],
        ],
        strong: [rows.length],
        filename: 'cheques-in-hand',
      },
      format,
    );
  }

  async list(ctx: RequestContext, q: ListDepositSlipsQueryDto = {}): Promise<DepositSlip[]> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<Record<string, unknown>>(
        // eslint-disable-next-line no-restricted-syntax -- ACCOUNT is a constant column list
        `SELECT d.id::text AS "slipId", d.slip_no AS "slipNo", d.deposit_on::text AS "depositOn", d.instruments, d.total::text, d.remarks, d.status, d.kind,
                u.display_name AS "createdBy", d.created_at::text AS "createdAt", ${ACCOUNT}
           FROM fee_deposit_slips d JOIN school_bank_accounts a ON a.id = d.bank_account_id JOIN banks b ON b.id = a.bank_id
           LEFT JOIN users u ON u.id = d.created_by
          WHERE d.academic_year_id = $1
            AND ($2::date IS NULL OR d.deposit_on >= $2::date) AND ($3::date IS NULL OR d.deposit_on <= $3::date)
            AND ($4::bigint IS NULL OR d.bank_account_id = $4)
            AND ($5::text IS NULL OR ($5 = 'none' AND d.kind IS NULL) OR d.kind = $5)
            AND ($6::text IS NULL OR d.status = $6)
            AND ($7::int IS NULL OR d.slip_no = $7)
          ORDER BY d.slip_no DESC LIMIT 1000`,
        [
          yearId,
          q.from ?? null,
          q.to ?? null,
          q.bankAccountId ?? null,
          q.kind ?? null,
          q.status ?? null,
          q.slipNo ?? null,
        ],
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

  /**
   * The slips for the chosen cheques and drafts. Cheques of the account's own bank (a transfer) and of
   * other banks (clearing) go on separate slips unless told otherwise, and a slip holds no more than the
   * school's limit: 47 cheques with a limit of 20 make three slips, numbered one after the other.
   * Returns the first slip, with every slip made under `slips`.
   */
  async create(
    ctx: RequestContext,
    dto: CreateDepositSlipDto,
  ): Promise<DepositSlip & { slips: DepositSlip[] }> {
    const yearId = this.year(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const bank = await this.bankOf(c, dto.bankAccountId);
      const keys = [...new Set(dto.items)];
      // one slip number at a time per school
      await c.query(
        `SELECT pg_advisory_xact_lock(hashtext('fee_deposit_slip'), app.current_school_id()::int)`,
      );
      const chosen = await c.query<{ key: string; bankName: string | null }>(
        // eslint-disable-next-line no-restricted-syntax -- INSTRUMENTS is a constant; values are bound parameters
        `SELECT x.key, x."bankName" FROM (${INSTRUMENTS}) x
          WHERE x.key = ANY($1::text[]) AND x.deposit_slip_id IS NULL ORDER BY x.received_on, x.id`,
        [keys],
      );
      if (chosen.rows.length !== keys.length)
        throw new DomainError(
          'fees.deposit_stale',
          'Some cheques are already on a slip, bounced or reversed; reload the list',
          { status: 409 },
        );
      const limit = await this.limitIn(c);
      const groups: Array<{ kind: DepositSlip['kind']; keys: string[] }> = dto.separate
        ? (
            [
              ['transfer', chosen.rows.filter((x) => sameBank(x.bankName, bank))],
              ['clearing', chosen.rows.filter((x) => !sameBank(x.bankName, bank))],
            ] as const
          ).map(([kind, rows]) => ({ kind, keys: rows.map((x) => x.key) }))
        : [{ kind: null, keys: chosen.rows.map((x) => x.key) }];
      const made: string[] = [];
      for (const g of groups)
        for (let at = 0; at < g.keys.length; at += limit || g.keys.length) {
          const part = g.keys.slice(at, at + (limit || g.keys.length));
          const payIds = part.filter((k) => k.startsWith('p:')).map((k) => k.slice(2));
          const miscIds = part.filter((k) => k.startsWith('m:')).map((k) => k.slice(2));
          const no = await c.query<{ n: number }>(
            `SELECT COALESCE(max(slip_no), 0) + 1 AS n FROM fee_deposit_slips`,
          );
          const slip = await c.query<{ id: string }>(
            `INSERT INTO fee_deposit_slips (school_id, academic_year_id, slip_no, deposit_on, bank_account_id, remarks, kind, created_by)
             VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5, $6, app.current_user_id()) RETURNING id::text`,
            [yearId, no.rows[0]!.n, dto.depositOn, dto.bankAccountId, dto.remarks ?? null, g.kind],
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
          if (taken.length !== part.length)
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
            after: {
              bankAccountId: dto.bankAccountId,
              depositOn: dto.depositOn,
              items: part,
              kind: g.kind,
              slipNo: no.rows[0]!.n,
              total,
            },
          });
          made.push(id);
        }
      const slips: DepositSlip[] = [];
      for (const id of made) slips.push(await this.find(c, id));
      return { ...slips[0]!, slips };
    });
  }

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
    kind: (x.kind as DepositSlip['kind']) ?? null,
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
