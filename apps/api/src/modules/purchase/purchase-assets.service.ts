import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import QRCode from 'qrcode';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { BOOK_VALUE } from './purchase-asset-core';
import { purchaseHead } from './purchase-head';
import { checkListSize, LIST_LIMIT, purchaseListFile, type ListSheet } from './purchase-list-file';
import { istToday, PERSON_OF } from './purchase-stock-core';
import {
  PURCHASE,
  type AssetDto,
  type AssetExportQueryDto,
  type AssetImportDto,
  type AssetListQueryDto,
  type AssetMoveDto,
  type DepreciationRunDto,
} from './purchase.dto';

const r2 = (n: number) => Math.round(n * 100) / 100;
const fyStartOf = (fy: string) => `${fy.slice(0, 4)}-04-01`;
const fyEndOf = (fy: string) => `${String(Number(fy.slice(0, 4)) + 1)}-03-31`;
const fyOf = (day: string) => {
  const y = Number(day.slice(0, 4));
  const start = Number(day.slice(5, 7)) >= 4 ? y : y - 1;
  return `${String(start)}-${String(start + 1).slice(2)}`;
};
const nextFy = (fy: string) => {
  const y = Number(fy.slice(0, 4)) + 1;
  return `${String(y)}-${String(y + 1).slice(2)}`;
};
const days = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
const yearDays = (fy: string) => days(fyStartOf(fy), fyEndOf(fy));

const STATUS_WORDS: Record<string, string> = {
  in_store: 'In store',
  in_use: 'In use',
  in_transit: 'In transit',
  under_repair: 'Under repair',
  lost: 'Lost',
  returned: 'Returned to the vendor',
  written_off: 'Written off',
  disposed: 'Disposed of',
};

// eslint-disable-next-line no-restricted-syntax -- BOOK_VALUE is a fixed fragment
const SELECT = `
  SELECT a.id::text, a.tag, a.item_id::text, i.code AS item_code, i.name AS item, cat.name AS category, a.description, a.make, a.model,
         a.serial_no, a.receipt_line_id::text, g.id::text AS receipt_id, g.number AS receipt, a.order_id::text,
         po.number || CASE WHEN po.revision > 0 THEN '-R' || po.revision ELSE '' END AS order_label, v.legal_name AS vendor,
         a.source_note, a.cost::text, ${BOOK_VALUE('a')}::text AS book_value, a.acquired_on::text, a.put_to_use_on::text, a.status,
         a.store_id::text, st.name AS store, a.department_id::text, d.name AS department, a.location,
         a.custodian_employee_id::text AS custodian_id, ce.display_name AS custodian, ce.employee_code AS custodian_code,
         a.condition, a.warranty_until::text, a.insurer, a.policy_no, a.insured_value::text, a.insurance_renewal::text,
         a.left_on::text, a.book_value_at_exit::text, a.note, a.created_at,
         (SELECT m.id::text FROM asset_movements m WHERE m.asset_id = a.id AND m.status = 'pending') AS pending_id
    FROM assets a
    JOIN purchase_items i ON i.id = a.item_id
    JOIN purchase_item_categories cat ON cat.id = i.category_id
    LEFT JOIN goods_receipt_lines gl ON gl.id = a.receipt_line_id
    LEFT JOIN goods_receipts g ON g.id = gl.receipt_id
    LEFT JOIN purchase_orders po ON po.id = a.order_id
    LEFT JOIN vendors v ON v.id = a.vendor_id
    LEFT JOIN stores st ON st.id = a.store_id
    LEFT JOIN departments d ON d.id = a.department_id
    LEFT JOIN employees ce ON ce.id = a.custodian_employee_id`;

interface AssetRow {
  id: string;
  tag: string;
  item_id: string;
  item_code: string;
  item: string;
  category: string;
  description: string | null;
  make: string | null;
  model: string | null;
  serial_no: string | null;
  receipt_line_id: string | null;
  receipt_id: string | null;
  receipt: string | null;
  order_id: string | null;
  order_label: string | null;
  vendor: string | null;
  source_note: string | null;
  cost: string;
  book_value: string;
  acquired_on: string | null;
  put_to_use_on: string | null;
  status: string;
  store_id: string | null;
  store: string | null;
  department_id: string | null;
  department: string | null;
  location: string | null;
  custodian_id: string | null;
  custodian: string | null;
  custodian_code: string | null;
  condition: string;
  warranty_until: string | null;
  insurer: string | null;
  policy_no: string | null;
  insured_value: string | null;
  insurance_renewal: string | null;
  left_on: string | null;
  book_value_at_exit: string | null;
  note: string | null;
  created_at: Date;
  pending_id: string | null;
}

const CONDITION_WORDS: Record<string, string> = {
  good: 'Good',
  fair: 'Fair',
  poor: 'Poor',
  unserviceable: 'Unserviceable',
};

/** Warranty or insurance ending within 60 days (from today). */
const ENDING = `(a.warranty_until BETWEEN (now() AT TIME ZONE 'Asia/Kolkata')::date AND (now() AT TIME ZONE 'Asia/Kolkata')::date + 60
               OR a.insurance_renewal BETWEEN (now() AT TIME ZONE 'Asia/Kolkata')::date AND (now() AT TIME ZONE 'Asia/Kolkata')::date + 60)`;

/** I keep it, or a custody change to me waits. */
const MINE = `(EXISTS (SELECT 1 FROM employees e WHERE e.id = a.custodian_employee_id AND e.user_id = app.current_user_id())
  OR EXISTS (SELECT 1 FROM asset_movements m JOIN employees e ON e.id = m.to_custodian_id
              WHERE m.asset_id = a.id AND m.status = 'pending' AND e.user_id = app.current_user_id()))`;

/**
 * The asset register (docs/design/84, part 9): every unit of an asset item with its tag (a QR label),
 * where it came from and what it cost, where it is and who keeps it, warranty and insurance, condition;
 * movements — custody (place and custodian, with the new custodian's acknowledgement), repair out and
 * back, lost and found — besides the store's own (received, issued, back, transferred, returned,
 * written off); existing assets from Excel; the yearly depreciation by item category (straight line or
 * written-down value, pro rata from the day put to use) kept per asset and year.
 */
