import { Injectable } from '@nestjs/common';
import { decryptField, encryptField, type PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { GST_STATES, GSTIN_HELP, PAN_FORMAT, gstinProblem, panOfGstin } from './gstin';
import { checkVendorFields, type VendorFieldsOut } from './vendor-rules';
import {
  CreateVendorSchema,
  PURCHASE,
  type CreateVendorDto,
  type DecisionDto,
  type UpdateVendorDto,
  type VendorDocumentDto,
  type VendorImportDto,
  type VendorListQueryDto,
  type VendorStatusDto,
} from './purchase.dto';

type Bank = { accountNo: string; ifsc: string; bankName: string; holder: string };
type VendorStatus = 'pending' | 'active' | 'inactive' | 'blacklisted' | 'rejected';

interface VendorDbRow {
  id: string;
  code: string;
  legal_name: string;
  trade_name: string | null;
  kind: string;
  gst_status: string;
  gstin: string | null;
  pan: string | null;
  state_code: string | null;
  msme_type: string | null;
  udyam_no: string | null;
  address: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  pin: string | null;
  phone: string | null;
  email: string | null;
  bank_hint: string | null;
  bank_secure: string | null;
  category_ids: string[];
  payment_term_id: string | null;
  payment_term: string | null;
  status: VendorStatus;
  status_reason: string | null;
  created_by: string | null;
  created_by_name: string | null;
  approved_by_name: string | null;
  approved_at: Date | null;
  created_at: Date;
  pending_change_id: string | null;
}

const SELECT = `
  SELECT v.id::text, v.code, v.legal_name, v.trade_name, v.kind, v.gst_status, v.gstin, v.pan, v.state_code,
         v.msme_type, v.udyam_no, v.address, v.country, v.state, v.city, v.pin, v.phone, v.email, v.bank_hint, v.bank_secure,
         v.category_ids::text[] AS category_ids, v.payment_term_id::text, pt.name AS payment_term, v.status,
         v.status_reason, v.created_by::text, cu.display_name AS created_by_name, au.display_name AS approved_by_name,
         v.approved_at, v.created_at,
         (SELECT c.id::text FROM vendor_changes c WHERE c.vendor_id = v.id AND c.status = 'pending') AS pending_change_id
    FROM vendors v
    LEFT JOIN purchase_payment_terms pt ON pt.id = v.payment_term_id
    LEFT JOIN users cu ON cu.id = v.created_by
    LEFT JOIN users au ON au.id = v.approved_by`;

/**
 * May the caller approve vendors (and bank / GSTIN / PAN changes)? The people named in Purchase →
 * Settings → Vendor approval when any is named; else whoever holds the right (School Admin, Group Admin
 * by default).
 */
export async function mayApproveVendors(c: PoolClient, ctx: RequestContext): Promise<boolean> {
  const r = await c.query<{ named: number; me: boolean | null }>(
    `SELECT count(*)::int AS named, bool_or(e.user_id = app.current_user_id()) AS me
       FROM purchase_vendor_approvers a
       JOIN employees e ON e.id = a.employee_id AND e.deleted_at IS NULL AND e.status = 'active'`,
  );
  const x = r.rows[0]!;
  return x.named > 0 ? x.me === true : (ctx.permissions?.has(PURCHASE.vendorApprove) ?? false);
}
/** The purchase view right, or a vendor approver (named ones may hold no purchase role at all). */
async function mayView(c: PoolClient, ctx: RequestContext) {
  if (ctx.permissions?.has(PURCHASE.masterView)) return true;
  if (await mayApproveVendors(c, ctx)) return true;
  throw new DomainError(
    'permission-denied',
    'Needs the purchase view right or to be a vendor approver',
    {
      status: 403,
    },
  );
}
const notApprover = () =>
  new DomainError(
    'purchase.not_vendor_approver',
    'Only the vendor approvers (Purchase → Settings → Vendor approval) approve vendors',
    { status: 403 },
  );

/** The sensitive fields: on an approved vendor a change of any of them waits for a second person. */
const SENSITIVE = ['gstStatus', 'gstin', 'pan', 'stateCode', 'bank'] as const;

const hintOf = (b: Bank) => `${b.bankName} ····${b.accountNo.slice(-4)} (${b.ifsc})`;
const decryptBank = (secure: string | null): Bank | null => {
  if (!secure) return null;
  try {
    return JSON.parse(decryptField(secure) ?? 'null') as Bank | null;
  } catch {
    return null;
  }
};

/** The GST identity of a vendor, checked: GSTIN well formed, PAN matching it, the state from it. */
function gstIdentity(v: {
  gstStatus?: string;
  gstin?: string | null;
  pan?: string | null;
  stateCode?: string | null;
}): { gstin: string | null; pan: string | null; stateCode: string | null } {
  const status = v.gstStatus ?? 'regular';
  const gstin = v.gstin ?? null;
  let pan = v.pan ?? null;
  if (status !== 'unregistered') {
    if (!gstin)
      throw new DomainError('validation-failed', 'A registered vendor needs its GSTIN', {
        status: 400,
      });
    const problem = gstinProblem(gstin);
    if (problem)
      throw new DomainError('purchase.gstin_invalid', `GSTIN ${gstin}: ${GSTIN_HELP[problem]}`, {
        status: 400,
      });
    if (pan && pan !== panOfGstin(gstin))
      throw new DomainError(
        'purchase.pan_mismatch',
        `The PAN ${pan} is not the one inside the GSTIN (${panOfGstin(gstin)})`,
        { status: 400 },
      );
    pan = panOfGstin(gstin);
    return { gstin, pan, stateCode: gstin.slice(0, 2) };
  }
  if (gstin)
    throw new DomainError('validation-failed', 'An unregistered vendor has no GSTIN', {
      status: 400,
    });
  if (pan && !PAN_FORMAT.test(pan))
    throw new DomainError('validation-failed', `PAN ${pan}: five letters, four digits, a letter`, {
      status: 400,
    });
  const stateCode = v.stateCode ?? null;
  if (stateCode && !GST_STATES[stateCode])
    throw new DomainError('validation-failed', 'Unknown state code', { status: 400 });
  return { gstin: null, pan, stateCode };
}

/**
 * The school's common vendor master (docs/design/83, part 1). A new vendor is pending until a second
 * person with the vendor-approve right approves it; on an approved vendor a change of its bank account,
 * GSTIN, PAN or GST status waits the same way (one change at a time), while names, contacts and the
 * rest change at once. The person who entered a vendor or a change never approves it. A GSTIN, PAN or
 * bank account another vendor already has is flagged and saved only with a reason. The bank account is
 * encrypted; screens show its hint, the approver sees it in full.
 */
@Injectable()
export class PurchaseVendorsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private me(ctx: RequestContext): string {
    return String(ctx.user.id);
  }

  /** Every school starts with the purchase starter masters (units, HSN, a payment term, settings). */
  static async seed(c: PoolClient) {
    await c.query(`SELECT app.purchase_seed_masters(app.current_school_id())`);
  }

  private shape(r: VendorDbRow, full = false) {
    return {
      id: r.id,
      code: r.code,
      legalName: r.legal_name,
      tradeName: r.trade_name,
      kind: r.kind,
      gstStatus: r.gst_status,
      gstin: r.gstin,
      pan: r.pan,
      stateCode: r.state_code,
      state: r.state ?? (r.state_code ? (GST_STATES[r.state_code] ?? null) : null),
      country: r.country,
      msmeType: r.msme_type,
      udyamNo: r.udyam_no,
      address: r.address,
      city: r.city,
      pin: r.pin,
      phone: r.phone,
      email: r.email,
      bankHint: r.bank_hint,
      ...(full ? { bank: decryptBank(r.bank_secure) } : {}),
      categoryIds: r.category_ids,
      paymentTermId: r.payment_term_id,
      paymentTerm: r.payment_term,
      status: r.status,
      statusReason: r.status_reason,
      createdBy: r.created_by_name,
      approvedBy: r.approved_by_name,
      approvedAt: r.approved_at?.toISOString() ?? null,
      createdAt: r.created_at.toISOString(),
      pendingChangeId: r.pending_change_id,
    };
  }

  async list(ctx: RequestContext, q: VendorListQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const where = `WHERE ($1::text IS NULL OR v.status = $1)
        AND ($2::text IS NULL OR v.code ILIKE $2 OR v.legal_name ILIKE $2 OR v.trade_name ILIKE $2 OR v.gstin ILIKE $2 OR v.pan ILIKE $2 OR v.city ILIKE $2)`;
      const args = [q.status ?? null, q.q ? `%${q.q}%` : null];
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- a fixed WHERE; values are bound
        `SELECT count(*)::int AS n FROM vendors v ${where}`,
        args,
      );
      const rows = await c.query<VendorDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT and WHERE are fixed fragments; values are bound
        `${SELECT} ${where} ORDER BY v.code LIMIT $3 OFFSET $4`,
        [...args, q.size, (q.page - 1) * q.size],
      );
      const counts = await c.query<{ status: string; n: number }>(
        `SELECT status, count(*)::int AS n FROM vendors GROUP BY status`,
      );
      return {
        data: rows.rows.map((r) => this.shape(r)),
        total: total.rows[0]!.n,
        page: q.page,
        size: q.size,
        counts: Object.fromEntries(counts.rows.map((x) => [x.status, x.n])),
      };
    });
  }

  private async load(c: PoolClient, id: string): Promise<VendorDbRow> {
    // eslint-disable-next-line no-restricted-syntax -- SELECT is a fixed fragment
    const r = await c.query<VendorDbRow>(`${SELECT} WHERE v.id = $1`, [id]);
    if (!r.rows[0]) throw new DomainError('not-found', 'Vendor not found', { status: 404 });
    return r.rows[0];
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await mayView(c, ctx);
      const v = await this.load(c, id);
      const contacts = await c.query<{
        id: string;
        name: string;
        role: string | null;
        phone: string | null;
        email: string | null;
        is_main: boolean;
      }>(
        `SELECT id::text, name, role, phone, email, is_main FROM vendor_contacts WHERE vendor_id = $1 ORDER BY is_main DESC, id`,
        [id],
      );
      const docs = await c.query<{
        id: string;
        kind: string;
        file_id: string;
        name: string | null;
        content_type: string | null;
        uploaded_at: Date;
      }>(
        `SELECT d.id::text, d.kind, d.file_id::text, f.original_name AS name, f.content_type, d.uploaded_at
           FROM vendor_documents d JOIN files f ON f.id = d.file_id WHERE d.vendor_id = $1 ORDER BY d.uploaded_at`,
        [id],
      );
      const change = v.pending_change_id ? await this.changeOf(c, v.pending_change_id) : null;
      const approver = await mayApproveVendors(c, ctx);
      return {
        ...this.shape(v, approver),
        canApprove: approver,
        contacts: contacts.rows.map((x) => ({
          id: x.id,
          name: x.name,
          role: x.role,
          phone: x.phone,
          email: x.email,
          isMain: x.is_main,
        })),
        documents: docs.rows.map((d) => ({
          id: d.id,
          kind: d.kind,
          fileId: d.file_id,
          name: d.name,
          contentType: d.content_type,
          uploadedAt: d.uploaded_at.toISOString(),
        })),
        pendingChange: change ? this.shapeChange(change, approver) : null,
        /** the person who entered it may not approve it */
        enteredByMe: v.created_by === this.me(ctx),
      };
    });
  }

  /** Other vendors with the same GSTIN, PAN or bank account. */
  private async duplicates(
    c: PoolClient,
    exceptId: string | null,
    v: { gstin: string | null; pan: string | null; bank: Bank | null },
  ) {
    const out: Array<{ code: string; name: string; field: string }> = [];
    const same = await c.query<{ code: string; legal_name: string; gstin: string; pan: string }>(
      `SELECT code, legal_name, gstin, pan FROM vendors
        WHERE ($1::bigint IS NULL OR id <> $1::bigint) AND status <> 'rejected'
          AND (($2::text IS NOT NULL AND gstin = $2) OR ($3::text IS NOT NULL AND pan = $3))`,
      [exceptId, v.gstin, v.pan],
    );
    for (const r of same.rows)
      out.push({
        code: r.code,
        name: r.legal_name,
        field: v.gstin && r.gstin === v.gstin ? 'GSTIN' : 'PAN',
      });
    if (v.bank) {
      const near = await c.query<{ code: string; legal_name: string; bank_secure: string }>(
        `SELECT code, legal_name, bank_secure FROM vendors
          WHERE ($1::bigint IS NULL OR id <> $1::bigint) AND status <> 'rejected' AND bank_hint LIKE $2`,
        [exceptId, `%····${v.bank.accountNo.slice(-4)} (${v.bank.ifsc})`],
      );
      for (const r of near.rows) {
        const b = decryptBank(r.bank_secure);
        if (b && b.accountNo === v.bank.accountNo && b.ifsc === v.bank.ifsc)
          out.push({ code: r.code, name: r.legal_name, field: 'bank account' });
      }
    }
    return out;
  }

  private refuseDuplicates(
    found: Array<{ code: string; name: string; field: string }>,
    reason: string | undefined,
  ) {
    if (found.length && !reason)
      throw new DomainError(
        'purchase.vendor_duplicate',
        `Same ${found.map((d) => `${d.field} as ${d.code} ${d.name}`).join('; ')}: give the reason to save it anyway`,
        { status: 409, extra: { duplicates: found } },
      );
  }

  private async saveContacts(
    c: PoolClient,
    vendorId: string,
    contacts: CreateVendorDto['contacts'],
  ) {
    await c.query(`DELETE FROM vendor_contacts WHERE vendor_id = $1`, [vendorId]);
    let main = false;
    for (const x of contacts) {
      const isMain = x.isMain && !main;
      if (isMain) main = true;
      await c.query(
        `INSERT INTO vendor_contacts (school_id, vendor_id, name, role, phone, email, is_main)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6)`,
        [vendorId, x.name, x.role ?? null, x.phone ?? null, x.email ?? null, isMain],
      );
    }
  }

  /**
   * A new vendor, pending (the form or a sheet row, checked): a code left empty gets the next V-0001;
   * the bank account stored encrypted; a GSTIN, PAN or bank account another vendor has needs a reason.
   */
  private async insertVendor(
    c: PoolClient,
    dto: CreateVendorDto,
    id: { gstin: string | null; pan: string | null; stateCode: string | null },
    f: VendorFieldsOut,
  ) {
    if (dto.code) {
      const exists = await c.query(`SELECT 1 FROM vendors WHERE code = $1`, [dto.code]);
      if (exists.rowCount)
        throw new DomainError('conflict', `Vendor code ${dto.code} is taken`, {
          status: 409,
          extra: { errors: [{ path: 'code', message: `Vendor code ${dto.code} is taken` }] },
        });
    }
    const found = await this.duplicates(c, null, { ...id, bank: f.bank ?? null });
    this.refuseDuplicates(found, dto.duplicateReason);
    const r = await c.query<{ id: string; code: string }>(
      `INSERT INTO vendors (school_id, code, legal_name, trade_name, kind, gst_status, gstin, pan, state_code, msme_type, udyam_no,
                            address, country, state, city, pin, phone, email, bank_secure, bank_hint, category_ids, payment_term_id,
                            status, created_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
               $20::bigint[], $21, 'pending', app.current_user_id())
       RETURNING id::text, code`,
      [
        dto.code ?? null,
        dto.legalName,
        dto.tradeName ?? null,
        dto.kind,
        dto.gstStatus,
        id.gstin,
        id.pan,
        id.gstin ? id.stateCode : (f.stateGst ?? id.stateCode),
        dto.msmeType ?? null,
        dto.udyamNo ?? null,
        dto.address ?? null,
        f.country,
        f.state,
        f.city,
        f.pin,
        f.phone,
        dto.email ?? null,
        f.bank ? encryptField(JSON.stringify(f.bank)) : null,
        f.bank ? hintOf(f.bank) : null,
        dto.categoryIds,
        dto.paymentTermId ?? null,
      ],
    );
    const vendorId = r.rows[0]!.id;
    await this.saveContacts(c, vendorId, f.contacts ?? dto.contacts);
    return { vendorId, code: r.rows[0]!.code, found };
  }

  async create(ctx: RequestContext, dto: CreateVendorDto) {
    const id = gstIdentity(dto);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const f = await checkVendorFields(c, dto, {
        creating: true,
        gstState: id.gstin ? id.stateCode : null,
      });
      const { vendorId, code, found } = await this.insertVendor(c, dto, id, f);
      await this.audit.stage(ctx, c, {
        action: 'purchase.vendor.create',
        entityType: 'vendors',
        entityId: vendorId,
        after: {
          code,
          legalName: dto.legalName,
          ...(found.length ? { duplicates: found, duplicateReason: dto.duplicateReason } : {}),
        },
      });
      return this.shape(await this.load(c, vendorId));
    });
  }

  /**
   * Changes a vendor. While it is pending or rejected everything changes at once (it is approved as a
   * whole, and the editor becomes its maker; a rejected one goes back to pending). On an approved vendor
   * the plain fields change at once and the bank account, GSTIN, PAN or GST status become a pending change.
   */
  async update(ctx: RequestContext, vendorId: string, dto: UpdateVendorDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await this.load(c, vendorId);
      const merged = gstIdentity({
        gstStatus: dto.gstStatus ?? v.gst_status,
        gstin: dto.gstin !== undefined ? dto.gstin : v.gstin,
        pan: dto.pan !== undefined ? dto.pan : v.pan,
        stateCode: dto.stateCode ?? v.state_code,
      });
      const f = await checkVendorFields(
        c,
        { ...dto, gstStatus: dto.gstStatus ?? v.gst_status },
        {
          creating: false,
          gstState: merged.gstin ? merged.stateCode : null,
          stored: { country: v.country, state: v.state, city: v.city },
        },
      );
      const placeSent = [dto.country, dto.state, dto.city].some((x) => x !== undefined);
      // an unregistered vendor's GST state is its address state
      if (!merged.gstin && placeSent && f.stateGst) merged.stateCode = f.stateGst;
      const touchesSensitive =
        SENSITIVE.some((k) => dto[k] !== undefined) || (!merged.gstin && placeSent);
      const bank = f.bank ?? null;
      const sensitiveChanged =
        touchesSensitive &&
        (merged.gstin !== v.gstin ||
          merged.pan !== v.pan ||
          merged.stateCode !== v.state_code ||
          (dto.gstStatus !== undefined && dto.gstStatus !== v.gst_status) ||
          (bank !== null && JSON.stringify(bank) !== JSON.stringify(decryptBank(v.bank_secure))));
      if (sensitiveChanged) {
        // only what changes is checked (a GSTIN shared on purpose earlier is not asked about again)
        const found = await this.duplicates(c, vendorId, {
          gstin: merged.gstin !== v.gstin ? merged.gstin : null,
          pan: merged.pan !== v.pan ? merged.pan : null,
          bank:
            bank && JSON.stringify(bank) !== JSON.stringify(decryptBank(v.bank_secure))
              ? bank
              : null,
        });
        this.refuseDuplicates(found, dto.duplicateReason);
      }
      const plain: Array<[string, unknown]> = [
        ['legal_name', dto.legalName],
        ['trade_name', dto.tradeName],
        ['kind', dto.kind],
        ['msme_type', dto.msmeType],
        ['udyam_no', dto.udyamNo],
        ['address', dto.address],
        ['country', placeSent ? f.country : undefined],
        ['state', placeSent ? f.state : undefined],
        ['city', placeSent ? f.city : undefined],
        ['pin', dto.pin !== undefined ? f.pin : undefined],
        ['phone', dto.phone !== undefined ? f.phone : undefined],
        ['email', dto.email],
        ['payment_term_id', dto.paymentTermId],
      ];
      const approved = v.status !== 'pending' && v.status !== 'rejected';
      const apply = plain.filter(([, val]) => val !== undefined);
      if (!approved && sensitiveChanged)
        apply.push(
          ['gst_status', dto.gstStatus ?? v.gst_status],
          ['gstin', merged.gstin],
          ['pan', merged.pan],
          ['state_code', merged.stateCode],
          ...(bank
            ? ([
                ['bank_secure', encryptField(JSON.stringify(bank))],
                ['bank_hint', hintOf(bank)],
              ] as Array<[string, unknown]>)
            : []),
        );
      for (const [col, val] of apply)
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- col is one of the fixed column names above
          `UPDATE vendors SET ${col} = $2, updated_at = now() WHERE id = $1`,
          [vendorId, val],
        );
      if (dto.categoryIds)
        await c.query(`UPDATE vendors SET category_ids = $2::bigint[] WHERE id = $1`, [
          vendorId,
          dto.categoryIds,
        ]);
      if (dto.contacts) await this.saveContacts(c, vendorId, f.contacts ?? dto.contacts);
      // the last person to enter the details of a vendor not yet approved is its maker
      if (!approved)
        await c.query(
          `UPDATE vendors SET created_by = app.current_user_id(), status = 'pending', status_reason = NULL WHERE id = $1`,
          [vendorId],
        );
      let changeId: string | null = null;
      if (approved && sensitiveChanged) {
        if (v.pending_change_id)
          throw new DomainError(
            'purchase.vendor_change_pending',
            'A change of this vendor’s bank, GSTIN or PAN is already waiting for approval',
            { status: 409 },
          );
        if (!dto.changeReason)
          throw new DomainError(
            'validation-failed',
            'Give the reason for changing the bank account, GSTIN or PAN',
            { status: 400 },
          );
        const changes: Record<string, unknown> = {
          gstStatus: dto.gstStatus ?? v.gst_status,
          gstin: merged.gstin,
          pan: merged.pan,
          stateCode: merged.stateCode,
          ...(bank
            ? { bankSecure: encryptField(JSON.stringify(bank)), bankHint: hintOf(bank) }
            : {}),
        };
        const r = await c.query<{ id: string }>(
          `INSERT INTO vendor_changes (school_id, vendor_id, changes, before, reason, requested_by)
           VALUES (app.current_school_id(), $1, $2::jsonb, $3::jsonb, $4, app.current_user_id()) RETURNING id::text`,
          [
            vendorId,
            JSON.stringify(changes),
            JSON.stringify({
              gstStatus: v.gst_status,
              gstin: v.gstin,
              pan: v.pan,
              stateCode: v.state_code,
              bankHint: v.bank_hint,
            }),
            dto.changeReason,
          ],
        );
        changeId = r.rows[0]!.id;
      }
      await this.audit.stage(ctx, c, {
        action: 'purchase.vendor.update',
        entityType: 'vendors',
        entityId: vendorId,
        after: {
          fields: apply.map(([k]) => k).filter((k) => k !== 'bank_secure'),
          ...(changeId ? { changeId, reason: dto.changeReason } : {}),
          ...(dto.duplicateReason ? { duplicateReason: dto.duplicateReason } : {}),
        },
      });
      return { ...this.shape(await this.load(c, vendorId)), changeWaiting: changeId !== null };
    });
  }

  /** A new vendor approved or rejected by a second person. */
  async decideVendor(ctx: RequestContext, vendorId: string, dto: DecisionDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (!(await mayApproveVendors(c, ctx))) throw notApprover();
      const v = await this.load(c, vendorId);
      if (v.status !== 'pending')
        throw new DomainError('purchase.not_pending', 'This vendor is not waiting for approval', {
          status: 409,
        });
      if (v.created_by === this.me(ctx))
        throw new DomainError(
          'purchase.maker_checker',
          'You entered this vendor: another person approves it',
          { status: 403 },
        );
      if (!dto.approve && (dto.note ?? '').length < 3)
        throw new DomainError('validation-failed', 'Give the reason for rejecting', {
          status: 400,
        });
      await c.query(
        `UPDATE vendors SET status = $2, status_reason = $3, approved_by = app.current_user_id(), approved_at = now(), updated_at = now()
          WHERE id = $1`,
        [vendorId, dto.approve ? 'active' : 'rejected', dto.approve ? null : dto.note],
      );
      await this.audit.stage(ctx, c, {
        action: dto.approve ? 'purchase.vendor.approve' : 'purchase.vendor.reject',
        entityType: 'vendors',
        entityId: vendorId,
        after: { note: dto.note ?? null },
      });
      return this.shape(await this.load(c, vendorId));
    });
  }

  private async changeOf(c: PoolClient, changeId: string) {
    const r = await c.query<{
      id: string;
      vendor_id: string;
      changes: Record<string, string | null>;
      before: Record<string, string | null>;
      reason: string | null;
      status: string;
      requested_by: string | null;
      requested_by_name: string | null;
      requested_at: Date;
    }>(
      `SELECT x.id::text, x.vendor_id::text, x.changes, x.before, x.reason, x.status, x.requested_by::text,
              u.display_name AS requested_by_name, x.requested_at
         FROM vendor_changes x LEFT JOIN users u ON u.id = x.requested_by WHERE x.id = $1`,
      [changeId],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Change not found', { status: 404 });
    return r.rows[0];
  }

  private shapeChange(x: Awaited<ReturnType<PurchaseVendorsService['changeOf']>>, full: boolean) {
    const { bankSecure, ...rest } = x.changes;
    return {
      id: x.id,
      vendorId: x.vendor_id,
      changes: { ...rest, ...(full && bankSecure ? { bank: decryptBank(bankSecure) } : {}) },
      before: x.before,
      reason: x.reason,
      status: x.status,
      requestedBy: x.requested_by_name,
      requestedAt: x.requested_at.toISOString(),
    };
  }

  /** A change of an approved vendor's bank, GSTIN or PAN approved (applied) or rejected. */
  async decideChange(ctx: RequestContext, changeId: string, dto: DecisionDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (!(await mayApproveVendors(c, ctx))) throw notApprover();
      const x = await this.changeOf(c, changeId);
      if (x.status !== 'pending')
        throw new DomainError('purchase.not_pending', 'This change is not waiting for approval', {
          status: 409,
        });
      if (x.requested_by === this.me(ctx))
        throw new DomainError(
          'purchase.maker_checker',
          'You asked for this change: another person approves it',
          { status: 403 },
        );
      if (!dto.approve && (dto.note ?? '').length < 3)
        throw new DomainError('validation-failed', 'Give the reason for rejecting', {
          status: 400,
        });
      if (dto.approve) {
        const ch = x.changes;
        await c.query(
          `UPDATE vendors SET gst_status = $2, gstin = $3, pan = $4, state_code = $5,
                  bank_secure = COALESCE($6, bank_secure), bank_hint = COALESCE($7, bank_hint), updated_at = now()
            WHERE id = $1`,
          [
            x.vendor_id,
            ch.gstStatus,
            ch.gstin ?? null,
            ch.pan ?? null,
            ch.stateCode ?? null,
            ch.bankSecure ?? null,
            ch.bankHint ?? null,
          ],
        );
      }
      await c.query(
        `UPDATE vendor_changes SET status = $2, decided_by = app.current_user_id(), decided_at = now(), decision_note = $3 WHERE id = $1`,
        [changeId, dto.approve ? 'approved' : 'rejected', dto.note ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: dto.approve ? 'purchase.vendor.change_approve' : 'purchase.vendor.change_reject',
        entityType: 'vendors',
        entityId: x.vendor_id,
        after: { changeId, note: dto.note ?? null },
      });
      return this.shape(await this.load(c, x.vendor_id));
    });
  }

  /** The requester takes their own waiting change back. */
  async withdrawChange(ctx: RequestContext, changeId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const x = await this.changeOf(c, changeId);
      if (x.status !== 'pending' || x.requested_by !== this.me(ctx))
        throw new DomainError(
          'purchase.not_pending',
          'Only your own waiting change can be withdrawn',
          {
            status: 409,
          },
        );
      await c.query(
        `UPDATE vendor_changes SET status = 'withdrawn', decided_at = now() WHERE id = $1`,
        [changeId],
      );
      return { withdrawn: true };
    });
  }

  /** What waits for a second person: new vendors and changes (the approver sees the bank in full). */
  /**
   * What waits for this user (the header's approvals and My approvals): new vendors and bank / GSTIN /
   * PAN changes they may decide — a vendor approver, never on what they entered or asked for.
   */
  async approvalsMine(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      if (!(await mayApproveVendors(c, ctx))) return { rows: [], canApprove: false };
      const r = await c.query<{
        kind: 'vendor' | 'change';
        id: string;
        vendor_id: string;
        code: string;
        name: string;
        what: string | null;
        since: Date;
      }>(
        `SELECT 'vendor' AS kind, v.id::text, v.id::text AS vendor_id, v.code, v.legal_name AS name, NULL AS what,
                v.created_at AS since
           FROM vendors v
          WHERE v.status = 'pending' AND v.created_by IS DISTINCT FROM app.current_user_id()
         UNION ALL
         SELECT 'change', ch.id::text, v.id::text, v.code, v.legal_name,
                concat_ws(', ', CASE WHEN ch.changes ? 'bankHint' THEN 'bank account' END,
                                CASE WHEN ch.changes->>'gstin' IS DISTINCT FROM ch.before->>'gstin' THEN 'GSTIN' END,
                                CASE WHEN ch.changes->>'pan' IS DISTINCT FROM ch.before->>'pan' THEN 'PAN' END,
                                CASE WHEN ch.changes->>'gstStatus' IS DISTINCT FROM ch.before->>'gstStatus' THEN 'GST status' END),
                ch.requested_at
           FROM vendor_changes ch JOIN vendors v ON v.id = ch.vendor_id
          WHERE ch.status = 'pending' AND ch.requested_by IS DISTINCT FROM app.current_user_id()
          ORDER BY since`,
      );
      return {
        canApprove: true,
        rows: r.rows.map((x) => ({
          kind: x.kind,
          id: x.id,
          vendorId: x.vendor_id,
          title: `${x.code} · ${x.name}`,
          detail: x.kind === 'vendor' ? 'New vendor' : `Change of ${x.what || 'its details'}`,
          since: x.since.toISOString(),
        })),
      };
    });
  }

  async approvals(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await mayView(c, ctx);
      const me = this.me(ctx);
      const vendors = await c.query<VendorDbRow>(
        // eslint-disable-next-line no-restricted-syntax -- SELECT is a fixed fragment
        `${SELECT} WHERE v.status = 'pending' ORDER BY v.created_at`,
      );
      const changes = await c.query<{ id: string }>(
        `SELECT id::text FROM vendor_changes WHERE status = 'pending' ORDER BY requested_at`,
      );
      const full = await mayApproveVendors(c, ctx);
      const list = [];
      for (const ch of changes.rows) {
        const x = await this.changeOf(c, ch.id);
        const v = await this.load(c, x.vendor_id);
        list.push({
          ...this.shapeChange(x, full),
          vendor: { id: v.id, code: v.code, legalName: v.legal_name },
          mine: x.requested_by === me,
        });
      }
      return {
        vendors: vendors.rows.map((v) => ({ ...this.shape(v, full), mine: v.created_by === me })),
        changes: list,
        canApprove: full,
      };
    });
  }

  /** Active, inactive or blacklisted (with a reason); a pending or rejected vendor goes through approval. */
  async setStatus(ctx: RequestContext, vendorId: string, dto: VendorStatusDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const v = await this.load(c, vendorId);
      if (v.status === 'pending' || v.status === 'rejected')
        throw new DomainError(
          'purchase.not_approved',
          'This vendor is not approved yet: it is approved (or rejected) in Vendor approvals',
          { status: 409 },
        );
      if (dto.status === 'blacklisted' && (dto.reason ?? '').length < 3)
        throw new DomainError('validation-failed', 'Give the reason for blacklisting', {
          status: 400,
        });
      await c.query(
        `UPDATE vendors SET status = $2, status_reason = $3, updated_at = now() WHERE id = $1`,
        [vendorId, dto.status, dto.status === 'active' ? null : (dto.reason ?? null)],
      );
      await this.audit.stage(ctx, c, {
        action: `purchase.vendor.${dto.status}`,
        entityType: 'vendors',
        entityId: vendorId,
        before: { status: v.status },
        after: { status: dto.status, reason: dto.reason ?? null },
      });
      return this.shape(await this.load(c, vendorId));
    });
  }

  async addDocument(ctx: RequestContext, vendorId: string, dto: VendorDocumentDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.load(c, vendorId);
      const f = await c.query(
        `SELECT 1 FROM files WHERE id = $1 AND status = 'ready' AND created_by = app.current_user_id()
            AND size_bytes <= 5242880 AND content_type ~ '^(application/pdf|image/(png|jpeg|webp))$'`,
        [dto.fileId],
      );
      if (!f.rowCount)
        throw new DomainError(
          'validation-failed',
          'Upload a PDF or a photo (JPEG, PNG) of up to 5 MB first',
          { status: 400 },
        );
      const r = await c.query<{ id: string }>(
        `INSERT INTO vendor_documents (school_id, vendor_id, kind, file_id, uploaded_by)
         VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id()) RETURNING id::text`,
        [vendorId, dto.kind, dto.fileId],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.vendor.document_add',
        entityType: 'vendors',
        entityId: vendorId,
        after: { kind: dto.kind, fileId: dto.fileId },
      });
      return { id: r.rows[0]!.id };
    });
  }

  async removeDocument(ctx: RequestContext, vendorId: string, docId: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(`DELETE FROM vendor_documents WHERE id = $1 AND vendor_id = $2`, [
        docId,
        vendorId,
      ]);
      if (!r.rowCount) throw new DomainError('not-found', 'Document not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'purchase.vendor.document_remove',
        entityType: 'vendors',
        entityId: vendorId,
        after: { documentId: docId },
      });
      return { removed: true };
    });
  }

  // ---- Excel import (every row checked first; vendors arrive pending; no bank details) ----------------
  /**
   * What the vendor form picks from: the school's countries, states (with their GST codes) and cities
   * (with their PIN), the banks of the Banks master (and the first four letters of their IFSCs), and
   * the code a new vendor would get now.
   */
  async formLists(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const [countries, states, cities, banks, next] = await Promise.all([
        c.query<{ code: string; name: string }>(
          `SELECT code, name FROM countries WHERE status = 'active' ORDER BY (code = 'IN') DESC, name`,
        ),
        c.query<{ code: string; name: string; gstCode: string | null; country: string }>(
          `SELECT s.code, s.name, s.gst_code AS "gstCode", c.code AS country
             FROM states s JOIN countries c ON c.id = s.country_id
            WHERE s.status = 'active' ORDER BY s.name`,
        ),
        c.query<{ name: string; state: string; pincode: string | null }>(
          `SELECT ci.name, s.code AS state, ci.pincode FROM cities ci JOIN states s ON s.id = ci.state_id
            WHERE ci.status = 'active' ORDER BY ci.name`,
        ),
        c.query<{ name: string; prefixes: string[] }>(
          `SELECT name, array_remove(array_agg(DISTINCT upper(left(ifsc, 4))), NULL) AS prefixes
             FROM banks WHERE status = 'active' GROUP BY name ORDER BY name`,
        ),
        c.query<{ code: string }>(
          `SELECT app.purchase_vendor_code(app.current_school_id()) AS code`,
        ),
      ]);
      return {
        countries: countries.rows,
        states: states.rows,
        cities: cities.rows,
        banks: banks.rows,
        nextCode: next.rows[0]!.code,
      };
    });
  }

  static readonly COLUMNS = [
    'Code',
    'Legal name',
    'Trade name',
    'Kind',
    'GST status',
    'GSTIN',
    'PAN',
    'MSME',
    'Udyam no',
    'Address',
    'Country',
    'State',
    'City',
    'PIN',
    'Mobile',
    'E-mail',
    'Contact name',
    'Contact mobile',
    'Contact e-mail',
    'Payment term',
    'Bank',
    'IFSC',
    'Account no',
    'Account holder',
  ] as const;

  /** The Excel column each checked field is in (a row's problems say the column). */
  private static readonly COLUMN_OF: Record<string, string> = {
    code: 'Code',
    legalName: 'Legal name',
    gstStatus: 'GST status',
    gstin: 'GSTIN',
    pan: 'PAN',
    msmeType: 'MSME',
    udyamNo: 'Udyam no',
    address: 'Address',
    country: 'Country',
    state: 'State',
    city: 'City',
    pin: 'PIN',
    phone: 'Mobile',
    email: 'E-mail',
    'contacts.0.name': 'Contact name',
    'contacts.0.phone': 'Contact mobile',
    'contacts.0.email': 'Contact e-mail',
    'bank.bankName': 'Bank',
    'bank.ifsc': 'IFSC',
    'bank.accountNo': 'Account no',
    'bank.holder': 'Account holder',
  };

  async template(ctx: RequestContext) {
    const lists = await this.formLists(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const terms = await c.query<{ code: string; name: string }>(
        `SELECT code, name FROM purchase_payment_terms WHERE status = 'active' ORDER BY code`,
      );
      const stateName = new Map(lists.states.map((x) => [x.code, x.name]));
      const bytes = await templateSheet({
        sheet: 'Vendors',
        columns: [
          {
            header: 'Code',
            width: 12,
            format: 'text',
            note: `Leave empty: the next code is given (${lists.nextCode}, …). Or the school's own code.`,
          },
          { header: 'Legal name', width: 30, required: true },
          { header: 'Trade name', width: 24 },
          {
            header: 'Kind',
            width: 16,
            required: true,
            options: ['manufacturer', 'dealer', 'service_provider'],
          },
          {
            header: 'GST status',
            width: 14,
            required: true,
            options: ['regular', 'composition', 'unregistered'],
          },
          {
            header: 'GSTIN',
            width: 18,
            format: 'text',
            note: 'Required for regular and composition; the PAN and the state are read from it',
          },
          {
            header: 'PAN',
            width: 12,
            format: 'text',
            note: 'Required for an unregistered vendor in India (ABCDE1234F)',
          },
          { header: 'MSME', width: 10, options: ['micro', 'small', 'medium'] },
          {
            header: 'Udyam no',
            width: 22,
            format: 'text',
            note: 'Required with MSME: UDYAM-MH-12-1234567',
          },
          { header: 'Address', width: 30, required: true },
          {
            header: 'Country',
            width: 14,
            required: true,
            options: lists.countries.map((x) => x.name),
            note: 'From the Countries master; empty means India',
          },
          {
            header: 'State',
            width: 18,
            required: true,
            options: lists.states.map((x) => x.name),
            note: "From the States master; a registered vendor's is its GSTIN's state",
          },
          {
            header: 'City',
            width: 22,
            required: true,
            options: lists.cities.map((x) => `${x.name} · ${stateName.get(x.state) ?? x.state}`),
            note: "From the Cities master, a city of the row's state; a missing city is added there first",
          },
          { header: 'PIN', width: 8, required: true, format: 'text', note: 'Six digits in India' },
          {
            header: 'Mobile',
            width: 14,
            required: true,
            format: 'text',
            note: '10 digits starting with 6, 7, 8 or 9',
          },
          { header: 'E-mail', width: 24, required: true, note: 'The purchase order is sent here' },
          { header: 'Contact name', width: 20, required: true },
          {
            header: 'Contact mobile',
            width: 14,
            required: true,
            format: 'text',
            note: '10 digits starting with 6, 7, 8 or 9',
          },
          { header: 'Contact e-mail', width: 24 },
          {
            header: 'Payment term',
            width: 22,
            options: terms.rows.map((t) => `${t.code} · ${t.name}`),
            note: "Empty: the school's default",
          },
          {
            header: 'Bank',
            width: 22,
            options: lists.banks.map((x) => x.name),
            note: 'Optional; when given, IFSC, account no and holder are needed too',
          },
          { header: 'IFSC', width: 13, format: 'text', note: "The bank's IFSC, e.g. SBIN0001234" },
          { header: 'Account no', width: 20, format: 'text', note: '9 to 18 digits' },
          { header: 'Account holder', width: 24, note: 'The name as the bank has it' },
        ],
        guide: [
          'One row per vendor. The columns marked * are required; a drop-down takes only what it lists.',
          "Code: leave empty and the next code is given (V-0001, V-0002 …), or type the school's own.",
          'A regular or composition vendor needs its GSTIN: the PAN and the state are read from it, and the State column must be that state.',
          'An unregistered vendor in India needs its PAN. A vendor outside India is unregistered.',
          "Country, State and City come from the school's masters: a city not in the list is added in Masters → Cities (under its state) first.",
          'PIN: six digits in India. Mobile and contact mobile: 10 digits starting with 6, 7, 8 or 9.',
          'MSME: micro, small or medium, with the Udyam number (UDYAM-MH-12-1234567).',
          "Bank (optional): a bank of the Banks master, its IFSC (it must be that bank's), the account number (9 to 18 digits) and the holder's name.",
          "Every row is checked first (Check the file); only good rows are saved, and every vendor waits for a second person's approval.",
        ],
      });
      return {
        filename: 'vendors-format.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  async import(ctx: RequestContext, dto: VendorImportDto) {
    const rows = await readSheet(dto.file, [...PurchaseVendorsService.COLUMNS]);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await PurchaseVendorsService.seed(c);
      const terms = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, code FROM purchase_payment_terms WHERE status = 'active'`,
          )
        ).rows.map((t) => [t.code, t.id]),
      );
      const seenCodes = new Set<string>();
      const seenIds = new Set<string>();
      const results: Array<{ row: number; code: string; ok: boolean; error?: string }> = [];
      let saved = 0;
      const column = (path: string) => PurchaseVendorsService.COLUMN_OF[path] ?? path;
      for (const { row, cells } of rows) {
        const typed = (cells['Code'] ?? '').trim().toUpperCase();
        // a row is saved whole or not at all
        await c.query('SAVEPOINT vendor_row');
        try {
          const term = (cells['Payment term'] ?? '').split(' · ')[0]!.trim();
          const bankGiven = ['Bank', 'IFSC', 'Account no', 'Account holder'].some(
            (h) => (cells[h] ?? '').trim() !== '',
          );
          const parsed = CreateVendorSchema.safeParse({
            code: typed || undefined,
            legalName: cells['Legal name'],
            tradeName: cells['Trade name'],
            kind: cells['Kind'] || undefined,
            gstStatus: cells['GST status'] || undefined,
            gstin: cells['GSTIN'],
            pan: cells['PAN'],
            msmeType: cells['MSME'] || undefined,
            udyamNo: cells['Udyam no'],
            address: cells['Address'],
            country: cells['Country'] || 'India',
            state: cells['State'],
            city: cells['City'],
            pin: cells['PIN'],
            phone: cells['Mobile'],
            email: cells['E-mail'],
            ...(term && terms.has(term) ? { paymentTermId: terms.get(term) } : {}),
            contacts: [
              {
                name: cells['Contact name'] ?? '',
                phone: cells['Contact mobile'],
                email: cells['Contact e-mail'],
                isMain: true,
              },
            ],
            ...(bankGiven
              ? {
                  bank: {
                    bankName: cells['Bank'] ?? '',
                    ifsc: cells['IFSC'] ?? '',
                    accountNo: cells['Account no'] ?? '',
                    holder: cells['Account holder'] ?? '',
                  },
                }
              : {}),
          });
          if (!parsed.success)
            throw new Error(
              parsed.error.issues
                .map((i) => `${column(i.path.join('.'))}: ${i.message}`)
                .join('; '),
            );
          const v = parsed.data;
          if (term && !terms.has(term)) throw new Error(`Payment term: unknown ${term}`);
          if (v.code && seenCodes.has(v.code)) throw new Error('Code: twice in the file');
          const id = gstIdentity(v);
          const key = id.gstin ?? id.pan;
          if (key && seenIds.has(key))
            throw new Error('The same GSTIN or PAN is twice in the file');
          const f = await checkVendorFields(c, v, {
            creating: true,
            gstState: id.gstin ? id.stateCode : null,
          });
          if (v.code) seenCodes.add(v.code);
          if (key) seenIds.add(key);
          let code = v.code ?? '(next code)';
          if (dto.dryRun) {
            // the checks the save makes too: a code taken, a GSTIN / PAN / bank another vendor has
            if (
              v.code &&
              (await c.query(`SELECT 1 FROM vendors WHERE code = $1`, [v.code])).rowCount
            )
              throw new Error(`Code: vendor code ${v.code} is taken`);
            const dup = await this.duplicates(c, null, { ...id, bank: f.bank ?? null });
            if (dup.length)
              throw new Error(
                `Same ${dup.map((d) => `${d.field} as ${d.code} ${d.name}`).join('; ')}`,
              );
          } else {
            code = (await this.insertVendor(c, v, id, f)).code;
            saved += 1;
          }
          await c.query('RELEASE SAVEPOINT vendor_row');
          results.push({ row, code, ok: true });
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT vendor_row');
          const errs =
            e instanceof DomainError
              ? (e.extra?.errors as Array<{ path: string; message: string }> | undefined)
              : undefined;
          results.push({
            row,
            code: typed,
            ok: false,
            error: errs?.length
              ? errs.map((x) => `${column(x.path)}: ${x.message}`).join('; ')
              : e instanceof Error
                ? e.message
                : String(e),
          });
        }
      }
      if (!dto.dryRun && saved)
        await this.audit.stage(ctx, c, {
          action: 'purchase.vendor.import',
          entityType: 'vendors',
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
}
