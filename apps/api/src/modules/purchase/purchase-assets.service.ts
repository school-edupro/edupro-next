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
import { istToday, PERSON_OF } from './purchase-stock-core';
import {
  PURCHASE,
  type AssetDto,
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
  async list(ctx: RequestContext, q: AssetListQueryDto) {
    if (!this.seesAll(ctx))
      throw new DomainError('permission-denied', 'Only the stores see the asset register', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const where = `WHERE ($1::text IS NULL OR a.status = $1 OR ($1 = 'held' AND a.status IN ('in_store', 'in_use', 'in_transit', 'under_repair', 'lost')))
          AND ($2::bigint IS NULL OR a.item_id = $2) AND ($3::bigint IS NULL OR i.category_id = $3 OR cat.parent_id = $3)
          AND ($4::bigint IS NULL OR a.department_id = $4) AND ($5::bigint IS NULL OR a.store_id = $5)
          AND ($6::bigint IS NULL OR a.custodian_employee_id = $6)
          AND ($7::text IS NULL OR a.tag ILIKE '%' || $7 || '%' OR a.serial_no ILIKE '%' || $7 || '%' OR i.name ILIKE '%' || $7 || '%'
               OR a.location ILIKE '%' || $7 || '%' OR ce.display_name ILIKE '%' || $7 || '%')
          AND (NOT $8 OR a.warranty_until BETWEEN (now() AT TIME ZONE 'Asia/Kolkata')::date AND (now() AT TIME ZONE 'Asia/Kolkata')::date + 60
               OR a.insurance_renewal BETWEEN (now() AT TIME ZONE 'Asia/Kolkata')::date AND (now() AT TIME ZONE 'Asia/Kolkata')::date + 60)`;
      const args = [
        q.status ?? null,
        q.itemId ?? null,
        q.categoryId ?? null,
        q.departmentId ?? null,
        q.storeId ?? null,
        q.custodianId ?? null,
        q.q ?? null,
        q.expiring,
      ];
      const sum = await c.query<{ n: number; cost: string; book: string }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT count(*)::int AS n, COALESCE(sum(a.cost), 0)::text AS cost, COALESCE(sum(${BOOK_VALUE('a')}), 0)::text AS book
           FROM assets a JOIN purchase_items i ON i.id = a.item_id JOIN purchase_item_categories cat ON cat.id = i.category_id
           LEFT JOIN employees ce ON ce.id = a.custodian_employee_id ${where}`,
        args,
      );
      const r = await c.query<AssetRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} ${where} ORDER BY a.tag LIMIT 100 OFFSET $9`,
        [...args, (q.page - 1) * 100],
      );
      return {
        rows: r.rows.map((x) => this.shape(x)),
        total: sum.rows[0]!.n,
        cost: Number(sum.rows[0]!.cost),
        bookValue: Number(sum.rows[0]!.book),
        page: q.page,
      };
    });
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
  private static readonly COLUMNS = [
    'Item code',
    'Tag',
    'Description',
    'Make',
    'Model',
    'Serial',
    'Cost',
    'Acquired on',
    'Put to use on',
    'Store code',
    'Department',
    'Location',
    'Custodian code',
    'Condition',
    'Warranty until',
    'Vendor',
    'Reference',
  ] as const;

  async importTemplate(ctx: RequestContext) {
    this.mustManage(ctx);
    const bytes = await templateSheet({
      sheet: 'Assets',
      columns: [
        {
          header: 'Item code',
          width: 14,
          required: true,
          format: 'text',
          note: 'An item of type asset',
        },
        {
          header: 'Tag',
          width: 16,
          format: 'text',
          note: 'The tag already on it; empty: a new AST tag',
        },
        { header: 'Description', width: 26 },
        { header: 'Make', width: 14 },
        { header: 'Model', width: 14 },
        { header: 'Serial', width: 16, format: 'text' },
        { header: 'Cost', width: 10, required: true, note: 'What one unit cost, in rupees' },
        { header: 'Acquired on', width: 12, format: 'text', note: 'YYYY-MM-DD or DD-MM-YYYY' },
        {
          header: 'Put to use on',
          width: 12,
          format: 'text',
          note: 'Depreciation runs from this day',
        },
        { header: 'Store code', width: 10, format: 'text', note: 'Kept in a store: its code' },
        { header: 'Department', width: 16, note: 'In use with a department: its name' },
        { header: 'Location', width: 16, note: 'Room or block' },
        {
          header: 'Custodian code',
          width: 12,
          format: 'text',
          note: 'The employee code of who keeps it',
        },
        { header: 'Condition', width: 10, options: ['good', 'fair', 'poor', 'unserviceable'] },
        { header: 'Warranty until', width: 12, format: 'text' },
        { header: 'Vendor', width: 20, note: 'Who supplied it (from the old register)' },
        { header: 'Reference', width: 16, note: 'The old PO or bill number' },
      ],
      guide: [
        'One row per unit (a set of 40 chairs is 40 rows, or 40 tags).',
        'Either a store code (kept in the store) or a department (in use); not both.',
        'The asset joins the register only: the store’s stock is not changed (put it in with opening stock).',
        'Upload it: every row is checked first, then the good rows are saved.',
      ],
      examples: [
        [
          'LAPTOP',
          '',
          'Lab laptop',
          'Dell',
          'Latitude 3420',
          'SN123',
          52000,
          '2023-07-10',
          '2023-07-15',
          '',
          'Computer Science',
          'Lab 2',
          'E104',
          'good',
          '2026-07-09',
          'City Computers',
          'PO 1182',
        ],
      ],
    });
    return {
      filename: 'assets-format.xlsx',
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      base64: bytes.toString('base64'),
    };
  }

  async importAssets(ctx: RequestContext, dto: AssetImportDto) {
    this.mustManage(ctx);
    const rows = await readSheet(
      dto.file,
      ['Item code', 'Cost'],
      PurchaseAssetsService.COLUMNS.filter((k) => !['Item code', 'Cost'].includes(k)),
    );
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const items = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, upper(code) AS code FROM purchase_items WHERE item_type = 'asset'`,
          )
        ).rows.map((r) => [r.code, r.id]),
      );
      const stores = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, upper(code) AS code FROM stores`,
          )
        ).rows.map((r) => [r.code, r.id]),
      );
      const deps = new Map(
        (
          await c.query<{ id: string; name: string }>(
            `SELECT id::text, lower(name) AS name FROM departments WHERE status = 'active'`,
          )
        ).rows.map((r) => [r.name, r.id]),
      );
      const staff = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, upper(employee_code) AS code FROM employees WHERE deleted_at IS NULL`,
          )
        ).rows.map((r) => [r.code, r.id]),
      );
      const tags = new Set(
        (await c.query<{ tag: string }>(`SELECT upper(tag) AS tag FROM assets`)).rows.map(
          (r) => r.tag,
        ),
      );
      const day = (v: string) => {
        const t = (v ?? '').trim();
        if (!t) return null;
        if (/^\d{2}-\d{2}-\d{4}$/.test(t)) return t.split('-').reverse().join('-');
        return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : 'bad';
      };
      const results: Array<{ row: number; tag: string; ok: boolean; error?: string }> = [];
      const good: Array<Record<string, string | null>> = [];
      const seen = new Set<string>();
      for (const { row, cells } of rows) {
        const code = (cells['Item code'] ?? '').trim().toUpperCase();
        if (!code && !cells['Cost']) continue;
        const problems: string[] = [];
        const itemId = items.get(code);
        if (!itemId) problems.push(`no asset item has the code ${code || '(empty)'}`);
        const cost = Number((cells['Cost'] ?? '').replace(/,/g, ''));
        if (!Number.isFinite(cost) || cost < 0) problems.push('the cost is not a number');
        const tag = (cells['Tag'] ?? '').trim();
        if (tag && (tags.has(tag.toUpperCase()) || seen.has(tag.toUpperCase())))
          problems.push(`tag ${tag} is used already`);
        const storeCode = (cells['Store code'] ?? '').trim().toUpperCase();
        const storeId = storeCode ? stores.get(storeCode) : undefined;
        if (storeCode && !storeId) problems.push(`no store has the code ${storeCode}`);
        const depName = (cells['Department'] ?? '').trim().toLowerCase();
        const departmentId = depName ? deps.get(depName) : undefined;
        if (depName && !departmentId)
          problems.push(`no department is called ${cells['Department'] ?? ''}`);
        if (storeId && departmentId) problems.push('either a store or a department, not both');
        if (!storeId && !departmentId) problems.push('give the store code or the department');
        const custCode = (cells['Custodian code'] ?? '').trim().toUpperCase();
        const custodianId = custCode ? staff.get(custCode) : undefined;
        if (custCode && !custodianId) problems.push(`no employee has the code ${custCode}`);
        const condition = (cells['Condition'] ?? '').trim().toLowerCase() || 'good';
        if (!['good', 'fair', 'poor', 'unserviceable'].includes(condition))
          problems.push('the condition is good, fair, poor or unserviceable');
        const dates = {
          acquired: day(cells['Acquired on'] ?? ''),
          putToUse: day(cells['Put to use on'] ?? ''),
          warranty: day(cells['Warranty until'] ?? ''),
        };
        if (Object.values(dates).includes('bad'))
          problems.push('a date is not YYYY-MM-DD or DD-MM-YYYY');
        if (tag) seen.add(tag.toUpperCase());
        if (problems.length) {
          results.push({ row, tag, ok: false, error: problems.join('; ') });
          continue;
        }
        results.push({ row, tag, ok: true });
        good.push({
          itemId: itemId!,
          tag: tag || null,
          description: (cells['Description'] ?? '').trim().slice(0, 300) || null,
          make: (cells['Make'] ?? '').trim().slice(0, 80) || null,
          model: (cells['Model'] ?? '').trim().slice(0, 80) || null,
          serial: (cells['Serial'] ?? '').trim().slice(0, 60) || null,
          cost: String(cost),
          acquired: dates.acquired,
          putToUse: dates.putToUse ?? (departmentId ? dates.acquired : null),
          storeId: storeId ?? null,
          departmentId: departmentId ?? null,
          location: (cells['Location'] ?? '').trim().slice(0, 120) || null,
          custodianId: custodianId ?? null,
          condition,
          warranty: dates.warranty,
          source:
            [cells['Vendor'], cells['Reference']]
              .map((x) => (x ?? '').trim())
              .filter(Boolean)
              .join(' · ')
              .slice(0, 300) || 'From the old register',
        });
      }
      if (dto.dryRun) return { rows: results, saved: 0 };
      let saved = 0;
      for (const g of good) {
        const tag =
          g.tag ??
          (await c.query<{ n: string }>(`SELECT app.purchase_next_number('asset') AS n`)).rows[0]!
            .n;
        await c.query('SAVEPOINT asset_import');
        try {
          const id = (
            await c.query<{ id: string }>(
              `INSERT INTO assets (school_id, tag, item_id, description, make, model, serial_no, cost, acquired_on, put_to_use_on, status,
                                   store_id, department_id, location, custodian_employee_id, condition, warranty_until, source_note, created_by)
               VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, app.current_user_id())
               RETURNING id::text`,
              [
                tag,
                g.itemId,
                g.description,
                g.make,
                g.model,
                g.serial,
                g.cost,
                g.acquired,
                g.putToUse,
                g.storeId ? 'in_store' : 'in_use',
                g.storeId,
                g.departmentId,
                g.location,
                g.custodianId,
                g.condition,
                g.warranty,
                g.source,
              ],
            )
          ).rows[0]!.id;
          await c.query(
            `INSERT INTO asset_movements (school_id, asset_id, kind, to_store_id, to_department_id, to_custodian_id, note, created_by)
             VALUES (app.current_school_id(), $1, 'imported', $2, $3, $4, $5, app.current_user_id())`,
            [id, g.storeId, g.departmentId, g.custodianId, g.source],
          );
          await c.query('RELEASE SAVEPOINT asset_import');
          saved += 1;
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT asset_import');
          if ((e as { code?: string }).code !== '23505') throw e;
          const r = results.find((x) => x.ok && x.tag === (g.tag ?? ''));
          if (r)
            Object.assign(r, {
              ok: false,
              error: 'the serial number is on another asset of the item',
            });
        }
      }
      await this.audit.stage(ctx, c, {
        action: 'purchase.asset.import',
        entityType: 'assets',
        entityId: '0',
        after: { saved },
      });
      return { rows: results, saved };
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
