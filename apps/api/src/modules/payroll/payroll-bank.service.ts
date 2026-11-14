import { Inject, Injectable } from '@nestjs/common';
import { decryptField, maskValue, type PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { tablePdf } from '../engagement/table-pdf';
import { registerLetterhead } from '../exams/register-head';
import { STORAGE_DRIVER } from '../files/storage';
import { blankBox, signerOf } from '../purchase/purchase-doc-sign';
import {
  bankCode,
  customCsv,
  genericCsv,
  LayoutSchema,
  letterAmount,
  letterMonth,
  type BankLine,
  type Layout,
} from './payroll-bank';
import type {
  BankAccountDto,
  BatchCreateDto,
  CancelDto,
  ConfirmDto,
  MarkPaidDto,
  RejectLineDto,
} from './payroll-bank.dto';
import { RUN } from './payroll-inputs.dto';
import { bad, camelRow, has, monthWords, must, mustBePayable } from './payroll-month';
import { amountInWords } from './payroll-words';
import { PAYROLL } from './payroll.dto';

/** rupees with two places → paise */
const paise = (v: string) => BigInt(v.replace('.', ''));
const rupees = (p: bigint) => {
  const s = p.toString().padStart(3, '0');
  return `${s.slice(0, -2)}.${s.slice(-2)}`;
};
/** A paragraph in lines of at most `width` characters (the PDF draws each line as it is). */
export function wrapWords(text: string, width: number): string[] {
  const out: string[] = [];
  let line = '';
  for (const w of text.split(/\s+/)) {
    if (line && line.length + 1 + w.length > width) {
      out.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) out.push(line);
  return out;
}
const FORMAT_OF: Record<string, string> = {
  GENERIC_CSV: 'GENERIC_CSV',
  CUSTOM_CSV: 'CUSTOM_CSV',
  BANK_LETTER_XLSX: 'BANK_LETTER',
};
export const FORMAT_WORDS: Record<string, string> = {
  GENERIC_CSV: 'Generic CSV',
  CUSTOM_CSV: 'The bank’s own layout',
  BANK_LETTER: 'Bank letter',
};

interface Payable {
  id: string;
  employee_code: string;
  employee_name: string;
  status: string;
  net_pay: string;
  reissue: boolean;
  ifsc: string | null;
  account_enc: string | null;
  bank_name: string | null;
  /** the account is the employee's current one, not the record's copy (a re-issue, or none was copied) */
  refreshed: boolean;
}
interface BatchRow {
  id: string;
  run_id: string;
  seq: number;
  bank_code: string | null;
  bank_account_id: string | null;
  file_format: string;
  layout: Record<string, unknown>;
  debit_bank_name: string | null;
  debit_branch: string | null;
  debit_account: string | null;
  value_date: string | null;
  made_on: string;
  provisional: boolean;
  status: string;
  txn_count: number;
  total: string;
  utr: string | null;
  month: string;
  run_type: string;
  run_seq: number;
  stage: string;
}

/**
 * Bank batches (docs/design/86, phase C step 1; PAYROLL_PAYMENT_SPEC.md §2): the school's accounts with a file
 * layout each, the run's payments by bank, a bank file from an approved (provisional) or locked run, uploaded and
 * confirmed with the UTR only after the lock — the records paid, the run paid when nothing is left —, a batch
 * cancelled before upload, a line the bank returned (the record held, re-issued to the employee's current account),
 * cash and cheque payments marked paid with their voucher number. Everything here is a payroll checker's.
 */
@Injectable()
export class PayrollBankService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ---- the school's accounts ----------------------------------------------------------------------------------------
  async accounts(ctx: RequestContext) {
    if (!has(ctx, RUN.approve) && !has(ctx, PAYROLL.admin))
      bad('Only a payroll checker or the payroll admin sees the bank accounts', 403);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = (
        await c.query(
          `SELECT id::text, bank_code, bank_name, branch, account_no, file_format, layout, active, updated_at
             FROM payroll_bank_accounts ORDER BY active DESC, bank_code`,
        )
      ).rows.map(camelRow);
      const s = (
        await c.query<{ f: string; cols: unknown }>(
          `SELECT bank_file_format AS f, bank_custom_columns AS cols FROM payroll_settings`,
        )
      ).rows[0];
      return {
        rows,
        fallback: { fileFormat: FORMAT_OF[s?.f ?? 'GENERIC_CSV'] ?? 'GENERIC_CSV' },
        formats: FORMAT_WORDS,
        can: { manage: has(ctx, PAYROLL.admin) },
      };
    });
  }

  async saveAccount(ctx: RequestContext, dto: BankAccountDto, id?: string) {
    must(ctx, PAYROLL.admin, 'Only the payroll admin sets the bank accounts');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const layout = dto.fileFormat === 'CUSTOM_CSV' ? (dto.layout ?? {}) : {};
      const args = [
        dto.bankCode,
        dto.bankName,
        dto.branch ?? null,
        dto.accountNo,
        dto.fileFormat,
        JSON.stringify(layout),
        dto.active,
      ];
      try {
        const r = id
          ? await c.query<{ id: string }>(
              `UPDATE payroll_bank_accounts SET bank_code = $2, bank_name = $3, branch = $4, account_no = $5,
                      file_format = $6, layout = $7::jsonb, active = $8, updated_by = app.current_user_id(), updated_at = now()
                WHERE id = $1 RETURNING id::text`,
              [id, ...args],
            )
          : await c.query<{ id: string }>(
              `INSERT INTO payroll_bank_accounts (school_id, bank_code, bank_name, branch, account_no, file_format, layout, active,
                                                  created_by, updated_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::jsonb, $7, app.current_user_id(), app.current_user_id())
               RETURNING id::text`,
              args,
            );
        if (!r.rows[0]) bad('Not found', 404);
        await this.audit.stage(ctx, c, {
          action: id ? 'payroll.bank_account.update' : 'payroll.bank_account.add',
          entityType: 'payroll_bank_accounts',
          entityId: r.rows[0]!.id,
          after: { bankCode: dto.bankCode, bankName: dto.bankName, fileFormat: dto.fileFormat },
        });
        return { id: r.rows[0]!.id };
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          bad(`${dto.bankCode} already has an account: change that one`, 409);
        throw e;
      }
    });
  }

  /** A layout tried on two made-up payments: what the bank would receive. */
  checkLayout(layout: Layout) {
    const lines: BankLine[] = [
      {
        lineNo: 1,
        code: 'E001',
        name: 'Employee One',
        account: '000000001234',
        ifsc: 'ABCD0001234',
        amount: '30160.00',
      },
      {
        lineNo: 2,
        code: 'E002',
        name: 'Employee, Two',
        account: '000000005678',
        ifsc: 'ABCD0005678',
        amount: '18250.50',
      },
    ];
    return {
      text: customCsv(
        lines,
        { month: '2026-07', date: '2026-07-31', debitAccount: '000000009999' },
        layout,
      ),
    };
  }

  // ---- a run's payments --------------------------------------------------------------------------------------------
  private async runOf(c: PoolClient, runId: string, lock = false) {
    const r = (
      await c.query<{ id: string; month: string; run_type: string; seq: number; stage: string }>(
        lock
          ? `SELECT id::text, to_char(month, 'YYYY-MM') AS month, run_type, seq, stage FROM payroll_runs
              WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`
          : `SELECT id::text, to_char(month, 'YYYY-MM') AS month, run_type, seq, stage FROM payroll_runs
              WHERE id = $1 AND deleted_at IS NULL`,
        [runId],
      )
    ).rows[0];
    if (!r) bad('Run not found', 404);
    return r!;
  }

  /**
   * What the run still pays by bank: computed or released, by bank, more than nothing, on no live line. A record whose
   * line the bank returned (or that carries no account) goes to the employee's current account.
   */
  private async payable(c: PoolClient, runId: string, lock = false) {
    return (
      await c.query<Payable>(
        // eslint-disable-next-line no-restricted-syntax -- the lock clause is one of two fixed strings; values are bound
        `SELECT r.id::text, r.employee_code, r.employee_name, r.status, r.net_pay::text, x.reissue,
                (x.reissue OR r.bank_account_enc IS NULL) AS refreshed,
                CASE WHEN x.reissue OR r.bank_account_enc IS NULL THEN NULLIF(e.profile->>'bank_ifsc', '') ELSE r.bank_ifsc END AS ifsc,
                CASE WHEN x.reissue OR r.bank_account_enc IS NULL THEN NULLIF(e.secure->>'bank_account_no', '') ELSE r.bank_account_enc END AS account_enc,
                CASE WHEN x.reissue OR r.bank_account_enc IS NULL THEN NULLIF(e.profile->>'bank_name', '') ELSE r.bank_name END AS bank_name
           FROM payroll_records r
           JOIN employees e ON e.id = r.employee_id
           CROSS JOIN LATERAL (SELECT EXISTS (SELECT 1 FROM payroll_bank_batch_lines l
                                               WHERE l.record_id = r.id AND l.status = 'REJECTED') AS reissue) x
          WHERE r.run_id = $1 AND r.status IN ('COMPUTED', 'RELEASED') AND COALESCE(r.pay_mode, 'BANK') = 'BANK'
            AND r.net_pay > 0
            AND NOT EXISTS (SELECT 1 FROM payroll_bank_batch_lines l WHERE l.record_id = r.id AND l.status = 'SENT')
          ORDER BY r.employee_name, r.employee_code ${lock ? 'FOR UPDATE OF r' : ''}`,
        [runId],
      )
    ).rows;
  }

  private async fileSetting(c: PoolClient, code: string | null) {
    const acc = code
      ? (
          await c.query<{
            id: string;
            bank_name: string;
            branch: string | null;
            account_no: string;
            file_format: string;
            layout: Record<string, unknown>;
          }>(
            `SELECT id::text, bank_name, branch, account_no, file_format, layout FROM payroll_bank_accounts
              WHERE bank_code = $1 AND active`,
            [code],
          )
        ).rows[0]
      : undefined;
    if (acc) return { account: acc, format: acc.file_format, layout: acc.layout };
    const s = (
      await c.query<{ f: string; cols: unknown }>(
        `SELECT bank_file_format AS f, bank_custom_columns AS cols FROM payroll_settings`,
      )
    ).rows[0];
    const format = FORMAT_OF[s?.f ?? 'GENERIC_CSV'] ?? 'GENERIC_CSV';
    return {
      account: null,
      format,
      layout: format === 'CUSTOM_CSV' ? { columns: s?.cols ?? [] } : {},
    };
  }

  async preview(ctx: RequestContext, runId: string) {
    must(ctx, RUN.approve, 'Only a payroll checker sees the bank payments');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runOf(c, runId);
      const open = ['APPROVED', 'LOCKED', 'PAID'].includes(run.stage);
      const rows = open ? await this.payable(c, runId) : [];
      const groups = new Map<string, { code: string | null; count: number; total: bigint }>();
      const payable = rows.map((r) => {
        const code = bankCode(r.ifsc);
        const g = groups.get(code ?? '—') ?? { code, count: 0, total: 0n };
        g.count += 1;
        g.total += paise(r.net_pay);
        groups.set(code ?? '—', g);
        let masked: string | null = null;
        try {
          masked = r.account_enc ? maskValue(decryptField(r.account_enc) ?? '') : null;
        } catch {
          masked = null;
        }
        return {
          recordId: r.id,
          code: r.employee_code,
          name: r.employee_name,
          bankCode: code,
          ifsc: r.ifsc,
          accountMasked: masked,
          amount: r.net_pay,
          reissue: r.reissue,
          noAccount: !r.account_enc,
        };
      });
      const shaped = [];
      for (const g of groups.values()) {
        const f = await this.fileSetting(c, g.code);
        shaped.push({
          bankCode: g.code,
          bankName: f.account?.bank_name ?? null,
          accountSet: !!f.account,
          fileFormat: f.format,
          count: g.count,
          total: rupees(g.total),
        });
      }
      const cash = open
        ? (
            await c.query(
              `SELECT id::text AS record_id, employee_code AS code, employee_name AS name, pay_mode AS mode, net_pay::text AS amount,
                      status, payment_ref, paid_at
                 FROM payroll_records
                WHERE run_id = $1 AND pay_mode IN ('CASH', 'CHEQUE') AND status IN ('COMPUTED', 'RELEASED', 'PAID')
                  AND net_pay > 0
                ORDER BY employee_name`,
              [runId],
            )
          ).rows.map(camelRow)
        : [];
      const batches = (
        await c.query(
          `SELECT b.id::text, b.seq, b.bank_code, b.file_format, b.status, b.txn_count, b.total::text, b.utr, b.provisional,
                  b.value_date::text, b.created_at, u.display_name AS created_by_name,
                  (SELECT count(*)::int FROM payroll_bank_batch_lines l WHERE l.batch_id = b.id AND l.status = 'REJECTED') AS returned
             FROM payroll_bank_batches b LEFT JOIN users u ON u.id = b.created_by
            WHERE b.run_id = $1 ORDER BY b.seq`,
          [runId],
        )
      ).rows.map(camelRow);
      const paid = (
        await c.query<{ n: number; total: string | null }>(
          `SELECT count(*)::int AS n, sum(net_pay)::text AS total FROM payroll_records WHERE run_id = $1 AND status = 'PAID'`,
          [runId],
        )
      ).rows[0]!;
      return {
        run: { ...camelRow(run), provisional: run.stage === 'APPROVED' },
        groups: shaped.sort((a, b) => (a.bankCode ?? '~').localeCompare(b.bankCode ?? '~')),
        payable,
        noAccount: payable.filter((p) => p.noAccount).map((p) => p.code),
        cash,
        batches,
        paid: { count: paid.n, total: paid.total ?? '0.00' },
        formats: FORMAT_WORDS,
        can: {
          generate: open && payable.length > 0,
          pay: ['LOCKED', 'PAID'].includes(run.stage),
        },
      };
    });
  }

  async generate(ctx: RequestContext, runId: string, dto: BatchCreateDto) {
    must(ctx, RUN.approve, 'Only a payroll checker makes a bank file');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runOf(c, runId, true);
      await mustBePayable(c, run.month, 'a bank file');
      if (!['APPROVED', 'LOCKED', 'PAID'].includes(run.stage))
        bad(
          `The run is ${run.stage.toLowerCase()}: a bank file is made from an approved or locked run`,
          409,
        );
      const rows = await this.payable(c, runId, true);
      if (!rows.length)
        bad(
          'Nothing in this run is left to pay by bank (paid, held, already in a bank file, or paid in cash)',
          409,
        );
      const pick = dto.bankCode ? rows.filter((r) => bankCode(r.ifsc) === dto.bankCode) : rows;
      if (!pick.length) bad(`No payment to ${dto.bankCode!} is left in this run`, 409);
      const none = pick.filter((r) => !r.account_enc).map((r) => r.employee_code);
      if (none.length)
        bad(
          `No bank account for ${none.slice(0, 10).join(', ')}${none.length > 10 ? ' …' : ''}: add it on the employee record, or hold the salary`,
        );
      const codes = new Set(pick.map((r) => bankCode(r.ifsc)));
      const code = dto.bankCode ?? (codes.size === 1 ? [...codes][0]! : null);
      const f = await this.fileSetting(c, code);
      if (f.format === 'CUSTOM_CSV' && !LayoutSchema.safeParse(f.layout).success)
        bad(
          `The bank's file layout is not set${code ? ` for ${code}` : ''}: set it in Payroll set-up → Bank accounts`,
        );
      const lines = pick.map((r, i) => {
        let plain: string | null = null;
        try {
          plain = decryptField(r.account_enc!);
        } catch {
          plain = null;
        }
        if (!plain) bad(`${r.employee_code}: the bank account could not be read`, 409);
        return { r, lineNo: i + 1, masked: maskValue(plain!) };
      });
      const total = pick.reduce((s, r) => s + paise(r.net_pay), 0n);
      const seq = (
        await c.query<{ n: number }>(
          `SELECT COALESCE(max(seq), 0)::int + 1 AS n FROM payroll_bank_batches WHERE run_id = $1`,
          [runId],
        )
      ).rows[0]!.n;
      const batchId = (
        await c.query<{ id: string }>(
          `INSERT INTO payroll_bank_batches (school_id, run_id, seq, bank_code, bank_account_id, file_format, layout,
                                             debit_bank_name, debit_branch, debit_account, value_date, provisional,
                                             txn_count, total, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::date, $11, $12, $13, app.current_user_id())
           RETURNING id::text`,
          [
            runId,
            seq,
            code,
            f.account?.id ?? null,
            f.format,
            JSON.stringify(f.layout ?? {}),
            f.account?.bank_name ?? null,
            f.account?.branch ?? null,
            f.account?.account_no ?? null,
            dto.valueDate ?? null,
            run.stage === 'APPROVED',
            pick.length,
            rupees(total),
          ],
        )
      ).rows[0]!.id;
      for (const l of lines)
        await c.query(
          `INSERT INTO payroll_bank_batch_lines (school_id, batch_id, line_no, record_id, employee_code, employee_name,
                                                 bank_ifsc, account_enc, account_masked, amount)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            batchId,
            l.lineNo,
            l.r.id,
            l.r.employee_code,
            l.r.employee_name,
            l.r.ifsc,
            l.r.account_enc,
            l.masked,
            l.r.net_pay,
          ],
        );
      const sum = (
        await c.query<{ s: string }>(
          `SELECT sum(amount)::text AS s FROM payroll_bank_batch_lines WHERE batch_id = $1`,
          [batchId],
        )
      ).rows[0]!.s;
      if (paise(sum) !== total)
        bad(`The file total ${sum} does not match what is payable (${rupees(total)})`, 500);
      // a re-issue (or a record that carried no account) is paid to the employee's current account: the record says so
      const refreshed = lines.filter((l) => l.r.refreshed);
      for (const l of refreshed)
        await c.query(
          `UPDATE payroll_records SET bank_ifsc = $2, bank_account_enc = $3, bank_account_masked = $4, bank_name = $5,
                  updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
          [l.r.id, l.r.ifsc, l.r.account_enc, l.masked, l.r.bank_name],
        );
      await c.query(
        `INSERT INTO payroll_run_events (school_id, run_id, action, stage_from, stage_to, detail, created_by)
         VALUES (app.current_school_id(), $1, 'bank_file', $2, $2, $3::jsonb, app.current_user_id())`,
        [
          runId,
          run.stage,
          JSON.stringify({ batch: seq, count: pick.length, total: rupees(total) }),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.bank.generate',
        entityType: 'payroll_bank_batches',
        entityId: batchId,
        after: {
          run: runId,
          seq,
          bank: code,
          count: pick.length,
          total: rupees(total),
          accountsRead: pick.length,
          reissuedTo: refreshed.map((l) => l.r.employee_code),
        },
      });
      return {
        id: batchId,
        seq,
        txnCount: pick.length,
        total: rupees(total),
        provisional: run.stage === 'APPROVED',
        message:
          `Bank file ${String(seq)} made: ${String(pick.length)} payment(s), ₹${rupees(total)}.` +
          (run.stage === 'APPROVED'
            ? ' The run is only approved: lock it before the file goes to the bank.'
            : ''),
      };
    });
  }

  private async batchRow(c: PoolClient, batchId: string, lock = false) {
    const b = (
      await c.query<BatchRow>(
        // eslint-disable-next-line no-restricted-syntax -- the lock clause is one of two fixed strings; values are bound
        `SELECT b.id::text, b.run_id::text, b.seq, b.bank_code, b.bank_account_id::text, b.file_format, b.layout,
                b.debit_bank_name, b.debit_branch, b.debit_account, b.value_date::text,
                to_char(b.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS made_on, b.provisional, b.status,
                b.txn_count, b.total::text, b.utr, to_char(u.month, 'YYYY-MM') AS month, u.run_type, u.seq AS run_seq, u.stage
           FROM payroll_bank_batches b JOIN payroll_runs u ON u.id = b.run_id
          WHERE b.id = $1 ${lock ? 'FOR UPDATE OF b, u' : ''}`,
        [batchId],
      )
    ).rows[0];
    if (!b) bad('Bank file not found', 404);
    return b!;
  }

  async batch(ctx: RequestContext, batchId: string) {
    must(ctx, RUN.approve, 'Only a payroll checker sees a bank file');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const b = await this.batchRow(c, batchId);
      const lines = (
        await c.query(
          `SELECT l.id::text, l.line_no, l.record_id::text, l.employee_code AS code, l.employee_name AS name, l.bank_ifsc AS ifsc,
                  l.account_masked, l.amount::text, l.status, l.reject_reason, l.rejected_at, r.status AS record_status
             FROM payroll_bank_batch_lines l JOIN payroll_records r ON r.id = l.record_id
            WHERE l.batch_id = $1 ORDER BY l.line_no`,
          [batchId],
        )
      ).rows.map(camelRow);
      const rest: Partial<BatchRow> = { ...b };
      delete rest.layout;
      const locked = ['LOCKED', 'PAID'].includes(b.stage);
      return {
        batch: { ...camelRow(rest), formatWords: FORMAT_WORDS[b.file_format] ?? b.file_format },
        lines,
        can: {
          upload: b.status === 'GENERATED' && locked,
          confirm: b.status === 'UPLOADED' && locked,
          cancel: b.status === 'GENERATED',
          reject: ['UPLOADED', 'CONFIRMED'].includes(b.status),
          download: b.status !== 'CANCELLED',
        },
      };
    });
  }

  private async plainLines(c: PoolClient, batchId: string): Promise<BankLine[]> {
    const rows = (
      await c.query<{
        line_no: number;
        employee_code: string;
        employee_name: string;
        bank_ifsc: string | null;
        account_enc: string;
        amount: string;
      }>(
        `SELECT line_no, employee_code, employee_name, bank_ifsc, account_enc, amount::text
           FROM payroll_bank_batch_lines WHERE batch_id = $1 AND status <> 'CANCELLED' ORDER BY line_no`,
        [batchId],
      )
    ).rows;
    return rows.map((r) => {
      let plain: string | null = null;
      try {
        plain = decryptField(r.account_enc);
      } catch {
        plain = null;
      }
      if (!plain) bad(`${r.employee_code}: the bank account could not be read`, 409);
      return {
        lineNo: r.line_no,
        code: r.employee_code,
        name: r.employee_name,
        account: plain!,
        ifsc: r.bank_ifsc,
        amount: r.amount,
      };
    });
  }

  private async logo(c: PoolClient): Promise<{
    head: Awaited<ReturnType<typeof registerLetterhead>>;
    logo: LetterheadLogo | null;
  }> {
    const head = await registerLetterhead(c);
    let logo: LetterheadLogo | null = null;
    if (head.file)
      try {
        logo = {
          contentType: head.file.content_type,
          bytes: await this.storage.read(head.file.object_key),
        };
      } catch {
        logo = null;
      }
    return { head, logo };
  }

  /** The bank file as made (its own copy of the accounts and the layout), or the bank letter, Excel or PDF. */
  async file(ctx: RequestContext, batchId: string, as: 'file' | 'letter' | 'pdf') {
    must(ctx, RUN.approve, 'Only a payroll checker downloads a bank file');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const b = await this.batchRow(c, batchId);
      if (b.status === 'CANCELLED') bad('This bank file was cancelled: make a new one', 409);
      const lines = await this.plainLines(c, batchId);
      const meta = {
        month: b.month,
        date: b.value_date ?? b.made_on,
        debitAccount: b.debit_account,
      };
      const base = `BANK_${b.month.replace('-', '_')}_${b.run_type}${String(b.run_seq)}_${String(b.seq)}`;
      const kind = as === 'file' ? (b.file_format === 'BANK_LETTER' ? 'letter' : 'csv') : as;
      let out: { filename: string; base64: string; contentType: string };
      if (kind === 'csv') {
        const layout = b.file_format === 'CUSTOM_CSV' ? LayoutSchema.safeParse(b.layout) : null;
        if (layout && !layout.success) bad('This bank file’s layout cannot be read', 409);
        const text = layout?.success
          ? customCsv(lines, meta, layout.data)
          : genericCsv(lines, meta);
        const ext = layout?.success ? layout.data.extension : 'csv';
        out = {
          filename: `${base}.${ext}`,
          base64: Buffer.from(text, 'utf8').toString('base64'),
          contentType: ext === 'txt' ? 'text/plain; charset=utf-8' : 'text/csv; charset=utf-8',
        };
      } else {
        const { head, logo } = await this.logo(c);
        const letter = await this.letterParts(c, b, lines);
        if (kind === 'pdf') {
          const pdf = await tablePdf({
            school: head.school,
            address: head.address,
            title: `Salary transfer — ${monthWords(b.month)}`,
            letterhead: { logo, details: letter.dated },
            subtitle: [
              ...(letter.provisional ? [letter.provisional] : []),
              'The Branch Manager,',
              ...letter.to,
              '',
              'Sir,',
              ...wrapWords(letter.body, 105),
              '',
            ],
            subtitleFirstOnly: true,
            portrait: true,
            wrap: true,
            columns: [
              { label: 'S. No.', width: 0.08, right: true },
              { label: 'Bank A/c No.', width: 0.22 },
              { label: 'IFSC', width: 0.16 },
              { label: 'Name', width: 0.36 },
              { label: 'Net amount (Rs.)', width: 0.18, right: true },
            ],
            rows: [
              ...lines.map((l) => [
                l.lineNo,
                l.account,
                l.ifsc ?? '',
                l.name,
                letterAmount(l.amount),
              ]),
              ['', '', '', 'TOTAL', letterAmount(b.total)],
            ],
            strong: [lines.length],
            rowCount: lines.length,
            signs: letter.signs,
          });
          out = {
            filename: `${base.replace('BANK_', 'BANK_LETTER_')}.pdf`,
            base64: Buffer.from(pdf).toString('base64'),
            contentType: 'application/pdf',
          };
        } else {
          const buf = await this.letterXlsx(head.school, head.address, letter, lines, b);
          out = {
            filename: `${base.replace('BANK_', 'BANK_LETTER_')}.xlsx`,
            base64: buf.toString('base64'),
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          };
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.bank.download',
        entityType: 'payroll_bank_batches',
        entityId: batchId,
        after: { as: kind, accountsRead: lines.length },
      });
      return out;
    });
  }

  private async letterParts(c: PoolClient, b: BatchRow, lines: BankLine[]) {
    const [y, m, d] = (b.value_date ?? b.made_on).split('-');
    const to = [b.debit_bank_name, b.debit_branch].filter((x): x is string => !!x);
    const body =
      `Kindly debit a sum of Rs.${letterAmount(b.total)}/- (${amountInWords(b.total)}) from our account no. ` +
      `${b.debit_account ?? '______________'} and credit it to the following ${String(lines.length)} individuals' ` +
      `accounts as per the details given below, it being their salary for ${letterMonth(b.month)}.`;
    const signs = [
      await signerOf(c, (k) => this.storage.read(k), {
        as: 'Prepared by',
        name:
          (
            await c.query<{ n: string }>(
              `SELECT COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1),
                               u.display_name) AS n FROM users u WHERE u.id = app.current_user_id()`,
            )
          ).rows[0]?.n ?? null,
        userId:
          (await c.query<{ id: string }>(`SELECT app.current_user_id()::text AS id`)).rows[0]?.id ??
          null,
        at: new Date(),
        verb: 'Prepared on',
      }),
      blankBox('Accountant'),
      blankBox('Principal'),
      blankBox('Authorised signatory'),
    ];
    return {
      dated: `Dated: ${d}/${m}/${y}`,
      to,
      body,
      signs,
      provisional: ['LOCKED', 'PAID'].includes(b.stage)
        ? null
        : 'PROVISIONAL — the run is approved but not locked: do not send this letter yet.',
    };
  }

  private async letterXlsx(
    school: string,
    address: string,
    letter: Awaited<ReturnType<PayrollBankService['letterParts']>>,
    lines: BankLine[],
    b: BatchRow,
  ): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Bank letter ${b.month}`, {
      pageSetup: {
        paperSize: 9,
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
      },
    });
    ws.columns = [
      { width: 7 },
      { width: 22, style: { numFmt: '@' } },
      { width: 15 },
      { width: 34 },
      { width: 16, style: { numFmt: '#,##0.00' } },
    ];
    const put = (row: number, text: string, bold = false, merge = true) => {
      ws.getCell(row, 1).value = text;
      ws.getCell(row, 1).font = { bold };
      if (merge) ws.mergeCells(row, 1, row, 5);
    };
    let r = 1;
    put(r++, school.toUpperCase(), true);
    ws.getCell(1, 1).alignment = { horizontal: 'center' };
    if (address) {
      put(r, address);
      ws.getCell(r++, 1).alignment = { horizontal: 'center' };
    }
    if (letter.provisional) put(r++, letter.provisional, true);
    ws.getCell(r, 5).value = letter.dated;
    r += 2;
    put(r++, 'The Branch Manager,');
    for (const t of letter.to) put(r++, t);
    r += 1;
    put(r++, 'Sir,');
    put(r, letter.body);
    ws.getCell(r, 1).alignment = { wrapText: true, vertical: 'top' };
    ws.getRow(r).height = 48;
    r += 2;
    const headRow = ws.getRow(r++);
    headRow.values = ['S. No.', 'Bank A/c No.', 'IFSC', 'Name', 'Net amount (₹)'];
    headRow.font = { bold: true };
    for (const l of lines) {
      const row = ws.getRow(r++);
      row.values = [l.lineNo, l.account, l.ifsc ?? '', l.name, Number(l.amount)];
      row.getCell(2).numFmt = '@';
    }
    const tot = ws.getRow(r++);
    tot.getCell(4).value = 'TOTAL';
    tot.getCell(5).value = Number(b.total);
    tot.font = { bold: true };
    r += 3;
    ws.getRow(r).values = letter.signs.map((s) => s.as);
    ws.getRow(r).font = { bold: true };
    const by = letter.signs[0];
    if (by?.name)
      ws.getCell(r + 1, 1).value =
        `${by.name}${by.code ? ` (${by.code})` : ''}${by.when ? `, ${by.when}` : ''}`;
    return Buffer.from(await wb.xlsx.writeBuffer());
  }

  // ---- the batch's life ----------------------------------------------------------------------------------------------
  async uploaded(ctx: RequestContext, batchId: string) {
    must(ctx, RUN.approve, 'Only a payroll checker marks a bank file uploaded');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const b = await this.batchRow(c, batchId, true);
      if (b.status !== 'GENERATED') bad(`The bank file is ${b.status.toLowerCase()}`, 409);
      if (!['LOCKED', 'PAID'].includes(b.stage))
        bad('Lock the run before the file goes to the bank: it is only approved', 409);
      await c.query(
        `UPDATE payroll_bank_batches SET status = 'UPLOADED', uploaded_by = app.current_user_id(), uploaded_at = now()
          WHERE id = $1`,
        [batchId],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.bank.uploaded',
        entityType: 'payroll_bank_batches',
        entityId: batchId,
      });
      return { ok: true };
    });
  }

  async confirm(ctx: RequestContext, batchId: string, dto: ConfirmDto) {
    must(ctx, RUN.approve, 'Only a payroll checker confirms a bank file');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const b = await this.batchRow(c, batchId, true);
      if (b.status !== 'UPLOADED')
        bad(
          b.status === 'GENERATED'
            ? 'Mark the file uploaded to the bank first'
            : `The bank file is ${b.status.toLowerCase()}`,
          409,
        );
      if (!['LOCKED', 'PAID'].includes(b.stage)) bad('Lock the run first', 409);
      await c.query(
        `UPDATE payroll_bank_batches SET status = 'CONFIRMED', utr = $2, confirmed_by = app.current_user_id(), confirmed_at = now()
          WHERE id = $1`,
        [batchId, dto.utr],
      );
      const paid = await c.query(
        `UPDATE payroll_records r SET status = 'PAID', paid_at = now(), paid_by = app.current_user_id(), payment_ref = $2,
                updated_by = app.current_user_id(), updated_at = now()
          WHERE r.id IN (SELECT record_id FROM payroll_bank_batch_lines WHERE batch_id = $1 AND status = 'SENT')
            AND r.status IN ('COMPUTED', 'RELEASED')`,
        [batchId, dto.utr],
      );
      const settled = await this.settle(c, b.run_id);
      await this.audit.stage(ctx, c, {
        action: 'payroll.bank.confirm',
        entityType: 'payroll_bank_batches',
        entityId: batchId,
        after: { utr: dto.utr, paid: paid.rowCount, runPaid: settled },
      });
      return {
        paid: paid.rowCount ?? 0,
        runPaid: settled,
        message: `Confirmed: ${String(paid.rowCount ?? 0)} salary(ies) paid.${settled ? ' Everything in the run is paid.' : ''}`,
      };
    });
  }

  async cancel(ctx: RequestContext, batchId: string, dto: CancelDto) {
    must(ctx, RUN.approve, 'Only a payroll checker cancels a bank file');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const b = await this.batchRow(c, batchId, true);
      if (b.status !== 'GENERATED')
        bad(
          b.status === 'CANCELLED'
            ? 'Already cancelled'
            : 'The bank has this file: reject the lines the bank returns instead',
          409,
        );
      await c.query(
        `UPDATE payroll_bank_batches SET status = 'CANCELLED', cancel_reason = $2, cancelled_by = app.current_user_id(),
                cancelled_at = now() WHERE id = $1`,
        [batchId, dto.reason],
      );
      await c.query(
        `UPDATE payroll_bank_batch_lines SET status = 'CANCELLED' WHERE batch_id = $1 AND status = 'SENT'`,
        [batchId],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.bank.cancel',
        entityType: 'payroll_bank_batches',
        entityId: batchId,
        after: { reason: dto.reason },
      });
      return { ok: true };
    });
  }

  /** The bank returned a payment: the line rejected, the salary held (paid no more), re-issued once released. */
  async rejectLine(ctx: RequestContext, lineId: string, dto: RejectLineDto) {
    must(ctx, RUN.approve, 'Only a payroll checker records a returned payment');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const l = (
        await c.query<{ batch_id: string; record_id: string; status: string; code: string }>(
          `SELECT batch_id::text, record_id::text, status, employee_code AS code FROM payroll_bank_batch_lines WHERE id = $1`,
          [lineId],
        )
      ).rows[0];
      if (!l) bad('Not found', 404);
      const b = await this.batchRow(c, l!.batch_id, true);
      if (l!.status !== 'SENT') bad('Only a payment sent to the bank is returned', 409);
      if (!['UPLOADED', 'CONFIRMED'].includes(b.status))
        bad('The file has not gone to the bank: cancel it and make it again instead', 409);
      await c.query(
        `UPDATE payroll_bank_batch_lines SET status = 'REJECTED', reject_reason = $2, rejected_by = app.current_user_id(),
                rejected_at = now() WHERE id = $1 AND status = 'SENT'`,
        [lineId, dto.reason],
      );
      await c.query(
        `UPDATE payroll_records SET status = 'HELD', held_reason = $2, paid_at = NULL, paid_by = NULL, payment_ref = NULL,
                updated_by = app.current_user_id(), updated_at = now()
          WHERE id = $1 AND status IN ('COMPUTED', 'RELEASED', 'PAID')`,
        [l!.record_id, `Returned by the bank: ${dto.reason}`],
      );
      let unpaid = false;
      if (b.stage === 'PAID') {
        await c.query(
          `UPDATE payroll_runs SET stage = 'LOCKED', updated_by = app.current_user_id(), updated_at = now()
            WHERE id = $1 AND stage = 'PAID'`,
          [b.run_id],
        );
        unpaid = true;
      }
      await c.query(
        `INSERT INTO payroll_run_events (school_id, run_id, action, stage_from, stage_to, comment, detail, created_by)
         VALUES (app.current_school_id(), $1, 'bank_return', $2, $3, $4, $5::jsonb, app.current_user_id())`,
        [
          b.run_id,
          b.stage,
          unpaid ? 'LOCKED' : b.stage,
          dto.reason,
          JSON.stringify({ batch: b.seq, record: l!.record_id, code: l!.code }),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.bank.return',
        entityType: 'payroll_bank_batch_lines',
        entityId: lineId,
        after: { reason: dto.reason, record: l!.record_id },
      });
      return {
        ok: true,
        message: `${l!.code}'s salary is held. Correct the account on the employee record if needed, then release it: the next bank file pays it.`,
      };
    });
  }

  /** A cash or cheque salary paid, with its voucher or cheque number. */
  async markPaid(ctx: RequestContext, runId: string, recordId: string, dto: MarkPaidDto) {
    must(ctx, RUN.approve, 'Only a payroll checker marks a salary paid');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const run = await this.runOf(c, runId, true);
      if (!['LOCKED', 'PAID'].includes(run.stage))
        bad('A salary is paid once the run is locked', 409);
      const r = (
        await c.query<{ pay_mode: string | null; status: string; net_pay: string }>(
          `SELECT pay_mode, status, net_pay::text FROM payroll_records WHERE id = $1 AND run_id = $2 FOR UPDATE`,
          [recordId, runId],
        )
      ).rows[0];
      if (!r) bad('Not found', 404);
      if ((r!.pay_mode ?? 'BANK') === 'BANK')
        bad('This salary is paid by bank: it is paid through a bank file', 409);
      if (r!.pay_mode !== dto.mode)
        bad(`This salary is paid by ${r!.pay_mode!.toLowerCase()}`, 409);
      if (!['COMPUTED', 'RELEASED'].includes(r!.status))
        bad(
          `The salary is ${r!.status.toLowerCase()}: only one waiting to be paid is marked paid`,
          409,
        );
      if (paise(r!.net_pay) <= 0n) bad('Nothing to pay', 409);
      await c.query(
        `UPDATE payroll_records SET status = 'PAID', paid_at = now(), paid_by = app.current_user_id(), payment_ref = $2,
                updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [recordId, dto.reference],
      );
      const settled = await this.settle(c, runId);
      await this.audit.stage(ctx, c, {
        action: 'payroll.record.paid',
        entityType: 'payroll_records',
        entityId: recordId,
        after: { mode: dto.mode, reference: dto.reference },
      });
      return { ok: true, runPaid: settled };
    });
  }

  /** A locked run is paid when nothing in it is left to pay (held salaries wait, and do not keep it open). */
  private async settle(c: PoolClient, runId: string): Promise<boolean> {
    const left = (
      await c.query(
        `SELECT 1 FROM payroll_records WHERE run_id = $1 AND status IN ('COMPUTED', 'RELEASED') AND net_pay > 0 LIMIT 1`,
        [runId],
      )
    ).rowCount;
    if (left) return false;
    const r = await c.query(
      `UPDATE payroll_runs SET stage = 'PAID', updated_by = app.current_user_id(), updated_at = now()
        WHERE id = $1 AND stage = 'LOCKED'`,
      [runId],
    );
    if (r.rowCount)
      await c.query(
        `INSERT INTO payroll_run_events (school_id, run_id, action, stage_from, stage_to, created_by)
         VALUES (app.current_school_id(), $1, 'paid', 'LOCKED', 'PAID', app.current_user_id())`,
        [runId],
      );
    return !!r.rowCount;
  }
}
