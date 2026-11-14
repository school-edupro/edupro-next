import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import ExcelJS from 'exceljs';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { tablePdf } from '../engagement/table-pdf';
import { registerLetterhead } from '../exams/register-head';
import { STORAGE_DRIVER } from '../files/storage';
import { preparedChecked } from '../leave/leave-report-file';
import { RUN } from './payroll-inputs.dto';
import { bad, camelRow, firstOf, has, monthWords, must } from './payroll-month';
import { istToday } from './payroll-setup.service';
import { paise, pfChallan, rupees, type PfRecord } from './payroll-statutory';
import { amountInWords } from './payroll-words';
import { PAYROLL } from './payroll.dto';

const ITEM_WORDS: Record<string, string> = {
  ECR: 'PF ECR and payment',
  ESI: 'ESI contribution',
  TDS: 'TDS deposit',
  PT: 'Profession tax',
  LWF: 'Labour welfare fund',
  TDS_RETURN: 'Quarterly TDS return',
};
const addDays = (d: string, n: number) => {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const ym = (y: number, m: number) => `${String(y)}-${String(m).padStart(2, '0')}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
/** the month after y-m: [year, month] */
const next = (y: number, m: number): [number, number] => (m === 12 ? [y + 1, 1] : [y, m + 1]);

export interface VoucherLine {
  ledger: string;
  amount: string;
  note: string;
}

/**
 * The compliance calendar and the salary voucher (docs/design/86, phase C step 3; PAYROLL_PAYMENT_SPEC.md §7–8).
 * Calendar: a financial year's statutory dues set up once by a checker (PF ECR and ESI by the 15th, TDS by the 7th —
 * March's by 30 April —, profession tax by the month's end when a state is set, LWF after its due months when it is
 * on, the quarterly TDS returns); marked done with the acknowledgement, the date and the amount paid against what
 * payroll worked out; due and overdue counted for the payroll screens; reopened only by the payroll admin. Voucher:
 * one journal voucher for the month's runs — salaries by staff type and the employer's PF / ESI / NPS / LWF on the
 * debit side; each deduction (with the employer's share) payable and the net salary on the credit side; ledger names
 * from the settings; balanced or not, said plainly.
 */
@Injectable()
export class PayrollAccountsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  // ---- the compliance calendar -------------------------------------------------------------------------------------
  async calendar(ctx: RequestContext, fy: number) {
    must(ctx, RUN.view, 'Only payroll staff see the compliance calendar');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const today = istToday();
      const rows = (
        await c.query<{
          id: string;
          item: string;
          month: string | null;
          period: string;
          due_on: string;
          description: string;
          done_at: string | null;
          done_by_name: string | null;
          ack_no: string | null;
          ack_date: string | null;
          amount_paid: string | null;
          amount_computed: string | null;
        }>(
          `SELECT p.id::text, p.item, to_char(p.month, 'YYYY-MM') AS month, p.period, p.due_on::text, p.description,
                  p.done_at, u.display_name AS done_by_name, p.ack_no, p.ack_date::text, p.amount_paid::text,
                  p.amount_computed::text
             FROM payroll_compliance p LEFT JOIN users u ON u.id = p.done_by
            WHERE p.fy = $1 ORDER BY p.due_on, p.item`,
          [fy],
        )
      ).rows;
      const shaped = rows.map((r) => {
        const status = r.done_at
          ? r.ack_date && r.ack_date > r.due_on
            ? 'DONE_LATE'
            : 'DONE'
          : r.due_on < today
            ? 'OVERDUE'
            : r.due_on <= addDays(today, 7)
              ? 'DUE_SOON'
              : 'PENDING';
        const diff =
          r.amount_paid !== null && r.amount_computed !== null
            ? rupees(paise(r.amount_paid) - paise(r.amount_computed))
            : null;
        return {
          ...camelRow(r),
          status,
          itemWords: ITEM_WORDS[r.item] ?? r.item,
          difference: diff,
        };
      });
      const count = (s: string) => shaped.filter((r) => r.status === s).length;
      return {
        fy,
        fyLabel: `${String(fy)}-${String((fy + 1) % 100).padStart(2, '0')}`,
        rows: shaped,
        counts: {
          overdue: count('OVERDUE'),
          dueSoon: count('DUE_SOON'),
          pending: count('PENDING'),
          done: count('DONE') + count('DONE_LATE'),
        },
        seeded: rows.length > 0,
        can: { manage: has(ctx, RUN.approve), reopen: has(ctx, PAYROLL.admin) },
      };
    });
  }

  /** What is due and overdue now (for the payroll screens' "To look at"). */
  async dueNow(c: PoolClient) {
    const today = istToday();
    return (
      await c.query<{ overdue: number; due_soon: number }>(
        `SELECT count(*) FILTER (WHERE due_on < $1::date)::int AS overdue,
                count(*) FILTER (WHERE due_on >= $1::date AND due_on <= $1::date + 7)::int AS due_soon
           FROM payroll_compliance WHERE done_at IS NULL`,
        [today],
      )
    ).rows[0]!;
  }

  /** A year's dues, set up once (re-running adds only what is missing). */
  async seed(ctx: RequestContext, fy: number) {
    must(ctx, RUN.approve, 'Only a payroll checker sets up the compliance calendar');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const st = (
        await c.query<{ state_code: string | null; lwf_enabled: boolean }>(
          `SELECT state_code, lwf_enabled FROM payroll_settings`,
        )
      ).rows[0];
      const lwf =
        st?.lwf_enabled && st.state_code
          ? (
              await c.query<{ frequency: string; months: number[] | null }>(
                `SELECT frequency, months FROM payroll_lwf_settings
                  WHERE state_code = $1 AND status = 'active' AND effective_from <= $2::date
                    AND (effective_to IS NULL OR effective_to >= $3::date)
                  ORDER BY effective_from DESC LIMIT 1`,
                [st.state_code, `${String(fy + 1)}-03-31`, `${String(fy)}-04-01`],
              )
            ).rows[0]
          : undefined;
      const items: Array<[string, string | null, string, string, string]> = [];
      for (let k = 0; k < 12; k += 1) {
        const y = k < 9 ? fy : fy + 1;
        const m = ((k + 3) % 12) + 1;
        const [ny, nm] = next(y, m);
        const p = ym(y, m);
        const words = monthWords(p);
        items.push(['ECR', p, p, `${ym(ny, nm)}-15`, `PF ECR and payment for ${words}`]);
        items.push(['ESI', p, p, `${ym(ny, nm)}-15`, `ESI contribution for ${words}`]);
        items.push([
          'TDS',
          p,
          p,
          m === 3 ? `${String(y)}-04-30` : `${ym(ny, nm)}-07`,
          `TDS deposit for ${words}`,
        ]);
        if (st?.state_code)
          items.push([
            'PT',
            p,
            p,
            lastDay(ny, nm),
            `Profession tax for ${words} (${st.state_code})`,
          ]);
        if (lwf && (lwf.frequency === 'monthly' || (lwf.months ?? []).includes(m)))
          items.push([
            'LWF',
            p,
            p,
            `${ym(ny, nm)}-15`,
            `Labour welfare fund for ${words} (${st!.state_code!})`,
          ]);
      }
      for (const [q, due] of [
        ['Q1', `${String(fy)}-07-31`],
        ['Q2', `${String(fy)}-10-31`],
        ['Q3', `${String(fy + 1)}-01-31`],
        ['Q4', `${String(fy + 1)}-05-31`],
      ] as const)
        items.push([
          'TDS_RETURN',
          null,
          q,
          due,
          `Quarterly TDS return, ${q} of ${String(fy)}-${String((fy + 1) % 100).padStart(2, '0')}`,
        ]);
      let added = 0;
      for (const [item, month, period, due, description] of items) {
        const r = await c.query(
          `INSERT INTO payroll_compliance (school_id, fy, item, month, period, due_on, description)
           VALUES (app.current_school_id(), $1, $2, $3::date, $4, $5::date, $6)
           ON CONFLICT (school_id, fy, item, period) DO NOTHING`,
          [fy, item, month ? firstOf(month) : null, period, due, description],
        );
        added += r.rowCount ?? 0;
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.compliance.seed',
        entityType: 'payroll_compliance',
        after: { fy, added },
      });
      return {
        added,
        message: `${String(added)} due date(s) set up for ${String(fy)}-${String((fy + 1) % 100).padStart(2, '0')}.`,
      };
    });
  }

  /** What payroll worked out for a due (locked runs only). */
  private async computed(
    c: PoolClient,
    item: string,
    month: string | null,
  ): Promise<string | null> {
    if (!month) return null;
    const rows = (
      await c.query<Record<string, string | null>>(
        `SELECT r.it_amount::text, r.cess_amount::text, r.pt_amount::text, r.pf_wage::text AS rec_pf_wage,
                s.pf_wage::text, s.ee_pf::text, s.vpf::text, s.er_eps::text, s.er_epf::text, s.edli::text, s.pf_admin::text,
                CASE WHEN s.esi_covered THEN s.esi_ee END::text AS esi_ee, CASE WHEN s.esi_covered THEN s.esi_er END::text AS esi_er,
                s.lwf_ee::text, s.lwf_er::text
           FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
           LEFT JOIN payroll_record_statutory s ON s.record_id = r.id
          WHERE r.month = $1::date AND u.deleted_at IS NULL AND u.stage IN ('LOCKED', 'PAID') AND r.status <> 'FAILED'`,
        [firstOf(month)],
      )
    ).rows;
    const sum = (...ks: string[]) =>
      rows.reduce((s, r) => s + ks.reduce((t, k) => t + paise(r[k]), 0n), 0n);
    if (item === 'ECR') {
      const mins = (
        await c.query<{ admin_min: string; edli_min: string }>(
          `SELECT admin_min::text, edli_min::text FROM payroll_pf_settings
            WHERE status = 'active' AND effective_from <= $1::date ORDER BY effective_from DESC LIMIT 1`,
          [firstOf(month)],
        )
      ).rows[0];
      const recs = rows.map(
        (r) =>
          ({
            pfWage: r.pf_wage ?? '0.00',
            eePf: r.ee_pf ?? '0.00',
            vpf: r.vpf ?? '0.00',
            erEps: r.er_eps ?? '0.00',
            erEpf: r.er_epf ?? '0.00',
            edli: r.edli ?? '0.00',
            admin: r.pf_admin ?? '0.00',
          }) as PfRecord,
      );
      return pfChallan(recs, {
        admin: mins?.admin_min ?? '500.00',
        edli: mins?.edli_min ?? '75.00',
      }).total;
    }
    if (item === 'ESI') return rupees(sum('esi_ee', 'esi_er'));
    if (item === 'TDS') return rupees(sum('it_amount', 'cess_amount'));
    if (item === 'PT') return rupees(sum('pt_amount'));
    if (item === 'LWF') return rupees(sum('lwf_ee', 'lwf_er'));
    return null;
  }

  async done(
    ctx: RequestContext,
    id: string,
    dto: { ackNo: string; ackDate: string; amountPaid: string | null },
  ) {
    must(ctx, RUN.approve, 'Only a payroll checker marks a due done');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{ item: string; month: string | null; done_at: string | null }>(
          `SELECT item, to_char(month, 'YYYY-MM') AS month, done_at FROM payroll_compliance WHERE id = $1 FOR UPDATE`,
          [id],
        )
      ).rows[0];
      if (!r) bad('Not found', 404);
      if (r!.done_at) bad('Already marked done: the payroll admin reopens it to change it', 409);
      if (dto.ackDate > istToday()) bad('The acknowledgement date cannot be in the future');
      const computed = await this.computed(c, r!.item, r!.month);
      await c.query(
        `UPDATE payroll_compliance SET done_at = now(), done_by = app.current_user_id(), ack_no = $2, ack_date = $3::date,
                amount_paid = $4, amount_computed = $5, reopen_reason = NULL WHERE id = $1`,
        [id, dto.ackNo, dto.ackDate, dto.amountPaid, computed],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.compliance.done',
        entityType: 'payroll_compliance',
        entityId: id,
        after: { ...dto, computed },
      });
      const diff =
        dto.amountPaid !== null && computed !== null
          ? rupees(paise(dto.amountPaid) - paise(computed))
          : null;
      return {
        computed,
        difference: diff,
        message:
          diff && diff !== '0.00'
            ? `Marked done. The amount paid differs from payroll's figure (${computed!}) by ${diff}.`
            : 'Marked done.',
      };
    });
  }

  async reopen(ctx: RequestContext, id: string, reason: string) {
    must(ctx, PAYROLL.admin, 'Only the payroll admin reopens a due marked done');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE payroll_compliance SET done_at = NULL, done_by = NULL, ack_no = NULL, ack_date = NULL, amount_paid = NULL,
                amount_computed = NULL, reopen_reason = $2 WHERE id = $1 AND done_at IS NOT NULL`,
        [id, reason],
      );
      if (!r.rowCount) bad('Only a due marked done is reopened', 409);
      await this.audit.stage(ctx, c, {
        action: 'payroll.compliance.reopen',
        entityType: 'payroll_compliance',
        entityId: id,
        after: { reason },
      });
      return { ok: true };
    });
  }

  // ---- the salary voucher --------------------------------------------------------------------------------------------
  private async voucherData(c: PoolClient, month: string) {
    const runs = (
      await c.query<{ stage: string }>(
        `SELECT stage FROM payroll_runs WHERE month = $1::date AND deleted_at IS NULL AND stage IN ('APPROVED', 'LOCKED', 'PAID')`,
        [firstOf(month)],
      )
    ).rows;
    const cfg = ((
      await c.query<{ j: Record<string, unknown> }>(`SELECT jv_ledgers AS j FROM payroll_settings`)
    ).rows[0]?.j ?? {}) as {
      salary?: Record<string, string>;
      heads?: Record<string, string>;
      employer?: Record<string, string>;
      payable?: Record<string, string>;
      net?: string;
    };
    const lines = (
      await c.query<{
        head_type: string;
        code: string;
        name: string;
        staff_type: string;
        amount: string;
      }>(
        `SELECT l.head_type, l.code, min(l.name) AS name,
                COALESCE(NULLIF(e.profile->>'staff_type', ''), initcap(replace(e.employee_type::text, '_', ' '))) AS staff_type,
                sum(l.amount)::text AS amount
           FROM payroll_record_lines l
           JOIN payroll_records r ON r.id = l.record_id
           JOIN payroll_runs u ON u.id = r.run_id
           JOIN employees e ON e.id = r.employee_id
          WHERE r.month = $1::date AND u.deleted_at IS NULL AND u.stage IN ('APPROVED', 'LOCKED', 'PAID') AND r.status <> 'FAILED'
          GROUP BY 1, 2, 4`,
        [firstOf(month)],
      )
    ).rows;
    const er = (
      await c.query<{ pf: string; esi: string; nps: string; lwf: string; net: string; n: number }>(
        `SELECT COALESCE(sum(s.er_eps + s.er_epf + s.edli + s.pf_admin), 0)::text AS pf,
                COALESCE(sum(s.esi_er), 0)::text AS esi, COALESCE(sum(s.nps_er), 0)::text AS nps,
                COALESCE(sum(s.lwf_er), 0)::text AS lwf, COALESCE(sum(r.net_pay), 0)::text AS net, count(r.id)::int AS n
           FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
           LEFT JOIN payroll_record_statutory s ON s.record_id = r.id
          WHERE r.month = $1::date AND u.deleted_at IS NULL AND u.stage IN ('APPROVED', 'LOCKED', 'PAID') AND r.status <> 'FAILED'`,
        [firstOf(month)],
      )
    ).rows[0]!;
    const fix = (v: string) => rupees(paise(Number(v).toFixed(2)));
    const dr = new Map<string, { amount: bigint; note: string }>();
    const cr = new Map<string, { amount: bigint; note: string }>();
    const add = (m: typeof dr, ledger: string, amount: bigint, note: string) => {
      if (!amount) return;
      const x = m.get(ledger) ?? { amount: 0n, note };
      x.amount += amount;
      m.set(ledger, x);
    };
    const STAT: Record<string, string> = {
      PF: 'PF',
      VPF: 'PF',
      ESI: 'ESI',
      NPS: 'NPS',
      LWF: 'LWF',
    };
    const payable = (k: string) =>
      cfg.payable?.[k] ??
      {
        PF: "Employees' Provident Fund Payable",
        ESI: 'ESI Payable',
        NPS: 'NPS Payable',
        LWF: 'LWF Payable',
      }[k] ??
      k;
    for (const l of lines) {
      const amount = paise(fix(l.amount));
      if (l.head_type === 'EARNING')
        add(
          dr,
          cfg.salary?.[l.staff_type] ?? `Salaries & Wages — ${l.staff_type}`,
          amount,
          `Salaries: ${l.staff_type}`,
        );
      else if (STAT[l.code]) add(cr, payable(STAT[l.code]!), amount, `${l.code} deducted`);
      else
        add(
          cr,
          cfg.heads?.[l.code] ??
            {
              PT: 'Profession Tax Payable',
              TDS: 'TDS Payable',
              ADV: 'Staff Loans & Advances',
              ROUND_ADJ: 'Rounding adjustment',
            }[l.code] ??
            `${l.name} (${l.code})`,
          amount,
          `${l.code} deducted`,
        );
    }
    for (const [k, v] of [
      ['PF', er.pf],
      ['ESI', er.esi],
      ['NPS', er.nps],
      ['LWF', er.lwf],
    ] as const) {
      const amount = paise(fix(v));
      add(dr, cfg.employer?.[k] ?? `Employer ${k} Contribution`, amount, `The employer's ${k}`);
      add(cr, payable(k), amount, `The employer's ${k}`);
    }
    add(cr, cfg.net ?? 'Salary Payable', paise(fix(er.net)), 'Net salaries');
    const out = (m: typeof dr): VoucherLine[] =>
      [...m.entries()].map(([ledger, x]) => ({ ledger, amount: rupees(x.amount), note: x.note }));
    const drL = out(dr);
    const crL = out(cr);
    const sDr = [...dr.values()].reduce((s, x) => s + x.amount, 0n);
    const sCr = [...cr.values()].reduce((s, x) => s + x.amount, 0n);
    return {
      month,
      monthWords: monthWords(month),
      records: er.n,
      provisional: runs.some((r) => r.stage === 'APPROVED'),
      ledgersSet: !!(cfg.salary && Object.keys(cfg.salary).length) || !!cfg.net,
      debit: drL,
      credit: crL,
      totalDebit: rupees(sDr),
      totalCredit: rupees(sCr),
      balanced: sDr === sCr,
      words: amountInWords(rupees(sDr)),
    };
  }

  async voucher(ctx: RequestContext, month: string) {
    must(ctx, RUN.view, 'Only payroll staff see the salary voucher');
    return this.db.tenant(requireTenant(ctx), (c) => this.voucherData(c, month));
  }

  async voucherFile(ctx: RequestContext, month: string, format: 'xlsx' | 'csv' | 'pdf') {
    must(ctx, RUN.view, 'Only payroll staff download the salary voucher');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await this.voucherData(c, month);
      if (!v.records) bad(`${v.monthWords} has no approved or locked run`, 409);
      const name = `SALARY_VOUCHER_${month.replace('-', '_')}`;
      const note = v.provisional
        ? 'PROVISIONAL — an approved run of the month is not locked yet: do not post this voucher.'
        : null;
      const unbalanced = v.balanced
        ? null
        : `NOT BALANCED — debit ${v.totalDebit}, credit ${v.totalCredit}: do not post this until it is looked into.`;
      if (format === 'csv') {
        const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
        const text = [
          ...(note ? [q(note)] : []),
          'Type,Ledger,Amount',
          ...v.debit.map((l) => `Dr,${q(l.ledger)},${l.amount}`),
          ...v.credit.map((l) => `Cr,${q(l.ledger)},${l.amount}`),
          `TOTAL Dr,,${v.totalDebit}`,
          `TOTAL Cr,,${v.totalCredit}`,
        ].join('\n');
        return {
          filename: `${name}.csv`,
          base64: Buffer.from(text, 'utf8').toString('base64'),
          contentType: 'text/csv; charset=utf-8',
        };
      }
      const head = await registerLetterhead(c);
      if (format === 'pdf') {
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
        const rows = [
          ['DEBIT', '', ''],
          ...v.debit.map((l) => ['', l.ledger, l.amount]),
          ['', 'Total debit', v.totalDebit],
          ['CREDIT', '', ''],
          ...v.credit.map((l) => ['', l.ledger, l.amount]),
          ['', 'Total credit', v.totalCredit],
        ];
        const pdf = await tablePdf({
          school: head.school,
          address: head.address,
          title: `Journal voucher — salaries for ${v.monthWords}`,
          letterhead: { logo, details: `Voucher No: ________   Date: ________` },
          subtitle: [...(note ? [note] : []), ...(unbalanced ? [unbalanced] : []), `(${v.words})`],
          portrait: true,
          columns: [
            { label: 'Dr / Cr', width: 0.14 },
            { label: 'Ledger', width: 0.6 },
            { label: 'Amount (Rs.)', width: 0.26, right: true },
          ],
          rows,
          strong: [v.debit.length + 1, rows.length - 1],
          shade: {
            0: 'heading',
            [v.debit.length + 2]: 'heading',
            [v.debit.length + 1]: 'total',
            [rows.length - 1]: 'total',
          },
          rowCount: v.debit.length + v.credit.length,
          signs: [
            ...(await preparedChecked(c, (k) => this.storage.read(k))),
            {
              as: 'Principal',
              name: null,
              code: null,
              designation: null,
              when: null,
              signature: null,
            },
          ],
        });
        return {
          filename: `${name}.pdf`,
          base64: Buffer.from(pdf).toString('base64'),
          contentType: 'application/pdf',
        };
      }
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Salary voucher');
      ws.columns = [{ width: 10 }, { width: 50 }, { width: 18, style: { numFmt: '#,##0.00' } }];
      ws.addRow([head.school]).font = { bold: true, size: 13 };
      if (head.address) ws.addRow([head.address]);
      ws.addRow([`Journal voucher — salaries for ${v.monthWords}`]).font = { bold: true };
      ws.addRow(['Voucher No:', '', 'Date:']);
      if (note) ws.addRow([note]).font = { bold: true };
      if (unbalanced) ws.addRow([unbalanced]).font = { bold: true };
      ws.addRow([]);
      ws.addRow(['DEBIT']).font = { bold: true };
      for (const l of v.debit) ws.addRow(['', l.ledger, Number(l.amount)]);
      ws.addRow(['', 'Total debit', Number(v.totalDebit)]).font = { bold: true };
      ws.addRow(['CREDIT']).font = { bold: true };
      for (const l of v.credit) ws.addRow(['', l.ledger, Number(l.amount)]);
      ws.addRow(['', 'Total credit', Number(v.totalCredit)]).font = { bold: true };
      ws.addRow([]);
      ws.addRow(['', `(${v.words})`]);
      ws.addRow([]);
      ws.addRow(['Prepared by', 'Checked by', 'Principal']).font = { bold: true };
      return {
        filename: `${name}.xlsx`,
        base64: Buffer.from(await wb.xlsx.writeBuffer()).toString('base64'),
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };
    });
  }
}
