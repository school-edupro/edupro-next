import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { libraryFile } from '../library/library-file';
import { WorkflowService } from '../workflow/workflow.service';
import { GST_STATES, GSTIN_HELP, gstinProblem } from './gstin';
import { syncFlow, type PurchaseDocType } from './purchase-flow';
import { PurchaseVendorsService } from './purchase-vendors.service';
import { pinProblem, resolvePlace } from './vendor-rules';
import {
  PaymentTermSchema,
  type CommitteeMemberDto,
  type CopyFromDto,
  type DepartmentLevelsDto,
  type DepartmentRulesDto,
  type PaymentTermDto,
  type SettingsDto,
  type TermListQueryDto,
  type VendorImportDto,
} from './purchase.dto';

const DOCS = ['indent', 'requisition', 'order', 'inspection'] as const;

/** The payment terms Excel: one row per term, up to four instalments across (docs/design/83). */
const TERM_GROUPS = 4;
const TERM_LINE = (n: number) =>
  [
    `Instalment ${String(n)} %`,
    `Instalment ${String(n)} due`,
    `Instalment ${String(n)} days`,
  ] as const;
const DUE_WORDS = {
  advance: 'Has an advance',
  delivery: 'After delivery',
  invoice: 'After the invoice',
};
type TermRow = Awaited<ReturnType<PurchaseSetupService['terms']>>[number];
type Doc = (typeof DOCS)[number];

interface TermLine {
  pct: string;
  due_on: 'advance' | 'delivery' | 'invoice';
  days: number;
}

/** "50% in advance, 50% 15 days after delivery" — the words of a term's instalments. */
export const instalmentWords = (
  lines: Array<{ pct: string | number; dueOn: string; days: number }>,
) =>
  lines
    .map(
      (l) =>
        `${String(Number(l.pct))}% ${
          l.dueOn === 'advance'
            ? 'in advance'
            : l.dueOn === 'delivery'
              ? l.days
                ? `${String(l.days)} days after delivery`
                : 'on delivery'
              : l.days
                ? `${String(l.days)} days after the invoice`
                : 'on the invoice'
        }`,
    )
    .join(', ');

/**
 * The purchase set-up besides the grid masters (docs/design/83, part 1): payment terms in instalments,
 * the settings (GSTIN, numbering, sourcing tiers, emergency purchase, PO terms), the purchase committee,
 * who approves each department's PIs, PRs and POs and the department's bypass rules, copying masters
 * from another school of the group, and an overview of what is set.
 */
