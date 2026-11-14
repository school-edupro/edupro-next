import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PDFDocument as LockableDocument } from '@cantoo/pdf-lib';
import { decryptField, type PoolClient } from '@edupro/db';
import { objectKeyFor, type StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { tablePdf } from '../engagement/table-pdf';
import { registerLetterhead } from '../exams/register-head';
import { STORAGE_DRIVER } from '../files/storage';
import { blankBox, signerOf } from '../purchase/purchase-doc-sign';
import { RUN } from './payroll-inputs.dto';
import { bad, has, hiddenFor, must } from './payroll-month';
import { passwordFor, patternInWords } from './payroll-payslip-pdf';
import { fyOf, istToday } from './payroll-setup.service';
import { PAYROLL } from './payroll.dto';

const OWN = 'payroll.own.view';
const QUARTER: Record<number, number[]> = {
  1: [4, 5, 6],
  2: [7, 8, 9],
  3: [10, 11, 12],
  4: [1, 2, 3],
};
const PAN_RE = /[A-Z]{5}[0-9]{4}[A-Z]/;
const monthOf = (fy: string, m: number) =>
  `${String(m >= 4 ? Number(fy.slice(0, 4)) : Number(fy.slice(0, 4)) + 1)}-${String(m).padStart(2, '0')}`;
const endOf = (ym: string) =>
  new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).toISOString().slice(0, 10);
const dmy = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
/** a rupee figure (two places) in whole rupees, half up */
const whole = (v: string | null | undefined) => String(Math.round(Number(v ?? 0)));
const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows: Array<Array<string | number>>) =>
  rows.map((r) => r.map(csvCell).join(',')).join('\n');
const esc = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!,
  );
const money = (v: string | null | undefined) =>
  Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface TaxRow {
  regime: string | null;
  gross_projection: string | null;
  exemptions: string | null;
  standard_deduction: string | null;
  pt_deduction: string | null;
  other_deductions: string | null;
  taxable_income: string | null;
  slab_tax: string | null;
  rebate: string | null;
  surcharge: string | null;
  cess: string | null;
  annual_tax: string | null;
  perquisites: string | null;
  prev_salary: string | null;
  prev_tds: string | null;
  other_income: string | null;
  house_loss: string | null;
  working: { deductions?: Array<{ code: string; declared: string; allowed: string }> } | null;
}

/**
 * Income-tax papers (docs/design/86, phase D step 4; PAYROLL_TAX_SPEC.md §10, PAYROLL_PAYMENT_SPEC.md §9): the
 * quarterly return's files (Form 24Q / 138: challans, Annexure I, Annexure II), the employee's declaration (Form 124 /
 * 12BB), and the annual certificate (Form 16 / 130) — Part A from TRACES matched by PAN, Part B from the year's last
 * record, one PDF locked with the payslip password, released in My tax and e-mailed only on Send.
 */
