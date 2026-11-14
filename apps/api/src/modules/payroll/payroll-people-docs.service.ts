import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { PDFDocument } from 'pdf-lib';
import { DbService } from '../../common/db/db.service';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import type { LetterheadLogo } from '../../common/pdf/letterhead';
import { tablePdf, type TablePdf } from '../engagement/table-pdf';
import { registerGeneratedOn, registerLetterhead } from '../exams/register-head';
import { STORAGE_DRIVER, type StorageDriver } from '../files/storage';
import { blankBox, signerOf, type SignBox } from '../purchase/purchase-doc-sign';
import { RUN } from './payroll-inputs.dto';
import { bad, hiddenFor, monthWords, must } from './payroll-month';
import { OWN } from './payroll-payslip.service';
import { fyOf, istToday } from './payroll-setup.service';
import { wrapWords } from './payroll-bank.service';
import { amountInWords } from './payroll-words';

const money = (v: string | number | null | undefined) =>
  Number(v ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (d: string | null | undefined) =>
  d ? `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}` : '';
const words = (v: string) => amountInWords(v);
/** a portrait paper whose lines above the table are paragraphs, wrapped to the page */
const paper = (t: TablePdf) =>
  tablePdf({ ...t, subtitle: [t.subtitle ?? []].flat().flatMap((x) => wrapWords(x, 122)) });
const file = (name: string, pdf: Buffer) => ({
  filename: name.replace(/[^\w.-]+/g, '_'),
  base64: Buffer.from(pdf).toString('base64'),
  contentType: 'application/pdf',
});
const HEAD_NAMES: Record<string, string> = {
  BASIC: 'Basic pay',
  DA: 'Dearness allowance',
  HRA: 'House rent allowance',
  TA: 'Transport allowance',
  SPL_ALW: 'Special allowance',
};
const REASONS: Record<string, string> = {
  RESIGNATION: 'Resignation',
  RETIREMENT: 'Retirement',
  TERMINATION: 'Termination',
  DISMISSAL: 'Dismissal',
  DEATH: 'Death',
  DISABLEMENT: 'Disablement',
  CONTRACT_END: 'End of contract',
};

/**
 * Payroll's people papers (docs/design/86, phase E step 5), each on the register letterhead with signature boxes
 * filled from the system: the increment letter (numbered, signed by the checker who applied it), the settlement
 * statement, the dues letter, the salary certificate of a year, and a loan's statement or its no-dues certificate.
 */
@Injectable()
export class PayrollPeopleDocsService {
  constructor(
    private readonly db: DbService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private async head(c: PoolClient) {
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

  private sign(
    c: PoolClient,
    as: string,
    who: { userId: string | null; name: string | null; at: Date | null },
    verb: string,
  ): Promise<SignBox> {
    if (!who.userId) return Promise.resolve(blankBox(as));
    return signerOf(c, (k) => this.storage.read(k), {
      as,
      name: who.name,
      userId: who.userId,
      at: who.at,
      verb,
    });
  }

  /** the person signed in, as the employee record names them */
  private async me(c: PoolClient) {
    return (
      await c.query<{ id: string; name: string | null }>(
        `SELECT u.id::text, COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1),
                                     u.display_name) AS name FROM users u WHERE u.id = app.current_user_id()`,
      )
    ).rows[0];
  }

  private async ownEmployee(c: PoolClient) {
    const e = (
      await c.query<{ id: string }>(
        `SELECT id::text FROM employees WHERE user_id = app.current_user_id() AND deleted_at IS NULL
          ORDER BY (status = 'active') DESC, id LIMIT 1`,
      )
    ).rows[0];
    if (!e) bad('Your sign-in is not linked to a staff record', 404);
    return e!.id;
  }

  // ---- increment letters ------------------------------------------------------------------------------------------
  /** A revision's letters as one paper (a page each), or one letter; `own` limits it to the signed-in employee's. */
  async letters(ctx: RequestContext, q: { revisionId?: string; letterId?: string; own?: boolean }) {
    if (q.own) must(ctx, OWN, 'My letters are for staff');
    else must(ctx, RUN.view, 'Only payroll staff print the letters');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const own = q.own ? await this.ownEmployee(c) : null;
      const hidden = own ? [] : await hiddenFor(c, ctx);
      const rows = (
        await c.query<{
          letter_no: string;
          code: string;
          name: string;
          designation: string | null;
          department: string | null;
          before: Record<string, string | number | null>;
          after: Record<string, string | number | null>;
          effective_from: string;
          issued_at: Date;
          issued_by: string | null;
          issuer: string | null;
          applied_by: string | null;
          applied_at: Date | null;
          applier: string | null;
          kind: string;
          reason: string;
          employee_id: string;
        }>(
          `SELECT l.letter_no, e.employee_code AS code, e.display_name AS name, e.designation, e.department, l.before, l.after,
                  l.effective_from::text, l.issued_at, l.issued_by::text, iu.display_name AS issuer, r.applied_by::text, r.applied_at,
                  au.display_name AS applier, r.kind, r.reason, l.employee_id::text
             FROM payroll_revision_letters l JOIN employees e ON e.id = l.employee_id
             JOIN payroll_revisions r ON r.id = l.revision_id
             LEFT JOIN users iu ON iu.id = l.issued_by LEFT JOIN users au ON au.id = r.applied_by
            WHERE ($1::bigint IS NULL OR l.revision_id = $1) AND ($2::bigint IS NULL OR l.id = $2)
              AND ($3::bigint IS NULL OR l.employee_id = $3) AND NOT (l.employee_id::text = ANY($4::text[]))
            ORDER BY l.letter_no`,
          [q.revisionId ?? null, q.letterId ?? null, own, hidden],
        )
      ).rows;
      if (!rows.length) bad('No letter found', 404);
      const { head, logo } = await this.head(c);
      const first = rows[0]!;
      const out = await PDFDocument.create();
      // a page a letter, each its own paper, put together
      for (const l of rows) {
        const codes = [...new Set([...Object.keys(l.before), ...Object.keys(l.after)])].filter(
          (k) => !['level', 'cell'].includes(k),
        );
        const signer = await this.sign(
          c,
          'Authorised signatory',
          { userId: l.applied_by, name: l.applier, at: l.applied_at },
          'Approved on',
        );
        const one = await paper({
          school: head.school,
          address: head.address,
          title: l.kind === 'INCREMENT' ? 'Increment letter' : 'Pay revision letter',
          letterhead: {
            logo,
            details: `No. ${l.letter_no} · Date ${dmy(l.issued_at.toISOString().slice(0, 10))}`,
          },
          subtitle: [
            `To ${l.name} (${l.code})${l.designation ? `, ${l.designation}` : ''}${l.department ? `, ${l.department}` : ''}`,
            `Subject: ${l.kind === 'INCREMENT' ? 'Annual increment' : 'Revision of pay'} from ${dmy(l.effective_from)}`,
            l.kind === 'INCREMENT'
              ? `We are pleased to tell you that you have been granted the annual increment from ${dmy(l.effective_from)}${
                  l.after.cell
                    ? `, to cell ${String(l.after.cell)} of pay level ${String(l.after.level ?? '')}`
                    : ''
                }. Your pay from that date is as below; the allowances worked out on basic pay follow it.`
              : `Your pay is revised from ${dmy(l.effective_from)} (${l.reason}). Your pay from that date is as below.`,
          ],
          portrait: true,
          columns: [
            { label: 'Pay head', width: 0.5 },
            { label: 'Before (Rs. a month)', width: 0.25, right: true },
            { label: 'From the date (Rs. a month)', width: 0.25, right: true },
          ],
          rows: codes.map((k) => [
            HEAD_NAMES[k] ?? k,
            l.before[k] === undefined || l.before[k] === null ? '—' : money(l.before[k]),
            l.after[k] === undefined || l.after[k] === null ? '—' : money(l.after[k]),
          ]),
          footnote: 'The other terms of your appointment stay as they are.',
          signs: [signer, blankBox('Received by the employee')],
        });
        const doc = await PDFDocument.load(one);
        for (const pg of await out.copyPages(doc, doc.getPageIndices())) out.addPage(pg);
      }
      const pdf = Buffer.from(await out.save());
      return file(
        rows.length === 1
          ? `${first.letter_no}_${first.code}.pdf`
          : `Increment_letters_${first.letter_no}.pdf`,
        pdf,
      );
    });
  }

  /** The signed-in employee's letters, for My payslips. */
  async myLetters(ctx: RequestContext) {
    must(ctx, OWN, 'My letters are for staff');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const id = await this.ownEmployee(c);
      return {
        rows: (
          await c.query<{ id: string; letterNo: string; effectiveFrom: string; kind: string }>(
            `SELECT l.id::text, l.letter_no AS "letterNo", l.effective_from::text AS "effectiveFrom", r.kind
               FROM payroll_revision_letters l JOIN payroll_revisions r ON r.id = l.revision_id
              WHERE l.employee_id = $1 AND r.status = 'APPLIED' ORDER BY l.effective_from DESC, l.id DESC`,
            [id],
          )
        ).rows,
      };
    });
  }

  // ---- the settlement statement and the dues letter ---------------------------------------------------------------
  private async settlement(c: PoolClient, ctx: RequestContext, id: string) {
    const s = (
      await c.query<{
        id: string;
        employee_id: string;
        code: string;
        name: string;
        designation: string | null;
        department: string | null;
        joined_on: string | null;
        last_day: string;
        reason: string;
        status: string;
        basis: string | null;
        gratuity: string;
        gratuity_tax_free: string;
        gratuity_forfeited: string;
        forfeit_reason: string | null;
        encash_days: string;
        encash_amount: string;
        encash_tax_free: string;
        notice_amount: string;
        loans: string;
        other_payable: string;
        other_recovery: string;
        net: string;
        detail: {
          service?: { years: number; months: number; days: number };
          gratuity?: { years: number; eligible: boolean; why?: string };
          notice?: { days: number };
          clearanceDues?: string;
          nominees?: Array<{
            name: string;
            relation: string | null;
            share: string;
            amount: string;
          }>;
          averageMonthly?: string;
          collected?: string;
          collectedOn?: string;
        };
        pay_month: string | null;
        dues_letter_no: string | null;
        computed_by: string | null;
        computer: string | null;
        computed_at: Date | null;
        approved_by: string | null;
        approver: string | null;
        approved_at: Date | null;
        staged_by: string | null;
        stager: string | null;
        staged_at: Date | null;
      }>(
        `SELECT s.id::text, s.employee_id::text, e.employee_code AS code, e.display_name AS name, e.designation, e.department,
                e.joined_on::text, s.last_day::text, s.reason, s.status, s.basis::text, s.gratuity::text, s.gratuity_tax_free::text,
                s.gratuity_forfeited::text, s.forfeit_reason, s.encash_days::text, s.encash_amount::text, s.encash_tax_free::text,
                s.notice_amount::text, s.loans::text, s.other_payable::text, s.other_recovery::text, s.net::text, s.detail,
                to_char(s.pay_month, 'YYYY-MM') AS pay_month, s.dues_letter_no,
                s.computed_by::text, cu.display_name AS computer, s.computed_at,
                s.approved_by::text, au.display_name AS approver, s.approved_at,
                s.staged_by::text, su.display_name AS stager, s.staged_at
           FROM payroll_settlements s JOIN employees e ON e.id = s.employee_id
           LEFT JOIN users cu ON cu.id = s.computed_by LEFT JOIN users au ON au.id = s.approved_by
           LEFT JOIN users su ON su.id = s.staged_by
          WHERE s.id = $1`,
        [id],
      )
    ).rows[0];
    if (!s || (await hiddenFor(c, ctx)).includes(s.employee_id)) bad('Settlement not found', 404);
    return s!;
  }

  async statement(ctx: RequestContext, id: string) {
    must(ctx, RUN.view, 'Only payroll staff print a settlement');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settlement(c, ctx, id);
      if (['DRAFT', 'CANCELLED'].includes(s.status)) bad('The settlement is not worked out', 409);
      const d = s.detail;
      const sv = d.service;
      const fixedOther = Number(s.other_recovery) - Number(d.clearanceDues ?? 0);
      const rows: Array<Array<string>> = [
        ['Payable', '', ''],
        [
          'Gratuity',
          d.gratuity?.eligible === false
            ? (d.gratuity.why ?? 'Not due')
            : `${String(d.gratuity?.years ?? 0)} year(s)`,
          money(s.gratuity),
        ],
        ['Gratuity: the tax-free part', '', money(s.gratuity_tax_free)],
        ['Leave encashment', `${Number(s.encash_days).toString()} day(s)`, money(s.encash_amount)],
        ['Leave encashment: the tax-free part', '', money(s.encash_tax_free)],
        ['Other payable', '', money(s.other_payable)],
        ['Recoverable', '', ''],
        [
          'Notice period shortfall',
          d.notice?.days ? `${String(d.notice.days)} day(s)` : '',
          money(s.notice_amount),
        ],
        ['Loans and advances outstanding', '', money(s.loans)],
        ['Dues from the no-dues clearance', '', money(d.clearanceDues ?? 0)],
        ['Other recovery', '', money(fixedOther)],
      ];
      const net = Number(s.net);
      rows.push([
        net >= 0 ? 'Net payable to the employee' : 'Net recoverable from the employee',
        '',
        money(Math.abs(net)),
      ]);
      const shade: Record<number, 'subheading' | 'grand'> = {
        0: 'subheading',
        6: 'subheading',
        [rows.length - 1]: 'grand',
      };
      const after: Array<{
        title: string;
        columns: Array<{ label: string; width: number; right?: boolean }>;
        rows: Array<Array<string>>;
        total?: boolean;
      }> = [];
      if (d.nominees?.length)
        after.push({
          title: 'Gratuity to the nominees, by their shares',
          columns: [
            { label: 'Nominee', width: 0.45 },
            { label: 'Relation', width: 0.2 },
            { label: 'Share %', width: 0.15, right: true },
            { label: 'Amount (Rs.)', width: 0.2, right: true },
          ],
          rows: [
            ...d.nominees.map((n) => [
              n.name,
              n.relation ?? '',
              Number(n.share).toString(),
              money(n.amount),
            ]),
            ['Total', '', '100', money(s.gratuity)],
          ],
          total: true,
        });
      const { head, logo } = await this.head(c);
      const pdf = await paper({
        school: head.school,
        address: head.address,
        title: 'Full and final settlement',
        letterhead: { logo, details: `No. FNF/${s.id} · Generated on ${registerGeneratedOn()}` },
        subtitle: [
          `${s.name} (${s.code}) · ${s.designation ?? ''}${s.department ? ` · ${s.department}` : ''}`,
          `Joined ${dmy(s.joined_on)} · last working day ${dmy(s.last_day)} · ${REASONS[s.reason] ?? s.reason}${
            sv ? ` · service ${String(sv.years)} y ${String(sv.months)} m ${String(sv.days)} d` : ''
          }`,
          `Worked on Rs. ${money(s.basis)} a month (basic + DA of the last month paid)${
            s.pay_month ? ` · paid with ${monthWords(s.pay_month)}` : ''
          }${s.dues_letter_no ? ` · dues letter ${s.dues_letter_no}` : ''}`,
          `In words: ${words(Math.abs(net).toFixed(2))}`,
        ],
        portrait: true,
        wrap: true,
        columns: [
          { label: 'Particulars', width: 0.55 },
          { label: 'Working', width: 0.2 },
          { label: 'Amount (Rs.)', width: 0.25, right: true },
        ],
        rows,
        shade,
        after,
        footnote: [
          'Gratuity: 15 days’ wages (basic + DA ÷ 26) for each completed year, a part year above six months counted. Leave: basic + DA ÷ 30 a day.',
          Number(s.gratuity_forfeited) > 0
            ? `Gratuity of Rs. ${money(s.gratuity_forfeited)} forfeited: ${s.forfeit_reason ?? ''}.`
            : '',
          'The salary for the days of the last month is paid by that month’s run, and its tax with it.',
        ]
          .filter(Boolean)
          .join(' '),
        signs: [
          await this.sign(
            c,
            'Worked out by',
            { userId: s.computed_by, name: s.computer, at: s.computed_at },
            'Worked out on',
          ),
          await this.sign(
            c,
            'Approved by',
            { userId: s.approved_by, name: s.approver, at: s.approved_at },
            'Approved on',
          ),
          blankBox('Received by the employee'),
        ],
      });
      return file(`Settlement_${s.code}_${s.last_day}.pdf`, pdf);
    });
  }

  async duesLetter(ctx: RequestContext, id: string) {
    must(ctx, RUN.view, 'Only payroll staff print a dues letter');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = await this.settlement(c, ctx, id);
      if (!s.dues_letter_no) bad('This settlement has no dues', 409);
      const due = Math.abs(Number(s.net));
      const d = s.detail;
      const rows: Array<Array<string>> = [
        ['Payable to you', ''],
        ['Gratuity', money(s.gratuity)],
        ['Leave encashment', money(s.encash_amount)],
        ['Other payable', money(s.other_payable)],
        ['Recoverable from you', ''],
        ['Notice period shortfall', money(s.notice_amount)],
        ['Loans and advances outstanding', money(s.loans)],
        ['Dues from the no-dues clearance', money(d.clearanceDues ?? 0)],
        ['Other recovery', money(Number(s.other_recovery) - Number(d.clearanceDues ?? 0))],
        ['Amount due to the school', money(due)],
      ];
      const { head, logo } = await this.head(c);
      const pdf = await paper({
        school: head.school,
        address: head.address,
        title: 'Amount due on your full and final settlement',
        letterhead: {
          logo,
          details: `No. ${s.dues_letter_no!} · Date ${dmy(s.staged_at?.toISOString().slice(0, 10) ?? istToday())}`,
        },
        subtitle: [
          `To ${s.name} (${s.code}), ${s.designation ?? ''}`,
          `Your full and final settlement, on your last working day ${dmy(s.last_day)}, leaves Rs. ${money(due)} (${words(
            due.toFixed(2),
          )}) due from you to the school, as worked out below.`,
          'Please pay it at the school office within 30 days of this letter, quoting its number. The school’s receipt closes the matter; your relieving papers are not held back for it.',
        ],
        subtitleFirstOnly: true,
        portrait: true,
        wrap: true,
        columns: [
          { label: 'Particulars', width: 0.7 },
          { label: 'Amount (Rs.)', width: 0.3, right: true },
        ],
        rows,
        shade: { 0: 'subheading', 4: 'subheading', 9: 'grand' },
        footnote: d.collected ? `Collected on ${dmy(d.collectedOn)}: ${d.collected}.` : undefined,
        signs: [
          await this.sign(
            c,
            'Authorised signatory',
            { userId: s.staged_by, name: s.stager, at: s.staged_at },
            'Issued on',
          ),
          blankBox('Received by the employee'),
        ],
      });
      return file(`${s.dues_letter_no!}_${s.code}.pdf`, pdf);
    });
  }

  // ---- the salary certificate -------------------------------------------------------------------------------------
  /** A year's salary, month by month, from the locked months; an employee's own, or anyone's for a checker. */
  async salaryCertificate(ctx: RequestContext, fy: string | undefined, employeeId?: string) {
    if (employeeId) must(ctx, RUN.approve, 'Only a payroll checker certifies another’s salary');
    else must(ctx, OWN, 'My salary certificate is for staff');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const eid = employeeId ?? (await this.ownEmployee(c));
      if (employeeId && (await hiddenFor(c, ctx)).includes(eid)) bad('Employee not found', 404);
      const year = fy ?? fyOf(istToday());
      const from = `${year.slice(0, 4)}-04-01`;
      const to = `${String(Number(year.slice(0, 4)) + 1)}-03-01`;
      const e = (
        await c.query<{
          code: string;
          name: string;
          designation: string | null;
          left_on: string | null;
          status: string;
        }>(
          `SELECT employee_code AS code, display_name AS name, designation, left_on::text, status::text FROM employees WHERE id = $1`,
          [eid],
        )
      ).rows[0];
      if (!e) bad('Employee not found', 404);
      const recs = (
        await c.query<{
          month: string;
          top: boolean;
          gross: string;
          ded: string;
          net: string;
          tds: string;
        }>(
          `SELECT to_char(r.month, 'YYYY-MM') AS month, r.is_top_up AS top, r.gross_earned::text AS gross, r.total_deductions::text AS ded,
                  r.net_pay::text AS net, (r.it_amount + r.cess_amount)::text AS tds
             FROM payroll_records r JOIN payroll_runs u ON u.id = r.run_id
            WHERE r.employee_id = $1 AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL AND r.status <> 'FAILED'
              AND r.month BETWEEN $2::date AND $3::date
            ORDER BY r.month, r.is_top_up, r.id`,
          [eid, from, to],
        )
      ).rows;
      if (!recs.length) bad(`No month of ${year} is paid and locked yet`, 409);
      const sum = (k: 'gross' | 'ded' | 'net' | 'tds') =>
        recs.reduce((t, r) => t + Number(r[k]), 0);
      const rows: Array<Array<string>> = recs.map((r) => [
        `${monthWords(r.month)}${r.top ? ' (additional)' : ''}`,
        money(r.gross),
        money(r.ded),
        money(r.tds),
        money(r.net),
      ]);
      rows.push([
        'Total',
        money(sum('gross')),
        money(sum('ded')),
        money(sum('tds')),
        money(sum('net')),
      ]);
      const me = await this.me(c);
      const { head, logo } = await this.head(c);
      const pdf = await paper({
        school: head.school,
        address: head.address,
        title: `Salary certificate · ${year}`,
        letterhead: { logo, details: `Generated on ${registerGeneratedOn()}` },
        subtitle: [
          `This is to certify that ${e!.name} (${e!.code})${e!.designation ? `, ${e!.designation},` : ''} ${
            e!.status === 'active' && !e!.left_on ? 'is employed with' : 'was employed with'
          } this school and has drawn the salary below in the financial year ${year}, as paid through its payroll.`,
          `Net salary of the year: ${words(sum('net').toFixed(2))}.`,
        ],
        subtitleFirstOnly: true,
        portrait: true,
        columns: [
          { label: 'Month', width: 0.28 },
          { label: 'Gross (Rs.)', width: 0.18, right: true },
          { label: 'Deductions (Rs.)', width: 0.18, right: true },
          { label: 'of which tax (Rs.)', width: 0.18, right: true },
          { label: 'Net (Rs.)', width: 0.18, right: true },
        ],
        rows,
        strong: [rows.length - 1],
        rowCount: recs.length,
        footnote:
          'Issued on request. The months paid and locked; a month paid twice (an additional run) shows on two lines.',
        signs: employeeId
          ? [
              await this.sign(
                c,
                'Authorised signatory',
                { userId: me?.id ?? null, name: me?.name ?? null, at: new Date() },
                'Issued on',
              ),
              blankBox('Principal'),
            ]
          : [blankBox('Authorised signatory'), blankBox('Principal')],
      });
      return file(`Salary_certificate_${e!.code}_${year}.pdf`, pdf);
    });
  }

  // ---- a loan's statement or its no-dues certificate --------------------------------------------------------------
  async loanStatement(ctx: RequestContext, loanId: string, kind: 'statement' | 'noc') {
    must(ctx, RUN.view, 'Only payroll staff print a loan statement');
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const l = (
        await c.query<{
          employee_id: string;
          code: string;
          name: string;
          designation: string | null;
          department: string | null;
          loan_type: string;
          principal: string;
          emi: string;
          interest_method: string;
          interest_rate: string | null;
          balance: string;
          start_month: string;
          status: string;
          remarks: string | null;
        }>(
          `SELECT l.employee_id::text, e.employee_code AS code, e.display_name AS name, e.designation, e.department, l.loan_type,
                  l.principal::text, l.emi::text, l.interest_method, l.interest_rate::text, l.balance::text,
                  to_char(l.start_month, 'YYYY-MM') AS start_month, l.status, l.remarks
             FROM payroll_loans l JOIN employees e ON e.id = l.employee_id WHERE l.id = $1`,
          [loanId],
        )
      ).rows[0];
      if (!l || (await hiddenFor(c, ctx)).includes(l.employee_id)) bad('Loan not found', 404);
      if (kind === 'noc' && (l!.status !== 'CLOSED' || Number(l!.balance) > 0))
        bad(
          `The loan is ${l!.status.toLowerCase()} with Rs. ${money(l!.balance)} owed: no certificate yet`,
          409,
        );
      const paid = (
        await c.query<{ month: string; amount: string }>(
          `SELECT to_char(r.month, 'YYYY-MM') AS month, sum(x.amount)::text AS amount
             FROM payroll_record_lines x JOIN payroll_records r ON r.id = x.record_id JOIN payroll_runs u ON u.id = r.run_id
            WHERE x.source_kind = 'loan' AND x.source_id = $1 AND u.stage IN ('LOCKED', 'PAID') AND u.deleted_at IS NULL
              AND r.status <> 'FAILED'
            GROUP BY r.month ORDER BY r.month`,
          [loanId],
        )
      ).rows;
      // what closed it outside the instalments: a settlement, a transfer, a foreclosure (the loan's own remarks)
      const closing = (l!.remarks ?? '')
        .split('\n')
        .filter((x) => x.startsWith('CLOSED'))
        .map((x) => x.replace(/^CLOSED:\s*/, ''));
      let left = Number(l!.principal);
      const rows: Array<Array<string>> = paid.map((p, i) => {
        left = Math.max(0, left - Number(p.amount));
        return [String(i + 1), monthWords(p.month), money(p.amount), money(left)];
      });
      const recovered = paid.reduce((t, p) => t + Number(p.amount), 0);
      rows.push(['', 'Recovered through salary', money(recovered), '']);
      const me = await this.me(c);
      const { head, logo } = await this.head(c);
      const pdf = await paper({
        school: head.school,
        address: head.address,
        title: kind === 'noc' ? 'No-dues certificate: loan' : 'Loan statement',
        letterhead: { logo, details: `Generated on ${registerGeneratedOn()}` },
        subtitle: [
          `${l!.name} (${l!.code}) · ${l!.designation ?? ''}${l!.department ? ` · ${l!.department}` : ''}`,
          `${l!.loan_type}: Rs. ${money(l!.principal)} from ${monthWords(l!.start_month)}, Rs. ${money(l!.emi)} a month, interest ${
            l!.interest_method === 'NONE'
              ? 'none'
              : `${l!.interest_method.toLowerCase()} at ${Number(l!.interest_rate ?? 0).toString()} %`
          } · ${l!.status.toLowerCase()} · owed now Rs. ${money(l!.balance)}`,
          ...(kind === 'noc'
            ? [
                `This is to certify that the loan above has been repaid in full and that nothing remains owed on it${
                  closing.length ? ` (closed: ${closing.join('; ')})` : ''
                }.`,
              ]
            : closing.length
              ? [`Closed: ${closing.join('; ')}.`]
              : []),
        ],
        subtitleFirstOnly: true,
        portrait: true,
        wrap: true,
        columns: [
          { label: '#', width: 0.1 },
          { label: 'Month', width: 0.4 },
          { label: 'Deducted (Rs.)', width: 0.25, right: true },
          { label: 'Owed after (Rs.)', width: 0.25, right: true },
        ],
        rows,
        strong: [rows.length - 1],
        rowCount: paid.length,
        signs: [
          await this.sign(
            c,
            kind === 'noc' ? 'Authorised signatory' : 'Accounts',
            { userId: me?.id ?? null, name: me?.name ?? null, at: new Date() },
            'Printed on',
          ),
          blankBox(kind === 'noc' ? 'Principal' : 'Employee'),
        ],
      });
      return file(
        `${kind === 'noc' ? 'Loan_NOC' : 'Loan_statement'}_${l!.code}_${loanId}.pdf`,
        pdf,
      );
    });
  }
}