@Injectable()
export class PurchaseAssetsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }
  private seesAll(ctx: RequestContext) {
    return this.has(ctx, PURCHASE.assetManage) || this.has(ctx, PURCHASE.storeView);
  }
  private mustManage(ctx: RequestContext) {
    if (!this.has(ctx, PURCHASE.assetManage))
      throw new DomainError(
        'permission-denied',
        'Only the purchase office keeps the asset register',
        {
          status: 403,
        },
      );
  }

  private shape(a: AssetRow) {
    return {
      id: a.id,
      tag: a.tag,
      itemId: a.item_id,
      itemCode: a.item_code,
      item: a.item,
      category: a.category,
      description: a.description,
      make: a.make,
      model: a.model,
      serialNo: a.serial_no,
      receiptId: a.receipt_id,
      receipt: a.receipt,
      orderId: a.order_id,
      order: a.order_label,
      vendor: a.vendor,
      sourceNote: a.source_note,
      cost: Number(a.cost),
      bookValue: Number(a.book_value),
      acquiredOn: a.acquired_on,
      putToUseOn: a.put_to_use_on,
      status: a.status,
      statusLabel: STATUS_WORDS[a.status] ?? a.status,
      storeId: a.store_id,
      store: a.store,
      departmentId: a.department_id,
      department: a.department,
      location: a.location,
      custodianId: a.custodian_id,
      custodian: a.custodian,
      custodianCode: a.custodian_code,
      condition: a.condition,
      warrantyUntil: a.warranty_until,
      insurer: a.insurer,
      policyNo: a.policy_no,
      insuredValue: a.insured_value === null ? null : Number(a.insured_value),
      insuranceRenewal: a.insurance_renewal,
      leftOn: a.left_on,
      bookValueAtExit: a.book_value_at_exit === null ? null : Number(a.book_value_at_exit),
      note: a.note,
      pending: !!a.pending_id,
    };
  }

  private async load(c: PoolClient, ctx: RequestContext, id: string, lock = false) {
    const r = await c.query<AssetRow>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
      `${SELECT} WHERE a.id = $1 AND ($2 OR ${MINE})${lock ? ' FOR UPDATE OF a' : ''}`,
      [id, this.seesAll(ctx)],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Asset not found', { status: 404 });
    return r.rows[0];
  }

  // ---- lists ---------------------------------------------------------------------------------------
  private mustSee(ctx: RequestContext) {
    if (!this.seesAll(ctx))
      throw new DomainError('permission-denied', 'Only the stores see the asset register', {
        status: 403,
      });
  }

  /** The register's filters (bound as $1 to $8), shared by the page and its file. */
  // eslint-disable-next-line no-restricted-syntax -- ENDING is a fixed fragment; values are bound
  private static readonly WHERE = `WHERE ($1::text IS NULL OR a.status = $1 OR ($1 = 'held' AND a.status IN ('in_store', 'in_use', 'in_transit', 'under_repair', 'lost')))
          AND ($2::bigint IS NULL OR a.item_id = $2) AND ($3::bigint IS NULL OR i.category_id = $3 OR cat.parent_id = $3)
          AND ($4::bigint IS NULL OR a.department_id = $4) AND ($5::bigint IS NULL OR a.store_id = $5)
          AND ($6::bigint IS NULL OR a.custodian_employee_id = $6)
          AND ($7::text IS NULL OR a.tag ILIKE '%' || $7 || '%' OR a.serial_no ILIKE '%' || $7 || '%' OR i.name ILIKE '%' || $7 || '%'
               OR a.location ILIKE '%' || $7 || '%' OR ce.display_name ILIKE '%' || $7 || '%')
          AND (NOT $8 OR ${ENDING})`;

  private static argsOf(q: AssetListQueryDto) {
    return [
      q.status ?? null,
      q.itemId ?? null,
      q.categoryId ?? null,
      q.departmentId ?? null,
      q.storeId ?? null,
      q.custodianId ?? null,
      q.q ?? null,
      q.expiring,
    ];
  }

  /**
   * The register a page at a time (25, 50 or 100), with figures over everything the filters find: how
   * many, cost, book value and the depreciation so far, under repair, lost, and warranty or insurance
   * ending within 60 days.
   */
  async list(ctx: RequestContext, q: AssetListQueryDto) {
    this.mustSee(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const args = PurchaseAssetsService.argsOf(q);
      const sum = await c.query<{
        n: number;
        cost: string;
        book: string;
        repair: number;
        lost: number;
        ending: number;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT count(*)::int AS n, COALESCE(sum(a.cost), 0)::text AS cost, COALESCE(sum(${BOOK_VALUE('a')}), 0)::text AS book,
                count(*) FILTER (WHERE a.status = 'under_repair')::int AS repair, count(*) FILTER (WHERE a.status = 'lost')::int AS lost,
                count(*) FILTER (WHERE ${ENDING})::int AS ending
           FROM assets a JOIN purchase_items i ON i.id = a.item_id JOIN purchase_item_categories cat ON cat.id = i.category_id
           LEFT JOIN employees ce ON ce.id = a.custodian_employee_id ${PurchaseAssetsService.WHERE}`,
        args,
      );
      const r = await c.query<AssetRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} ${PurchaseAssetsService.WHERE} ORDER BY a.tag LIMIT $9 OFFSET $10`,
        [...args, q.size, (q.page - 1) * q.size],
      );
      const f = sum.rows[0]!;
      const cost = Number(f.cost);
      const book = Number(f.book);
      return {
        rows: r.rows.map((x) => this.shape(x)),
        total: f.n,
        cost,
        bookValue: book,
        page: q.page,
        size: q.size,
        figures: {
          depreciation: r2(cost - book),
          underRepair: f.repair,
          lost: f.lost,
          ending: f.ending,
        },
      };
    });
  }

  /**
   * The asset master as filtered on the page (every page, up to 5,000), on the school letterhead: Excel
   * with every field of each asset (where it came from, cost, depreciation so far, book value, where it
   * is and who keeps it, warranty, insurance) and a second sheet of totals by category for the auditor;
   * the PDF a narrower register.
   */
  async exportRegister(ctx: RequestContext, q: AssetExportQueryDto) {
    this.mustSee(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = (
        await c.query<AssetRow>(
          // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
          `${SELECT} ${PurchaseAssetsService.WHERE} ORDER BY cat.name, i.name, a.tag LIMIT $9`,
          [...PurchaseAssetsService.argsOf(q), LIST_LIMIT],
        )
      ).rows.map((x) => this.shape(x));
      checkListSize(rows.length, 'assets');
      const where = (a: (typeof rows)[number]) => a.store ?? a.department ?? '';
      const dep = (a: (typeof rows)[number]) => r2(a.cost - a.bookValue);
      const list: ListSheet =
        q.format === 'pdf'
          ? {
              columns: [
                { label: 'Tag', width: 1.8 },
                { label: 'Item', width: 2.4 },
                { label: 'Make / model / serial', width: 2.4 },
                { label: 'Acquired on', type: 'date' },
                { label: 'Cost (₹)', type: 'money' },
                { label: 'Book value (₹)', type: 'money' },
                { label: 'Where', width: 2.4 },
                { label: 'Custodian', width: 2 },
                { label: 'Condition', width: 1.2 },
                { label: 'Status', width: 1.4 },
              ],
              rows: rows.map((a) => [
                a.tag,
                a.item,
                [[a.make, a.model].filter(Boolean).join(' '), a.serialNo ? `S/N ${a.serialNo}` : '']
                  .filter(Boolean)
                  .join(' · '),
                a.acquiredOn,
                a.cost,
                a.bookValue,
                [where(a), a.location].filter(Boolean).join(' · '),
                a.custodian,
                CONDITION_WORDS[a.condition] ?? a.condition,
                a.statusLabel,
              ]),
            }
          : {
              columns: [
                { label: 'Tag', width: 2 },
                { label: 'Item code', width: 1.6 },
                { label: 'Item', width: 3 },
                { label: 'Category', width: 2.2 },
                { label: 'Description', width: 3 },
                { label: 'Make', width: 1.8 },
                { label: 'Model', width: 1.8 },
                { label: 'Serial no.', width: 2 },
                { label: 'Vendor', width: 3 },
                { label: 'Bill / PO / receipt', width: 3 },
                { label: 'Acquired on', type: 'date' },
                { label: 'Put to use on', type: 'date' },
                { label: 'Cost (₹)', type: 'money' },
                { label: 'Depreciation so far (₹)', type: 'money' },
                { label: 'Book value (₹)', type: 'money' },
                { label: 'Status', width: 1.8 },
                { label: 'Store', width: 2.2 },
                { label: 'Department', width: 2.4 },
                { label: 'Location', width: 2.2 },
                { label: 'Custodian', width: 2.6 },
                { label: 'Emp. code', width: 1.4 },
                { label: 'Condition', width: 1.6 },
                { label: 'Warranty until', type: 'date' },
                { label: 'Insurer', width: 2.4 },
                { label: 'Policy no.', width: 2 },
                { label: 'Insured value (₹)', type: 'money' },
                { label: 'Insurance renewal', type: 'date' },
              ],
              rows: rows.map((a) => [
                a.tag,
                a.itemCode,
                a.item,
                a.category,
                a.description,
                a.make,
                a.model,
                a.serialNo,
                a.vendor,
                [
                  a.order ? `PO ${a.order}` : '',
                  a.receipt ? `GRN ${a.receipt}` : '',
                  a.sourceNote ?? '',
                ]
                  .filter(Boolean)
                  .join(' · '),
                a.acquiredOn,
                a.putToUseOn,
                a.cost,
                dep(a),
                a.bookValue,
                a.statusLabel,
                a.store,
                a.department,
                a.location,
                a.custodian,
                a.custodianCode,
                CONDITION_WORDS[a.condition] ?? a.condition,
                a.warrantyUntil,
                a.insurer,
                a.policyNo,
                a.insuredValue,
                a.insuranceRenewal,
              ]),
            };
      const byCategory = new Map<string, { n: number; cost: number; dep: number; book: number }>();
      for (const a of rows) {
        const t = byCategory.get(a.category) ?? { n: 0, cost: 0, dep: 0, book: 0 };
        t.n += 1;
        t.cost += a.cost;
        t.dep += dep(a);
        t.book += a.bookValue;
        byCategory.set(a.category, t);
      }
      return purchaseListFile({
        format: q.format,
        head: await purchaseHead(c, this.storage),
        title: 'Asset register',
        slug: 'Asset-register',
        words: await this.filterWords(c, q),
        list,
        sum: q.format === 'pdf' ? [4, 5] : [12, 13, 14, 25],
        lines: {
          tab: 'By category',
          title: 'Asset register: totals by category',
          columns: [
            { label: 'Category', width: 3 },
            { label: 'Assets', type: 'number', width: 1.4 },
            { label: 'Cost (₹)', type: 'money' },
            { label: 'Depreciation so far (₹)', type: 'money' },
            { label: 'Book value (₹)', type: 'money' },
          ],
          rows: [...byCategory.entries()].map(([k, t]) => [
            k,
            t.n,
            r2(t.cost),
            r2(t.dep),
            r2(t.book),
          ]),
          sum: [1, 2, 3, 4],
        },
      });
    });
  }

  /** The register's filters in words, for the file's details line. */
  private async filterWords(c: PoolClient, q: AssetListQueryDto) {
    const name = async (sql: string, id: string | undefined) =>
      id ? (await c.query<{ name: string }>(sql, [id])).rows[0]?.name : undefined;
    const [item, category, department, store, custodian] = await Promise.all([
      name(`SELECT name FROM purchase_items WHERE id = $1`, q.itemId),
      name(`SELECT name FROM purchase_item_categories WHERE id = $1`, q.categoryId),
      name(`SELECT name FROM departments WHERE id = $1`, q.departmentId),
      name(`SELECT name FROM stores WHERE id = $1`, q.storeId),
      name(
        `SELECT display_name || ' (' || employee_code || ')' AS name FROM employees WHERE id = $1`,
        q.custodianId,
      ),
    ]);
    return [
      !q.status
        ? 'All assets'
        : q.status === 'held'
          ? 'On the books'
          : (STATUS_WORDS[q.status] ?? q.status),
      item ? `Item: ${item}` : null,
      category ? `Category: ${category}` : null,
      department ? `Department: ${department}` : null,
      store ? `Store: ${store}` : null,
      custodian ? `Custodian: ${custodian}` : null,
      q.q ? `Search: ${q.q}` : null,
      q.expiring ? 'Warranty or insurance ending in 60 days' : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  /** The assets I keep, and custody changes waiting for my acknowledgement (the staff app). */
  async mine(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<AssetRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments
        `${SELECT} WHERE ${MINE} AND a.status NOT IN ('written_off', 'disposed', 'returned') ORDER BY a.tag`,
      );
      const pending = await c.query<{
        id: string;
        asset_id: string;
        tag: string;
        item: string;
        from_name: string | null;
        note: string | null;
        moved_on: string;
      }>(
        `SELECT m.id::text, a.id::text AS asset_id, a.tag, i.name AS item, fe.display_name AS from_name, m.note, m.moved_on::text
           FROM asset_movements m JOIN assets a ON a.id = m.asset_id JOIN purchase_items i ON i.id = a.item_id
           JOIN employees e ON e.id = m.to_custodian_id LEFT JOIN employees fe ON fe.id = m.from_custodian_id
          WHERE m.status = 'pending' AND e.user_id = app.current_user_id() ORDER BY m.id`,
      );
      return {
        rows: r.rows.map((x) => this.shape(x)),
        pending: pending.rows.map((p) => ({
          movementId: p.id,
          assetId: p.asset_id,
          tag: p.tag,
          item: p.item,
          from: p.from_name,
          note: p.note,
          movedOn: p.moved_on,
        })),
      };
    });
  }

  /** The assets an employee keeps (their profile; the exit clearance). */
  async ofEmployee(ctx: RequestContext, employeeId: string) {
    if (!this.seesAll(ctx) && !this.has(ctx, 'people.employee.view'))
      throw new DomainError('permission-denied', 'Only HR and the stores see this', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<AssetRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} WHERE a.custodian_employee_id = $1 AND a.status IN ('in_use', 'under_repair', 'lost') ORDER BY a.tag`,
        [employeeId],
      );
      return { rows: r.rows.map((x) => this.shape(x)) };
    });
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, ctx, id);
      const moves = await c.query<{
        id: string;
        kind: string;
        status: string;
        moved_on: string;
        from_store: string | null;
        to_store: string | null;
        to_department: string | null;
        from_location: string | null;
        to_location: string | null;
        from_custodian: string | null;
        to_custodian: string | null;
        to_custodian_user: string | null;
        vendor: string | null;
        expected_back: string | null;
        cost: string | null;
        doc: string | null;
        note: string | null;
        by: string | null;
        acknowledged_at: Date | null;
        acknowledged_by: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON_OF is a fixed fragment
        `SELECT m.id::text, m.kind, m.status, m.moved_on::text, fs.name AS from_store, ts.name AS to_store, td.name AS to_department,
                m.from_location, m.to_location, fc.display_name AS from_custodian, tc.display_name AS to_custodian,
                tc.user_id::text AS to_custodian_user, v.legal_name AS vendor, m.expected_back::text, m.cost::text, m.doc, m.note,
                (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = m.created_by) AS by, m.acknowledged_at,
                (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = m.acknowledged_by) AS acknowledged_by
           FROM asset_movements m
           LEFT JOIN stores fs ON fs.id = m.from_store_id LEFT JOIN stores ts ON ts.id = m.to_store_id
           LEFT JOIN departments td ON td.id = m.to_department_id
           LEFT JOIN employees fc ON fc.id = m.from_custodian_id LEFT JOIN employees tc ON tc.id = m.to_custodian_id
           LEFT JOIN vendors v ON v.id = m.vendor_id
          WHERE m.asset_id = $1 ORDER BY m.id`,
        [id],
      );
      const dep = await c.query<{
        fy: string;
        method: string;
        opening: string;
        depreciation: string;
        closing: string;
        days: number;
      }>(
        `SELECT fy, method, opening::text, depreciation::text, closing::text, days FROM asset_depreciation WHERE asset_id = $1 ORDER BY fy`,
        [id],
      );
      const manage = this.has(ctx, PURCHASE.assetManage);
      const pending = moves.rows.find((m) => m.status === 'pending');
      const held = ['in_store', 'in_use', 'under_repair', 'lost'].includes(a.status);
      return {
        ...this.shape(a),
        movements: moves.rows.map((m) => ({
          id: m.id,
          kind: m.kind,
          status: m.status,
          movedOn: m.moved_on,
          fromStore: m.from_store,
          toStore: m.to_store,
          toDepartment: m.to_department,
          fromLocation: m.from_location,
          toLocation: m.to_location,
          fromCustodian: m.from_custodian,
          toCustodian: m.to_custodian,
          vendor: m.vendor,
          expectedBack: m.expected_back,
          cost: m.cost === null ? null : Number(m.cost),
          doc: m.doc,
          note: m.note,
          by: m.by,
          acknowledgedAt: m.acknowledged_at?.toISOString() ?? null,
          acknowledgedBy: m.acknowledged_by,
        })),
        depreciation: dep.rows.map((d) => ({
          fy: d.fy,
          method: d.method,
          opening: Number(d.opening),
          depreciation: Number(d.depreciation),
          closing: Number(d.closing),
          days: d.days,
        })),
        can: {
          edit: manage && held,
          move: manage && held && !pending,
          acknowledge: !!pending && pending.to_custodian_user === String(ctx.user.id),
          acknowledgeOnPaper: !!pending && manage,
        },
      };
    });
  }

  // ---- change -------------------------------------------------------------------------------------
  async update(ctx: RequestContext, id: string, dto: AssetDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, ctx, id, true);
      if (['written_off', 'disposed', 'returned'].includes(a.status))
        throw new DomainError('purchase.asset_gone', 'This asset is off the register', {
          status: 409,
        });
      try {
        await c.query('SAVEPOINT asset_update');
        await c.query(
          `UPDATE assets SET description = $2, make = $3, model = $4, serial_no = $5, location = $6, condition = $7, put_to_use_on = $8,
                  warranty_until = $9, insurer = $10, policy_no = $11, insured_value = $12, insurance_renewal = $13, note = $14,
                  updated_at = now()
            WHERE id = $1`,
          [
            id,
            dto.description ?? null,
            dto.make ?? null,
            dto.model ?? null,
            dto.serialNo ?? null,
            dto.location ?? null,
            dto.condition,
            dto.putToUseOn ?? null,
            dto.warrantyUntil ?? null,
            dto.insurer ?? null,
            dto.policyNo ?? null,
            dto.insuredValue ?? null,
            dto.insuranceRenewal ?? null,
            dto.note ?? null,
          ],
        );
        await c.query('RELEASE SAVEPOINT asset_update');
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT asset_update');
        if ((e as { code?: string }).code === '23505')
          throw new DomainError(
            'conflict',
            `Serial number ${dto.serialNo ?? ''} is on another ${a.item} already`,
            {
              status: 409,
            },
          );
        throw e;
      }
      await this.audit.stage(ctx, c, {
        action: 'purchase.asset.update',
        entityType: 'assets',
        entityId: id,
        after: { ...dto },
      });
      return { saved: true };
    });
  }

  /** Custody (place, custodian — waits for the new custodian), repair out / back, lost / found. */
  async move(ctx: RequestContext, id: string, dto: AssetMoveDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const a = await this.load(c, ctx, id, true);
      if (a.pending_id)
        throw new DomainError('conflict', 'A custody change waits for its acknowledgement', {
          status: 409,
        });
      const day = dto.movedOn ?? istToday();
      const allowed: Record<string, string[]> = {
        custody: ['in_use', 'in_store'],
        repair_out: ['in_use', 'in_store'],
        repair_back: ['under_repair'],
        lost: ['in_use', 'in_store'],
        found: ['lost'],
      };
      if (!allowed[dto.kind]!.includes(a.status))
        throw new DomainError(
          'validation-failed',
          `${a.tag} is ${(STATUS_WORDS[a.status] ?? a.status).toLowerCase()}: it cannot be ${dto.kind.replace('_', ' ')} now`,
          { status: 409 },
        );
      const base = {
        from_store_id: a.store_id,
        from_department_id: a.department_id,
        from_location: a.location,
        from_custodian_id: a.custodian_id,
      };
      if (dto.kind === 'custody') {
        if (a.status === 'in_store')
          throw new DomainError(
            'validation-failed',
            'An asset in the store goes out by an issue from the store',
            { status: 409 },
          );
        // a new custodian who signs in acknowledges first; otherwise it applies at once
        let pending = false;
        if (dto.custodianId && dto.custodianId !== a.custodian_id) {
          const e = await c.query<{ user_id: string | null }>(
            `SELECT user_id::text FROM employees WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
            [dto.custodianId],
          );
          if (!e.rows[0]) throw new DomainError('validation-failed', 'The custodian was not found');
          pending = !!e.rows[0].user_id && e.rows[0].user_id !== String(ctx.user.id);
        }
        await c.query(
          `INSERT INTO asset_movements (school_id, asset_id, kind, status, moved_on, from_store_id, from_department_id, from_location,
                                        from_custodian_id, to_department_id, to_location, to_custodian_id, note, created_by)
           VALUES (app.current_school_id(), $1, 'custody', $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, app.current_user_id())`,
          [
            id,
            pending ? 'pending' : 'done',
            day,
            base.from_store_id,
            base.from_department_id,
            base.from_location,
            base.from_custodian_id,
            dto.departmentId ?? a.department_id,
            dto.location ?? null,
            dto.custodianId ?? null,
            dto.note ?? null,
          ],
        );
        if (!pending)
          await c.query(
            `UPDATE assets SET department_id = $2, location = $3, custodian_employee_id = $4, updated_at = now() WHERE id = $1`,
            [
              id,
              dto.departmentId ?? a.department_id,
              dto.location ?? null,
              dto.custodianId ?? null,
            ],
          );
        await this.audit.stage(ctx, c, {
          action: 'purchase.asset.custody',
          entityType: 'assets',
          entityId: id,
          after: { ...dto, pending },
        });
        return { pending };
      }
      const status =
        dto.kind === 'repair_out' ? 'under_repair' : dto.kind === 'lost' ? 'lost' : null;
      // back from repair or found: where it was before (in use with a department, else in the store)
      const back = a.department_id ? 'in_use' : 'in_store';
      if (dto.kind === 'repair_out' && dto.vendorId) {
        const v = await c.query(`SELECT 1 FROM vendors WHERE id = $1`, [dto.vendorId]);
        if (!v.rowCount) throw new DomainError('validation-failed', 'The vendor was not found');
      }
      await c.query(
        `INSERT INTO asset_movements (school_id, asset_id, kind, moved_on, from_store_id, from_department_id, from_location, from_custodian_id,
                                      vendor_id, expected_back, cost, note, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, app.current_user_id())`,
        [
          id,
          dto.kind,
          day,
          base.from_store_id,
          base.from_department_id,
          base.from_location,
          base.from_custodian_id,
          dto.kind === 'repair_out' ? (dto.vendorId ?? null) : null,
          dto.kind === 'repair_out' ? (dto.expectedBack ?? null) : null,
          dto.kind === 'repair_back' ? (dto.cost ?? null) : null,
          dto.note ?? null,
        ],
      );
      await c.query(`UPDATE assets SET status = $2, updated_at = now() WHERE id = $1`, [
        id,
        status ?? back,
      ]);
      await this.audit.stage(ctx, c, {
        action: `purchase.asset.${dto.kind}`,
        entityType: 'assets',
        entityId: id,
        after: { ...dto },
      });
      return { status: status ?? back };
    });
  }

  /** The new custodian takes the asset (or the office records the signed handover). */
  async acknowledge(
    ctx: RequestContext,
    movementId: string,
    note: string | undefined,
    onPaper: boolean,
  ) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const m = (
        await c.query<{
          asset_id: string;
          status: string;
          to_department_id: string | null;
          to_location: string | null;
          to_custodian_id: string | null;
          user_id: string | null;
        }>(
          `SELECT m.asset_id::text, m.status, m.to_department_id::text, m.to_location, m.to_custodian_id::text, e.user_id::text
             FROM asset_movements m LEFT JOIN employees e ON e.id = m.to_custodian_id WHERE m.id = $1 FOR UPDATE OF m`,
          [movementId],
        )
      ).rows[0];
      if (!m || m.status !== 'pending')
        throw new DomainError('purchase.not_waiting', 'Nothing waits for an acknowledgement', {
          status: 409,
        });
      if (onPaper) {
        this.mustManage(ctx);
        if (!note)
          throw new DomainError('validation-failed', 'Say who signed for it', { status: 400 });
      } else if (m.user_id !== String(ctx.user.id))
        throw new DomainError('permission-denied', 'Only the new custodian acknowledges it', {
          status: 403,
        });
      await c.query(
        `UPDATE asset_movements SET status = 'done', acknowledged_by = app.current_user_id(), acknowledged_at = now(),
                note = COALESCE(note || ' · ', '') || COALESCE($2, '') WHERE id = $1`,
        [movementId, note ?? null],
      );
      await c.query(
        `UPDATE assets SET department_id = COALESCE($2, department_id), location = $3, custodian_employee_id = $4, updated_at = now()
          WHERE id = $1`,
        [m.asset_id, m.to_department_id, m.to_location, m.to_custodian_id],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.asset.acknowledge',
        entityType: 'assets',
        entityId: m.asset_id,
        after: { movement: movementId, onPaper },
      });
      return { acknowledged: true };
    });
  }

  /** The custody change cancelled before it is acknowledged (the office). */
  async cancelMove(ctx: RequestContext, movementId: string) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(
        `UPDATE asset_movements SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`,
        [movementId],
      );
      if (!r.rowCount)
        throw new DomainError('purchase.not_waiting', 'Nothing waits for an acknowledgement', {
          status: 409,
        });
      return { cancelled: true };
    });
  }

  // ---- labels ---------------------------------------------------------------------------------------
  /** A sheet of QR labels (3 × 8 on A4): the tag as a QR code, the tag, the item and the school. */
  async labels(ctx: RequestContext, ids: string[]) {
    if (!this.seesAll(ctx))
      throw new DomainError('permission-denied', 'Only the stores print asset labels', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        tag: string;
        item: string;
        serial_no: string | null;
        school: string;
      }>(
        `SELECT a.tag, i.name AS item, a.serial_no, (SELECT name FROM schools WHERE id = app.current_school_id()) AS school
           FROM assets a JOIN purchase_items i ON i.id = a.item_id WHERE a.id = ANY($1::bigint[]) ORDER BY a.tag`,
        [ids],
      );
      if (!r.rows.length) throw new DomainError('not-found', 'No asset to label', { status: 404 });
      const latin = (s: string) => s.replace(/[^\x20-\x7E\xA0-\xFF]/g, '?');
      const pdf = await PDFDocument.create();
      pdf.setTitle('Asset labels');
      const font = await pdf.embedFont(StandardFonts.Helvetica);
      const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
      const [W, H] = [595.28, 841.89];
      const cols = 3;
      const rows = 8;
      const mx = 14;
      const my = 22;
      const cw = (W - 2 * mx) / cols;
      const ch = (H - 2 * my) / rows;
      let page = pdf.addPage([W, H]);
      for (const [n, a] of r.rows.entries()) {
        if (n && n % (cols * rows) === 0) page = pdf.addPage([W, H]);
        const k = n % (cols * rows);
        const x = mx + (k % cols) * cw;
        const y = H - my - (Math.floor(k / cols) + 1) * ch;
        page.drawRectangle({
          x: x + 2,
          y: y + 2,
          width: cw - 4,
          height: ch - 4,
          borderColor: rgb(0.8, 0.82, 0.86),
          borderWidth: 0.5,
        });
        const png = await QRCode.toBuffer(a.tag, {
          type: 'png',
          margin: 0,
          width: 160,
          errorCorrectionLevel: 'M',
        });
        const img = await pdf.embedPng(new Uint8Array(png));
        const s = ch - 22;
        page.drawImage(img, { x: x + 8, y: y + 11, width: s, height: s });
        const tx = x + 14 + s;
        const tw = cw - s - 22;
        const fit = (t: string, f: typeof font, size: number) => {
          let out = latin(t);
          while (out.length > 1 && f.widthOfTextAtSize(out, size) > tw) out = out.slice(0, -1);
          return out;
        };
        page.drawText(fit(a.school, font, 6.5), {
          x: tx,
          y: y + ch - 20,
          size: 6.5,
          font,
          color: rgb(0.36, 0.4, 0.46),
        });
        page.drawText(fit(a.tag, bold, 9), { x: tx, y: y + ch - 34, size: 9, font: bold });
        page.drawText(fit(a.item, font, 7.5), { x: tx, y: y + ch - 47, size: 7.5, font });
        if (a.serial_no)
          page.drawText(fit(`S/N ${a.serial_no}`, font, 6.5), {
            x: tx,
            y: y + ch - 59,
            size: 6.5,
            font,
          });
      }
      return { bytes: Buffer.from(await pdf.save()), filename: 'asset-labels.pdf' };
    });
  }

  // ---- import ---------------------------------------------------------------------------------------
  /**
   * The format's headings, and the older format's names for the same columns (a sheet downloaded before
   * 9 Nov 2026 is still read): the item, store and custodian typed as codes, the cost and the reference.
   */
  private static readonly NAMES = {
    item: ['Item', 'Item code'],
    cost: ['Cost per unit (₹)', 'Cost'],
    store: ['Store', 'Store code'],
    custodian: ['Custodian', 'Custodian code'],
    reference: ['Bill / PO no.', 'Reference'],
  } as const;
  private static readonly OPTIONAL = [
    ...Object.values(PurchaseAssetsService.NAMES).flat(),
    'Quantity',
    'Tag',
    'Description',
    'Make',
    'Model',
    'Serial',
    'Acquired on',
    'Put to use on',
    'Department',
    'Location',
    'Condition',
    'Warranty until',
    'Vendor',
  ];
  /** units one row makes at most, and in one file */
  private static readonly MAX_UNITS = 500;
  private static readonly MAX_FILE_UNITS = 5000;

  /** What the drop-downs offer: "Name (CODE)" for items, stores and staff; names for the rest. */
  private async importLists(c: PoolClient) {
    const [items, stores, deps, staff, vendors] = await Promise.all([
      c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM purchase_items WHERE item_type = 'asset' AND status = 'active' ORDER BY name LIMIT 5000`,
      ),
      c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM stores WHERE status = 'active' ORDER BY (kind = 'main') DESC, name`,
      ),
      c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM departments WHERE status = 'active' ORDER BY sort_order, name`,
      ),
      c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, employee_code AS code, display_name AS name FROM employees
          WHERE deleted_at IS NULL AND status = 'active' AND employee_code IS NOT NULL ORDER BY display_name LIMIT 5000`,
      ),
      c.query<{ id: string; name: string }>(
        `SELECT id::text, legal_name AS name FROM vendors WHERE status = 'active' ORDER BY legal_name LIMIT 5000`,
      ),
    ]);
    const label = (x: { code: string; name: string }) => `${x.name} (${x.code})`;
    return {
      items: items.rows,
      stores: stores.rows,
      deps: deps.rows,
      staff: staff.rows,
      vendors: vendors.rows,
      label,
    };
  }

  async importTemplate(ctx: RequestContext) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const l = await this.importLists(c);
      const day = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d));
      const bytes = await templateSheet({
        sheet: 'Assets',
        hideLists: true,
        columns: [
          {
            header: 'Item',
            width: 34,
            required: true,
            options: l.items.map(l.label),
            note: 'An item of type asset (set up under Purchase → Items). The code in brackets is read; the code alone works too.',
          },
          {
            header: 'Quantity',
            width: 10,
            format: 'whole',
            check: true,
            max: PurchaseAssetsService.MAX_UNITS,
            note: 'Empty means 1. More than 1 (40 chairs): that many assets, each with a new tag and QR label; leave Tag and Serial empty.',
          },
          {
            header: 'Tag',
            width: 16,
            format: 'text',
            note: 'The tag already on it (from the old register). Empty: a new AST tag.',
          },
          { header: 'Description', width: 28, note: 'What it is, in a few words' },
          { header: 'Make', width: 16 },
          { header: 'Model', width: 16 },
          { header: 'Serial', width: 18, format: 'text', note: 'Its serial number, if it has one' },
          {
            header: 'Cost per unit (₹)',
            width: 16,
            required: true,
            format: 'money',
            check: true,
            note: 'What one unit cost, in rupees, without the ₹ sign',
          },
          {
            header: 'Acquired on',
            width: 14,
            format: 'date',
            check: true,
            note: 'The day it was bought, as a date (10-07-2023)',
          },
          {
            header: 'Put to use on',
            width: 14,
            format: 'date',
            check: true,
            note: 'Depreciation runs from this day (empty: the day bought)',
          },
          {
            header: 'Store',
            width: 26,
            options: l.stores.map(l.label),
            note: 'Kept in a store: pick it. Leave Department empty.',
          },
          {
            header: 'Department',
            width: 26,
            options: l.deps.map((x) => x.name),
            note: 'In use with a department: pick it. Leave Store empty.',
          },
          { header: 'Location', width: 20, note: 'Room, lab or block' },
          {
            header: 'Custodian',
            width: 30,
            options: l.staff.map(l.label),
            note: 'Who keeps it. The employee code in brackets is read.',
          },
          {
            header: 'Condition',
            width: 14,
            options: ['Good', 'Fair', 'Poor', 'Unserviceable'],
            note: 'Empty means Good',
          },
          {
            header: 'Warranty until',
            width: 14,
            format: 'date',
            check: true,
          },
          {
            header: 'Vendor',
            width: 28,
            options: l.vendors.map((x) => x.name),
            allowNew: true,
            note: 'Who supplied it. A vendor not in the list: type the name; it is kept as a note.',
          },
          { header: 'Bill / PO no.', width: 18, note: 'The old bill or PO number' },
        ],
        guide: [
          'One row per asset; or one row with a Quantity for many alike (40 chairs bought together: Quantity 40). Each unit gets a new tag and QR label.',
          'A unit with its own old tag or serial number: one row each (Quantity 1 or empty).',
          'Pick the Item, Store, Department, Custodian, Condition and Vendor from the drop-down (in Excel, click the cell, then the arrow; newer Excel finds as you type). The code in brackets is what is read.',
          'Kept in a store: pick the Store. In use: pick the Department, and the Location and Custodian. Not both a store and a department.',
          'Cost per unit in rupees. Dates as dates (10-07-2023). Depreciation runs from Put to use on, else the day bought.',
          'Assets lying in a store can instead go in as that store’s opening stock (Purchase → Stores → the store → Post opening stock): that puts the stock in and makes the assets too. Use one way, not both, or they are counted twice.',
          'Upload the sheet and press Check: every row is checked first and its problems shown; then save the good rows.',
        ],
        // made-up rows (the Example sheet is never read), the same shape as the drop-downs' values
        examples: [
          [
            'Laptop (LAPTOP)',
            1,
            null,
            'Computer lab laptop',
            'Dell',
            'Latitude 3420',
            'SN123',
            52000,
            day(2023, 7, 10),
            day(2023, 7, 15),
            null,
            'Computer Science',
            'Computer lab 2',
            'Teacher name (E104)',
            'Good',
            day(2026, 7, 9),
            'City Computers',
            'PO 1182',
          ],
          [
            'Student chair (CHAIR)',
            40,
            null,
            'Classroom chairs',
            'Godrej',
            null,
            null,
            1800,
            day(2022, 4, 5),
            day(2022, 4, 5),
            null,
            'Primary wing',
            'Block A',
            null,
            'Fair',
            null,
            'Local supplier',
            'Bill 77',
          ],
          [
            'Projector (PROJ)',
            1,
            'OLD-0042',
            'Spare projector',
            'Epson',
            'EB-X51',
            'X51-998',
            35000,
            day(2021, 1, 20),
            null,
            'Main store (MAIN)',
            null,
            null,
            null,
            'Good',
            null,
            null,
            null,
          ],
        ],
      });
      return {
        filename: 'assets-format.xlsx',
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  /**
   * Existing assets from the sheet: every row checked (the item, store or department, custodian, vendor
   * as picked or typed; the quantity, cost and dates; tags and serial numbers not used already), then the
   * good rows saved — a row of Quantity 40 makes 40 assets with new tags. The store's stock is not changed.
   */
  async importAssets(ctx: RequestContext, dto: AssetImportDto) {
    this.mustManage(ctx);
    const N = PurchaseAssetsService.NAMES;
    const rows = await readSheet(dto.file, [], PurchaseAssetsService.OPTIONAL, [
      [...N.item],
      [...N.cost],
    ]);
    const pick = (cells: Record<string, string>, names: readonly string[]) =>
      names.map((n) => (cells[n] ?? '').trim()).find(Boolean) ?? '';
    /** the code of "Name (CODE)", or the cell as typed */
    const inBrackets = (v: string) => /\(([^()]+)\)\s*$/.exec(v)?.[1]?.trim() ?? v.trim();
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const l = await this.importLists(c);
      /** found by code (or the code in brackets), else by the name when only one has it */
      const finder = (xs: Array<{ id: string; code: string; name: string }>) => {
        const byCode = new Map(xs.map((x) => [x.code.toUpperCase(), x]));
        const byName = new Map<string, (typeof xs)[number] | null>();
        for (const x of xs) {
          const k = x.name.toLowerCase();
          byName.set(k, byName.has(k) ? null : x);
        }
        return (v: string) =>
          byCode.get(inBrackets(v).toUpperCase()) ??
          byCode.get(v.trim().toUpperCase()) ??
          byName.get(v.trim().toLowerCase()) ??
          undefined;
      };
      const itemOf = finder(l.items);
      // an inactive asset item, or one of another type, is told apart from a typing mistake
      const allItems = new Map(
        (
          await c.query<{ code: string; item_type: string; status: string }>(
            `SELECT upper(code) AS code, item_type, status FROM purchase_items`,
          )
        ).rows.map((r) => [r.code, r]),
      );
      const storeOf = finder(l.stores);
      const staffOf = finder(l.staff);
      const deps = new Map(l.deps.map((d) => [d.name.toLowerCase(), d.id]));
      const vendors = new Map(l.vendors.map((v) => [v.name.toLowerCase(), v]));
      const tags = new Set(
        (await c.query<{ tag: string }>(`SELECT upper(tag) AS tag FROM assets`)).rows.map(
          (r) => r.tag,
        ),
      );
      const serials = new Set(
        (
          await c.query<{ k: string }>(
            `SELECT item_id::text || '|' || upper(serial_no) AS k FROM assets WHERE serial_no IS NOT NULL AND status <> 'returned'`,
          )
        ).rows.map((r) => r.k),
      );
      const today = istToday();
      const day = (v: string) => {
        const t = (v ?? '').trim();
        if (!t) return null;
        const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(t);
        const iso = m ? `${m[3]}-${m[2]!.padStart(2, '0')}-${m[1]!.padStart(2, '0')}` : t;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return 'bad';
        const d = new Date(`${iso}T00:00:00Z`);
        return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? 'bad' : iso;
      };
      const results: Array<{
        row: number;
        item: string;
        units: number;
        tag: string;
        cost: number;
        ok: boolean;
        error?: string;
      }> = [];
      const good: Array<{
        at: number;
        units: number;
        rec: Record<string, string | null>;
      }> = [];
      const seenTags = new Set<string>();
      const seenSerials = new Set<string>();
      let fileUnits = 0;
      for (const { row, cells } of rows) {
        const itemCell = pick(cells, N.item);
        const costCell = pick(cells, N.cost);
        if (!itemCell && !costCell) continue;
        const problems: string[] = [];
        const item = itemCell ? itemOf(itemCell) : undefined;
        if (!itemCell) problems.push('pick the item');
        else if (!item) {
          const other = allItems.get(inBrackets(itemCell).toUpperCase());
          problems.push(
            !other
              ? `no asset item is ${itemCell}`
              : other.item_type !== 'asset'
                ? `${itemCell} is not an item of type asset (its assets are not tracked one by one)`
                : `${itemCell} is switched off`,
          );
        }
        const qtyCell = (cells['Quantity'] ?? '').trim();
        const units = qtyCell ? Number(qtyCell) : 1;
        if (!Number.isInteger(units) || units < 1 || units > PurchaseAssetsService.MAX_UNITS)
          problems.push(
            `the quantity is a whole number from 1 to ${String(PurchaseAssetsService.MAX_UNITS)}`,
          );
        const cost = Number(costCell.replace(/[₹,\s]/g, ''));
        if (!costCell) problems.push('give the cost per unit');
        else if (!Number.isFinite(cost) || cost < 0) problems.push('the cost is not a number');
        const tag = (cells['Tag'] ?? '').trim();
        const serial = (cells['Serial'] ?? '').trim();
        if (units > 1 && (tag || serial))
          problems.push(
            'a row of more than 1 makes new tags: leave Tag and Serial empty, or give each unit its own row',
          );
        if (tag && (tags.has(tag.toUpperCase()) || seenTags.has(tag.toUpperCase())))
          problems.push(`tag ${tag} is used already`);
        if (item && serial) {
          const k = `${item.id}|${serial.toUpperCase()}`;
          if (serials.has(k) || seenSerials.has(k))
            problems.push(`serial ${serial} is on another ${item.name} already`);
          seenSerials.add(k);
        }
        const storeCell = pick(cells, N.store);
        const store = storeCell ? storeOf(storeCell) : undefined;
        if (storeCell && !store) problems.push(`no store is ${storeCell}`);
        const depCell = (cells['Department'] ?? '').trim();
        const departmentId = depCell ? deps.get(depCell.toLowerCase()) : undefined;
        if (depCell && !departmentId) problems.push(`no department is called ${depCell}`);
        if (storeCell && depCell) problems.push('either a store or a department, not both');
        if (!storeCell && !depCell) problems.push('pick the store or the department');
        const custCell = pick(cells, N.custodian);
        const custodian = custCell ? staffOf(custCell) : undefined;
        if (custCell && !custodian) problems.push(`no employee is ${custCell}`);
        const condition = (cells['Condition'] ?? '').trim().toLowerCase() || 'good';
        if (!['good', 'fair', 'poor', 'unserviceable'].includes(condition))
          problems.push('the condition is Good, Fair, Poor or Unserviceable');
        const dates = {
          acquired: day(cells['Acquired on'] ?? ''),
          putToUse: day(cells['Put to use on'] ?? ''),
          warranty: day(cells['Warranty until'] ?? ''),
        };
        if (Object.values(dates).includes('bad'))
          problems.push('a date is not a date (10-07-2023)');
        else {
          if (
            (dates.acquired && dates.acquired > today) ||
            (dates.putToUse && dates.putToUse > today)
          )
            problems.push('bought or put to use after today');
          if (dates.acquired && dates.putToUse && dates.putToUse < dates.acquired)
            problems.push('put to use before it was bought');
        }
        if (tag) seenTags.add(tag.toUpperCase());
        const shown = item ? `${item.name} (${item.code})` : itemCell;
        if (problems.length) {
          results.push({
            row,
            item: shown,
            units: Number.isInteger(units) ? units : 0,
            tag,
            cost: 0,
            ok: false,
            error: problems.join('; '),
          });
          continue;
        }
        fileUnits += units;
        const vendorCell = (cells['Vendor'] ?? '').trim();
        const vendor = vendorCell ? vendors.get(vendorCell.toLowerCase()) : undefined;
        const reference = pick(cells, N.reference);
        results.push({ row, item: shown, units, tag, cost: r2(cost * units), ok: true });
        good.push({
          at: results.length - 1,
          units,
          rec: {
            itemId: item!.id,
            tag: tag || null,
            description: (cells['Description'] ?? '').trim().slice(0, 300) || null,
            make: (cells['Make'] ?? '').trim().slice(0, 80) || null,
            model: (cells['Model'] ?? '').trim().slice(0, 80) || null,
            serial: serial.slice(0, 60) || null,
            cost: String(cost),
            acquired: dates.acquired,
            putToUse: dates.putToUse ?? (departmentId ? dates.acquired : null),
            storeId: store?.id ?? null,
            departmentId: departmentId ?? null,
            location: (cells['Location'] ?? '').trim().slice(0, 120) || null,
            custodianId: custodian?.id ?? null,
            condition,
            warranty: dates.warranty,
            vendorId: vendor?.id ?? null,
            source:
              [vendor ? '' : vendorCell, reference].filter(Boolean).join(' · ').slice(0, 300) ||
              'From the old register',
          },
        });
      }
      if (fileUnits > PurchaseAssetsService.MAX_FILE_UNITS)
        throw new DomainError(
          'validation-failed',
          `The sheet makes ${fileUnits.toLocaleString('en-IN')} assets; up to ${PurchaseAssetsService.MAX_FILE_UNITS.toLocaleString('en-IN')} at a time: split the file`,
          { status: 400 },
        );
      const totals = {
        units: results.filter((r) => r.ok).reduce((a, r) => a + r.units, 0),
        cost: r2(results.filter((r) => r.ok).reduce((a, r) => a + r.cost, 0)),
      };
      if (dto.dryRun) return { rows: results, saved: 0, ...totals };
      let saved = 0;
      for (const g of good) {
        const a = g.rec;
        await c.query('SAVEPOINT asset_import');
        try {
          for (let k = 0; k < g.units; k += 1) {
            const tag =
              a.tag ??
              (await c.query<{ n: string }>(`SELECT app.purchase_next_number('asset') AS n`))
                .rows[0]!.n;
            const id = (
              await c.query<{ id: string }>(
                `INSERT INTO assets (school_id, tag, item_id, description, make, model, serial_no, cost, acquired_on, put_to_use_on, status,
                                     store_id, department_id, location, custodian_employee_id, condition, warranty_until, vendor_id, source_note, created_by)
                 VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, app.current_user_id())
                 RETURNING id::text`,
                [
                  tag,
                  a.itemId,
                  a.description,
                  a.make,
                  a.model,
                  a.serial,
                  a.cost,
                  a.acquired,
                  a.putToUse,
                  a.storeId ? 'in_store' : 'in_use',
                  a.storeId,
                  a.departmentId,
                  a.location,
                  a.custodianId,
                  a.condition,
                  a.warranty,
                  a.vendorId,
                  a.source,
                ],
              )
            ).rows[0]!.id;
            await c.query(
              `INSERT INTO asset_movements (school_id, asset_id, kind, to_store_id, to_department_id, to_custodian_id, note, created_by)
               VALUES (app.current_school_id(), $1, 'imported', $2, $3, $4, $5, app.current_user_id())`,
              [id, a.storeId, a.departmentId, a.custodianId, a.source],
            );
          }
          await c.query('RELEASE SAVEPOINT asset_import');
          saved += g.units;
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT asset_import');
          if ((e as { code?: string }).code !== '23505') throw e;
          Object.assign(results[g.at]!, {
            ok: false,
            error: 'the tag or serial number is on another asset already',
          });
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'purchase.asset.import',
        entityType: 'assets',
        entityId: '0',
        after: { saved, rows: good.length },
      });
      return {
        rows: results,
        saved,
        units: results.filter((r) => r.ok).reduce((a, r) => a + r.units, 0),
        cost: r2(results.filter((r) => r.ok).reduce((a, r) => a + r.cost, 0)),
      };
    });
  }

  // ---- depreciation ---------------------------------------------------------------------------------
  /**
   * The year's depreciation of every asset on the books: straight line ((cost − salvage) / life a year)
   * or written-down value (book value × rate), pro rata from the day put to use (or bought) and until
   * it left the books; never below the salvage value. Earlier years not yet worked out are worked out
   * first, so each year opens at the last one's closing. A year is run again only while no later year
   * has been.
   */
  async depreciate(ctx: RequestContext, dto: DepreciationRunDto) {
    this.mustManage(ctx);
    const today = istToday();
    if (fyStartOf(dto.fy) > today)
      throw new DomainError('validation-failed', `${dto.fy} has not started`, { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const later = await c.query<{ fy: string }>(
        `SELECT fy FROM asset_depreciation_runs WHERE fy > $1 ORDER BY fy LIMIT 1`,
        [dto.fy],
      );
      if (later.rows[0])
        throw new DomainError(
          'conflict',
          `${later.rows[0].fy} has been run: an earlier year is not run again`,
          { status: 409 },
        );
      const assets = await c.query<{
        id: string;
        cost: string;
        start: string | null;
        left_on: string | null;
        method: string | null;
        life: string | null;
        salvage: string | null;
        rate: string | null;
      }>(
        `SELECT a.id::text, a.cost::text, COALESCE(a.put_to_use_on, a.acquired_on, (a.created_at AT TIME ZONE 'Asia/Kolkata')::date)::text AS start,
                a.left_on::text, COALESCE(cat.dep_method, par.dep_method) AS method,
                COALESCE(cat.useful_life_years, par.useful_life_years)::text AS life,
                COALESCE(cat.salvage_pct, par.salvage_pct, 5)::text AS salvage,
                COALESCE(cat.wdv_rate_pct, par.wdv_rate_pct)::text AS rate
           FROM assets a JOIN purchase_items i ON i.id = a.item_id
           JOIN purchase_item_categories cat ON cat.id = i.category_id
           LEFT JOIN purchase_item_categories par ON par.id = cat.parent_id
          WHERE a.status <> 'returned'`,
      );
      const end = fyEndOf(dto.fy);
      const rows: Array<{
        assetId: string;
        fy: string;
        method: string;
        opening: number;
        dep: number;
        closing: number;
        days: number;
      }> = [];
      for (const a of assets.rows) {
        if (!a.method || !a.start || a.start > end) continue;
        if (a.method === 'slm' && !a.life) continue;
        if (a.method === 'wdv' && !a.rate) continue;
        const last = (
          await c.query<{ fy: string; closing: string }>(
            `SELECT fy, closing::text FROM asset_depreciation WHERE asset_id = $1 AND fy < $2 ORDER BY fy DESC LIMIT 1`,
            [a.id, dto.fy],
          )
        ).rows[0];
        const cost = Number(a.cost);
        const salvage = a.method === 'slm' ? (cost * Number(a.salvage)) / 100 : 0;
        let fy = last ? nextFy(last.fy) : fyOf(a.start);
        let book = last ? Number(last.closing) : cost;
        while (fy <= dto.fy) {
          const from = a.start > fyStartOf(fy) ? a.start : fyStartOf(fy);
          const to = a.left_on && a.left_on < fyEndOf(fy) ? a.left_on : fyEndOf(fy);
          const d = a.left_on && a.left_on < fyStartOf(fy) ? 0 : Math.max(0, days(from, to));
          const share = d / yearDays(fy);
          let dep =
            a.method === 'slm'
              ? ((cost - salvage) / Number(a.life)) * share
              : (book * Number(a.rate) * share) / 100;
          dep = r2(Math.max(0, Math.min(dep, book - salvage)));
          rows.push({
            assetId: a.id,
            fy,
            method: a.method,
            opening: r2(book),
            dep,
            closing: r2(book - dep),
            days: d,
          });
          book = r2(book - dep);
          fy = nextFy(fy);
        }
      }
      const total = r2(rows.filter((x) => x.fy === dto.fy).reduce((s, x) => s + x.dep, 0));
      const count = rows.filter((x) => x.fy === dto.fy).length;
      if (dto.dryRun)
        return {
          fy: dto.fy,
          assets: count,
          total,
          earlierYears: rows.length - count,
          saved: false,
        };
      await c.query(`DELETE FROM asset_depreciation WHERE fy = $1`, [dto.fy]);
      for (const x of rows)
        await c.query(
          `INSERT INTO asset_depreciation (school_id, asset_id, fy, method, opening, depreciation, closing, days)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (asset_id, fy) DO UPDATE SET method = EXCLUDED.method, opening = EXCLUDED.opening,
             depreciation = EXCLUDED.depreciation, closing = EXCLUDED.closing, days = EXCLUDED.days`,
          [x.assetId, x.fy, x.method, x.opening, x.dep, x.closing, x.days],
        );
      for (const fy of new Set(rows.map((x) => x.fy)))
        await c.query(
          `INSERT INTO asset_depreciation_runs (school_id, fy, assets, total, run_by)
           SELECT app.current_school_id(), $1, count(*), COALESCE(sum(depreciation), 0), app.current_user_id()
             FROM asset_depreciation WHERE fy = $1
           ON CONFLICT (school_id, fy) DO UPDATE SET assets = EXCLUDED.assets, total = EXCLUDED.total, run_by = EXCLUDED.run_by, run_at = now()`,
          [fy],
        );
      await this.audit.stage(ctx, c, {
        action: 'purchase.asset.depreciate',
        entityType: 'asset_depreciation_runs',
        entityId: dto.fy.replace('-', ''),
        after: { fy: dto.fy, assets: count, total },
      });
      return { fy: dto.fy, assets: count, total, earlierYears: rows.length - count, saved: true };
    });
  }

  /** The depreciation runs made, and the form lists of the register. */
  async lists(ctx: RequestContext) {
    if (!this.seesAll(ctx))
      throw new DomainError('permission-denied', 'Only the stores see the asset register', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const runs = await c.query<{
        fy: string;
        assets: number;
        total: string;
        run_at: Date;
        by: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON_OF is a fixed fragment
        `SELECT r.fy, r.assets, r.total::text, r.run_at, (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = r.run_by) AS by
           FROM asset_depreciation_runs r ORDER BY r.fy DESC`,
      );
      const items = await c.query<{ id: string; code: string; name: string }>(
        `SELECT id::text, code, name FROM purchase_items WHERE item_type = 'asset' ORDER BY name`,
      );
      const categories = await c.query<{ id: string; name: string; method: string | null }>(
        `SELECT id::text, name, dep_method AS method FROM purchase_item_categories ORDER BY name`,
      );
      const deps = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM departments WHERE status = 'active' ORDER BY sort_order, name`,
      );
      const stores = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM stores WHERE status = 'active' ORDER BY (kind = 'main') DESC, name`,
      );
      const staff = await c.query<{
        id: string;
        code: string;
        name: string;
        department: string | null;
      }>(
        `SELECT id::text, employee_code AS code, display_name AS name, department FROM employees
          WHERE deleted_at IS NULL AND status = 'active' ORDER BY display_name LIMIT 3000`,
      );
      const vendors = await c.query<{ id: string; name: string }>(
        `SELECT id::text, legal_name AS name FROM vendors WHERE status = 'active' ORDER BY legal_name LIMIT 3000`,
      );
      const today = istToday();
      return {
        runs: runs.rows.map((r) => ({
          fy: r.fy,
          assets: r.assets,
          total: Number(r.total),
          runAt: r.run_at.toISOString(),
          by: r.by,
        })),
        currentFy: fyOf(today),
        items: items.rows,
        categories: categories.rows,
        departments: deps.rows,
        stores: stores.rows,
        staff: staff.rows,
        vendors: vendors.rows,
      };
    });
  }
}
