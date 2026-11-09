import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { readSheet, templateSheet } from '../../common/excel/sheet';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { libraryFile, type FileColumn } from '../library/library-file';
import { WorkflowService, type InstanceRow } from '../workflow/workflow.service';
import { syncFlow } from './purchase-flow';
import {
  approvingDepartment,
  dmy,
  istToday,
  money2,
  mustOperateStore,
  pdfSchool,
  PERSON_OF,
  qty3,
} from './purchase-stock-core';
import { blankBox, signerOf } from './purchase-doc-sign';
import { purchaseStockPdf } from './purchase-stock-pdf';
import { postStock } from './purchase-stores.service';
import {
  PURCHASE,
  type CountDecisionDto,
  type CountDto,
  type CountImportDto,
  type CountLinesDto,
  type CountViewDto,
  type NoteDto,
  type StockDocQueryDto,
} from './purchase.dto';

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** My step at a count's current level (Purchase → Who approves). */
// eslint-disable-next-line no-restricted-syntax -- MAY_ACT is a fixed fragment
const MY_STEP = `SELECT s.id::text FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
   WHERE i.id = $1 AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending' AND ${WorkflowService.MAY_ACT}`;
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Why a line differs (docs/design/84, "As built — the count rebuilt", 9 Nov 2026), and in words. */
export const COUNT_REASONS = {
  not_found: 'Not found / lost',
  damaged: 'Damaged',
  expired: 'Expired',
  issued_no_slip: 'Issued without a slip',
  received_no_grn: 'Received without a GRN',
  entry_mistake: 'Entry mistake (opening or earlier)',
  found: 'Found, not on the list',
  other: 'Other',
} as const;
export type CountReason = keyof typeof COUNT_REASONS;
/** The reason in words: its kind, then the note. */
const reasonWords = (code: string | null, note: string | null) =>
  [code ? (COUNT_REASONS[code as CountReason] ?? code) : null, note].filter(Boolean).join(': ') ||
  null;

// eslint-disable-next-line no-restricted-syntax -- PERSON_OF is a fixed fragment
const SELECT = `
  SELECT k.id::text, k.number, k.status, k.store_id::text, st.name AS store, k.category_id::text, cat.name AS category,
         k.counted_on::text, k.counted_by, k.note, k.submitted_at, k.decided_at, k.decision_note, k.created_by::text,
         k.submitted_by::text, k.workflow_instance_id::text, (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = k.created_by) AS started_by,
         (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = k.decided_by) AS decided_by, k.decided_by::text AS decided_by_id,
         (SELECT count(*)::int FROM stock_count_lines l WHERE l.count_id = k.id) AS lines,
         (SELECT count(*)::int FROM stock_count_lines l WHERE l.count_id = k.id AND l.counted_qty IS NOT NULL) AS counted,
         (SELECT count(*)::int FROM stock_count_lines l WHERE l.count_id = k.id AND l.counted_qty IS NOT NULL AND l.counted_qty <> l.book_qty) AS differences,
         COALESCE((SELECT sum(l.value) FROM stock_count_lines l WHERE l.count_id = k.id), 0)::text AS value
    FROM stock_counts k JOIN stores st ON st.id = k.store_id LEFT JOIN purchase_item_categories cat ON cat.id = k.category_id`;

interface CountRow {
  id: string;
  number: string;
  status: 'counting' | 'submitted' | 'approved' | 'cancelled';
  store_id: string;
  store: string;
  category_id: string | null;
  category: string | null;
  counted_on: string;
  counted_by: string | null;
  note: string | null;
  submitted_at: Date | null;
  decided_at: Date | null;
  decision_note: string | null;
  created_by: string | null;
  submitted_by: string | null;
  workflow_instance_id: string | null;
  started_by: string | null;
  decided_by: string | null;
  decided_by_id: string | null;
  lines: number;
  counted: number;
  differences: number;
  value: string;
}

interface CountLine {
  id: string;
  item_id: string;
  item_code: string;
  item: string;
  category: string;
  unit: string;
  tracks_batch: boolean;
  batch_no: string | null;
  expiry: string | null;
  book_qty: string;
  counted_qty: string | null;
  reason: string | null;
  reason_code: string | null;
  added: boolean;
  rate: string | null;
  value: string | null;
  avg_rate: string | null;
}

/**
 * The physical count of a store (docs/design/84, part 8; GFR 2017 rule 213): the keeper starts a count
 * of the store (or one category) — the book quantity of every item (per batch for batch items) is
 * taken then — and enters what is found on screen or from Excel; the sheet is blind (no book quantity)
 * until the counts are in; differences need a reason; the school admin (not who counted) approves and
 * the differences post as adjustments at the average rate, or sends it back to count again.
 */
@Injectable()
export class PurchaseCountsService implements OnModuleInit {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly workflow: WorkflowService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  onModuleInit() {
    this.workflow.onComplete('purchase_count', (c, ctx, instance, outcome) =>
      this.onDecided(c, ctx, instance, outcome),
    );
  }

