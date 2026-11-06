import { Injectable } from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { mustOperateStore } from './purchase-stock-core';
import { PURCHASE, type ReorderIndentDto } from './purchase.dto';

/**
 * Reorder (docs/design/84, part 9): items whose free stock in a store (in hand less reserved) and what
 * is on order are at or below the store's reorder level, with the quantity to ask for (the reorder
 * quantity, or up to the maximum) and any indent already open for it; "Raise an indent" drafts a
 * Purchase Indent for the store's department, priced from the rate contract or the last purchase, for
 * the keeper to check and send.
 */
@Injectable()
export class PurchaseReorderService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }

  async list(ctx: RequestContext) {
    if (!this.has(ctx, PURCHASE.storeView))
      throw new DomainError('permission-denied', 'Only the stores see reorder levels', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        store_id: string;
        store: string;
        mine: boolean;
        item_id: string;
        code: string;
        name: string;
        unit: string;
        purchase_unit: string;
        per_unit: string;
        qty: string;
        reserved: string;
        on_order: string;
        level: string;
        reorder_qty: string | null;
        max_qty: string | null;
        indents: string | null;
      }>(
        `SELECT l.store_id::text, st.name AS store,
                ($1 OR EXISTS (SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
                                WHERE k.store_id = l.store_id AND e.user_id = app.current_user_id())) AS mine,
                l.item_id::text, i.code, i.name, COALESCE(su.code, u.code) AS unit, u.code AS purchase_unit, i.stock_per_unit::text AS per_unit,
                COALESCE(b.qty, 0)::text AS qty, COALESCE(b.reserved, 0)::text AS reserved,
                COALESCE((SELECT sum((ol.quantity - ol.received_qty + ol.rejected_qty + ol.returned_qty) * i.stock_per_unit)
                            FROM purchase_order_lines ol JOIN purchase_orders po ON po.id = ol.order_id
                           WHERE ol.item_id = l.item_id AND po.status IN ('approved', 'sent')
                             AND ol.quantity - ol.received_qty + ol.rejected_qty + ol.returned_qty > 0), 0)::text AS on_order,
                l.reorder_level::text AS level, l.reorder_qty::text, l.max_qty::text,
                (SELECT string_agg(DISTINCT COALESCE(pi.number, 'a draft'), ', ') FROM purchase_indent_lines pil
                   JOIN purchase_indents pi ON pi.id = pil.indent_id
                  WHERE pil.item_id = l.item_id AND pi.department_id = COALESCE(st.department_id, ps.purchase_department_id)
                    AND (pi.status IN ('draft', 'submitted', 'sent_back')
                         OR (pi.status = 'approved' AND pi.route IN ('to_requisition', 'to_order', 'in_requisition')))) AS indents
           FROM item_store_levels l JOIN stores st ON st.id = l.store_id AND st.status = 'active'
           JOIN purchase_items i ON i.id = l.item_id AND i.status = 'active'
           JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
           LEFT JOIN stock_balances b ON b.store_id = l.store_id AND b.item_id = l.item_id
           JOIN purchase_settings ps ON ps.school_id = l.school_id
          WHERE l.reorder_level > 0
          ORDER BY st.name, i.name`,
        [this.has(ctx, PURCHASE.storeManage)],
      );
      const rows = r.rows
        .map((x) => {
          const qty = Number(x.qty);
          const free = Math.max(0, qty - Number(x.reserved));
          const onOrder = Number(x.on_order);
          const level = Number(x.level);
          const per = Number(x.per_unit);
          const max = x.max_qty === null ? null : Number(x.max_qty);
          // the reorder quantity, else up to the maximum, else back to twice the level
          const want =
            x.reorder_qty !== null
              ? Number(x.reorder_qty)
              : max !== null
                ? Math.max(0, max - free - onOrder)
                : Math.max(0, level * 2 - free - onOrder);
          return {
            storeId: x.store_id,
            store: x.store,
            mine: x.mine,
            itemId: x.item_id,
            code: x.code,
            name: x.name,
            unit: x.unit,
            purchaseUnit: x.purchase_unit,
            perUnit: per,
            inHand: qty,
            free: Math.round(free * 1000) / 1000,
            onOrder: Math.round(onOrder * 1000) / 1000,
            reorderLevel: level,
            reorderQty: x.reorder_qty === null ? null : Number(x.reorder_qty),
            maxQty: max,
            /** in the purchase unit, rounded up */
            suggest: Math.max(1, Math.ceil(want / per)),
            indents: x.indents,
            below: free + onOrder <= level,
          };
        })
        .filter((x) => x.below);
      return { rows };
    });
  }

  /** A draft indent for the store's department with the items to reorder (the keeper checks and sends it). */
  async raiseIndent(ctx: RequestContext, dto: ReorderIndentDto) {
    if (!this.has(ctx, PURCHASE.indentRaise))
      throw new DomainError('permission-denied', 'Raising an indent needs the indent right', {
        status: 403,
      });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const store = await mustOperateStore(c, ctx.permissions, dto.storeId, 'reorder for');
      const dept = (
        await c.query<{ id: string | null }>(
          `SELECT COALESCE(s.department_id, ps.purchase_department_id)::text AS id
             FROM stores s JOIN purchase_settings ps ON ps.school_id = s.school_id WHERE s.id = $1`,
          [dto.storeId],
        )
      ).rows[0]?.id;
      if (!dept)
        throw new DomainError(
          'purchase.no_department',
          `${store.name} has no department and Purchase settings names none: set the store's department`,
          { status: 409 },
        );
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO purchase_indents (school_id, department_id, raised_by, purpose, priority)
           VALUES (app.current_school_id(), $1, app.current_user_id(), $2, 'normal') RETURNING id::text`,
          [dept, `Reorder for ${store.name}: items at or below their reorder level`],
        )
      ).rows[0]!.id;
      let estimate = 0;
      for (const [n, l] of dto.lines.entries()) {
        const it = (
          await c.query<{
            name: string;
            uom_id: string;
            status: string;
            item_type: string;
            contract_id: string | null;
            contract_rate: string | null;
            last_rate: string | null;
          }>(
            `SELECT i.name, i.uom_id::text, i.status, i.item_type,
                    rc.id::text AS contract_id, rc.rate::text AS contract_rate, i.last_purchase_rate::text AS last_rate
               FROM purchase_items i
               LEFT JOIN LATERAL (SELECT rc.id, rc.rate FROM purchase_rate_contracts rc JOIN vendors v ON v.id = rc.vendor_id AND v.status = 'active'
                                   WHERE rc.item_id = i.id AND rc.status = 'active'
                                     AND (now() AT TIME ZONE 'Asia/Kolkata')::date BETWEEN rc.valid_from AND rc.valid_to
                                   ORDER BY rc.rate LIMIT 1) rc ON true
              WHERE i.id = $1`,
            [l.itemId],
          )
        ).rows[0];
        if (!it || it.status !== 'active')
          throw new DomainError('validation-failed', 'An item is not in use', { status: 400 });
        const rate = Number(it.contract_rate ?? it.last_rate ?? 0);
        estimate += rate * l.quantity;
        await c.query(
          `INSERT INTO purchase_indent_lines (school_id, indent_id, seq, item_id, quantity, uom_id, est_rate, rate_source, contract_id, note)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id,
            n + 1,
            l.itemId,
            l.quantity,
            it.uom_id,
            rate,
            it.contract_rate !== null ? 'contract' : it.last_rate !== null ? 'last' : 'typed',
            it.contract_id,
            `Reorder for ${store.name}`.slice(0, 300),
          ],
        );
      }
      await c.query(`UPDATE purchase_indents SET estimate = $2 WHERE id = $1`, [
        id,
        Math.round(estimate * 100) / 100,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'purchase.reorder.indent',
        entityType: 'purchase_indents',
        entityId: id,
        after: { store: store.name, lines: dto.lines.length },
      });
      return { id };
    });
  }
}
