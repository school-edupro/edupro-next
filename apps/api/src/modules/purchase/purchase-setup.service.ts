import { Injectable } from '@nestjs/common';
import type { PoolClient, TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { WorkflowService } from '../workflow/workflow.service';
import { GST_STATES, GSTIN_HELP, gstinProblem } from './gstin';
import { syncFlow, type PurchaseDocType } from './purchase-flow';
import { PurchaseVendorsService } from './purchase-vendors.service';
import type {
  CommitteeMemberDto,
  CopyFromDto,
  DepartmentLevelsDto,
  DepartmentRulesDto,
  PaymentTermDto,
  SettingsDto,
} from './purchase.dto';

const DOCS = ['indent', 'requisition', 'order'] as const;
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

  async listTerms(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      return { data: await this.terms(c) };
    });
  }

  async saveTerm(ctx: RequestContext, id: string | null, dto: PaymentTermDto) {
    const total = dto.lines.reduce((s, l) => s + Math.round(l.pct * 100), 0);
    if (total !== 10000)
      throw new DomainError(
        'validation-failed',
        `The instalments add up to ${String(total / 100)}%: they must add up to 100%`,
        { status: 400 },
      );
    return this.db.tenant(requireTenant(ctx), async (c) => {
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
    });
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
        pi_prefix: string;
        pr_prefix: string;
        po_prefix: string;
        direct_limit: string;
        committee_limit: string;
        committee_quotes: number;
        committee_signatures: number | null;
        emergency_enabled: boolean;
        emergency_ratifier: string;
        po_terms: string | null;
        po_validity_days: number;
        purchase_department_id: string | null;
        po_signatures: string[];
        large_po_alert: string | null;
        split_window_days: number;
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
        piPrefix: x.pi_prefix,
        prPrefix: x.pr_prefix,
        poPrefix: x.po_prefix,
        directLimit: Number(x.direct_limit),
        committeeLimit: Number(x.committee_limit),
        committeeQuotes: x.committee_quotes,
        committeeSignatures: x.committee_signatures,
        emergencyEnabled: x.emergency_enabled,
        emergencyRatifier: x.emergency_ratifier,
        poTerms: x.po_terms,
        poValidityDays: x.po_validity_days,
        purchaseDepartmentId: x.purchase_department_id,
        poSignatures: x.po_signatures,
        largePoAlert: x.large_po_alert === null ? null : Number(x.large_po_alert),
        splitWindowDays: x.split_window_days,
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

  async saveSettings(ctx: RequestContext, dto: SettingsDto) {
    if (dto.gstin) {
      const problem = gstinProblem(dto.gstin);
      if (problem)
        throw new DomainError(
          'purchase.gstin_invalid',
          `GSTIN ${dto.gstin}: ${GSTIN_HELP[problem]}`,
          {
            status: 400,
          },
        );
    }
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      if (dto.committeeSignatures !== null) {
        const n = await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM purchase_committee_members`,
        );
        if (dto.committeeSignatures > n.rows[0]!.n)
          throw new DomainError(
            'validation-failed',
            `The committee has ${String(n.rows[0]!.n)} members: it cannot need ${String(dto.committeeSignatures)} signatures`,
            { status: 400 },
          );
      }
      await c.query(
        `UPDATE purchase_settings SET gstin = $1, state_code = $2, billing_address = $3, delivery_address = $4,
                pi_prefix = $5, pr_prefix = $6, po_prefix = $7, direct_limit = $8, committee_limit = $9,
                committee_quotes = $10, committee_signatures = $11, emergency_enabled = $12, po_terms = $13,
                po_validity_days = $14, purchase_department_id = $15, po_signatures = $16::text[], large_po_alert = $17,
                split_window_days = $18, emergency_ratifier = $19, updated_at = now(), updated_by = app.current_user_id()`,
        [
          dto.gstin,
          dto.gstin ? dto.gstin.slice(0, 2) : null,
          dto.billingAddress ?? null,
          dto.deliveryAddress ?? null,
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
                  v.address, v.city, v.pin, v.phone, v.email, v.bank_secure, v.bank_hint, t.code AS term,
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
                                  address, city, pin, phone, email, bank_secure, bank_hint, payment_term_id, category_ids, status, created_by)
             VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                     (SELECT id FROM purchase_payment_terms WHERE code = $18),
                     COALESCE((SELECT array_agg(id) FROM purchase_item_categories WHERE code = ANY($19::text[])), '{}'),
                     'pending', app.current_user_id())
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