  /**
   * Who approves a count of this store and where it is: the levels set on Purchase → Who approves for
   * the store's department (none: the school admin), and, once sent, each level's people and outcome.
   */
  private async approvalOf(c: PoolClient, k: CountRow) {
    const departmentId = await approvingDepartment(c, k.store_id);
    const set = (
      await c.query<{ department: string | null; levels: Array<{ name: string }> | null }>(
        `SELECT d.name AS department, a.levels FROM departments d
           LEFT JOIN purchase_department_approvals a ON a.department_id = d.id AND a.doc_type = 'count'
          WHERE d.id = $1`,
        [departmentId],
      )
    ).rows[0];
    const instance = k.workflow_instance_id
      ? await this.workflow.instanceWith(c, k.workflow_instance_id)
      : null;
    const mine = k.workflow_instance_id
      ? !!(await c.query(MY_STEP, [k.workflow_instance_id])).rowCount
      : false;
    return {
      departmentId: departmentId === '0' ? null : departmentId,
      department: set?.department ?? null,
      levels: (set?.levels ?? []).map((l) => l.name),
      steps: (instance?.steps ?? []).map((st) => ({
        level: st.level,
        name: st.name,
        status: st.status,
        assignees: st.assignees.map((a) => a.name),
        actedBy: st.actedBy,
        actedAt: st.actedAt,
        note: st.note,
        overdue: st.overdue,
      })),
      currentLevel: instance?.status === 'pending' ? instance.currentLevel : null,
      mine,
    };
  }

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }
  private mustSee(ctx: RequestContext) {
    if (!this.has(ctx, PURCHASE.storeView))
      throw new DomainError('permission-denied', 'Only the stores see counts', { status: 403 });
  }
  /** The stores, or someone on the count's approval (a level of Purchase → Who approves). */
  private async mustRead(c: PoolClient, ctx: RequestContext, k: CountRow) {
    if (this.has(ctx, PURCHASE.storeView)) return;
    const on =
      k.workflow_instance_id &&
      (
        await c.query(
          // eslint-disable-next-line no-restricted-syntax -- MAY_ACT is a fixed fragment
          `SELECT 1 FROM workflow_steps s WHERE s.instance_id = $1
              AND (app.current_user_id() = ANY(s.assignee_user_ids) OR s.acted_by = app.current_user_id() OR ${WorkflowService.MAY_ACT})`,
          [k.workflow_instance_id],
        )
      ).rowCount;
    if (!on)
      throw new DomainError('permission-denied', 'Only the stores see counts', { status: 403 });
  }

  private shape(k: CountRow) {
    return {
      id: k.id,
      number: k.number,
      status: k.status,
      storeId: k.store_id,
      store: k.store,
      categoryId: k.category_id,
      category: k.category,
      countedOn: k.counted_on,
      countedBy: k.counted_by,
      note: k.note,
      submittedAt: k.submitted_at?.toISOString() ?? null,
      decidedAt: k.decided_at?.toISOString() ?? null,
      decidedBy: k.decided_by,
      decisionNote: k.decision_note,
      startedBy: k.started_by,
      lines: k.lines,
      counted: k.counted,
      differences: k.differences,
      value: Number(k.value),
    };
  }

  private async load(c: PoolClient, id: string, lock = false) {
    const r = await c.query<CountRow>(
      // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
      `${SELECT} WHERE k.id = $1${lock ? ' FOR UPDATE OF k' : ''}`,
      [id],
    );
    if (!r.rows[0]) throw new DomainError('not-found', 'Count not found', { status: 404 });
    return r.rows[0];
  }

  private async linesOf(c: PoolClient, id: string) {
    return (
      await c.query<CountLine>(
        `SELECT l.id::text, l.item_id::text, i.code AS item_code, i.name AS item, cat.name AS category, COALESCE(su.code, u.code) AS unit,
                i.tracks_batch, l.batch_no, l.expiry::text, l.book_qty::text, l.counted_qty::text, l.reason, l.reason_code, l.added, l.rate::text,
                l.value::text, b.avg_rate::text
           FROM stock_count_lines l JOIN stock_counts k ON k.id = l.count_id
           JOIN purchase_items i ON i.id = l.item_id JOIN purchase_item_categories cat ON cat.id = i.category_id
           JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
           LEFT JOIN stock_balances b ON b.store_id = k.store_id AND b.item_id = l.item_id
          WHERE l.count_id = $1 ORDER BY cat.name, i.name, l.expiry NULLS LAST, l.batch_no`,
        [id],
      )
    ).rows;
  }

  async list(ctx: RequestContext, q: StockDocQueryDto) {
    // waiting for me (my level on Purchase → Who approves): for anyone; the rest for the stores
    if (!q.mine) this.mustSee(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<CountRow>(
        // eslint-disable-next-line no-restricted-syntax -- fixed fragments; values are bound
        `${SELECT} WHERE ($1::text IS NULL OR k.status = $1) AND ($2::bigint IS NULL OR k.store_id = $2)
            AND (NOT $4 OR (k.status = 'submitted' AND EXISTS (SELECT 1 FROM workflow_steps s JOIN workflow_instances i ON i.id = s.instance_id
                  WHERE i.id = k.workflow_instance_id AND i.status = 'pending' AND s.level = i.current_level AND s.status = 'pending'
                    AND ${WorkflowService.MAY_ACT})))
          ORDER BY (k.status IN ('counting', 'submitted')) DESC, k.counted_on DESC, k.id DESC LIMIT 50 OFFSET $3`,
        [q.status ?? null, q.storeId ?? null, (q.page - 1) * 50, q.mine],
      );
      if (q.mine)
        return { rows: r.rows.map((x) => this.shape(x)), page: q.page, stores: [], categories: [] };
      const stores = await c.query<{
        id: string;
        name: string;
        last: string | null;
        fy: string;
        mine: boolean;
      }>(
        `SELECT s.id::text, s.name,
                (SELECT max(k.counted_on)::text FROM stock_counts k WHERE k.store_id = s.id AND k.status = 'approved') AS last,
                app.purchase_fy((now() AT TIME ZONE 'Asia/Kolkata')::date) AS fy,
                ($1 OR ($2 AND EXISTS (SELECT 1 FROM store_keepers sk JOIN employees e ON e.id = sk.employee_id
                                        WHERE sk.store_id = s.id AND e.user_id = app.current_user_id()))) AS mine
           FROM stores s WHERE s.status = 'active' ORDER BY (s.kind = 'main') DESC, s.name`,
        [this.has(ctx, PURCHASE.storeManage), this.has(ctx, PURCHASE.storeOperate)],
      );
      const categories = await c.query<{ id: string; name: string }>(
        `SELECT id::text, name FROM purchase_item_categories ORDER BY name`,
      );
      const fyStart = (fy: string) => `${fy.slice(0, 4)}-04-01`;
      return {
        rows: r.rows.map((x) => this.shape(x)),
        page: q.page,
        stores: stores.rows.map((s) => ({
          id: s.id,
          name: s.name,
          lastCountedOn: s.last,
          countedThisYear: !!s.last && s.last >= fyStart(s.fy),
          mine: s.mine,
        })),
        categories: categories.rows,
      };
    });
  }

  async get(ctx: RequestContext, id: string, view: Partial<CountViewDto> = {}) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id);
      await this.mustRead(c, ctx, k);
      const lines = await this.linesOf(c, id);
      let keeps = this.has(ctx, PURCHASE.storeManage);
      if (!keeps && this.has(ctx, PURCHASE.storeOperate))
        keeps = !!(
          await c.query(
            `SELECT 1 FROM store_keepers sk JOIN employees e ON e.id = sk.employee_id
              WHERE sk.store_id = $1 AND e.user_id = app.current_user_id()`,
            [k.store_id],
          )
        ).rowCount;
      const me = String(ctx.user.id);
      // blind while counting: the book quantity shows once a line is counted
      const items = lines.map((l) => {
        const counted = l.counted_qty === null ? null : Number(l.counted_qty);
        const show = counted !== null || k.status !== 'counting';
        const diff = counted === null ? null : round3(counted - Number(l.book_qty));
        return {
          id: l.id,
          itemId: l.item_id,
          itemCode: l.item_code,
          item: l.item,
          category: l.category,
          unit: l.unit,
          tracksBatch: l.tracks_batch,
          batch: l.batch_no,
          expiry: l.expiry,
          book: show ? Number(l.book_qty) : null,
          counted,
          difference: show ? diff : null,
          reason: l.reason,
          reasonCode: l.reason_code,
          reasonWords: reasonWords(l.reason_code, l.reason),
          added: l.added,
          rate: l.rate === null ? (show ? Number(l.avg_rate ?? 0) : null) : Number(l.rate),
          value:
            l.value !== null
              ? Number(l.value)
              : show && diff !== null
                ? Math.round(diff * Number(l.avg_rate ?? 0) * 100) / 100
                : null,
        };
      });
      const seen = items.filter((l) => l.difference);
      const excess = seen.filter((l) => l.difference! > 0);
      const short = seen.filter((l) => l.difference! < 0);
      const sum = (xs: typeof items) => round2(xs.reduce((a, l) => a + (l.value ?? 0), 0));
      const approval = await this.approvalOf(c, k);
      // a page of the lines, as found (the figures stay over the whole count)
      const needle = view.q?.toLowerCase() ?? '';
      // a page of lines without a choice: every line while counting, the differences once sent
      const show = view.show ?? (view.page && k.status !== 'counting' ? 'diff' : 'all');
      const found = items.filter(
        (l) =>
          (!needle || `${l.item} ${l.itemCode} ${l.batch ?? ''}`.toLowerCase().includes(needle)) &&
          (!view.category || l.category === view.category) &&
          (show !== 'todo' || l.counted === null) &&
          (show !== 'diff' || (l.difference !== null && l.difference !== 0)) &&
          (!view.reason ||
            (view.reason === 'none'
              ? !!l.difference && !l.reasonCode
              : l.reasonCode === view.reason)),
      );
      const size = view.size ?? 50;
      const page = view.page
        ? Math.min(view.page, Math.max(1, Math.ceil(found.length / size)))
        : null;
      return {
        ...this.shape(k),
        approval,
        lineItems: page ? found.slice((page - 1) * size, page * size) : found,
        found: found.length,
        page,
        size,
        show,
        categories: [...new Set(items.map((l) => l.category))].sort(),
        // over the counted lines (the book shows once a line is counted)
        figures: {
          lines: items.length,
          counted: items.filter((l) => l.counted !== null).length,
          excess: excess.length,
          excessValue: sum(excess),
          shortage: short.length,
          shortageValue: sum(short),
          net: sum(seen),
          noReason: seen.filter((l) => !l.reasonCode && !l.reason).length,
        },
        // the differences by reason, over the whole count
        byReason: [...new Set(seen.map((l) => l.reasonCode ?? 'none'))].map((code) => {
          const of = seen.filter((l) => (l.reasonCode ?? 'none') === code);
          return {
            code,
            words: code === 'none' ? 'No reason given' : COUNT_REASONS[code as CountReason],
            lines: of.length,
            value: sum(of),
          };
        }),
        reasons: COUNT_REASONS,
        can: {
          count: k.status === 'counting' && keeps,
          submit: k.status === 'counting' && keeps,
          // the level's approver now (a count sent before levels existed: the right, as then)
          decide:
            k.status === 'submitted' &&
            k.created_by !== me &&
            k.submitted_by !== me &&
            (k.workflow_instance_id ? approval.mine : this.has(ctx, PURCHASE.countApprove)),
          cancel: ['counting', 'submitted'].includes(k.status) && keeps,
        },
      };
    });
  }

  /** The book quantity of an item (or one of its batches) in a store now. */
  private async bookOf(
    c: PoolClient,
    storeId: string,
    itemId: string,
    batch: string | null,
    expiry: string | null,
  ) {
    const r = batch
      ? await c.query<{ q: string }>(
          `SELECT COALESCE(sum(qty_left), 0)::text AS q FROM stock_batches
            WHERE store_id = $1 AND item_id = $2 AND batch_no = $3 AND expiry IS NOT DISTINCT FROM $4::date`,
          [storeId, itemId, batch, expiry],
        )
      : await c.query<{ q: string }>(
          `SELECT COALESCE((SELECT qty FROM stock_balances WHERE store_id = $1 AND item_id = $2), 0)::text AS q`,
          [storeId, itemId],
        );
    return Number(r.rows[0]!.q);
  }

  async create(ctx: RequestContext, dto: CountDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const store = await mustOperateStore(c, ctx.permissions, dto.storeId, 'count');
      const open = await c.query<{ number: string }>(
        `SELECT number FROM stock_counts WHERE store_id = $1 AND status IN ('counting', 'submitted')`,
        [dto.storeId],
      );
      if (open.rows[0])
        throw new DomainError(
          'conflict',
          `${open.rows[0].number} is still open for ${store.name}: finish it first`,
          { status: 409 },
        );
      const number = (await c.query<{ n: string }>(`SELECT app.purchase_next_number('count') AS n`))
        .rows[0]!.n;
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO stock_counts (school_id, number, store_id, category_id, counted_on, note, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id()) RETURNING id::text`,
          [
            number,
            dto.storeId,
            dto.categoryId ?? null,
            dto.countedOn ?? istToday(),
            dto.note ?? null,
          ],
        )
      ).rows[0]!.id;
      // every item the store holds or has held (per batch for batch items), as the book stands now
      await c.query(
        `INSERT INTO stock_count_lines (school_id, count_id, item_id, batch_no, expiry, book_qty)
         SELECT app.current_school_id(), $1::bigint, b.item_id, NULL::text, NULL::date, b.qty
           FROM stock_balances b JOIN purchase_items i ON i.id = b.item_id
          WHERE b.store_id = $2::bigint AND i.stock_tracked AND NOT i.tracks_batch AND ($3::bigint IS NULL OR i.category_id = $3)
         UNION ALL
         SELECT app.current_school_id(), $1::bigint, sb.item_id, sb.batch_no, sb.expiry, sb.qty_left
           FROM stock_batches sb JOIN purchase_items i ON i.id = sb.item_id
          WHERE sb.store_id = $2::bigint AND sb.qty_left > 0 AND i.stock_tracked AND i.tracks_batch AND ($3::bigint IS NULL OR i.category_id = $3)`,
        [id, dto.storeId, dto.categoryId ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.count.start',
        entityType: 'stock_counts',
        entityId: id,
        after: { number, store: store.name, category: dto.categoryId ?? null },
      });
      return { id, number };
    });
  }

  private async saveIn(c: PoolClient, k: CountRow, dto: CountLinesDto) {
    const lines = new Map((await this.linesOf(c, k.id)).map((l) => [l.id, l]));
    for (const l of dto.lines) {
      if (l.lineId) {
        if (!lines.has(l.lineId))
          throw new DomainError('validation-failed', 'A line not on this count');
        await c.query(
          `UPDATE stock_count_lines SET counted_qty = $2, reason = $3, reason_code = $4 WHERE id = $1`,
          // a reason in words alone (an older client) is an "Other" with that note
          [l.lineId, l.countedQty, l.reason ?? null, l.reasonCode ?? (l.reason ? 'other' : null)],
        );
        continue;
      }
      // found but not on the list
      const it = (
        await c.query<{ name: string; stock_tracked: boolean; tracks_batch: boolean }>(
          `SELECT name, stock_tracked, tracks_batch FROM purchase_items WHERE id = $1`,
          [l.itemId],
        )
      ).rows[0];
      if (!it?.stock_tracked)
        throw new DomainError('validation-failed', `${it?.name ?? 'An item'} is not kept in stock`);
      if (it.tracks_batch && !l.batch)
        throw new DomainError('validation-failed', `${it.name}: give the batch found`);
      const batch = it.tracks_batch ? (l.batch ?? null) : null;
      const expiry = it.tracks_batch ? (l.expiry ?? null) : null;
      const book = await this.bookOf(c, k.store_id, l.itemId!, batch, expiry);
      await c.query(
        `INSERT INTO stock_count_lines (school_id, count_id, item_id, batch_no, expiry, book_qty, counted_qty, reason, reason_code, added)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, true)
         ON CONFLICT (count_id, item_id, batch_no, expiry) DO UPDATE SET counted_qty = EXCLUDED.counted_qty, reason = EXCLUDED.reason,
                     reason_code = EXCLUDED.reason_code`,
        [
          k.id,
          l.itemId,
          batch,
          expiry,
          book,
          l.countedQty,
          l.reason ?? null,
          l.reasonCode ?? 'found',
        ],
      );
    }
    if (dto.countedBy !== undefined)
      await c.query(`UPDATE stock_counts SET counted_by = $2 WHERE id = $1`, [
        k.id,
        dto.countedBy ?? null,
      ]);
  }

  async saveLines(ctx: RequestContext, id: string, dto: CountLinesDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id, true);
      if (k.status !== 'counting')
        throw new DomainError('purchase.not_waiting', 'This count is not open for counting', {
          status: 409,
        });
      await mustOperateStore(c, ctx.permissions, k.store_id, 'count');
      await this.saveIn(c, k, dto);
      return { saved: true };
    });
  }

  /** The count sheet as Excel: blind (no book quantity), to fill in and upload. */
  async sheet(ctx: RequestContext, id: string) {
    this.mustSee(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id);
      const lines = await this.linesOf(c, id);
      const bytes = await templateSheet({
        sheet: 'Count',
        columns: [
          { header: 'Item code', width: 14, required: true, format: 'text' },
          { header: 'Item', width: 34 },
          { header: 'Batch', width: 14, format: 'text', note: 'For an item kept by batch' },
          { header: 'Expiry', width: 12, format: 'text', note: 'YYYY-MM-DD or DD-MM-YYYY' },
          { header: 'Unit', width: 8 },
          {
            header: 'Counted',
            width: 10,
            required: true,
            note: 'In the store unit; 0 when none is found',
          },
        ],
        guide: [
          `${k.number}: the physical count of ${k.store}${k.category ? ` (${k.category})` : ''}.`,
          'Fill Counted with what is on the shelf, in the store unit (0 when none is found).',
          'Add a row for an item or a batch found that is not listed (its code, batch and expiry).',
          'Upload the sheet on the count; give the reason for each difference there, then send it for approval.',
        ],
        rows: lines.map((l) => [
          l.item_code,
          l.item,
          l.batch_no,
          l.expiry,
          l.unit,
          l.counted_qty === null ? null : Number(l.counted_qty),
        ]),
      });
      return {
        filename: `${k.number.replaceAll('/', '-')}-sheet.xlsx`,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        base64: bytes.toString('base64'),
      };
    });
  }

  /** The filled sheet: rows matched by item code and batch; an item or batch not listed is added. */
  async importSheet(ctx: RequestContext, id: string, dto: CountImportDto) {
    const rows = await readSheet(dto.file, ['Item code', 'Counted'], ['Batch', 'Expiry']);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id, true);
      if (k.status !== 'counting')
        throw new DomainError('purchase.not_waiting', 'This count is not open for counting', {
          status: 409,
        });
      await mustOperateStore(c, ctx.permissions, k.store_id, 'count');
      const lines = await this.linesOf(c, id);
      const items = new Map(
        (
          await c.query<{ id: string; code: string }>(
            `SELECT id::text, upper(code) AS code FROM purchase_items WHERE stock_tracked`,
          )
        ).rows.map((r) => [r.code, r.id]),
      );
      const problems: string[] = [];
      const save: CountLinesDto = { lines: [] };
      for (const { row, cells } of rows) {
        const code = (cells['Item code'] ?? '').trim().toUpperCase();
        const counted = (cells['Counted'] ?? '').trim();
        if (!code || !counted) continue;
        const q = Number(counted.replace(/,/g, ''));
        if (!Number.isFinite(q) || q < 0) {
          problems.push(`Row ${String(row)}: the count is not a number`);
          continue;
        }
        const batch = (cells['Batch'] ?? '').trim() || null;
        const line = lines.find(
          (l) => l.item_code.toUpperCase() === code && (l.batch_no ?? null) === batch,
        );
        if (line) {
          save.lines.push({
            lineId: line.id,
            countedQty: q,
            reason: line.reason ?? undefined,
            reasonCode: (line.reason_code as CountReason | null) ?? undefined,
          });
          continue;
        }
        const itemId = items.get(code);
        if (!itemId) {
          problems.push(`Row ${String(row)}: no item kept in stock has the code ${code}`);
          continue;
        }
        const exp = (cells['Expiry'] ?? '').trim();
        const expiry = /^\d{2}-\d{2}-\d{4}$/.test(exp) ? exp.split('-').reverse().join('-') : exp;
        save.lines.push({
          itemId,
          batch: batch ?? undefined,
          expiry: /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : undefined,
          countedQty: q,
        });
      }
      if (problems.length)
        throw new DomainError('validation-failed', problems.slice(0, 20).join('; '), {
          status: 400,
          extra: { problems },
        });
      await this.saveIn(c, k, save);
      return { counted: save.lines.length };
    });
  }

  async submit(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id, true);
      if (k.status !== 'counting')
        throw new DomainError('purchase.not_waiting', 'This count is not open for counting', {
          status: 409,
        });
      await mustOperateStore(c, ctx.permissions, k.store_id, 'count');
      const lines = await this.linesOf(c, id);
      const notCounted = lines.filter((l) => l.counted_qty === null);
      if (notCounted.length)
        throw new DomainError(
          'validation-failed',
          `${String(notCounted.length)} lines are not counted yet (0 when none is found): ${notCounted
            .slice(0, 5)
            .map((l) => l.item)
            .join(', ')}`,
          { status: 400 },
        );
      const noReason = lines.filter(
        (l) =>
          Number(l.counted_qty) !== Number(l.book_qty) &&
          (!l.reason_code || (l.reason_code === 'other' && !l.reason)),
      );
      if (noReason.length)
        throw new DomainError(
          'validation-failed',
          `Pick the reason for each difference (and add a note for Other): ${noReason
            .slice(0, 5)
            .map((l) => l.item)
            .join(', ')}`,
          { status: 400 },
        );
      await c.query(
        `UPDATE stock_counts SET status = 'submitted', submitted_at = now(), submitted_by = app.current_user_id(),
                decision_note = NULL WHERE id = $1`,
        [id],
      );
      // the levels of the store's department on Purchase → Who approves (none: the school admin)
      const departmentId = await approvingDepartment(c, k.store_id);
      const flow = await syncFlow(c, 'count', departmentId);
      const diffs = lines.filter((l) => Number(l.counted_qty) !== Number(l.book_qty)).length;
      let instance: InstanceRow;
      try {
        instance = await this.workflow.start(c, ctx, {
          definitionCode: flow.code,
          entityType: 'purchase_count',
          entityId: id,
          subject: `${k.number} · ${k.store} · ${String(diffs)} difference${diffs === 1 ? '' : 's'}`,
          payload: { department: flow.department, departmentId, number: k.number },
        });
      } catch (e) {
        if (e instanceof DomainError && e.type === 'workflow.no_assignee')
          throw new DomainError(
            'purchase.no_approver',
            `Nobody can approve counts of ${k.store}: set the Physical count levels of ${flow.department || 'its department'} (Purchase → Who approves)`,
            { status: 409 },
          );
        throw e;
      }
      await c.query(`UPDATE stock_counts SET workflow_instance_id = $2 WHERE id = $1`, [
        id,
        instance.id,
      ]);
      await this.audit.stage(ctx, c, {
        action: 'purchase.count.submit',
        entityType: 'stock_counts',
        entityId: id,
        after: { number: k.number, lines: lines.length, levels: flow.levels },
      });
      return { submitted: true };
    });
  }

  /**
   * The approver at the count's current level (Purchase → Who approves) approves — at the last level the
   * differences post — or sends it back to count again (with what to count). Who started or counted it
   * never approves it.
   */
  async decide(ctx: RequestContext, id: string, dto: CountDecisionDto) {
    const step = await this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id, true);
      if (k.status !== 'submitted')
        throw new DomainError('purchase.not_waiting', 'This count is not waiting for approval', {
          status: 409,
        });
      if (k.created_by === String(ctx.user.id) || k.submitted_by === String(ctx.user.id))
        throw new DomainError(
          'workflow.self_approval',
          'You took part in this count: someone else approves it',
          { status: 403 },
        );
      if (dto.action === 'send_back' && !dto.note)
        throw new DomainError('validation-failed', 'Say what to count again', { status: 400 });
      if (!k.workflow_instance_id) {
        // sent before approval levels existed: the right decides, as then
        if (!this.has(ctx, PURCHASE.countApprove))
          throw new DomainError('permission-denied', 'Only the school admin approves counts', {
            status: 403,
          });
        if (dto.action === 'send_back') await this.sendBack(c, ctx, id, dto.note!);
        else await this.finalise(c, ctx, id, dto.note ?? null);
        return null;
      }
      const s = await c.query<{ id: string }>(MY_STEP, [k.workflow_instance_id]);
      if (!s.rows[0])
        throw new DomainError('workflow.not_assignee', 'This count is not waiting for you', {
          status: 403,
        });
      return s.rows[0].id;
    });
    if (step)
      await this.workflow.act(ctx, step, dto.action === 'approve' ? 'approved' : 'rejected', {
        note: dto.note,
      });
    const k = await this.db.tenant(requireTenant(ctx), (c) => this.load(c, id));
    return { status: k.status };
  }

  /** The workflow's end: approved — the differences post; sent back — counting again. */
  private async onDecided(
    c: PoolClient,
    ctx: RequestContext,
    instance: InstanceRow,
    outcome: 'approved' | 'rejected',
  ) {
    if (instance.status === 'cancelled') return;
    const note = [...instance.steps].reverse().find((s) => s.note)?.note ?? null;
    if (outcome === 'approved') await this.finalise(c, ctx, instance.entityId, note);
    else await this.sendBack(c, ctx, instance.entityId, note ?? 'Count again');
  }

  private async sendBack(c: PoolClient, ctx: RequestContext, id: string, note: string) {
    await c.query(
      `UPDATE stock_counts SET status = 'counting', decision_note = $2, submitted_at = NULL, submitted_by = NULL,
              workflow_instance_id = NULL WHERE id = $1`,
      [id, note],
    );
    await this.audit.stage(ctx, c, {
      action: 'purchase.count.send_back',
      entityType: 'stock_counts',
      entityId: id,
      after: { note },
    });
  }

  /** Every difference posts as an adjustment at the average rate, the reason on it. */
  private async finalise(c: PoolClient, ctx: RequestContext, id: string, note: string | null) {
    const k = await this.load(c, id, true);
    const day = istToday();
    let posted = 0;
    for (const l of await this.linesOf(c, id)) {
      const diff = round3(Number(l.counted_qty) - Number(l.book_qty));
      if (!diff) continue;
      let rate = Number(l.avg_rate ?? 0);
      if (diff > 0 && !rate) {
        const last = await c.query<{ rate: string }>(
          `SELECT rate::text FROM stock_moves WHERE store_id = $1 AND item_id = $2 AND qty > 0 AND rate > 0 ORDER BY id DESC LIMIT 1`,
          [k.store_id, l.item_id],
        );
        rate = Number(last.rows[0]?.rate ?? 0);
      }
      const moveId = await postStock(
        c,
        {
          storeId: k.store_id,
          itemId: l.item_id,
          kind: 'adjustment',
          qty: diff,
          rate,
          batch: l.batch_no,
          expiry: l.expiry,
          docType: 'stock_count',
          docId: id,
          docLineId: l.id,
          note: `${k.number}: ${reasonWords(l.reason_code, l.reason) ?? 'count difference'}`.slice(
            0,
            300,
          ),
          day,
        },
        l.item,
      );
      const m = (
        await c.query<{ rate: string; value: string }>(
          `SELECT rate::text, value::text FROM stock_moves WHERE id = $1`,
          [moveId],
        )
      ).rows[0]!;
      await c.query(
        `UPDATE stock_count_lines SET rate = $2, value = $3, move_id = $4 WHERE id = $1`,
        [l.id, m.rate, m.value, moveId],
      );
      posted += 1;
    }
    await c.query(
      `UPDATE stock_counts SET status = 'approved', decided_at = now(), decided_by = app.current_user_id(), decision_note = $2
        WHERE id = $1`,
      [id, note],
    );
    await this.audit.stage(ctx, c, {
      action: 'purchase.count.approve',
      entityType: 'stock_counts',
      entityId: id,
      after: { number: k.number, adjustments: posted },
    });
    return posted;
  }

  async cancel(ctx: RequestContext, id: string, dto: NoteDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id, true);
      if (!['counting', 'submitted'].includes(k.status))
        throw new DomainError('purchase.not_waiting', 'Only an open count is cancelled', {
          status: 409,
        });
      await mustOperateStore(c, ctx.permissions, k.store_id, 'count');
      if (!dto.note)
        throw new DomainError('validation-failed', 'Say why it is cancelled', { status: 400 });
      if (k.workflow_instance_id && k.status === 'submitted')
        await this.workflow.cancelIn(c, ctx, k.workflow_instance_id, `Cancelled: ${dto.note}`);
      await c.query(
        `UPDATE stock_counts SET status = 'cancelled', decision_note = $2, decided_at = now(), decided_by = app.current_user_id()
          WHERE id = $1`,
        [id, dto.note],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.count.cancel',
        entityType: 'stock_counts',
        entityId: id,
        after: { note: dto.note },
      });
      return { cancelled: true };
    });
  }

  /**
   * The count as Excel: every line with book, counted, excess, shortage, rate, value and the reason (while
   * counting, the book only of the lines counted — the sheet stays blind).
   */
  async statement(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id);
      await this.mustRead(c, ctx, k);
      const lines = await this.linesOf(c, id);
      const school = (
        await c.query<{ name: string }>(
          `SELECT name FROM schools WHERE id = app.current_school_id()`,
        )
      ).rows[0]!.name;
      const rows = lines.map((l) => {
        const counted = l.counted_qty === null ? null : Number(l.counted_qty);
        const show = counted !== null || k.status !== 'counting';
        const diff = counted === null ? null : round3(counted - Number(l.book_qty));
        const rate = l.rate !== null ? Number(l.rate) : Number(l.avg_rate ?? 0);
        const value =
          l.value !== null ? Number(l.value) : diff ? round2(diff * Number(l.avg_rate ?? 0)) : null;
        return [
          l.item_code,
          l.item,
          l.category,
          l.batch_no,
          l.expiry,
          l.unit,
          show ? Number(l.book_qty) : null,
          counted,
          diff && diff > 0 ? diff : null,
          diff && diff < 0 ? -diff : null,
          show ? rate : null,
          diff ? value : null,
          diff ? reasonWords(l.reason_code, l.reason) : null,
        ];
      });
      const net = round2(rows.reduce((a, r) => a + Number(r[11] ?? 0), 0));
      return libraryFile({
        format: 'xlsx',
        name: `${k.number} — physical count of ${k.store}`,
        slug: k.number.replaceAll('/', '-'),
        school,
        by: k.counted_by ?? k.started_by ?? '',
        words: [
          `Counted on ${dmy(k.counted_on)}`,
          k.category ?? 'all the store holds',
          {
            counting: 'counting',
            submitted: 'waiting for approval',
            approved: 'approved',
            cancelled: 'cancelled',
          }[k.status],
        ].join(' · '),
        columns: [
          { label: 'Item code', width: 1.3 },
          { label: 'Item', width: 2.8 },
          { label: 'Category', width: 1.6 },
          { label: 'Batch', width: 1.2 },
          { label: 'Expiry', type: 'date' },
          { label: 'Unit', width: 0.8 },
          { label: 'Book', type: 'number' },
          { label: 'Counted', type: 'number' },
          { label: 'Excess', type: 'number' },
          { label: 'Shortage', type: 'number' },
          { label: 'Rate (₹)', type: 'money' },
          { label: 'Value (₹)', type: 'money' },
          { label: 'Reason', width: 2.6 },
        ] as FileColumn[],
        rows,
        totals: ['Net difference', '', '', '', '', '', '', '', '', '', '', net, ''],
      });
    });
  }

  /** The count sheet (blind while counting) or, once counted, the statement of differences. */
  async pdf(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id);
      await this.mustRead(c, ctx, k);
      const lines = await this.linesOf(c, id);
      const read = (key: string) => this.storage.read(key);
      const head = await pdfSchool(c, read);
      const blind = k.status === 'counting';
      const value = lines.reduce(
        (a, l) =>
          a +
          (l.value !== null
            ? Number(l.value)
            : l.counted_qty === null
              ? 0
              : (Number(l.counted_qty) - Number(l.book_qty)) * Number(l.avg_rate ?? 0)),
        0,
      );
      const bytes = await purchaseStockPdf({
        ...head,
        title: blind ? 'Physical Count Sheet' : 'Physical Verification Statement',
        number: k.number,
        watermark:
          k.status === 'approved'
            ? null
            : k.status === 'cancelled'
              ? 'CANCELLED'
              : blind
                ? null
                : 'NOT APPROVED',
        facts: [
          ['Store', k.store],
          ['Items', k.category ?? 'All the store holds'],
          ['Counted on', dmy(k.counted_on)],
          ...((k.counted_by ? [['Counted by', k.counted_by]] : []) as Array<[string, string]>),
          ...((k.status === 'approved'
            ? [
                [
                  'Approved',
                  `${k.decided_by ?? ''} on ${dmy(k.decided_at?.toISOString().slice(0, 10) ?? null)}`,
                ],
              ]
            : []) as Array<[string, string]>),
        ],
        columns: blind
          ? [
              { label: '#', width: 4 },
              { label: 'Item', width: 46 },
              { label: 'Batch', width: 16 },
              { label: 'Unit', width: 8 },
              { label: 'Counted', width: 14, right: true },
            ]
          : [
              { label: '#', width: 4 },
              { label: 'Item', width: 31 },
              { label: 'Unit', width: 7 },
              { label: 'Book', width: 9, right: true },
              { label: 'Counted', width: 9, right: true },
              { label: 'Excess', width: 9, right: true },
              { label: 'Shortage', width: 9, right: true },
              { label: 'Value (Rs)', width: 11, right: true },
            ],
        rows: lines.map((l, i) => {
          const diff =
            l.counted_qty === null ? null : round3(Number(l.counted_qty) - Number(l.book_qty));
          return blind
            ? {
                cells: [
                  String(i + 1),
                  `${l.item} (${l.item_code})`,
                  [l.batch_no, l.expiry ? dmy(l.expiry) : null].filter(Boolean).join(' · '),
                  l.unit,
                  l.counted_qty === null ? '' : qty3(Number(l.counted_qty)),
                ],
              }
            : {
                cells: [
                  String(i + 1),
                  `${l.item} (${l.item_code})`,
                  l.unit,
                  qty3(Number(l.book_qty)),
                  l.counted_qty === null ? '' : qty3(Number(l.counted_qty)),
                  diff && diff > 0 ? qty3(diff) : '',
                  diff && diff < 0 ? qty3(-diff) : '',
                  diff
                    ? money2(l.value !== null ? Number(l.value) : diff * Number(l.avg_rate ?? 0))
                    : '',
                ],
                detail: [
                  l.batch_no ? `Batch ${l.batch_no}` : null,
                  diff ? reasonWords(l.reason_code, l.reason) : null,
                ]
                  .filter(Boolean)
                  .join(' · '),
              };
        }),
        ...(blind ? {} : { total: { label: 'Net difference (Rs)', value: money2(value) } }),
        // as on the GRN: signature, name, Emp. ID · designation and when (docs/design/83)
        signatures: [
          k.submitted_at
            ? await signerOf(c, read, {
                as: 'Counted by',
                name: k.counted_by ?? k.started_by,
                userId: k.submitted_by ?? k.created_by,
                at: k.submitted_at,
                verb: 'Counted on',
              })
            : blankBox('Counted by'),
          blankBox('Store keeper'),
          blankBox('Verified by'),
          k.decided_at && k.decided_by_id
            ? await signerOf(c, read, {
                as: 'Approved by',
                name: k.decided_by,
                userId: k.decided_by_id,
                at: k.decided_at,
                verb: 'Approved on',
              })
            : blankBox('Approved by'),
        ],
        foot: 'Physical verification of stores (GFR 2017 rule 213): the differences post as adjustments only once approved.',
      });
      return { bytes, filename: `${k.number.replaceAll('/', '-')}.pdf` };
    });
  }
}