@Injectable()
export class PayrollTaxDocsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private async label(c: PoolClient, fy: string, code: string) {
    return (
      await c.query<{ label: string }>(
        `SELECT label FROM payroll_tax_labels WHERE fy = $1 AND line_code = $2`,
        [fy, code],
      )
    ).rows[0]?.label;
  }
  private async logo(c: PoolClient) {
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
  private pan(enc: string | null) {
    if (!enc) return null;
    try {
      const v = decryptField(enc);
      return v && PAN_RE.test(v) ? v : null;
    } catch {
      return null;
    }
  }

  // ---- the quarterly return ---------------------------------------------------------------------------------------
  /** One of the quarter's files; refused until every month is locked and each month's TDS has its challan. */
  async returnFile(
    ctx: RequestContext,
    fy: string,
    quarter: number,
    file: 'challans' | 'annexure1' | 'annexure2',
  ) {
    must(ctx, RUN.approve, 'Only a payroll checker makes the TDS return');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const form = await this.label(c, fy, 'RETURN_FORM_NAME');
      const section = await this.label(c, fy, 'TDS_SECTION');
      if (!form || !section)
        bad(`The return's form or section is not set for ${fy} (Payroll set-up → Income tax)`);
      if (file === 'annexure2' && quarter !== 4) bad('Annexure II is in the fourth quarter only');
      const months = QUARTER[quarter]!.map((m) => monthOf(fy, m));
      const stages = (
        await c.query<{ m: string; stages: string[] }>(
          `SELECT to_char(month, 'YYYY-MM') AS m, array_agg(stage) AS stages FROM payroll_runs
            WHERE month = ANY($1::date[]) AND deleted_at IS NULL GROUP BY 1`,
          [months.map((m) => `${m}-01`)],
        )
      ).rows;
      const notReady = months.filter((m) => {
        const st = stages.find((x) => x.m === m)?.stages ?? [];
        return !st.length || st.some((x) => !['LOCKED', 'PAID'].includes(x));
      });
      if (notReady.length)
        bad(`Every month of the quarter must be locked first: ${notReady.join(', ')}`, 409);
      const recs = (
        await c.query<{
          id: string;
          employee_id: string;
          month: string;
          name: string;
          pan: string | null;
          it: string;
          cess: string;
          taxable: string;
        }>(
          `SELECT r.id::text, r.employee_id::text, to_char(r.month, 'YYYY-MM') AS month, r.employee_name AS name,
                  e.secure->>'pan' AS pan, r.it_amount::text AS it, r.cess_amount::text AS cess,
                  (SELECT COALESCE(sum(l.amount), 0) FROM payroll_record_lines l
                    WHERE l.record_id = r.id AND l.head_type = 'EARNING' AND l.is_taxable)::text AS taxable
             FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id JOIN employees e ON e.id = r.employee_id
            WHERE r.month = ANY($1::date[]) AND u.deleted_at IS NULL AND u.stage IN ('LOCKED', 'PAID') AND r.status <> 'FAILED'
            ORDER BY r.month, r.employee_name, r.id`,
          [months.map((m) => `${m}-01`)],
        )
      ).rows;
      const challans = (
        await c.query<{
          bsr_code: string;
          challan_no: string;
          deposited_on: string;
          amount: string;
          interest: string;
          late_fee: string;
          months: number[];
        }>(
          `SELECT bsr_code, challan_no, deposited_on::text, amount::text, interest::text, late_fee::text, months
             FROM payroll_tds_challans WHERE fy = $1 AND quarter = $2 AND deleted_at IS NULL ORDER BY deposited_on, id`,
          [fy, quarter],
        )
      ).rows;
      const sum = (m: number, k: 'it' | 'cess') =>
        recs.filter((r) => Number(r.month.slice(5, 7)) === m).reduce((s, r) => s + Number(r[k]), 0);
      const problems: string[] = [];
      for (const m of QUARTER[quarter]!) {
        const tds = sum(m, 'it') + sum(m, 'cess');
        const ch = challans.filter((x) => x.months.includes(m));
        if (tds > 0 && !ch.length) problems.push(`${monthOf(fy, m)} has TDS and no challan`);
      }
      for (const ch of challans) {
        const tds = ch.months.reduce((s, m) => s + sum(m, 'it') + sum(m, 'cess'), 0);
        if (Math.abs(tds - Number(ch.amount)) > 0.005)
          problems.push(
            `challan ${ch.challan_no} (${ch.amount}) differs from the TDS of its months (${tds.toFixed(2)})`,
          );
      }
      if (problems.length) bad(`The return cannot be made yet: ${problems.join('; ')}`, 409);
      const serialOf = (m: number) => challans.findIndex((x) => x.months.includes(m)) + 1;
      const head = (name: string) => [
        ['Form', form!, 'FY', fy, 'Quarter', `Q${String(quarter)}`, 'File', name],
      ];
      let rows: Array<Array<string | number>>;
      let name: string;
      if (file === 'challans') {
        name = 'CHALLANS';
        rows = [
          ...head(name),
          [
            'ChallanSerial',
            'BsrCode',
            'DepositDate',
            'ChallanNo',
            'TdsIncomeTax',
            'Surcharge',
            'EducationCess',
            'Interest',
            'Fee',
            'TotalDeposited',
            'MonthsCovered',
          ],
          ...challans.map((ch, i) => {
            const it = ch.months.reduce((s, m) => s + sum(m, 'it'), 0);
            const cess = ch.months.reduce((s, m) => s + sum(m, 'cess'), 0);
            return [
              i + 1,
              ch.bsr_code,
              dmy(ch.deposited_on),
              ch.challan_no,
              Math.round(it),
              0,
              Math.round(cess),
              whole(ch.interest),
              whole(ch.late_fee),
              Math.round(Number(ch.amount) + Number(ch.interest) + Number(ch.late_fee)),
              ch.months
                .map(
                  (m) =>
                    [
                      '',
                      'JAN',
                      'FEB',
                      'MAR',
                      'APR',
                      'MAY',
                      'JUN',
                      'JUL',
                      'AUG',
                      'SEP',
                      'OCT',
                      'NOV',
                      'DEC',
                    ][m],
                )
                .join('|'),
            ];
          }),
        ];
      } else if (file === 'annexure1') {
        name = 'ANNEXURE_I';
        rows = [
          ...head(name),
          [
            'ChallanSerial',
            'Section',
            'EmployeePan',
            'EmployeeName',
            'PaymentDate',
            'AmountPaid',
            'TdsIncomeTax',
            'Surcharge',
            'EducationCess',
            'TotalTdsDeducted',
            'TotalTdsDeposited',
            'DeductionDate',
            'Remarks',
          ],
          ...recs
            .filter((r) => Number(r.it) + Number(r.cess) > 0)
            .map((r) => {
              const pan = this.pan(r.pan);
              const end = dmy(endOf(r.month));
              const tds = Math.round(Number(r.it) + Number(r.cess));
              return [
                serialOf(Number(r.month.slice(5, 7))),
                section!,
                pan ?? 'PANNOTAVBL',
                r.name,
                end,
                whole(r.taxable),
                whole(r.it),
                0,
                whole(r.cess),
                tds,
                tds,
                end,
                pan ? '' : 'C',
              ];
            }),
        ];
      } else {
        name = 'ANNEXURE_II';
        const people = (
          await c.query<{
            employee_id: string;
            name: string;
            pan: string | null;
            first: string;
            last: string;
            tds: string;
          }>(
            `SELECT r.employee_id::text, max(r.employee_name) AS name, max(e.secure->>'pan') AS pan,
                    to_char(min(r.month), 'YYYY-MM') AS first, to_char(max(r.month), 'YYYY-MM') AS last,
                    sum(r.it_amount + r.cess_amount)::text AS tds
               FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id JOIN employees e ON e.id = r.employee_id
              WHERE r.month BETWEEN $1::date AND $2::date AND u.deleted_at IS NULL AND u.stage IN ('LOCKED', 'PAID')
                AND r.status <> 'FAILED'
              GROUP BY r.employee_id ORDER BY 2`,
            [`${monthOf(fy, 4)}-01`, `${monthOf(fy, 3)}-01`],
          )
        ).rows;
        rows = [
          ...head(name),
          [
            'EmployeePan',
            'EmployeeName',
            'EmployedFrom',
            'EmployedTo',
            'NewRegime',
            'GrossSalary',
            'ExemptionsUs10',
            'DeductionsUs16',
            'PrevEmployerIncome',
            'PrevEmployerTds',
            'ChapViaAllowed',
            'TaxableIncome',
            'TaxBeforeRebate',
            'Rebate',
            'Surcharge',
            'Relief89',
            'TotalTax',
            'NetTaxPayable',
            'CessIncluded',
            'TdsDeducted',
          ],
        ];
        for (const p of people) {
          const t = await this.lastTax(c, p.employee_id, fy);
          if (!t) continue;
          const total = whole(t.annual_tax);
          rows.push([
            this.pan(p.pan) ?? 'PANNOTAVBL',
            p.name,
            dmy(`${p.first}-01`),
            dmy(endOf(p.last)),
            t.regime === 'NEW' ? 'Y' : 'N',
            whole(t.gross_projection),
            whole(t.exemptions),
            String(Math.round(Number(t.standard_deduction ?? 0) + Number(t.pt_deduction ?? 0))),
            whole(t.prev_salary),
            whole(t.prev_tds),
            whole(t.other_deductions),
            whole(t.taxable_income),
            whole(t.slab_tax),
            whole(t.rebate),
            whole(t.surcharge),
            0,
            total,
            total,
            whole(t.cess),
            Math.round(Number(p.tds)),
          ]);
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.tds_return.file',
        entityType: 'payroll_tds_challans',
        after: { fy, quarter, file: name, rows: rows.length - 2, pansRead: true },
      });
      return {
        filename: `FORM${form!.replace(/\D/g, '') || form!}_${fy}_Q${String(quarter)}_${name}.csv`,
        base64: Buffer.from(csv(rows), 'utf8').toString('base64'),
        contentType: 'text/csv; charset=utf-8',
      };
    });
  }

  /** The year's last record's tax: the year as paid (a leaver's last month; March for the rest). */
  private async lastTax(
    c: PoolClient,
    employeeId: string,
    fy: string,
  ): Promise<TaxRow | undefined> {
    return (
      await c.query<TaxRow>(
        `SELECT x.regime, x.gross_projection::text, x.exemptions::text, x.standard_deduction::text, x.pt_deduction::text,
                x.other_deductions::text, x.taxable_income::text, x.slab_tax::text, x.rebate::text, x.surcharge::text,
                x.cess::text, x.annual_tax::text, x.perquisites::text, x.prev_salary::text, x.prev_tds::text,
                x.other_income::text, x.house_loss::text, x.working
           FROM payroll_record_tax x JOIN payroll_records r ON r.id = x.record_id JOIN payroll_runs u ON u.id = r.run_id
          WHERE r.employee_id = $1 AND x.fy = $2 AND x.mode = 'PROJECTION' AND u.stage IN ('LOCKED', 'PAID')
            AND u.deleted_at IS NULL AND r.status <> 'FAILED'
          ORDER BY r.month DESC, r.id DESC LIMIT 1`,
        [employeeId, fy],
      )
    ).rows[0];
  }

  // ---- the declaration (Form 124 / 12BB) --------------------------------------------------------------------------
  async declarationForm(ctx: RequestContext, fy: string, employeeId?: string) {
    if (employeeId) must(ctx, RUN.view, 'Only payroll staff print another’s declaration');
    else must(ctx, OWN, 'My declaration is for employees');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = (
        await c.query<{
          id: string;
          code: string;
          name: string;
          designation: string | null;
          pan: string | null;
        }>(
          employeeId
            ? `SELECT id::text, employee_code AS code, display_name AS name, designation, secure->>'pan' AS pan FROM employees WHERE id = $1`
            : `SELECT id::text, employee_code AS code, display_name AS name, designation, secure->>'pan' AS pan FROM employees
                WHERE user_id = app.current_user_id() AND deleted_at IS NULL LIMIT 1`,
          employeeId ? [employeeId] : [],
        )
      ).rows[0];
      if (!e || (employeeId && (await hiddenFor(c, ctx)).includes(employeeId)))
        bad('Employee not found', 404);
      const title = (await this.label(c, fy, 'DECL_FORM')) ?? 'Form 12BB';
      const rows = (
        await c.query<{
          label: string | null;
          line_code: string;
          declared: string;
          verified: string | null;
          status: string;
          detail: {
            months?: Array<{ month: string; rent: string }>;
            city?: string;
            landlord?: { name: string; address: string; relation: string; panEnc: string | null };
          };
        }>(
          `SELECT l.label, d.line_code, d.declared::text, d.verified::text, d.status, d.detail
             FROM payroll_declarations d LEFT JOIN payroll_tax_labels l ON l.fy = d.fy AND l.line_code = d.line_code
            WHERE d.employee_id = $1 AND d.fy = $2 AND d.deleted_at IS NULL ORDER BY l.sort_order NULLS LAST`,
          [e!.id, fy],
        )
      ).rows;
      const lines: Array<Array<string>> = [];
      for (const r of rows) {
        lines.push([
          r.label ?? r.line_code,
          money(r.declared),
          r.verified ? money(r.verified) : '—',
          r.status === 'SUBMITTED' ? 'Declared' : r.status === 'VERIFIED' ? 'Verified' : 'Rejected',
        ]);
        const ll = r.detail.landlord;
        if (r.line_code === 'HRA_RENT' && ll) {
          const lpan = this.pan(ll.panEnc);
          lines.push([
            `   Rent by month: ${(r.detail.months ?? []).map((x) => `${x.month} ₹${x.rent}`.replace('₹', 'Rs.')).join(', ')}`,
            '',
            '',
            '',
          ]);
          lines.push([
            `   Landlord: ${ll.name}, ${ll.address}; PAN ${lpan ?? 'not given'}; relation: ${ll.relation}; city: ${r.detail.city ?? ''}`,
            '',
            '',
            '',
          ]);
        }
      }
      const { head, logo } = await this.logo(c);
      const pan = this.pan(e!.pan);
      const pdf = await tablePdf({
        school: head.school,
        address: head.address,
        title: `${title} — statement of claims for deduction of tax, ${fy}`,
        letterhead: {
          logo,
          details: `Employee: ${e!.name} (${e!.code}) · PAN ${pan ?? 'not on record'}`,
        },
        subtitle: [
          `Designation: ${e!.designation ?? '—'} · Financial year ${fy}`,
          'I certify that the information given here is complete and correct.',
        ],
        portrait: true,
        wrap: true,
        columns: [
          { label: 'Particulars', width: 0.55 },
          { label: 'Declared (Rs.)', width: 0.15, right: true },
          { label: 'Verified (Rs.)', width: 0.15, right: true },
          { label: 'Status', width: 0.15 },
        ],
        rows: lines.length ? lines : [['No declaration this year', '', '', '']],
        signs: [blankBox('Signature of the employee'), blankBox('Verified by (payroll)')],
      });
      return {
        filename: `${title
          .replace(/\[.*\]/, '')
          .trim()
          .replace(/\W+/g, '_')}_${e!.code}_${fy}.pdf`,
        base64: Buffer.from(pdf).toString('base64'),
        contentType: 'application/pdf',
      };
    });
  }

  // ---- the annual certificate (Form 16 / 130) -------------------------------------------------------------------------
  private async yearLocked(c: PoolClient, fy: string) {
    const open = (
      await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM payroll_runs WHERE month BETWEEN $1::date AND $2::date AND deleted_at IS NULL
            AND stage NOT IN ('LOCKED', 'PAID')`,
        [`${monthOf(fy, 4)}-01`, `${monthOf(fy, 3)}-01`],
      )
    ).rows[0]!.n;
    return open === 0;
  }

  async certificates(ctx: RequestContext, fy: string) {
    must(ctx, RUN.approve, 'Only a payroll checker sees the certificates');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = (
        await c.query(
          `SELECT e.id::text AS employee_id, e.employee_code AS code, e.display_name AS name, (e.secure->>'pan') IS NOT NULL AS has_pan,
                  x.part_a_file_id IS NOT NULL AS part_a, x.made_at, x.released_at, x.emailed_at
             FROM employees e
             LEFT JOIN payroll_certificates x ON x.employee_id = e.id AND x.fy = $3
            WHERE EXISTS (SELECT 1 FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
                           WHERE r.employee_id = e.id AND r.month BETWEEN $1::date AND $2::date AND u.stage IN ('LOCKED', 'PAID')
                             AND u.deleted_at IS NULL AND r.status <> 'FAILED')
            ORDER BY e.display_name`,
          [`${monthOf(fy, 4)}-01`, `${monthOf(fy, 3)}-01`, fy],
        )
      ).rows;
      return {
        fy,
        yearLocked: await this.yearLocked(c, fy),
        title: (await this.label(c, fy, 'CERT_FORM_TITLE')) ?? 'FORM NO. 16',
        rows: rows.map((r) => ({
          employeeId: r.employee_id,
          code: r.code,
          name: r.name,
          hasPan: r.has_pan,
          partA: r.part_a,
          madeAt: r.made_at,
          releasedAt: r.released_at,
          emailedAt: r.emailed_at,
        })),
        can: { admin: has(ctx, PAYROLL.admin) },
      };
    });
  }

  /** Part A files from TRACES, each matched to an employee by the PAN in its file name. */
  async partA(ctx: RequestContext, fy: string, fileIds: string[]) {
    must(ctx, RUN.approve, 'Only a payroll checker uploads Part A');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const files = (
        await c.query<{
          id: string;
          name: string | null;
          content_type: string;
          mine: boolean;
          status: string;
        }>(
          `SELECT id::text, original_name AS name, content_type, (created_by = app.current_user_id()) AS mine, status
             FROM files WHERE id = ANY($1::bigint[]) AND deleted_at IS NULL`,
          [fileIds],
        )
      ).rows;
      if (files.length !== new Set(fileIds).size) bad('A file is not found');
      const staff = (
        await c.query<{ id: string; code: string; pan: string | null }>(
          `SELECT e.id::text, e.employee_code AS code, e.secure->>'pan' AS pan FROM employees e
            WHERE EXISTS (SELECT 1 FROM payroll_records r WHERE r.employee_id = e.id AND r.month BETWEEN $1::date AND $2::date)`,
          [`${monthOf(fy, 4)}-01`, `${monthOf(fy, 3)}-01`],
        )
      ).rows;
      const byPan = new Map<string, { id: string; code: string }>();
      for (const s of staff) {
        const p = this.pan(s.pan);
        if (p) byPan.set(p, { id: s.id, code: s.code });
      }
      const matched: string[] = [];
      const unmatched: string[] = [];
      for (const f of files) {
        const pan = (f.name ?? '').toUpperCase().match(PAN_RE)?.[0];
        const who = pan ? byPan.get(pan) : undefined;
        if (!f.mine || f.status !== 'ready' || f.content_type !== 'application/pdf' || !who) {
          unmatched.push(f.name ?? f.id);
          continue;
        }
        await c.query(
          `INSERT INTO payroll_certificates (school_id, employee_id, fy, part_a_file_id) VALUES (app.current_school_id(), $1, $2, $3)
           ON CONFLICT (employee_id, fy) DO UPDATE SET part_a_file_id = EXCLUDED.part_a_file_id, file_id = NULL, made_at = NULL,
             released_at = NULL`,
          [who.id, fy, f.id],
        );
        await c.query(
          `UPDATE files SET owner_entity_type = 'payroll_certificate', owner_entity_id = $2, classification = 'sensitive' WHERE id = $1`,
          [f.id, who.id],
        );
        matched.push(who.code);
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.certificate.part_a',
        entityType: 'payroll_certificates',
        after: { fy, matched: matched.length, unmatched: unmatched.length },
      });
      return { matched, unmatched };
    });
  }

  private async partB(c: PoolClient, fy: string, employeeId: string) {
    const t = await this.lastTax(c, employeeId, fy);
    if (!t) return null;
    const e = (
      await c.query<{ code: string; name: string; designation: string | null; pan: string | null }>(
        `SELECT employee_code AS code, display_name AS name, designation, secure->>'pan' AS pan FROM employees WHERE id = $1`,
        [employeeId],
      )
    ).rows[0]!;
    const span = (
      await c.query<{
        first: string;
        last: string;
        tds: string;
        prev_name: string | null;
        prev_tan: string | null;
      }>(
        `SELECT to_char(min(r.month), 'YYYY-MM') AS first, to_char(max(r.month), 'YYYY-MM') AS last,
                sum(r.it_amount + r.cess_amount)::text AS tds,
                (SELECT employer_name FROM payroll_prev_employment p WHERE p.employee_id = $1 AND p.fy = $4 AND p.deleted_at IS NULL) AS prev_name,
                (SELECT employer_tan FROM payroll_prev_employment p WHERE p.employee_id = $1 AND p.fy = $4 AND p.deleted_at IS NULL) AS prev_tan
           FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
          WHERE r.employee_id = $1 AND r.month BETWEEN $2::date AND $3::date AND u.stage IN ('LOCKED', 'PAID')
            AND u.deleted_at IS NULL AND r.status <> 'FAILED'`,
        [employeeId, `${monthOf(fy, 4)}-01`, `${monthOf(fy, 3)}-01`, fy],
      )
    ).rows[0]!;
    const L = async (code: string, d: string) => (await this.label(c, fy, code)) ?? d;
    const tan =
      (await c.query<{ tan: string | null }>(`SELECT tan FROM payroll_settings`)).rows[0]?.tan ??
      null;
    const n = (v: string | null | undefined) => Number(v ?? 0);
    const gross = n(t.gross_projection);
    const exempt = n(t.exemptions);
    const sd = n(t.standard_deduction);
    const pt = n(t.pt_deduction);
    const salaries = gross - exempt - sd - pt;
    const rows: string[][] = [
      [
        '1',
        'Gross salary (with perquisites and the earlier employer’s salary)',
        money(String(gross)),
      ],
      ...(n(t.perquisites)
        ? [['', '   of which: perquisites (and the employer’s NPS)', money(t.perquisites)]]
        : []),
      ['2', await L('HRA_RENT', 'HRA exemption'), money(String(exempt))],
      ['3', 'Balance (1 − 2)', money(String(gross - exempt))],
      ['4', await L('STD_DED', 'Standard deduction'), money(String(sd))],
      ['5', await L('PT_16III', 'Tax on employment'), money(String(pt))],
      ['6', 'Income chargeable under the head Salaries', money(String(salaries))],
      [
        '7',
        `Earlier employer: salary / TDS${span.prev_name ? ` (${span.prev_name}${span.prev_tan ? `, TAN ${span.prev_tan}` : ''})` : ''}`,
        `${money(t.prev_salary)} / ${money(t.prev_tds)}`,
      ],
      ['8', 'Other income less a house’s loss', money(String(n(t.other_income) - n(t.house_loss)))],
      ['9', 'Deductions (Chapter VI-A)', money(t.other_deductions)],
      ...(t.working?.deductions ?? []).map((d) => [
        '',
        `   ${d.code}: claimed ${money(d.declared)}, allowed`,
        money(d.allowed),
      ]),
      ['10', 'Total taxable income', money(t.taxable_income)],
      ['11', 'Tax on total income', money(t.slab_tax)],
      ['12', await L('REBATE', 'Rebate'), money(t.rebate)],
      ['13', 'Surcharge', money(t.surcharge)],
      ['14', 'Health and education cess', money(t.cess)],
      ['15', await L('RELIEF_89', 'Relief for arrears'), money('0')],
      ['16', 'Total tax payable', money(t.annual_tax)],
      ['17', 'Tax deducted and deposited (this school)', money(span.tds)],
    ];
    return {
      title: (await this.label(c, fy, 'CERT_FORM_TITLE')) ?? 'FORM NO. 16',
      year: (await this.label(c, fy, 'YEAR_LABEL')) ?? fy,
      section: (await this.label(c, fy, 'TDS_SECTION_DISPLAY')) ?? '',
      regime: await L(t.regime === 'OLD' ? 'REGIME_OLD' : 'REGIME_NEW', t.regime ?? ''),
      employee: { ...e, pan: this.pan(e.pan) },
      period: `${dmy(`${span.first}-01`)} to ${dmy(endOf(span.last))}`,
      tan,
      rows,
    };
  }

  private async certificatePdf(c: PoolClient, ctx: RequestContext, fy: string, employeeId: string) {
    const b = await this.partB(c, fy, employeeId);
    if (!b) return null;
    const { head, logo } = await this.logo(c);
    const signer = await signerOf(c, (k) => this.storage.read(k), {
      as: 'Authorised signatory',
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
      verb: 'Made on',
    });
    const partB = await tablePdf({
      school: head.school,
      address: head.address,
      title: `${b.title} — Part B: salary paid and tax deducted · ${b.year}`,
      letterhead: { logo, details: `TAN ${b.tan ?? 'not set'} · ${b.section}` },
      subtitle: [
        `Employee: ${b.employee.name} (${b.employee.code}) · PAN ${b.employee.pan ?? 'PANNOTAVBL'} · ${b.employee.designation ?? ''}`,
        `Period: ${b.period} · ${b.regime}`,
      ],
      subtitleFirstOnly: true,
      portrait: true,
      wrap: true,
      columns: [
        { label: 'No.', width: 0.07 },
        { label: 'Particulars', width: 0.63 },
        { label: 'Amount (Rs.)', width: 0.3, right: true },
      ],
      rows: b.rows,
      signs: [signer, blankBox('Principal')],
    });
    const out = await LockableDocument.create();
    const cert = (
      await c.query<{ object_key: string | null }>(
        `SELECT f.object_key FROM payroll_certificates x JOIN files f ON f.id = x.part_a_file_id
          WHERE x.employee_id = $1 AND x.fy = $2`,
        [employeeId, fy],
      )
    ).rows[0];
    if (cert?.object_key) {
      try {
        const a = await LockableDocument.load(await this.storage.read(cert.object_key), {
          ignoreEncryption: true,
        });
        for (const p of await out.copyPages(a, a.getPageIndices())) out.addPage(p);
      } catch {
        // a Part A that cannot be read: the certificate goes out with Part B, and the list says Part A is missing
      }
    }
    const bDoc = await LockableDocument.load(partB);
    for (const p of await out.copyPages(bDoc, bDoc.getPageIndices())) out.addPage(p);
    const pattern =
      (await c.query<{ p: string | null }>(`SELECT payslip_password AS p FROM payroll_settings`))
        .rows[0]?.p ?? null;
    const pw = await passwordFor(c, employeeId, pattern);
    if (pw.password)
      out.encrypt({
        userPassword: pw.password,
        ownerPassword: randomBytes(16).toString('hex'),
        permissions: { printing: 'highResolution', copying: false, modifying: false },
      });
    void ctx;
    return {
      pdf: Buffer.from(await out.save()),
      locked: !!pw.password,
      code: b.employee.code,
      title: b.title,
    };
  }

  /** Make the year's certificates: the year fully locked; each one stored, locked with the payslip password. */
  async make(ctx: RequestContext, fy: string) {
    must(ctx, RUN.approve, 'Only a payroll checker makes the certificates');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (!(await this.yearLocked(c, fy)))
        bad(
          `A run of ${fy} is not locked: the certificates are made from the locked year only`,
          409,
        );
      const staff = (
        await c.query<{ id: string }>(
          `SELECT DISTINCT r.employee_id::text AS id FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
            WHERE r.month BETWEEN $1::date AND $2::date AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL
              AND r.status <> 'FAILED'`,
          [`${monthOf(fy, 4)}-01`, `${monthOf(fy, 3)}-01`],
        )
      ).rows;
      let made = 0;
      const unlocked: string[] = [];
      const noPartA: string[] = [];
      for (const s of staff) {
        const r = await this.certificatePdf(c, ctx, fy, s.id);
        if (!r) continue;
        const key = objectKeyFor(
          requireTenant(ctx).schoolId,
          'pdf',
          `certificate-${s.id}-${randomBytes(6).toString('hex')}`,
        );
        await this.storage.write(key, r.pdf, 'application/pdf');
        const name = `${r.title.replace(/\W+/g, '_').replace(/^_|_$/g, '')}_${r.code}_${fy}.pdf`;
        const fileId = (
          await c.query<{ id: string }>(
            `INSERT INTO files (school_id, bucket, object_key, content_type, size_bytes, sha256, original_name, owner_entity_type,
                                owner_entity_id, classification, storage_driver, status, scanned_at, scan_result)
             VALUES (app.current_school_id(), $1, $2, 'application/pdf', $3, $4, $5, 'payroll_certificate', $6, 'sensitive', $7,
                     'ready', now(), 'generated') RETURNING id::text`,
            [
              this.storage.bucket,
              key,
              r.pdf.length,
              createHash('sha256').update(r.pdf).digest('hex'),
              name,
              s.id,
              this.storage.name,
            ],
          )
        ).rows[0]!.id;
        const row = (
          await c.query<{ part_a: boolean }>(
            `INSERT INTO payroll_certificates (school_id, employee_id, fy, file_id, made_at, made_by)
             VALUES (app.current_school_id(), $1, $2, $3, now(), app.current_user_id())
             ON CONFLICT (employee_id, fy) DO UPDATE SET file_id = EXCLUDED.file_id, made_at = now(), made_by = EXCLUDED.made_by
             RETURNING part_a_file_id IS NOT NULL AS part_a`,
            [s.id, fy, fileId],
          )
        ).rows[0]!;
        if (!row.part_a) noPartA.push(r.code);
        if (!r.locked) unlocked.push(r.code);
        made += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.certificate.make',
        entityType: 'payroll_certificates',
        after: { fy, made, noPartA: noPartA.length, unlocked: unlocked.length },
      });
      return {
        made,
        noPartA,
        unlocked,
        message: `${String(made)} certificate(s) made.${noPartA.length ? ` ${String(noPartA.length)} without Part A (upload it and make again).` : ''}${unlocked.length ? ` ${String(unlocked.length)} not locked: the password cannot be made (${unlocked.slice(0, 5).join(', ')}).` : ''}`,
      };
    });
  }

  async release(ctx: RequestContext, fy: string) {
    must(ctx, RUN.approve, 'Only a payroll checker releases the certificates');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE payroll_certificates SET released_at = now(), released_by = app.current_user_id()
          WHERE fy = $1 AND file_id IS NOT NULL AND released_at IS NULL`,
        [fy],
      );
      await this.audit.stage(ctx, c, {
        action: 'payroll.certificate.release',
        entityType: 'payroll_certificates',
        after: { fy, released: r.rowCount },
      });
      return { released: r.rowCount ?? 0 };
    });
  }

  /** E-mail the released certificates not yet sent, each with its locked PDF (the workers send). */
  async send(ctx: RequestContext, fy: string) {
    must(ctx, RUN.approve, 'Only a payroll checker sends the certificates');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = (
        await c.query<{
          id: string;
          employee_id: string;
          file_id: string;
          email: string | null;
          name: string;
          code: string;
          fname: string | null;
        }>(
          `SELECT x.id::text, x.employee_id::text, x.file_id::text, e.email, e.display_name AS name, e.employee_code AS code,
                  f.original_name AS fname
             FROM payroll_certificates x JOIN employees e ON e.id = x.employee_id JOIN files f ON f.id = x.file_id
            WHERE x.fy = $1 AND x.released_at IS NOT NULL AND x.emailed_at IS NULL`,
          [fy],
        )
      ).rows;
      const pattern =
        (await c.query<{ p: string | null }>(`SELECT payslip_password AS p FROM payroll_settings`))
          .rows[0]?.p ?? null;
      const hint = patternInWords(pattern);
      const school = (await registerLetterhead(c)).school;
      const title = (await this.label(c, fy, 'CERT_FORM_TITLE')) ?? 'Form 16';
      let queued = 0;
      const noEmail: string[] = [];
      for (const r of rows) {
        if (!r.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) {
          noEmail.push(r.code);
          continue;
        }
        const body = [
          `<p>Dear ${esc(r.name)},</p>`,
          `<p>Your tax certificate (${esc(title)}) for ${esc(fy)} is attached.</p>`,
          hint ? `<p>It opens with a password: ${esc(hint)}.</p>` : '',
          '<p>It is also in My tax.</p>',
          `<p>${esc(school)}</p>`,
        ].join('');
        const msg = (
          await c.query<{ id: string }>(
            `INSERT INTO comms_messages (school_id, channel, recipient_address, subject, body, format, status, variables, attachments)
             VALUES (app.current_school_id(), 'email', lower($1), $2, $3, 'html', 'queued', '{}'::jsonb, $4::jsonb) RETURNING id::text`,
            [
              r.email,
              `Tax certificate for ${fy}`,
              body,
              JSON.stringify([
                {
                  fileId: r.file_id,
                  name: r.fname ?? `Certificate_${r.code}.pdf`,
                  contentType: 'application/pdf',
                },
              ]),
            ],
          )
        ).rows[0]!.id;
        await c.query(
          `SELECT app.enqueue_job('notifications', jsonb_build_object('schoolId', app.current_school_id()::text, 'userId', NULL,
                    'requestId', NULL, 'kind', 'comms.message', 'payload', jsonb_build_object('messageId', $1::text)))`,
          [msg],
        );
        await c.query(
          `UPDATE payroll_certificates SET emailed_at = now(), message_id = $2 WHERE id = $1`,
          [r.id, msg],
        );
        queued += 1;
      }
      await this.audit.stage(ctx, c, {
        action: 'payroll.certificate.send',
        entityType: 'payroll_certificates',
        after: { fy, queued, noEmail: noEmail.length },
      });
      return { queued, noEmail };
    });
  }

  /** A certificate as stored: payroll staff (a checker), or the employee's own once released. */
  async file(ctx: RequestContext, fy: string, employeeId?: string) {
    if (employeeId) must(ctx, RUN.approve, 'Only a payroll checker opens a certificate');
    else must(ctx, OWN, 'My certificate is for employees');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = (
        await c.query<{ object_key: string; name: string | null; released: boolean }>(
          employeeId
            ? `SELECT f.object_key, f.original_name AS name, x.released_at IS NOT NULL AS released FROM payroll_certificates x
                 JOIN files f ON f.id = x.file_id WHERE x.employee_id = $1 AND x.fy = $2`
            : `SELECT f.object_key, f.original_name AS name, x.released_at IS NOT NULL AS released FROM payroll_certificates x
                 JOIN files f ON f.id = x.file_id JOIN employees e ON e.id = x.employee_id
                WHERE e.user_id = app.current_user_id() AND x.fy = $1`,
          employeeId ? [employeeId, fy] : [fy],
        )
      ).rows[0];
      if (!r || (!employeeId && !r.released)) bad('No certificate yet', 404);
      const bytes = await this.storage.read(r!.object_key);
      await this.audit.stage(ctx, c, {
        action: 'payroll.certificate.download',
        entityType: 'payroll_certificates',
        after: { fy, own: !employeeId },
      });
      return {
        filename: r!.name ?? `Certificate_${fy}.pdf`,
        base64: Buffer.from(bytes).toString('base64'),
        contentType: 'application/pdf',
      };
    });
  }

  /** the current financial year (for the screens' default) */
  currentFy() {
    return fyOf(istToday());
  }
}
