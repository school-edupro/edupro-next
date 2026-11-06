import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import {
  dmy,
  freeStock,
  istToday,
  money2,
  mustOperateStore,
  pdfSchool,
  PERSON_OF,
  postIssues,
  qty3,
  shareAmongIndents,
  type IssueShare,
} from './purchase-stock-core';
import { purchaseStockPdf } from './purchase-stock-pdf';
import { postStock } from './purchase-stores.service';
import {
  PURCHASE,
  type AcknowledgeDto,
  type IssueDto,
  type ReturnToStoreDto,
  type StockDocQueryDto,
} from './purchase.dto';

const KIND: Record<string, string> = {
  receipt: 'On receipt, for the indent',
  indent: 'Reserved on a requisition',
  counter: 'Counter issue',
};

/** I may acknowledge an issue: I took it, I raised its indent, or I am its department's HOD. */
const RECEIVER = `(EXISTS (SELECT 1 FROM employees e WHERE e.id = si.taken_by_employee_id AND e.user_id = app.current_user_id())
  OR EXISTS (SELECT 1 FROM purchase_indents pi WHERE pi.id = si.indent_id AND pi.raised_by = app.current_user_id())
  OR EXISTS (SELECT 1 FROM departments d JOIN employees h ON h.id = d.hod_employee_id
              WHERE d.id = si.department_id AND h.user_id = app.current_user_id()))`;

// eslint-disable-next-line no-restricted-syntax -- PERSON_OF is a fixed fragment
const SELECT = `
  SELECT si.id::text, si.number, si.kind, si.status, si.store_id::text, st.name AS store, si.department_id::text, d.name AS department,
         si.indent_id::text, pi.number AS indent, si.requisition_id::text, pr.number AS requisition, si.receipt_id::text, g.number AS receipt,
         si.taken_by_employee_id::text AS taker_id, tk.display_name AS taker, si.purpose, si.issued_on::text, si.ack_on_paper,
         si.acknowledged_at, si.ack_note, (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = si.acknowledged_by) AS acknowledged_by,
         (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = si.created_by) AS issued_by, si.created_at,
         (SELECT count(*)::int FROM stock_issue_lines l WHERE l.issue_id = si.id) AS lines,
         COALESCE((SELECT sum(l.value) FROM stock_issue_lines l WHERE l.issue_id = si.id), 0)::text AS value,
         ${RECEIVER} AS receiver
    FROM stock_issues si
    JOIN stores st ON st.id = si.store_id
    JOIN departments d ON d.id = si.department_id
    LEFT JOIN purchase_indents pi ON pi.id = si.indent_id
    LEFT JOIN purchase_requisitions pr ON pr.id = si.requisition_id
    LEFT JOIN goods_receipts g ON g.id = si.receipt_id
    LEFT JOIN employees tk ON tk.id = si.taken_by_employee_id`;

interface IssueRow {
  id: string;
  number: string;
  kind: 'receipt' | 'indent' | 'counter';
  status: 'issued' | 'acknowledged';
  store_id: string;
  store: string;
  department_id: string;
  department: string;
  indent_id: string | null;
  indent: string | null;
  requisition_id: string | null;
  requisition: string | null;
  receipt_id: string | null;
  receipt: string | null;
  taker_id: string | null;
  taker: string | null;
  purpose: string | null;
  issued_on: string;
  ack_on_paper: boolean;
  acknowledged_at: Date | null;
  ack_note: string | null;
  acknowledged_by: string | null;
  issued_by: string | null;
  created_at: Date;
  lines: number;
  value: string;
  receiver: boolean;
}

/**
 * Issues out of a store (docs/design/84, part 8): against an approved requisition's reserved lines (the
 * quantity shared among the indents it came from, one issue per indent) or at the counter (a
 * department, who took it, the purpose; never more than the free stock); batches go out earliest
 * expiry first unless one is named; the issue slip; the department acknowledges it (whoever took it,
 * the indent's raiser or the HOD — or the store records a slip signed on paper); unused goods come
 * back into the store against the issue, damaged ones are recorded for condemnation.
 */