@Injectable()
export class PurchaseSetupService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
  ) {}

  // ---- overview -----------------------------------------------------------------------------------
  async overview(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const n = await c.query<Record<string, number>>(
        `SELECT
           (SELECT count(*)::int FROM purchase_uoms WHERE status = 'active') AS uoms,
           (SELECT count(*)::int FROM purchase_hsn WHERE status = 'active') AS hsn,
           (SELECT count(*)::int FROM purchase_item_categories WHERE status = 'active' AND parent_id IS NULL) AS categories,
           (SELECT count(*)::int FROM purchase_items WHERE status = 'active') AS items,
           (SELECT count(*)::int FROM purchase_payment_terms WHERE status = 'active') AS payment_terms,
           (SELECT count(*)::int FROM vendors WHERE status = 'active') AS vendors,
           (SELECT count(*)::int FROM vendors WHERE status = 'pending') AS vendors_pending,
           (SELECT count(*)::int FROM vendor_changes WHERE status = 'pending') AS changes_pending,
           (SELECT count(*)::int FROM vendors WHERE status = 'blacklisted') AS blacklisted,
           (SELECT count(*)::int FROM purchase_rate_contracts WHERE status = 'active' AND CURRENT_DATE BETWEEN valid_from AND valid_to) AS rate_contracts,
           (SELECT count(*)::int FROM departments WHERE status = 'active') AS departments,
           (SELECT count(DISTINCT department_id)::int FROM purchase_department_approvals WHERE jsonb_array_length(levels) > 0) AS departments_set,
           (SELECT count(*)::int FROM purchase_committee_members) AS committee,
           (SELECT (gstin IS NOT NULL)::int FROM purchase_settings) AS gstin_set`,
      );
      const x = n.rows[0]!;
      return {
        uoms: x.uoms,
        hsn: x.hsn,
        categories: x.categories,
        items: x.items,
        paymentTerms: x.payment_terms,
        vendors: x.vendors,
        vendorsPending: x.vendors_pending,
        changesPending: x.changes_pending,
        blacklisted: x.blacklisted,
        rateContracts: x.rate_contracts,
        departments: x.departments,
        departmentsSet: x.departments_set,
        committee: x.committee,
        gstinSet: x.gstin_set === 1,
      };
    });
  }

  // ---- payment terms ------------------------------------------------------------------------------
  private async terms(c: PoolClient, id?: string) {
    const r = await c.query<{
      id: string;
      code: string;
      name: string;
      print_text: string | null;
      is_default: boolean;
      status: string;
      lines: TermLine[] | null;
      vendors: number;
    }>(
      `SELECT t.id::text, t.code, t.name, t.print_text, t.is_default, t.status::text,
              (SELECT json_agg(json_build_object('pct', l.pct, 'due_on', l.due_on, 'days', l.days) ORDER BY l.seq)
                 FROM purchase_payment_term_lines l WHERE l.term_id = t.id) AS lines,
              (SELECT count(*)::int FROM vendors v WHERE v.payment_term_id = t.id) AS vendors
         FROM purchase_payment_terms t WHERE ($1::bigint IS NULL OR t.id = $1::bigint) ORDER BY t.is_default DESC, t.code`,
      [id ?? null],
    );
    return r.rows.map((t) => {
      const lines = (t.lines ?? []).map((l) => ({
        pct: Number(l.pct),
        dueOn: l.due_on,
        days: l.days,
      }));
      return {
        id: t.id,
        code: t.code,
        name: t.name,
        printText: t.print_text,
        isDefault: t.is_default,
        status: t.status,
        lines,
        words: t.print_text || instalmentWords(lines),
        /** the longest wait in days (a micro or small vendor must be paid within 45: part 4 warns) */
        longestDays: lines.reduce((m, l) => (l.dueOn === 'advance' ? m : Math.max(m, l.days)), 0),
        vendors: t.vendors,
      };
    });
  }

  /** The terms the filters keep: code or name, status, how a term pays, longer than 45 days. */
  private static keep(list: TermRow[], q: TermListQueryDto) {
    const s = q.q?.toLowerCase();
    return list.filter(
      (t) =>
        (!s || t.code.toLowerCase().includes(s) || t.name.toLowerCase().includes(s)) &&
        (!q.status || t.status === q.status) &&
        (!q.kind || t.lines.some((l) => l.dueOn === q.kind)) &&
        (!q.over45 || t.longestDays > 45),
    );
  }

  /** The filters in words (the file's heading). */
  private static filterWords(q: TermListQueryDto) {
    return (
      [
        q.q ? `Search: ${q.q}` : '',
        q.status === 'active' ? 'Active' : q.status === 'inactive' ? 'Inactive' : '',
        q.kind ? DUE_WORDS[q.kind] : '',
        q.over45 ? 'Longer than 45 days' : '',
      ]
        .filter(Boolean)
        .join(' · ') || 'All payment terms'
    );
  }

  async listTerms(ctx: RequestContext, q: TermListQueryDto = {}) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const all = await this.terms(c);
      return { data: PurchaseSetupService.keep(all, q), total: all.length };
    });
  }

  /** The list as on screen, filters kept, as Excel or PDF. */
  async termsFile(ctx: RequestContext, q: TermListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const list = PurchaseSetupService.keep(await this.terms(c), q);
      const who = (
        await c.query<{ name: string; by: string }>(
          `SELECT (SELECT name FROM schools WHERE id = app.current_school_id()) AS name,
                  COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1),
                           u.display_name) AS by
             FROM users u WHERE u.id = app.current_user_id()`,
        )
      ).rows[0]!;
      return libraryFile({
        format: q.format ?? 'xlsx',
        name: 'Payment terms',
        slug: 'Purchase-payment-terms',
        school: who.name,
        by: who.by,
        words: PurchaseSetupService.filterWords(q),
        columns: [
          { label: 'Code' },
          { label: 'Payment term', width: 2 },
          { label: 'Instalments', width: 3 },
          { label: 'Instalments (no.)', type: 'number' },
          { label: 'Longest wait (days)', type: 'number' },
          { label: 'Default' },
          { label: 'Status' },
          { label: 'Vendors', type: 'number' },
        ],
        rows: list.map((t) => [
          t.code,
          t.name,
          t.words,
          t.lines.length,
          t.longestDays,
          t.isDefault ? 'Yes' : '',
          t.status === 'active' ? 'Active' : 'Inactive',
          t.vendors,
        ]),
      });
    });
  }

  /**
   * The Excel format: one row per term (code, name, print text, default, status, then up to four
   * instalments: %, due on, days), filled with the school's terms so they can be corrected and loaded
   * again; drop-downs for the choices and a How to fill sheet.
   */
  async termsTemplate(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const list = (await this.terms(c)).filter((t) => t.lines.length <= TERM_GROUPS);
      const cells = (t: TermRow) => [
        t.code,
        t.name,
        t.printText ?? '',
        t.isDefault ? 'yes' : 'no',
        t.status,
        ...Array.from({ length: TERM_GROUPS }, (_, i) => {
          const l = t.lines[i];
          return l ? [l.pct, l.dueOn, l.dueOn === 'advance' ? '' : l.days] : ['', '', ''];
        }).flat(),
      ];
      const bytes = await templateSheet({
        sheet: 'Payment terms',
        columns: [
          {
            header: 'Code',
            width: 12,
            required: true,
            format: 'text',
            note: 'Capital letters and digits, up to 20; an existing code updates that term',
          },
          { header: 'Payment term', width: 30, required: true },
          {
            header: 'Print text',
            width: 34,
            note: 'Printed on the PO; empty: made from the instalments',
          },
          {
            header: 'Default',
            width: 9,
            options: ['yes', 'no'],
            note: "One term is the school's default (a vendor without its own term pays by it)",
          },
          { header: 'Status', width: 10, options: ['active', 'inactive'] },
          ...Array.from({ length: TERM_GROUPS }, (_, i) => [
            {
              header: TERM_LINE(i + 1)[0],
              width: 9,
              format: 'number' as const,
              required: i === 0,
              note: 'The share of the PO value; the instalments add up to 100',
            },
            {
              header: TERM_LINE(i + 1)[1],
              width: 11,
              options: ['advance', 'delivery', 'invoice'],
              required: i === 0,
              note: 'advance: with the order; delivery: after the goods come; invoice: after the bill',
            },
            {
              header: TERM_LINE(i + 1)[2],
              width: 9,
              format: 'number' as const,
              note: 'Days after the delivery or the invoice (0 to 365); empty for an advance',
            },
          ]).flat(),
        ],
        guide: [
          'One row per payment term, with up to four instalments across; the instalments add up to 100%.',
          'Each instalment: its %, when it is due (advance, delivery or invoice) and, after a delivery or an invoice, the days.',
          'A code already there updates that term (name, print text, default, status, instalments); purchase orders already made keep the terms they printed.',
          "Default: yes makes the row the school's default (only one row may say yes); empty keeps a term as it is.",
          'Status empty: active (or as it is for a term already there).',
          'A term with more than four instalments is changed on the screen, not here.',
          'Check the file first: every row is checked and the problems listed; then import the good rows.',
        ],
        rows: list.map(cells),
        examples: [
          [
            'NET30',
            'Within 30 days of the invoice',
            '',
            'no',
            'active',
            100,
            'invoice',
            30,
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
            '',
          ],
          [
            'ADV50',
            'Half in advance',
            'Half with the order, half 15 days after delivery',
            'no',
            'active',
            50,
            'advance',
            '',
            50,
            'delivery',
            15,
            '',
            '',
            '',
            '',
            '',
            '',
          ],
        ],
      });
      return {
        filename: 'payment-terms-format.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  /**
   * Payment terms from Excel: every row checked first (dry run), then the good rows saved; a code
   * already there updates its term. A row is saved whole or not at all.
   */
  async importTerms(ctx: RequestContext, dto: VendorImportDto) {
    const lineHeads = Array.from({ length: TERM_GROUPS }, (_, i) => [...TERM_LINE(i + 1)]).flat();
    const rows = await readSheet(
      dto.file,
      ['Code', 'Payment term', TERM_LINE(1)[0], TERM_LINE(1)[1]],
      [
        'Print text',
        'Default',
        'Status',
        ...lineHeads.filter((h) => !h.startsWith('Instalment 1 ') || h.endsWith('days')),
      ],
    );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const existing = new Map((await this.terms(c)).map((t) => [t.code, t]));
      const seen = new Set<string>();
      let defaultRow: number | null = null;
      const results: Array<{
        row: number;
        code: string;
        ok: boolean;
        action?: 'new' | 'update';
        error?: string;
      }> = [];
      let saved = 0;
      for (const { row, cells } of rows) {
        const code = (cells['Code'] ?? '').trim().toUpperCase();
        await c.query('SAVEPOINT term_row');
        try {
          const problems: string[] = [];
          const lines: Array<{ pct: number; dueOn: string; days: number }> = [];
          for (let n = 1; n <= TERM_GROUPS; n += 1) {
            const [hp, hd, hy] = TERM_LINE(n);
            const pct = (cells[hp] ?? '').trim();
            const due = (cells[hd] ?? '').trim().toLowerCase();
            const days = (cells[hy] ?? '').trim();
            if (!pct && !due && !days) continue;
            if (!pct || !Number.isFinite(Number(pct)) || Number(pct) <= 0 || Number(pct) > 100)
              problems.push(`${hp}: a share above 0 and up to 100`);
            if (!['advance', 'delivery', 'invoice'].includes(due))
              problems.push(`${hd}: advance, delivery or invoice`);
            if (days && (!/^[0-9]{1,3}$/.test(days) || Number(days) > 365))
              problems.push(`${hy}: whole days from 0 to 365`);
            if (due === 'advance' && days && Number(days) !== 0)
              problems.push(`${hy}: an advance has no days`);
            lines.push({ pct: Number(pct), dueOn: due, days: days ? Number(days) : 0 });
          }
          if (!lines.length) problems.push(`${TERM_LINE(1)[0]}: at least one instalment`);
          const before = existing.get(code);
          const flag = (cells['Default'] ?? '').trim().toLowerCase();
          if (flag && !['yes', 'no'].includes(flag)) problems.push('Default: yes or no');
          const isDefault = flag ? flag === 'yes' : (before?.isDefault ?? false);
          const status =
            (cells['Status'] ?? '').trim().toLowerCase() || (before?.status ?? 'active');
          if (!['active', 'inactive'].includes(status)) problems.push('Status: active or inactive');
          const parsed = PaymentTermSchema.safeParse({
            code,
            name: cells['Payment term'],
            printText: cells['Print text'],
            isDefault,
            status,
            lines,
          });
          if (!parsed.success)
            for (const i of parsed.error.issues) {
              const f = String(i.path[0] ?? '');
              if (f === 'lines') continue; // said above, by column
              problems.push(
                `${f === 'name' ? 'Payment term' : f === 'code' ? 'Code' : f === 'printText' ? 'Print text' : f}: ${i.message}`,
              );
            }
          const total = Math.round(
            lines.reduce((a, l) => a + (Number.isFinite(l.pct) ? l.pct : 0), 0) * 100,
          );
          if (lines.length && total !== 10000)
            problems.push(
              `The instalments add up to ${String(total / 100)}%: they must add up to 100%`,
            );
          if (code && seen.has(code)) problems.push('Code: twice in the file');
          if (before && before.lines.length > TERM_GROUPS)
            problems.push(
              `Code: ${code} has more than ${String(TERM_GROUPS)} instalments; change it on the screen`,
            );
          if (isDefault && flag === 'yes') {
            if (defaultRow !== null)
              problems.push(`Default: row ${String(defaultRow)} is the default already`);
          }
          if (before?.isDefault && flag === 'no' && defaultRow === null)
            problems.push(
              'Default: this is the default term; mark another row yes (above it) or change it on the screen',
            );
          if (problems.length || !parsed.success)
            throw new Error(problems.join('; ') || 'Not a payment term');
          seen.add(code);
          if (isDefault && flag === 'yes') defaultRow = row;
          if (!dto.dryRun) {
            await this.saveTermIn(c, ctx, before?.id ?? null, parsed.data);
            saved += 1;
          }
          await c.query('RELEASE SAVEPOINT term_row');
          results.push({ row, code, ok: true, action: before ? 'update' : 'new' });
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT term_row');
          results.push({ row, code, ok: false, error: e instanceof Error ? e.message : String(e) });
        }
      }
      if (!dto.dryRun && saved)
        await this.audit.stage(ctx, c, {
          action: 'purchase.payment_term.import',
          entityType: 'purchase_payment_terms',
          after: { saved, rows: rows.length },
        });
      return {
        dryRun: dto.dryRun,
        rows: results.length,
        good: results.filter((r) => r.ok).length,
        saved,
        results,
      };
    });
  }

  /**
   * Who may approve a vendor (or a change of its bank account, GSTIN or PAN): the roles holding the
   * right and the people holding those roles in this school now (Purchase → Settings shows them).
   */
  async vendorApprovers(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const roles = await c.query<{ code: string; name: string }>(
        `SELECT DISTINCT r.code, r.name FROM roles r JOIN role_permissions rp ON rp.role_id = r.id
          WHERE rp.permission_code = 'purchase.vendor.approve'
            AND (r.school_id IS NULL OR r.school_id = app.current_school_id())
          ORDER BY r.name`,
      );
      const people = await c.query<{ name: string; roles: string }>(
        `SELECT COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1),
                         u.display_name) AS name,
                string_agg(DISTINCT r.name, ', ' ORDER BY r.name) AS roles
           FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
           JOIN role_permissions rp ON rp.role_id = r.id AND rp.permission_code = 'purchase.vendor.approve'
          WHERE ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL AND ur.valid_from <= CURRENT_DATE
            AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
          GROUP BY u.id ORDER BY 1`,
      );
      const named = await c.query<{
        id: string;
        employee_id: string;
        code: string;
        name: string;
        designation: string | null;
        signs_in: boolean;
      }>(
        `SELECT a.id::text, a.employee_id::text, e.employee_code AS code, e.display_name AS name, e.designation,
                (e.user_id IS NOT NULL AND e.status = 'active' AND e.deleted_at IS NULL) AS signs_in
           FROM purchase_vendor_approvers a JOIN employees e ON e.id = a.employee_id ORDER BY e.display_name`,
      );
      return {
        // named: the people below approve; role: the right decides (nobody named yet)
        mode: named.rows.length ? ('named' as const) : ('role' as const),
        named: named.rows.map((x) => ({
          id: x.id,
          employeeId: x.employee_id,
          code: x.code,
          name: x.name,
          designation: x.designation,
          signsIn: x.signs_in,
        })),
        roles: roles.rows,
        people: people.rows,
      };
    });
  }

  /** Names an employee who signs in as a vendor approver (then only the named ones approve). */
  async addVendorApprover(ctx: RequestContext, employeeId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await c.query<{ user_id: string | null }>(
        `SELECT user_id::text FROM employees WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
        [employeeId],
      );
      if (!e.rows[0])
        throw new DomainError('validation-failed', 'Pick an active employee', { status: 400 });
      if (!e.rows[0].user_id)
        throw new DomainError(
          'validation-failed',
          'This employee does not sign in: give them a login first (Access → Users)',
          { status: 400 },
        );
      await c.query(
        `INSERT INTO purchase_vendor_approvers (school_id, employee_id, created_by)
         VALUES (app.current_school_id(), $1, app.current_user_id()) ON CONFLICT (school_id, employee_id) DO NOTHING`,
        [employeeId],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.vendor_approver.add',
        entityType: 'purchase_vendor_approvers',
        entityId: employeeId,
      });
      return { added: true };
    });
  }

  async removeVendorApprover(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(`DELETE FROM purchase_vendor_approvers WHERE id = $1`, [id]);
      if (!r.rowCount) throw new DomainError('not-found', 'Approver not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'purchase.vendor_approver.remove',
        entityType: 'purchase_vendor_approvers',
        entityId: id,
      });
      return { removed: true };
    });
  }

  async saveTerm(ctx: RequestContext, id: string | null, dto: PaymentTermDto) {
    return this.db.tenant(requireTenant(ctx), (c) => this.saveTermIn(c, ctx, id, dto));
  }

  /** A term saved inside the caller's transaction (the screen, or a row of an Excel import). */
  private async saveTermIn(
    c: PoolClient,
    ctx: RequestContext,
    id: string | null,
    dto: PaymentTermDto,
  ) {
    const total = dto.lines.reduce((s, l) => s + Math.round(l.pct * 100), 0);
    if (total !== 10000)
      throw new DomainError(
        'validation-failed',
        `The instalments add up to ${String(total / 100)}%: they must add up to 100%`,
        { status: 400 },
      );
    {
      const clash = await c.query(
        `SELECT 1 FROM purchase_payment_terms WHERE code = $1 AND ($2::bigint IS NULL OR id <> $2::bigint)`,
        [dto.code, id],
      );
      if (clash.rowCount)
        throw new DomainError('conflict', `Payment term ${dto.code} exists`, { status: 409 });
      if (dto.isDefault)
        await c.query(`UPDATE purchase_payment_terms SET is_default = false WHERE is_default`);
      let termId = id;
      if (termId) {
        const r = await c.query(
          `UPDATE purchase_payment_terms SET code = $2, name = $3, print_text = $4, is_default = $5, status = $6::row_status, updated_at = now()
            WHERE id = $1`,
          [termId, dto.code, dto.name, dto.printText ?? null, dto.isDefault, dto.status],
        );
        if (!r.rowCount)
          throw new DomainError('not-found', 'Payment term not found', { status: 404 });
        await c.query(`DELETE FROM purchase_payment_term_lines WHERE term_id = $1`, [termId]);
      } else {
        const r = await c.query<{ id: string }>(
          `INSERT INTO purchase_payment_terms (school_id, code, name, print_text, is_default, status)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5::row_status) RETURNING id::text`,
          [dto.code, dto.name, dto.printText ?? null, dto.isDefault, dto.status],
        );
        termId = r.rows[0]!.id;
      }
      for (const [i, l] of dto.lines.entries())
        await c.query(
          `INSERT INTO purchase_payment_term_lines (school_id, term_id, seq, pct, due_on, days)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5)`,
          [termId, i + 1, l.pct, l.dueOn, l.dueOn === 'advance' ? 0 : l.days],
        );
      await this.audit.stage(ctx, c, {
        action: id ? 'purchase.payment_term.update' : 'purchase.payment_term.create',
        entityType: 'purchase_payment_terms',
        entityId: termId,
        after: { code: dto.code, lines: dto.lines },
      });
      return (await this.terms(c, termId))[0]!;
    }
  }

  /**
   * Passes the level a purchase document waits at for its approvers (an approver away), with the
   * reason: the right to pass a level; only purchase approvals; never on what the caller raised (the
   * engine refuses). The document moves on as when the level is approved.
   */
  async passStep(ctx: RequestContext, stepId: string, reason: string) {
    const ok = await this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `SELECT 1 FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
          WHERE s.id = $1 AND i.entity_type LIKE 'purchase%'`,
        [stepId],
      );
      return (r.rowCount ?? 0) > 0;
    });
    if (!ok)
      throw new DomainError('not-found', 'No purchase approval step like that', { status: 404 });
    return this.workflow.passLevel(ctx, stepId, reason);
  }

  // ---- settings -----------------------------------------------------------------------------------
  async settings(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const s = await c.query<{
        gstin: string | null;
        state_code: string | null;
        billing_address: string | null;
        delivery_address: string | null;
        billing_line: string | null;
        billing_country: string | null;
        billing_state: string | null;
        billing_city: string | null;
        billing_pin: string | null;
        delivery_same: boolean;
        delivery_line: string | null;
        delivery_country: string | null;
        delivery_state: string | null;
        delivery_city: string | null;
        delivery_pin: string | null;
        pi_prefix: string;
        pr_prefix: string;
        po_prefix: string;
        direct_limit: string;
        committee_limit: string;
        committee_quotes: number;
        committee_signatures: number | null;
        emergency_enabled: boolean;
        emergency_ratifier: string;
        stock_gst_in_cost: boolean;
        receipt_tolerance_pct: string;
        po_terms: string | null;
        po_validity_days: number;
        purchase_department_id: string | null;
        po_signatures: string[];
        large_po_alert: string | null;
        split_window_days: number;
        direct_pr_limit: string;
        bill_to_name: string | null;
        bill_contact_name: string | null;
        bill_contact_phone: string | null;
        ship_to_name: string | null;
        ship_contact_name: string | null;
        ship_contact_phone: string | null;
        office_email: string | null;
        updated_at: Date;
      }>(`SELECT *, purchase_department_id::text FROM purchase_settings`);
      const x = s.rows[0]!;
      const committee = await c.query<{
        id: string;
        employee_id: string;
        code: string;
        name: string;
        designation: string | null;
        role: string | null;
      }>(
        `SELECT m.id::text, m.employee_id::text, e.employee_code AS code, e.display_name AS name, e.designation, m.role
           FROM purchase_committee_members m JOIN employees e ON e.id = m.employee_id ORDER BY e.display_name`,
      );
      return {
        gstin: x.gstin,
        stateCode: x.state_code,
        state: x.state_code ? (GST_STATES[x.state_code] ?? null) : null,
        billingAddress: x.billing_address,
        deliveryAddress: x.delivery_address,
        billingLine: x.billing_line,
        billingCountry: x.billing_country,
        billingState: x.billing_state,
        billingCity: x.billing_city,
        billingPin: x.billing_pin,
        deliverySame: x.delivery_same,
        deliveryLine: x.delivery_line,
        deliveryCountry: x.delivery_country,
        deliveryState: x.delivery_state,
        deliveryCity: x.delivery_city,
        deliveryPin: x.delivery_pin,
        piPrefix: x.pi_prefix,
        prPrefix: x.pr_prefix,
        poPrefix: x.po_prefix,
        directLimit: Number(x.direct_limit),
        committeeLimit: Number(x.committee_limit),
        committeeQuotes: x.committee_quotes,
        committeeSignatures: x.committee_signatures,
        emergencyEnabled: x.emergency_enabled,
        emergencyRatifier: x.emergency_ratifier,
        stockGstInCost: x.stock_gst_in_cost,
        receiptTolerancePct: Number(x.receipt_tolerance_pct),
        poTerms: x.po_terms,
        poValidityDays: x.po_validity_days,
        purchaseDepartmentId: x.purchase_department_id,
        poSignatures: x.po_signatures,
        largePoAlert: x.large_po_alert === null ? null : Number(x.large_po_alert),
        splitWindowDays: x.split_window_days,
        directPrLimit: Number(x.direct_pr_limit),
        billToName: x.bill_to_name,
        billContactName: x.bill_contact_name,
        billContactPhone: x.bill_contact_phone,
        shipToName: x.ship_to_name,
        shipContactName: x.ship_contact_name,
        shipContactPhone: x.ship_contact_phone,
        officeEmail: x.office_email,
        updatedAt: x.updated_at.toISOString(),
        committee: committee.rows.map((m) => ({
          id: m.id,
          employeeId: m.employee_id,
          code: m.code,
          name: m.name,
          designation: m.designation,
          role: m.role,
        })),
      };
    });
  }

  /**
   * Saves the settings, every field checked and each problem named by its field (the form shows it
   * under the box): the GSTIN; the billing address and, unless it is the same, the delivery address
   * (a line, country → state → city from the school's masters, the PIN), the billing state the GSTIN's;
   * a prefix per document; the committee's signatures no more than its members; an active department.
   * Without a GSTIN the billing state is the school's GST state (CGST + SGST or IGST on a PO).
   */
  async saveSettings(ctx: RequestContext, dto: SettingsDto) {
    if (dto.gstin) {
      const problem = gstinProblem(dto.gstin);
      if (problem) {
        const message = `GSTIN ${dto.gstin}: ${GSTIN_HELP[problem]}`;
        throw new DomainError('purchase.gstin_invalid', message, {
          status: 400,
          extra: { errors: [{ path: 'gstin', message }] },
        });
      }
    }
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const errors: Array<{ path: string; message: string }> = [];
      const fail = (path: string, message: string) => {
        if (!errors.some((e) => e.path === path)) errors.push({ path, message });
      };
      const gstState = dto.gstin ? dto.gstin.slice(0, 2) : null;
      const address = async (
        prefix: 'billing' | 'delivery',
        a: { line?: string; country?: string; state?: string; city?: string; pin?: string },
      ) => {
        if (!a.line || a.line.trim().length < 5)
          fail(`${prefix}Line`, `The ${prefix} address is required (at least 5 characters)`);
        if (!a.country) fail(`${prefix}Country`, 'Pick the country');
        if (!a.state) fail(`${prefix}State`, 'Pick the state');
        if (!a.city) fail(`${prefix}City`, 'Pick the city');
        const place = await resolvePlace(
          c,
          { country: a.country ?? null, state: a.state ?? null, city: a.city ?? null },
          fail,
          { country: `${prefix}Country`, state: `${prefix}State`, city: `${prefix}City` },
        );
        const pin = a.pin ? a.pin.trim().toUpperCase() : null;
        if (!pin) fail(`${prefix}Pin`, 'The PIN is required');
        else {
          const problem = pinProblem(pin, place.india);
          if (problem) fail(`${prefix}Pin`, problem);
        }
        const line = a.line?.trim() ?? null;
        return {
          line,
          country: place.country?.name ?? null,
          state: place.state?.name ?? null,
          gst: place.india ? (place.state?.gst ?? null) : null,
          city: place.city?.name ?? null,
          pin,
          // the whole address as printed on the PO
          text: [
            line,
            [place.city?.name, pin].filter(Boolean).join(' '),
            place.state?.name,
            place.country?.name,
          ]
            .filter(Boolean)
            .join(', '),
        };
      };
      const billing = await address('billing', {
        line: dto.billingLine,
        country: dto.billingCountry,
        state: dto.billingState,
        city: dto.billingCity,
        pin: dto.billingPin,
      });
      if (gstState && billing.gst && billing.gst !== gstState)
        fail(
          'billingState',
          `The school's GSTIN is of ${GST_STATES[gstState] ?? gstState}: the billing address is in that state`,
        );
      const delivery = dto.deliverySame
        ? billing
        : await address('delivery', {
            line: dto.deliveryLine,
            country: dto.deliveryCountry,
            state: dto.deliveryState,
            city: dto.deliveryCity,
            pin: dto.deliveryPin,
          });
      const prefixes: Array<[string, string]> = [
        ['piPrefix', dto.piPrefix],
        ['prPrefix', dto.prPrefix],
        ['poPrefix', dto.poPrefix],
      ];
      prefixes.forEach(([k, v], i) => {
        if (prefixes.slice(0, i).some(([, w]) => w === v))
          fail(k, 'Each document needs its own prefix');
      });
      if (dto.committeeSignatures !== null) {
        const n = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM purchase_committee_members`,
        );
        if (dto.committeeSignatures > n.rows[0]!.n)
          fail(
            'committeeSignatures',
            `The committee has ${String(n.rows[0]!.n)} members: it cannot need ${String(dto.committeeSignatures)} signatures`,
          );
      }
      if (dto.purchaseDepartmentId) {
        const d = await c.query(`SELECT 1 FROM departments WHERE id = $1 AND status = 'active'`, [
          dto.purchaseDepartmentId,
        ]);
        if (!d.rowCount) fail('purchaseDepartmentId', 'Pick an active department');
      }
      if (errors.length)
        throw new DomainError('validation-failed', errors.map((e) => e.message).join('; '), {
          status: 400,
          extra: { errors },
        });
      await c.query(
        `UPDATE purchase_settings SET gstin = $1, state_code = $2, billing_address = $3, delivery_address = $4,
                pi_prefix = $5, pr_prefix = $6, po_prefix = $7, direct_limit = $8, committee_limit = $9,
                committee_quotes = $10, committee_signatures = $11, emergency_enabled = $12, po_terms = $13,
                po_validity_days = $14, purchase_department_id = $15, po_signatures = $16::text[], large_po_alert = $17,
                split_window_days = $18, emergency_ratifier = $19, stock_gst_in_cost = $20,
                receipt_tolerance_pct = $21, billing_line = $22, billing_country = $23, billing_state = $24,
                billing_city = $25, billing_pin = $26, delivery_same = $27, delivery_line = $28,
                delivery_country = $29, delivery_state = $30, delivery_city = $31, delivery_pin = $32,
                direct_pr_limit = $33, bill_to_name = $34, bill_contact_name = $35, bill_contact_phone = $36,
                ship_to_name = $37, ship_contact_name = $38, ship_contact_phone = $39, office_email = $40,
                updated_at = now(), updated_by = app.current_user_id()`,
        [
          dto.gstin,
          gstState ?? billing.gst,
          billing.text || null,
          delivery.text || null,
          dto.piPrefix,
          dto.prPrefix,
          dto.poPrefix,
          dto.directLimit,
          dto.committeeLimit,
          dto.committeeQuotes,
          dto.committeeSignatures,
          dto.emergencyEnabled,
          dto.poTerms ?? null,
          dto.poValidityDays,
          dto.purchaseDepartmentId,
          dto.poSignatures,
          dto.largePoAlert,
          dto.splitWindowDays,
          dto.emergencyRatifier,
          dto.stockGstInCost,
          dto.receiptTolerancePct,
          billing.line,
          billing.country,
          billing.state,
          billing.city,
          billing.pin,
          dto.deliverySame,
          dto.deliverySame ? null : delivery.line,
          dto.deliverySame ? null : delivery.country,
          dto.deliverySame ? null : delivery.state,
          dto.deliverySame ? null : delivery.city,
          dto.deliverySame ? null : delivery.pin,
          dto.directPrLimit,
          dto.billToName ?? null,
          dto.billContactName ?? null,
          dto.billContactPhone ?? null,
          dto.shipToName ?? null,
          dto.shipContactName ?? null,
          dto.shipContactPhone ?? null,
          dto.officeEmail ?? null,
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.settings.update',
        entityType: 'purchase_settings',
        after: { ...dto },
      });
      return { saved: true };
    });
  }

  async addMember(ctx: RequestContext, dto: CommitteeMemberDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await c.query(
        `SELECT 1 FROM employees WHERE id = $1 AND status = 'active' AND deleted_at IS NULL`,
        [dto.employeeId],
      );
      if (!e.rowCount)
        throw new DomainError('validation-failed', 'Pick an active employee', { status: 400 });
      await c.query(
        `INSERT INTO purchase_committee_members (school_id, employee_id, role) VALUES (app.current_school_id(), $1, $2)
         ON CONFLICT (school_id, employee_id) DO UPDATE SET role = EXCLUDED.role`,
        [dto.employeeId, dto.role ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.committee.add',
        entityType: 'purchase_committee_members',
        entityId: dto.employeeId,
        after: { role: dto.role ?? null },
      });
      return { added: true };
    });
  }

  async removeMember(ctx: RequestContext, memberId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(`DELETE FROM purchase_committee_members WHERE id = $1`, [memberId]);
      if (!r.rowCount) throw new DomainError('not-found', 'Member not found', { status: 404 });
      // fewer members than the signatures needed: all of them sign
      await c.query(
        `UPDATE purchase_settings SET committee_signatures = NULL
          WHERE committee_signatures > (SELECT count(*) FROM purchase_committee_members)`,
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.committee.remove',
        entityType: 'purchase_committee_members',
        entityId: memberId,
      });
      return { removed: true };
    });
  }

  // ---- who approves per department ----------------------------------------------------------------
  async approvals(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const deps = await c.query<{
        id: string;
        code: string;
        name: string;
        hod_id: string | null;
        hod: string | null;
        hod_code: string | null;
        hod_signs_in: boolean | null;
        bypass_limit: string | null;
        rate_contract_bypass: boolean | null;
      }>(
        `SELECT d.id::text, d.code, d.name, d.hod_employee_id::text AS hod_id, h.display_name AS hod,
                h.employee_code AS hod_code, (h.user_id IS NOT NULL) AS hod_signs_in,
                r.bypass_limit, r.rate_contract_bypass
           FROM departments d
           LEFT JOIN employees h ON h.id = d.hod_employee_id
           LEFT JOIN purchase_department_rules r ON r.department_id = d.id
          WHERE d.status = 'active' ORDER BY d.sort_order, d.name`,
      );
      const levels = await c.query<{ department_id: string; doc_type: Doc; levels: unknown[] }>(
        `SELECT department_id::text, doc_type, levels FROM purchase_department_approvals`,
      );
      const staff = await c.query<{
        id: string;
        code: string;
        name: string;
        designation: string | null;
        department: string | null;
        signs_in: boolean;
      }>(
        `SELECT e.id::text, e.employee_code AS code, e.display_name AS name, e.designation, e.department,
                (e.user_id IS NOT NULL) AS signs_in
           FROM employees e WHERE e.deleted_at IS NULL AND e.status = 'active' ORDER BY e.display_name LIMIT 3000`,
      );
      const designations = await c.query<{ name: string; holders: number }>(
        `SELECT d.name, (SELECT count(*)::int FROM employees e WHERE lower(e.designation) = lower(d.name)
                          AND e.status = 'active' AND e.deleted_at IS NULL AND e.user_id IS NOT NULL) AS holders
           FROM designations d WHERE d.status = 'active' ORDER BY d.sort_order, d.name`,
      );
      return {
        departments: deps.rows.map((d) => ({
          id: d.id,
          code: d.code,
          name: d.name,
          hod: d.hod_id
            ? { id: d.hod_id, code: d.hod_code, name: d.hod, signsIn: d.hod_signs_in === true }
            : null,
          rules: {
            bypassLimit: d.bypass_limit === null ? 0 : Number(d.bypass_limit),
            rateContractBypass: d.rate_contract_bypass ?? false,
          },
          levels: Object.fromEntries(
            DOCS.map((doc) => [
              doc,
              levels.rows.find((l) => l.department_id === d.id && l.doc_type === doc)?.levels ?? [],
            ]),
          ),
        })),
        staff: staff.rows.map((x) => ({
          id: x.id,
          code: x.code,
          name: x.name,
          designation: x.designation,
          department: x.department,
          signsIn: x.signs_in,
        })),
        designations: designations.rows,
      };
    });
  }

  private async department(c: PoolClient, id: string) {
    const d = await c.query<{ name: string; hod: string | null }>(
      `SELECT name, hod_employee_id::text AS hod FROM departments WHERE id = $1 AND status = 'active'`,
      [id],
    );
    if (!d.rows[0]) throw new DomainError('not-found', 'Department not found', { status: 404 });
    return d.rows[0];
  }

  async saveLevels(
    ctx: RequestContext,
    departmentId: string,
    doc: string,
    dto: DepartmentLevelsDto,
  ) {
    if (!(DOCS as readonly string[]).includes(doc))
      throw new DomainError('not-found', 'Unknown document', { status: 404 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const dep = await this.department(c, departmentId);
      const warnings: string[] = [];
      for (const [i, l] of dto.levels.entries()) {
        if (l.by === 'hod' && !dep.hod)
          warnings.push(
            `Level ${String(i + 1)}: ${dep.name} has no HOD set, so the level is skipped`,
          );
        if (l.by === 'employees') {
          const n = await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM employees WHERE id = ANY($1::bigint[]) AND status = 'active' AND deleted_at IS NULL AND user_id IS NOT NULL`,
            [l.employeeIds],
          );
          if (n.rows[0]!.n === 0)
            warnings.push(
              `Level ${String(i + 1)}: none of these employees can sign in, so the level is skipped`,
            );
        }
        if (l.by === 'designation') {
          const n = await c.query<{ n: number }>(
            `SELECT count(*)::int AS n FROM employees WHERE lower(designation) = lower($1) AND status = 'active' AND deleted_at IS NULL AND user_id IS NOT NULL`,
            [l.designation ?? ''],
          );
          if (n.rows[0]!.n === 0)
            warnings.push(
              `Level ${String(i + 1)}: nobody who can sign in is a ${l.designation ?? ''}, so the level is skipped`,
            );
        }
      }
      const levels = dto.levels.map((l) => ({
        name: l.name,
        by: l.by,
        employeeIds: l.by === 'employees' ? l.employeeIds : [],
        designation: l.by === 'designation' ? l.designation : null,
        slaHours: l.slaHours,
        need: l.by === 'hod' ? 'any' : l.need,
      }));
      await c.query(
        `INSERT INTO purchase_department_approvals (school_id, department_id, doc_type, levels, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb, app.current_user_id())
         ON CONFLICT (school_id, department_id, doc_type)
         DO UPDATE SET levels = EXCLUDED.levels, updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [departmentId, doc, JSON.stringify(levels)],
      );
      // documents waiting follow the new levels at once
      const flow = await syncFlow(c, doc as PurchaseDocType, departmentId);
      const refreshed = await this.workflow.refreshOpen(c, ctx, flow.code);
      await this.audit.stage(ctx, c, {
        action: 'purchase.approvals.update',
        entityType: 'departments',
        entityId: departmentId,
        after: { doc, levels },
      });
      return {
        saved: true,
        warnings,
        moved: refreshed.moved.length,
        approved: refreshed.approved.length,
      };
    });
  }

  async saveRules(ctx: RequestContext, departmentId: string, dto: DepartmentRulesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.department(c, departmentId);
      await c.query(
        `INSERT INTO purchase_department_rules (school_id, department_id, bypass_limit, rate_contract_bypass, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id())
         ON CONFLICT (school_id, department_id)
         DO UPDATE SET bypass_limit = EXCLUDED.bypass_limit, rate_contract_bypass = EXCLUDED.rate_contract_bypass,
                       updated_at = now(), updated_by = EXCLUDED.updated_by`,
        [departmentId, dto.bypassLimit, dto.rateContractBypass],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.department_rules.update',
        entityType: 'departments',
        entityId: departmentId,
        after: { ...dto },
      });
      return { saved: true };
    });
  }

  // ---- copy from another school of the group ------------------------------------------------------
  /** The other schools of this school's group the user belongs to. */
  async copySources(ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ id: string; code: string; name: string }>(
        `SELECT s.id::text, s.code, s.name FROM schools s
          WHERE s.id <> app.current_school_id() AND s.id = ANY($1::bigint[]) AND s.status = 'active'
            AND s.group_id IS NOT NULL AND s.group_id = (SELECT group_id FROM schools WHERE id = app.current_school_id())
          ORDER BY s.name`,
        [tenant.allowedSchoolIds],
      );
      return { data: r.rows };
    });
  }

  /**
   * Copies the chosen masters from another school of the group (one the user belongs to): rows whose
   * code this school has already are left as they are. Items bring their categories, units and HSN with
   * them; vendors arrive pending (approved here by a second person) without their documents.
   */
  async copyFrom(ctx: RequestContext, dto: CopyFromDto) {
    const tenant = requireTenant(ctx);
    const sources = (await this.copySources(ctx)).data;
    if (!sources.some((s) => s.id === dto.schoolId))
      throw new DomainError(
        'permission-denied',
        'Copy only from another school of your group that you belong to',
        { status: 403 },
      );
    const parts = new Set(dto.parts);
    if (parts.has('items')) ['uoms', 'hsn', 'categories'].forEach((p) => parts.add(p as never));
    if (parts.has('vendors')) parts.add('paymentTerms');
    const from: TenantContext = { ...tenant, schoolId: dto.schoolId };
    const src = await this.db.tenant(from, async (c) => ({
      uoms: (
        await c.query(`SELECT code, name, decimals FROM purchase_uoms WHERE status = 'active'`)
      ).rows,
      hsn: (
        await c.query(
          `SELECT code, kind, description, gst_rate, reverse_charge, exempt, effective_from FROM purchase_hsn WHERE status = 'active'`,
        )
      ).rows,
      categories: (
        await c.query(
          `SELECT c.code, c.name, p.code AS parent FROM purchase_item_categories c
             LEFT JOIN purchase_item_categories p ON p.id = c.parent_id WHERE c.status = 'active' ORDER BY c.parent_id NULLS FIRST`,
        )
      ).rows,
      items: (
        await c.query(
          `SELECT i.code, i.name, i.specification, i.item_type, c.code AS category, s.code AS sub_category, u.code AS uom,
                  h.code AS hsn, i.gst_rate, i.brand
             FROM purchase_items i JOIN purchase_item_categories c ON c.id = i.category_id
             LEFT JOIN purchase_item_categories s ON s.id = i.sub_category_id
             JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_hsn h ON h.id = i.hsn_id
            WHERE i.status = 'active'`,
        )
      ).rows,
      terms: (
        await c.query(
          `SELECT t.code, t.name, t.print_text,
                  (SELECT json_agg(json_build_object('pct', l.pct, 'due_on', l.due_on, 'days', l.days) ORDER BY l.seq)
                     FROM purchase_payment_term_lines l WHERE l.term_id = t.id) AS lines
             FROM purchase_payment_terms t WHERE t.status = 'active'`,
        )
      ).rows,
      vendors: (
        await c.query(
          `SELECT v.code, v.legal_name, v.trade_name, v.kind, v.gst_status, v.gstin, v.pan, v.state_code, v.msme_type, v.udyam_no,
                  v.address, v.city, v.pin, v.phone, v.email, v.bank_secure, v.bank_hint, t.code AS term, v.country, v.state,
                  (SELECT array_agg(c.code) FROM purchase_item_categories c WHERE c.id = ANY(v.category_ids)) AS categories,
                  (SELECT json_agg(json_build_object('name', x.name, 'role', x.role, 'phone', x.phone, 'email', x.email, 'is_main', x.is_main))
                     FROM vendor_contacts x WHERE x.vendor_id = v.id) AS contacts
             FROM vendors v LEFT JOIN purchase_payment_terms t ON t.id = v.payment_term_id WHERE v.status = 'active'`,
        )
      ).rows,
    }));
    return this.db.tenant(tenant, async (c) => {
      await PurchaseVendorsService.seed(c);
      const copied: Record<string, number> = {};
      const count = async (part: string, sql: string, args: unknown[]) => {
        const r = await c.query(sql, args);
        copied[part] = (copied[part] ?? 0) + (r.rowCount ?? 0);
      };
      if (parts.has('uoms'))
        for (const u of src.uoms)
          await count(
            'uoms',
            `INSERT INTO purchase_uoms (school_id, code, name, decimals) VALUES (app.current_school_id(), $1, $2, $3)
             ON CONFLICT (school_id, code) DO NOTHING`,
            [u.code, u.name, u.decimals],
          );
      if (parts.has('hsn'))
        for (const h of src.hsn)
          await count(
            'hsn',
            `INSERT INTO purchase_hsn (school_id, code, kind, description, gst_rate, reverse_charge, exempt, effective_from)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7) ON CONFLICT (school_id, code) DO NOTHING`,
            [
              h.code,
              h.kind,
              h.description,
              h.gst_rate,
              h.reverse_charge,
              h.exempt,
              h.effective_from,
            ],
          );
      if (parts.has('categories'))
        for (const k of src.categories)
          await count(
            'categories',
            `INSERT INTO purchase_item_categories (school_id, code, name, parent_id)
             VALUES (app.current_school_id(), $1, $2, (SELECT id FROM purchase_item_categories WHERE code = $3 AND parent_id IS NULL))
             ON CONFLICT (school_id, code) DO NOTHING`,
            [k.code, k.name, k.parent],
          );
      if (parts.has('items'))
        for (const i of src.items)
          await count(
            'items',
            `INSERT INTO purchase_items (school_id, code, name, specification, item_type, category_id, sub_category_id, uom_id, hsn_id, gst_rate, brand)
             SELECT app.current_school_id(), $1, $2, $3, $4, c.id,
                    (SELECT s.id FROM purchase_item_categories s WHERE s.code = $6 AND s.parent_id = c.id),
                    u.id, (SELECT h.id FROM purchase_hsn h WHERE h.code = $8), $9, $10
               FROM purchase_item_categories c, purchase_uoms u
              WHERE c.code = $5 AND c.parent_id IS NULL AND u.code = $7
             ON CONFLICT (school_id, code) DO NOTHING`,
            [
              i.code,
              i.name,
              i.specification,
              i.item_type,
              i.category,
              i.sub_category,
              i.uom,
              i.hsn,
              i.gst_rate,
              i.brand,
            ],
          );
      if (parts.has('paymentTerms'))
        for (const t of src.terms) {
          const r = await c.query<{ id: string }>(
            `INSERT INTO purchase_payment_terms (school_id, code, name, print_text) VALUES (app.current_school_id(), $1, $2, $3)
             ON CONFLICT (school_id, code) DO NOTHING RETURNING id::text`,
            [t.code, t.name, t.print_text],
          );
          if (!r.rows[0]) continue;
          copied.paymentTerms = (copied.paymentTerms ?? 0) + 1;
          for (const [i, l] of ((t.lines as TermLine[] | null) ?? []).entries())
            await c.query(
              `INSERT INTO purchase_payment_term_lines (school_id, term_id, seq, pct, due_on, days)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5)`,
              [r.rows[0].id, i + 1, l.pct, l.due_on, l.days],
            );
        }
      if (parts.has('vendors'))
        for (const v of src.vendors) {
          const r = await c.query<{ id: string }>(
            `INSERT INTO vendors (school_id, code, legal_name, trade_name, kind, gst_status, gstin, pan, state_code, msme_type, udyam_no,
                                  address, city, pin, phone, email, bank_secure, bank_hint, payment_term_id, category_ids, status, created_by,
                                  country, state)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                     (SELECT id FROM purchase_payment_terms WHERE code = $18),
                     COALESCE((SELECT array_agg(id) FROM purchase_item_categories WHERE code = ANY($19::text[])), '{}'),
                     'pending', app.current_user_id(), $20, $21)
             ON CONFLICT (school_id, code) DO NOTHING RETURNING id::text`,
            [
              v.code,
              v.legal_name,
              v.trade_name,
              v.kind,
              v.gst_status,
              v.gstin,
              v.pan,
              v.state_code,
              v.msme_type,
              v.udyam_no,
              v.address,
              v.city,
              v.pin,
              v.phone,
              v.email,
              v.bank_secure,
              v.bank_hint,
              v.term,
              v.categories ?? [],
              v.country,
              v.state,
            ],
          );
          if (!r.rows[0]) continue;
          copied.vendors = (copied.vendors ?? 0) + 1;
          for (const x of (v.contacts as Array<Record<string, unknown>> | null) ?? [])
            await c.query(
              `INSERT INTO vendor_contacts (school_id, vendor_id, name, role, phone, email, is_main)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)`,
              [r.rows[0].id, x.name, x.role, x.phone, x.email, x.is_main],
            );
        }
      await this.audit.stage(ctx, c, {
        action: 'purchase.masters.copy',
        entityType: 'schools',
        entityId: dto.schoolId,
        after: { parts: [...parts], copied },
      });
      return { copied };
    });
  }
}