@Injectable()
export class PurchaseIssuesService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }

  private async load(c: PoolClient, ctx: RequestContext, id: string, lock = false) {
    const r = await c.query<IssueRow>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
      `${SELECT} WHERE si.id = $1 AND ($2 OR ${RECEIVER})${lock ? ' FOR UPDATE OF si' : ''}`,
      [id, this.has(ctx, PURCHASE.storeView)],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Issue not found', { status: 404 });
    return r.rows[0];
  }

  private shape(r: IssueRow) {
    return {
      id: r.id,
      number: r.number,
      kind: r.kind,
      kindLabel: KIND[r.kind] ?? r.kind,
      status: r.status,
      storeId: r.store_id,
      store: r.store,
      departmentId: r.department_id,
      department: r.department,
      indentId: r.indent_id,
      indent: r.indent,
      requisitionId: r.requisition_id,
      requisition: r.requisition,
      receiptId: r.receipt_id,
      receipt: r.receipt,
      takenById: r.taker_id,
      takenBy: r.taker,
      purpose: r.purpose,
      issuedOn: r.issued_on,
      issuedBy: r.issued_by,
      ackOnPaper: r.ack_on_paper,
      acknowledgedAt: r.acknowledged_at?.toISOString() ?? null,
      acknowledgedBy: r.acknowledged_by,
      ackNote: r.ack_note,
      lines: r.lines,
      value: Number(r.value),
      receiver: r.receiver,
    };
  }

  // ---- lists ---------------------------------------------------------------------------------------
  async list(ctx: RequestContext, q: StockDocQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
      const where = `WHERE ($1::text IS NULL OR si.status = $1) AND ($2::text IS NULL OR si.kind = $2)
          AND ($3::bigint IS NULL OR si.store_id = $3) AND (NOT $4 OR (si.status = 'issued' AND ${RECEIVER}))
          AND ($5::text IS NULL OR si.number ILIKE '%' || $5 || '%' OR d.name ILIKE '%' || $5 || '%' OR pi.number ILIKE '%' || $5 || '%'
               OR tk.display_name ILIKE '%' || $5 || '%')
          AND ($6 OR ${RECEIVER})`;
      const args = [
        q.status ?? null,
        q.kind ?? null,
        q.storeId ?? null,
        q.mine,
        q.q ?? null,
        this.has(ctx, PURCHASE.storeView),
      ];
      const total = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `SELECT count(*)::int AS n FROM stock_issues si JOIN departments d ON d.id = si.department_id
           LEFT JOIN purchase_indents pi ON pi.id = si.indent_id LEFT JOIN employees tk ON tk.id = si.taken_by_employee_id ${where}`,
        args,
      );
      const r = await c.query<IssueRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} ${where} ORDER BY si.issued_on DESC, si.id DESC LIMIT 50 OFFSET $7`,
        [...args, (q.page - 1) * 50],
      );
      const mine = await c.query<{ n: number }>(
        // eslint-disable-next-line no-restricted-syntax -- RECEIVER is a fixed fragment
        `SELECT count(*)::int AS n FROM stock_issues si WHERE si.status = 'issued' AND ${RECEIVER}`,
      );
      return {
        rows: r.rows.map((x) => this.shape(x)),
        total: total.rows[0]!.n,
        page: q.page,
        toAcknowledge: mine.rows[0]!.n,
      };
    });
  }

  /** Approved requisitions' lines reserved in the stores I keep, still to issue. */
  async toIssue(ctx: RequestContext) {
    if (!this.has(ctx, PURCHASE.storeOperate) && !this.has(ctx, PURCHASE.storeManage))
      throw new DomainError('permission-denied', 'Only the store keepers issue', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{
        reservation_id: string;
        store_id: string;
        store: string;
        item_id: string;
        item_code: string;
        item: string;
        unit: string;
        tracks_batch: boolean;
        qty: string;
        issued: string;
        in_hand: string;
        requisition_id: string;
        requisition: string;
        department_id: string | null;
        department: string | null;
        purpose: string | null;
        indents: string | null;
        approved_at: Date | null;
      }>(
        `SELECT r.id::text AS reservation_id, r.store_id::text, st.name AS store, r.item_id::text, i.code AS item_code, i.name AS item,
                COALESCE(su.code, u.code) AS unit, i.tracks_batch, r.qty::text, r.issued_qty::text AS issued,
                COALESCE(b.qty, 0)::text AS in_hand, pr.id::text AS requisition_id, pr.number AS requisition,
                pr.department_id::text, d.name AS department, pr.purpose,
                (SELECT string_agg(DISTINCT pi.number, ', ') FROM purchase_requisition_sources src
                   JOIN purchase_indent_lines pil ON pil.id = src.indent_line_id JOIN purchase_indents pi ON pi.id = pil.indent_id
                  WHERE src.requisition_line_id = rl.id) AS indents,
                pr.approved_at
           FROM stock_reservations r
           JOIN purchase_requisition_lines rl ON rl.id = r.requisition_line_id
           JOIN purchase_requisitions pr ON pr.id = rl.requisition_id AND pr.status IN ('approved', 'part_ordered', 'ordered')
           JOIN stores st ON st.id = r.store_id
           JOIN purchase_items i ON i.id = r.item_id
           JOIN purchase_uoms u ON u.id = i.uom_id
           LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
           LEFT JOIN departments d ON d.id = pr.department_id
           LEFT JOIN stock_balances b ON b.store_id = r.store_id AND b.item_id = r.item_id
          WHERE r.status = 'open'
            AND ($1 OR EXISTS (SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
                                WHERE k.store_id = r.store_id AND e.user_id = app.current_user_id()))
          ORDER BY pr.approved_at NULLS LAST, pr.id, st.name, rl.seq`,
        [this.has(ctx, PURCHASE.storeManage)],
      );
      const groups = new Map<
        string,
        {
          requisitionId: string;
          requisition: string;
          storeId: string;
          store: string;
          department: string | null;
          purpose: string | null;
          indents: string | null;
          approvedAt: string | null;
          lines: Array<{
            reservationId: string;
            itemId: string;
            itemCode: string;
            item: string;
            unit: string;
            tracksBatch: boolean;
            reserved: number;
            issued: number;
            toIssue: number;
            inHand: number;
          }>;
        }
      >();
      for (const x of r.rows) {
        const key = `${x.requisition_id}:${x.store_id}`;
        let g = groups.get(key);
        if (!g) {
          g = {
            requisitionId: x.requisition_id,
            requisition: x.requisition,
            storeId: x.store_id,
            store: x.store,
            department: x.department,
            purpose: x.purpose,
            indents: x.indents,
            approvedAt: x.approved_at?.toISOString() ?? null,
            lines: [],
          };
          groups.set(key, g);
        } else if (x.indents && !g.indents?.includes(x.indents))
          g.indents = [g.indents, x.indents].filter(Boolean).join(', ');
        g.lines.push({
          reservationId: x.reservation_id,
          itemId: x.item_id,
          itemCode: x.item_code,
          item: x.item,
          unit: x.unit,
          tracksBatch: x.tracks_batch,
          reserved: Number(x.qty),
          issued: Number(x.issued),
          toIssue: Math.round((Number(x.qty) - Number(x.issued)) * 1000) / 1000,
          inHand: Number(x.in_hand),
        });
      }
      return { groups: [...groups.values()] };
    });
  }

  /** What the counter issue form picks from: my stores, their stock, the departments and staff. */
  async formLists(ctx: RequestContext) {
    if (!this.has(ctx, PURCHASE.storeOperate) && !this.has(ctx, PURCHASE.storeManage))
      throw new DomainError('permission-denied', 'Only the store keepers issue', { status: 403 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const stores = await c.query<{ id: string; code: string; name: string }>(
        `SELECT s.id::text, s.code, s.name FROM stores s
          WHERE s.status = 'active'
            AND ($1 OR EXISTS (SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
                                WHERE k.store_id = s.id AND e.user_id = app.current_user_id()))
          ORDER BY (s.kind = 'main') DESC, s.name`,
        [this.has(ctx, PURCHASE.storeManage)],
      );
      const stock = await c.query<{
        store_id: string;
        item_id: string;
        code: string;
        name: string;
        unit: string;
        tracks_batch: boolean;
        qty: string;
        reserved: string;
      }>(
        `SELECT b.store_id::text, b.item_id::text, i.code, i.name, COALESCE(su.code, u.code) AS unit, i.tracks_batch,
                b.qty::text, b.reserved::text
           FROM stock_balances b JOIN purchase_items i ON i.id = b.item_id JOIN purchase_uoms u ON u.id = i.uom_id
           LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
          WHERE b.store_id = ANY($1::bigint[]) AND b.qty > 0 ORDER BY i.name`,
        [stores.rows.map((s) => s.id)],
      );
      const batches = await c.query<{
        store_id: string;
        item_id: string;
        batch_no: string;
        expiry: string | null;
        qty_left: string;
      }>(
        `SELECT store_id::text, item_id::text, batch_no, expiry::text, qty_left::text FROM stock_batches
          WHERE store_id = ANY($1::bigint[]) AND qty_left > 0 ORDER BY expiry NULLS LAST, id`,
        [stores.rows.map((s) => s.id)],
      );
      const deps = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM departments WHERE status = 'active' ORDER BY sort_order, name`,
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
      return {
        stores: stores.rows,
        stock: stock.rows.map((x) => ({
          storeId: x.store_id,
          itemId: x.item_id,
          code: x.code,
          name: x.name,
          unit: x.unit,
          tracksBatch: x.tracks_batch,
          qty: Number(x.qty),
          reserved: Number(x.reserved),
          free: Math.max(0, Math.round((Number(x.qty) - Number(x.reserved)) * 1000) / 1000),
        })),
        batches: batches.rows.map((x) => ({
          storeId: x.store_id,
          itemId: x.item_id,
          batch: x.batch_no,
          expiry: x.expiry,
          qty: Number(x.qty_left),
        })),
        departments: deps.rows,
        staff: staff.rows,
      };
    });
  }

  // ---- issue ---------------------------------------------------------------------------------------
  async create(ctx: RequestContext, dto: IssueDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const store = await mustOperateStore(c, ctx.permissions, dto.storeId, 'issue from');
      if (store.status !== 'active')
        throw new DomainError('validation-failed', `${store.name} is not in use`, { status: 400 });
      const day = istToday();
      if (dto.takenByEmployeeId) {
        const e = await c.query(
          `SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
          [dto.takenByEmployeeId],
        );
        if (!e.rowCount) throw new DomainError('validation-failed', 'Who took it was not found');
      }
      const shares: IssueShare[] = [];
      if (dto.kind === 'indent') {
        const pr = (
          await c.query<{ number: string; status: string; department_id: string | null }>(
            `SELECT number, status, department_id::text FROM purchase_requisitions WHERE id = $1`,
            [dto.requisitionId],
          )
        ).rows[0];
        if (!pr) throw new DomainError('not-found', 'Requisition not found', { status: 404 });
        if (!['approved', 'part_ordered', 'ordered'].includes(pr.status))
          throw new DomainError(
            'purchase.not_approved',
            `${pr.number} is not approved: nothing is issued against it yet`,
            { status: 409 },
          );
        for (const l of dto.lines) {
          if (!l.reservationId)
            throw new DomainError('validation-failed', 'A line without its reservation');
          const r = (
            await c.query<{
              item_id: string;
              name: string;
              store_id: string;
              qty: string;
              issued_qty: string;
              status: string;
              requisition_line_id: string;
              requisition_id: string;
            }>(
              `SELECT r.item_id::text, i.name, r.store_id::text, r.qty::text, r.issued_qty::text, r.status,
                      r.requisition_line_id::text, rl.requisition_id::text
                 FROM stock_reservations r JOIN purchase_items i ON i.id = r.item_id
                 JOIN purchase_requisition_lines rl ON rl.id = r.requisition_line_id
                WHERE r.id = $1 FOR UPDATE OF r`,
              [l.reservationId],
            )
          ).rows[0];
          if (!r || r.requisition_id !== dto.requisitionId || r.store_id !== dto.storeId)
            throw new DomainError(
              'validation-failed',
              'A line not reserved on this requisition in this store',
            );
          const left = Math.round((Number(r.qty) - Number(r.issued_qty)) * 1000) / 1000;
          if (r.status !== 'open' || l.qty > left + 1e-9)
            throw new DomainError(
              'validation-failed',
              `${r.name}: ${qty3(Math.max(0, left))} is left to issue on this requisition`,
              { status: 400 },
            );
          for (const s of await shareAmongIndents(
            c,
            r.requisition_line_id,
            l.qty,
            pr.department_id,
          ))
            shares.push({
              ...s,
              itemId: r.item_id,
              name: r.name,
              batch: l.batch ?? null,
              reservationId: l.reservationId,
            });
        }
        if (!shares.length)
          throw new DomainError(
            'purchase.no_department',
            'The requisition has no department to issue to',
            { status: 409 },
          );
      } else {
        const need = new Map<string, number>();
        for (const l of dto.lines) {
          if (!l.itemId) throw new DomainError('validation-failed', 'Pick the item of every line');
          need.set(l.itemId, (need.get(l.itemId) ?? 0) + l.qty);
        }
        for (const [itemId, qty] of need) {
          const it = (
            await c.query<{ name: string; stock_tracked: boolean }>(
              `SELECT name, stock_tracked FROM purchase_items WHERE id = $1`,
              [itemId],
            )
          ).rows[0];
          if (!it?.stock_tracked)
            throw new DomainError(
              'validation-failed',
              `${it?.name ?? 'An item'} is not kept in stock`,
            );
          const f = await freeStock(c, dto.storeId, itemId);
          if (qty > f.free + 1e-9)
            throw new DomainError(
              'stock.insufficient',
              `${it.name}: ${qty3(f.free)} free in ${store.name} (${qty3(f.qty)} in hand, ${qty3(f.reserved)} reserved for requisitions)`,
              { status: 409 },
            );
        }
        for (const l of dto.lines) {
          const name = (
            await c.query<{ name: string }>(`SELECT name FROM purchase_items WHERE id = $1`, [
              l.itemId,
            ])
          ).rows[0]!.name;
          shares.push({
            indentId: null,
            indentLineId: null,
            departmentId: dto.departmentId!,
            itemId: l.itemId!,
            name,
            qty: l.qty,
            batch: l.batch ?? null,
            reservationId: null,
            taker: dto.takenByEmployeeId ?? null,
            purpose: dto.purpose ?? null,
          });
        }
      }
      const made = await postIssues(
        c,
        {
          storeId: dto.storeId,
          kind: dto.kind,
          requisitionId: dto.kind === 'indent' ? dto.requisitionId : null,
          day,
          takenBy: dto.takenByEmployeeId ?? null,
          purpose: dto.kind === 'counter' ? dto.purpose : null,
        },
        shares,
        (m, name) => postStock(c, m, name),
      );
      for (const m of made)
        await this.audit.stage(ctx, c, {
          action: 'purchase.issue.create',
          entityType: 'stock_issues',
          entityId: m.id,
          after: { number: m.number, kind: dto.kind, store: dto.storeId },
        });
      return { issues: made };
    });
  }

  // ---- one issue ------------------------------------------------------------------------------------
  private async linesOf(c: PoolClient, id: string) {
    return (
      await c.query<{
        id: string;
        item_id: string;
        item_code: string;
        item: string;
        unit: string;
        qty: string;
        rate: string;
        value: string;
        batch_no: string | null;
        returned_qty: string;
        indent: string | null;
      }>(
        `SELECT l.id::text, l.item_id::text, i.code AS item_code, i.name AS item, COALESCE(su.code, u.code) AS unit, l.qty::text,
                l.rate::text, l.value::text, l.batch_no, l.returned_qty::text,
                (SELECT pi.number FROM purchase_indent_lines pil JOIN purchase_indents pi ON pi.id = pil.indent_id
                  WHERE pil.id = l.indent_line_id) AS indent
           FROM stock_issue_lines l JOIN purchase_items i ON i.id = l.item_id JOIN purchase_uoms u ON u.id = i.uom_id
           LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
          WHERE l.issue_id = $1 ORDER BY l.id`,
        [id],
      )
    ).rows;
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const si = await this.load(c, ctx, id);
      const lines = await this.linesOf(c, id);
      const returns = await c.query<{
        id: string;
        number: string;
        returned_on: string;
        lines: number;
        by: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON_OF is a fixed fragment
        `SELECT r.id::text, r.number, r.returned_on::text, (SELECT count(*)::int FROM stock_return_lines l WHERE l.return_id = r.id) AS lines,
                (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = r.created_by) AS by
           FROM stock_returns r WHERE r.issue_id = $1 ORDER BY r.id`,
        [id],
      );
      let keeps = this.has(ctx, PURCHASE.storeManage);
      if (!keeps && this.has(ctx, PURCHASE.storeOperate))
        keeps = !!(
          await c.query(
            `SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
              WHERE k.store_id = $1 AND e.user_id = app.current_user_id()`,
            [si.store_id],
          )
        ).rowCount;
      return {
        ...this.shape(si),
        lineItems: lines.map((l) => ({
          id: l.id,
          itemId: l.item_id,
          itemCode: l.item_code,
          item: l.item,
          unit: l.unit,
          qty: Number(l.qty),
          rate: Number(l.rate),
          value: Number(l.value),
          batch: l.batch_no,
          returned: Number(l.returned_qty),
          returnable: Math.round((Number(l.qty) - Number(l.returned_qty)) * 1000) / 1000,
          indent: l.indent,
        })),
        returns: returns.rows.map((r) => ({
          id: r.id,
          number: r.number,
          returnedOn: r.returned_on,
          lines: r.lines,
          by: r.by,
        })),
        can: {
          acknowledge: si.status === 'issued' && si.receiver,
          acknowledgeOnPaper: si.status === 'issued' && keeps,
          returnToStore: keeps && lines.some((l) => Number(l.qty) > Number(l.returned_qty)),
        },
      };
    });
  }

  async acknowledge(ctx: RequestContext, id: string, dto: AcknowledgeDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const si = await this.load(c, ctx, id, true);
      if (si.status !== 'issued')
        throw new DomainError('purchase.not_waiting', 'This issue is acknowledged already', {
          status: 409,
        });
      if (dto.onPaper) {
        await mustOperateStore(c, ctx.permissions, si.store_id, 'record slips of');
        if (!dto.note)
          throw new DomainError(
            'validation-failed',
            'Say who signed the slip (and where it is kept)',
            { status: 400 },
          );
      } else if (!si.receiver)
        throw new DomainError(
          'permission-denied',
          'Only whoever took it, the indent’s raiser or the department’s HOD acknowledges it',
          { status: 403 },
        );
      await c.query(
        `UPDATE stock_issues SET status = 'acknowledged', acknowledged_by = app.current_user_id(), acknowledged_at = now(),
                ack_note = $2, ack_on_paper = $3 WHERE id = $1`,
        [id, dto.note ?? null, dto.onPaper],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.issue.acknowledge',
        entityType: 'stock_issues',
        entityId: id,
        after: { onPaper: dto.onPaper, note: dto.note ?? null },
      });
      return { acknowledged: true };
    });
  }

  /** Goods brought back against an issue: unused back into stock at the rate they went out at. */
  async returnToStore(ctx: RequestContext, id: string, dto: ReturnToStoreDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const si = await this.load(c, ctx, id, true);
      await mustOperateStore(c, ctx.permissions, si.store_id, 'take returns into');
      const lines = new Map((await this.linesOf(c, id)).map((l) => [l.id, l]));
      const want = new Map<string, number>();
      for (const l of dto.lines) {
        const il = lines.get(l.issueLineId);
        if (!il) throw new DomainError('validation-failed', 'A line not on this issue');
        want.set(l.issueLineId, (want.get(l.issueLineId) ?? 0) + l.qty);
        if (l.condition === 'damaged' && !l.reason)
          throw new DomainError('validation-failed', `${il.item}: say what is wrong with it`, {
            status: 400,
          });
      }
      for (const [lineId, q] of want) {
        const il = lines.get(lineId)!;
        const left = Number(il.qty) - Number(il.returned_qty);
        if (q > left + 1e-9)
          throw new DomainError(
            'validation-failed',
            `${il.item}: ${qty3(left)} ${il.unit} of it can still come back`,
            { status: 400 },
          );
      }
      const day = dto.returnedOn ?? istToday();
      const number = (
        await c.query<{ n: string }>(`SELECT app.purchase_next_number('return') AS n`)
      ).rows[0]!.n;
      const rid = (
        await c.query<{ id: string }>(
          `INSERT INTO stock_returns (school_id, number, kind, store_id, issue_id, department_id, returned_on, note, created_by)
           VALUES (app.current_school_id(), $1, 'to_store', $2, $3, $4, $5, $6, app.current_user_id()) RETURNING id::text`,
          [number, si.store_id, id, si.department_id, day, dto.note ?? null],
        )
      ).rows[0]!.id;
      for (const l of dto.lines) {
        const il = lines.get(l.issueLineId)!;
        const rate = Number(il.rate);
        let moveId: string | null = null;
        if (l.condition === 'unused')
          moveId = await postStock(
            c,
            {
              storeId: si.store_id,
              itemId: il.item_id,
              kind: 'return_in',
              qty: l.qty,
              rate,
              batch: il.batch_no,
              docType: 'stock_return',
              docId: rid,
              note: `${number} against ${si.number}`,
              day,
            },
            il.item,
          );
        await c.query(
          `INSERT INTO stock_return_lines (school_id, return_id, item_id, issue_line_id, source, condition, qty, rate, value, batch_no,
                                           reason, replacement, move_id)
           VALUES (app.current_school_id(), $1, $2, $3, 'issue', $4, $5, $6, $7, $8, $9, false, $10)`,
          [
            rid,
            il.item_id,
            il.id,
            l.condition,
            l.qty,
            rate,
            Math.round(l.qty * rate * 100) / 100,
            il.batch_no,
            l.reason ?? null,
            moveId,
          ],
        );
        await c.query(
          `UPDATE stock_issue_lines SET returned_qty = returned_qty + $2 WHERE id = $1`,
          [il.id, l.qty],
        );
      }
      await this.audit.stage(ctx, c, {
        action: 'purchase.return.to_store',
        entityType: 'stock_returns',
        entityId: rid,
        after: { number, issue: si.number, lines: dto.lines.length },
      });
      return { id: rid, number };
    });
  }

  /** The issue slip: what went out, to whom, and the department's "Received by". */
  async slip(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const si = await this.load(c, ctx, id);
      const lines = await this.linesOf(c, id);
      const head = await pdfSchool(c, (k) => this.storage.read(k));
      const total = lines.reduce((a, l) => a + Number(l.value), 0);
      const bytes = await purchaseStockPdf({
        ...head,
        title: 'Issue Slip',
        number: si.number,
        watermark: null,
        facts: [
          ['Issued on', dmy(si.issued_on)],
          ['From', si.store],
          ['To', si.department],
          ['How', KIND[si.kind] ?? si.kind],
          ...((si.indent
            ? [['Indent', si.indent]]
            : si.requisition
              ? [['Requisition', si.requisition]]
              : []) as Array<[string, string]>),
          ...((si.receipt ? [['Goods receipt', si.receipt]] : []) as Array<[string, string]>),
          ...((si.purpose ? [['Purpose', si.purpose]] : []) as Array<[string, string]>),
          [
            'Status',
            si.status === 'acknowledged'
              ? `Acknowledged${si.ack_on_paper ? ' on paper' : ''} by ${si.acknowledged_by ?? ''} on ${dmy(si.acknowledged_at?.toISOString().slice(0, 10) ?? null)}${si.ack_note ? ` (${si.ack_note})` : ''}`
              : 'Waiting for the department’s acknowledgement',
          ],
        ],
        columns: [
          { label: '#', width: 4 },
          { label: 'Item', width: 40 },
          { label: 'Unit', width: 8 },
          { label: 'Quantity', width: 11, right: true },
          { label: 'Rate (Rs)', width: 12, right: true },
          { label: 'Value (Rs)', width: 13, right: true },
          { label: 'Returned', width: 11, right: true },
        ],
        rows: lines.map((l, i) => ({
          cells: [
            String(i + 1),
            `${l.item} (${l.item_code})`,
            l.unit,
            qty3(Number(l.qty)),
            money2(Number(l.rate)),
            money2(Number(l.value)),
            Number(l.returned_qty) ? qty3(Number(l.returned_qty)) : '',
          ],
          detail: [l.batch_no ? `Batch ${l.batch_no}` : null, l.indent ? `For ${l.indent}` : null]
            .filter(Boolean)
            .join(' · '),
        })),
        total: { label: 'Value issued (Rs)', value: money2(total) },
        signatures: [
          { label: 'Issued by', name: si.issued_by },
          { label: 'Received by', name: si.taker },
          {
            label: 'Acknowledged by',
            name: si.acknowledged_by,
            at: si.acknowledged_at ? dmy(si.acknowledged_at.toISOString().slice(0, 10)) : null,
          },
        ],
        foot: 'Goods go out at the store’s average cost; batches with the earliest expiry first unless one is named.',
      });
      return { bytes, filename: `${si.number.replaceAll('/', '-')}.pdf` };
    });
  }
}
