import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { StorageDriver } from '@edupro/storage';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { STORAGE_DRIVER } from '../files/storage';
import { BOOK_VALUE } from './purchase-asset-core';
import {
  dmy,
  freeStock,
  istToday,
  money2,
  pdfSchool,
  PERSON_OF,
  qty3,
  refreshReserved,
} from './purchase-stock-core';
import { blankBox, signerOf, type SignBox } from './purchase-doc-sign';
import { purchaseStockPdf } from './purchase-stock-pdf';
import { postStock } from './purchase-stores.service';
import {
  PURCHASE,
  type CommitteeMemberDto,
  type CondemnationDecisionDto,
  type CondemnationDto,
  type DisposalDto,
  type ReasonDto,
  type StockDocQueryDto,
} from './purchase.dto';

const REASON: Record<string, string> = {
  unserviceable: 'Unserviceable',
  obsolete: 'Obsolete',
  surplus: 'Surplus',
  expired: 'Expired',
  damaged: 'Damaged beyond repair',
  lost: 'Lost',
};
const METHOD: Record<string, string> = {
  auction: 'Public auction',
  tender_sale: 'Sale by tender',
  sale: 'Sale',
  buyback: 'Buy-back by a vendor',
  scrap: 'Sold as scrap',
  donation: 'Donated',
  destruction: 'Destroyed',
};
/** GFR 2017 rule 217: above this residual value disposal is by tender or public auction. */
const AUCTION_ABOVE = 200_000;
const OPEN = ['draft', 'committee', 'approval'];

/**
 * Condemnation and disposal (docs/design/84, part 9; GFR 2017 rule 217): a proposal of assets and stock
 * quantities that are unserviceable, obsolete, surplus or expired, with the reasons and book value —
 * stock in it is held from issue meanwhile; the condemnation committee (Purchase settings) signs its
 * recommendation; the school admin (never its maker) approves — the assets are written off at their
 * book value and the stock leaves the store as a write-off — or rejects it or sends it back; then the
 * disposal is recorded (auction, sale, scrap, donation, destruction: who, how much, when; by tender or
 * auction above ₹2 lakh of book value).
 */
@Injectable()
export class PurchaseCondemnationsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private has(ctx: RequestContext, p: string) {
    return ctx.permissions?.has(p) ?? false;
  }
  private mustManage(ctx: RequestContext) {
    if (!this.has(ctx, PURCHASE.assetManage))
      throw new DomainError('permission-denied', 'Only the purchase office proposes condemnation', {
        status: 403,
      });
  }

  // ---- the committee -------------------------------------------------------------------------------
  private async committee(c: PoolClient, id: string | null) {
    return (
      await c.query<{
        id: string;
        employee_id: string;
        name: string;
        code: string;
        designation: string | null;
        role: string | null;
        user_id: string | null;
        signed_at: Date | null;
        me: boolean;
      }>(
        `SELECT m.id::text, e.id::text AS employee_id, e.display_name AS name, e.employee_code AS code, e.designation, m.role,
                e.user_id::text, (SELECT s.signed_at FROM condemnation_signoffs s WHERE s.condemnation_id = $1 AND s.employee_id = e.id) AS signed_at,
                (e.user_id = app.current_user_id()) AS me
           FROM condemnation_committee_members m JOIN employees e ON e.id = m.employee_id
          WHERE e.deleted_at IS NULL ORDER BY e.display_name`,
        [id],
      )
    ).rows;
  }

  async committeeList(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const s = (
        await c.query<{ n: number | null }>(
          `SELECT condemnation_signatures AS n FROM purchase_settings WHERE school_id = app.current_school_id()`,
        )
      ).rows[0];
      return {
        signatures: s?.n ?? null,
        members: (await this.committee(c, null)).map((m) => ({
          id: m.id,
          employeeId: m.employee_id,
          name: m.name,
          code: m.code,
          designation: m.designation,
          role: m.role,
          signsIn: !!m.user_id,
        })),
      };
    });
  }

  async addMember(ctx: RequestContext, dto: CommitteeMemberDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const e = await c.query(
        `SELECT 1 FROM employees WHERE id = $1 AND deleted_at IS NULL AND status = 'active'`,
        [dto.employeeId],
      );
      if (!e.rowCount) throw new DomainError('validation-failed', 'Employee not found');
      const r = await c.query<{ id: string }>(
        `INSERT INTO condemnation_committee_members (school_id, employee_id, role) VALUES (app.current_school_id(), $1, $2)
         ON CONFLICT (school_id, employee_id) DO UPDATE SET role = EXCLUDED.role RETURNING id::text`,
        [dto.employeeId, dto.role ?? null],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.condemnation_committee.add',
        entityType: 'condemnation_committee_members',
        entityId: r.rows[0]!.id,
        after: { ...dto },
      });
      return { id: r.rows[0]!.id };
    });
  }

  async removeMember(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query(`DELETE FROM condemnation_committee_members WHERE id = $1`, [id]);
      if (!r.rowCount) throw new DomainError('not-found', 'Member not found', { status: 404 });
      await this.audit.stage(ctx, c, {
        action: 'purchase.condemnation_committee.remove',
        entityType: 'condemnation_committee_members',
        entityId: id,
      });
      return { removed: true };
    });
  }

  async setSignatures(ctx: RequestContext, n: number | null) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `UPDATE purchase_settings SET condemnation_signatures = $1 WHERE school_id = app.current_school_id()`,
        [n],
      );
      return { saved: true };
    });
  }

  // ---- lists ---------------------------------------------------------------------------------------
  /** I may see a condemnation: the stores, the approvers, its committee. */
  private async mustSee(c: PoolClient, ctx: RequestContext) {
    if (
      this.has(ctx, PURCHASE.storeView) ||
      this.has(ctx, PURCHASE.assetManage) ||
      this.has(ctx, PURCHASE.condemnationApprove)
    )
      return;
    const m = await c.query(
      `SELECT 1 FROM condemnation_committee_members m JOIN employees e ON e.id = m.employee_id WHERE e.user_id = app.current_user_id()`,
    );
    if (!m.rowCount)
      throw new DomainError(
        'permission-denied',
        'Only the stores and the condemnation committee see these',
        {
          status: 403,
        },
      );
  }

  async list(ctx: RequestContext, q: StockDocQueryDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustSee(c, ctx);
      const r = await c.query<{
        id: string;
        number: string;
        title: string;
        status: string;
        lines: number;
        value: string;
        created_at: Date;
        by: string | null;
        signed: number;
        to_sign: boolean;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON_OF is a fixed fragment
        `SELECT k.id::text, k.number, k.title, k.status, (SELECT count(*)::int FROM condemnation_lines l WHERE l.condemnation_id = k.id) AS lines,
                COALESCE((SELECT sum(l.book_value) FROM condemnation_lines l WHERE l.condemnation_id = k.id), 0)::text AS value,
                k.created_at, (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = k.created_by) AS by,
                (SELECT count(*)::int FROM condemnation_signoffs s WHERE s.condemnation_id = k.id) AS signed,
                (k.status = 'committee' AND EXISTS (SELECT 1 FROM condemnation_committee_members m JOIN employees e ON e.id = m.employee_id
                                                     WHERE e.user_id = app.current_user_id()
                                                       AND NOT EXISTS (SELECT 1 FROM condemnation_signoffs s WHERE s.condemnation_id = k.id AND s.employee_id = e.id))) AS to_sign
           FROM condemnations k
          WHERE ($1::text IS NULL OR k.status = $1) AND (NOT $2 OR (k.status = 'committee' AND EXISTS (
                  SELECT 1 FROM condemnation_committee_members m JOIN employees e ON e.id = m.employee_id
                   WHERE e.user_id = app.current_user_id()
                     AND NOT EXISTS (SELECT 1 FROM condemnation_signoffs s WHERE s.condemnation_id = k.id AND s.employee_id = e.id)))
                  OR (k.status = 'approval' AND $3 AND k.created_by <> app.current_user_id()))
          ORDER BY (k.status IN ('draft', 'committee', 'approval')) DESC, k.created_at DESC LIMIT 50 OFFSET $4`,
        [q.status ?? null, q.mine, this.has(ctx, PURCHASE.condemnationApprove), (q.page - 1) * 50],
      );
      return {
        rows: r.rows.map((x) => ({
          id: x.id,
          number: x.number,
          title: x.title,
          status: x.status,
          lines: x.lines,
          value: Number(x.value),
          createdAt: x.created_at.toISOString(),
          by: x.by,
          signed: x.signed,
          toSign: x.to_sign,
        })),
        page: q.page,
      };
    });
  }

  /** What may be proposed: assets on the books, and stock (free) in each store. */
  async candidates(ctx: RequestContext) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const assets = await c.query<{
        id: string;
        tag: string;
        item: string;
        status: string;
        condition: string;
        book: string;
        place: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- BOOK_VALUE is a fixed fragment
        `SELECT a.id::text, a.tag, i.name AS item, a.status, a.condition, ${BOOK_VALUE('a')}::text AS book,
                COALESCE(st.name, d.name) AS place
           FROM assets a JOIN purchase_items i ON i.id = a.item_id LEFT JOIN stores st ON st.id = a.store_id
           LEFT JOIN departments d ON d.id = a.department_id
          WHERE a.status IN ('in_store', 'in_use', 'under_repair', 'lost')
            AND NOT EXISTS (SELECT 1 FROM condemnation_lines l JOIN condemnations k ON k.id = l.condemnation_id
                             WHERE l.asset_id = a.id AND k.status IN ('draft', 'committee', 'approval'))
          ORDER BY (a.condition = 'unserviceable') DESC, a.tag LIMIT 3000`,
      );
      const stock = await c.query<{
        store_id: string;
        store: string;
        item_id: string;
        code: string;
        name: string;
        unit: string;
        tracks_batch: boolean;
        qty: string;
        reserved: string;
        avg: string;
      }>(
        `SELECT b.store_id::text, st.name AS store, b.item_id::text, i.code, i.name, COALESCE(su.code, u.code) AS unit, i.tracks_batch,
                b.qty::text, b.reserved::text, b.avg_rate::text AS avg
           FROM stock_balances b JOIN stores st ON st.id = b.store_id JOIN purchase_items i ON i.id = b.item_id
           JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
          WHERE b.qty > 0 AND i.item_type <> 'asset' ORDER BY st.name, i.name`,
      );
      const batches = await c.query<{
        store_id: string;
        item_id: string;
        batch_no: string;
        expiry: string | null;
        qty: string;
      }>(
        `SELECT store_id::text, item_id::text, batch_no, expiry::text, qty_left::text AS qty FROM stock_batches WHERE qty_left > 0
          ORDER BY expiry NULLS LAST`,
      );
      return {
        assets: assets.rows.map((a) => ({
          id: a.id,
          tag: a.tag,
          item: a.item,
          status: a.status,
          condition: a.condition,
          bookValue: Number(a.book),
          place: a.place,
        })),
        stock: stock.rows.map((s) => ({
          storeId: s.store_id,
          store: s.store,
          itemId: s.item_id,
          code: s.code,
          name: s.name,
          unit: s.unit,
          tracksBatch: s.tracks_batch,
          qty: Number(s.qty),
          free: Math.max(0, Number(s.qty) - Number(s.reserved)),
          avgRate: Number(s.avg),
        })),
        batches: batches.rows.map((b) => ({
          storeId: b.store_id,
          itemId: b.item_id,
          batch: b.batch_no,
          expiry: b.expiry,
          qty: Number(b.qty),
        })),
      };
    });
  }

  private async load(c: PoolClient, id: string, lock = false) {
    const k = (
      await c.query<{
        id: string;
        number: string;
        title: string;
        status: string;
        note: string | null;
        created_by: string | null;
        by: string | null;
        created_at: Date;
        submitted_at: Date | null;
        decided_at: Date | null;
        decided_by: string | null;
        decided_by_id: string | null;
        decision_note: string | null;
        written_off_on: string | null;
      }>(
        // eslint-disable-next-line no-restricted-syntax -- PERSON_OF and the lock are fixed fragments
        `SELECT k.id::text, k.number, k.title, k.status, k.note, k.created_by::text, (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = k.created_by) AS by,
                k.created_at, k.submitted_at, k.decided_at, (SELECT ${PERSON_OF('u')} FROM users u WHERE u.id = k.decided_by) AS decided_by,
                k.decided_by::text AS decided_by_id,
                k.decision_note, k.written_off_on::text
           FROM condemnations k WHERE k.id = $1${lock ? ' FOR UPDATE' : ''}`,
        [id],
      )
    ).rows[0];
    if (!k) throw new DomainError('not-found', 'Condemnation not found', { status: 404 });
    return k;
  }

  private async linesOf(c: PoolClient, id: string) {
    return (
      await c.query<{
        id: string;
        kind: 'asset' | 'stock';
        asset_id: string | null;
        tag: string | null;
        asset_status: string | null;
        asset_store_id: string | null;
        store_id: string | null;
        store: string | null;
        item_id: string | null;
        item: string;
        unit: string | null;
        batch_no: string | null;
        qty: string | null;
        reason_kind: string;
        reason: string | null;
        book_value: string;
        acquired_on: string | null;
        cost: string | null;
      }>(
        `SELECT l.id::text, l.kind, l.asset_id::text, a.tag, a.status AS asset_status, a.store_id::text AS asset_store_id,
                l.store_id::text, st.name AS store, COALESCE(l.item_id, a.item_id)::text AS item_id, i.name AS item,
                COALESCE(su.code, u.code) AS unit, l.batch_no, l.qty::text, l.reason_kind, l.reason, l.book_value::text,
                a.acquired_on::text, a.cost::text
           FROM condemnation_lines l
           LEFT JOIN assets a ON a.id = l.asset_id
           JOIN purchase_items i ON i.id = COALESCE(l.item_id, a.item_id)
           JOIN purchase_uoms u ON u.id = i.uom_id LEFT JOIN purchase_uoms su ON su.id = i.stock_uom_id
           LEFT JOIN stores st ON st.id = COALESCE(l.store_id, a.store_id)
          WHERE l.condemnation_id = $1 ORDER BY l.kind, a.tag, i.name`,
        [id],
      )
    ).rows;
  }

  async get(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustSee(c, ctx);
      const k = await this.load(c, id);
      const lines = await this.linesOf(c, id);
      const committee = await this.committee(c, id);
      const need = await this.required(c, committee.length);
      const me = committee.find((m) => m.me);
      const disposal = (
        await c.query<{
          method: string;
          disposed_on: string;
          party: string | null;
          amount: string;
          reference: string | null;
          note: string | null;
          file_id: string | null;
        }>(
          `SELECT method, disposed_on::text, party, amount::text, reference, note, file_id::text FROM disposals WHERE condemnation_id = $1`,
          [id],
        )
      ).rows[0];
      const value = lines.reduce((a, l) => a + Number(l.book_value), 0);
      const mine = k.created_by === String(ctx.user.id);
      return {
        id: k.id,
        number: k.number,
        title: k.title,
        status: k.status,
        note: k.note,
        createdBy: k.by,
        createdAt: k.created_at.toISOString(),
        submittedAt: k.submitted_at?.toISOString() ?? null,
        decidedAt: k.decided_at?.toISOString() ?? null,
        decidedBy: k.decided_by,
        decisionNote: k.decision_note,
        writtenOffOn: k.written_off_on,
        value: Math.round(value * 100) / 100,
        auctionNeeded: value > AUCTION_ABOVE,
        lineItems: lines.map((l) => ({
          id: l.id,
          kind: l.kind,
          assetId: l.asset_id,
          tag: l.tag,
          item: l.item,
          itemId: l.item_id,
          storeId: l.store_id,
          unit: l.unit,
          store: l.store,
          batch: l.batch_no,
          qty: l.qty === null ? null : Number(l.qty),
          reasonKind: l.reason_kind,
          reasonLabel: REASON[l.reason_kind] ?? l.reason_kind,
          reason: l.reason,
          bookValue: Number(l.book_value),
          cost: l.cost === null ? null : Number(l.cost),
          acquiredOn: l.acquired_on,
        })),
        committee: {
          required: need,
          members: committee.map((m) => ({
            name: m.name,
            role: m.role ?? m.designation,
            signedAt: m.signed_at?.toISOString() ?? null,
            me: m.me,
          })),
        },
        disposal: disposal
          ? {
              method: disposal.method,
              methodLabel: METHOD[disposal.method] ?? disposal.method,
              disposedOn: disposal.disposed_on,
              party: disposal.party,
              amount: Number(disposal.amount),
              reference: disposal.reference,
              note: disposal.note,
              hasFile: !!disposal.file_id,
            }
          : null,
        can: {
          edit: k.status === 'draft' && this.has(ctx, PURCHASE.assetManage),
          submit: k.status === 'draft' && this.has(ctx, PURCHASE.assetManage),
          sign: k.status === 'committee' && !!me && !me.signed_at,
          sendBack: k.status === 'committee' && !!me,
          decide: k.status === 'approval' && this.has(ctx, PURCHASE.condemnationApprove) && !mine,
          dispose: k.status === 'written_off' && this.has(ctx, PURCHASE.assetManage),
          cancel: OPEN.includes(k.status) && this.has(ctx, PURCHASE.assetManage),
        },
      };
    });
  }

  private async required(c: PoolClient, members: number) {
    const s = (
      await c.query<{ n: number | null }>(
        `SELECT condemnation_signatures AS n FROM purchase_settings WHERE school_id = app.current_school_id()`,
      )
    ).rows[0];
    return Math.min(s?.n ?? members, members);
  }

  // ---- the proposal --------------------------------------------------------------------------------
  /** The lines checked and valued: assets on the books in no other open proposal; stock within its free quantity. */
  private async writeLines(c: PoolClient, id: string, dto: CondemnationDto) {
    const touched = new Set<string>();
    const old = await c.query<{ store_id: string; item_id: string }>(
      `DELETE FROM condemnation_lines WHERE condemnation_id = $1 RETURNING store_id::text, item_id::text`,
      [id],
    );
    for (const o of old.rows)
      if (o.store_id && o.item_id) touched.add(`${o.store_id}:${o.item_id}`);
    for (const t of touched) {
      const [s, i] = t.split(':') as [string, string];
      await refreshReserved(c, s, i);
    }
    const seen = new Set<string>();
    for (const l of dto.lines) {
      if (l.kind === 'asset') {
        if (seen.has(l.assetId!))
          throw new DomainError('validation-failed', 'An asset is on the proposal twice');
        seen.add(l.assetId!);
        const a = (
          await c.query<{ tag: string; status: string; book: string; open: boolean }>(
            // eslint-disable-next-line no-restricted-syntax -- BOOK_VALUE is a fixed fragment
            `SELECT a.tag, a.status, ${BOOK_VALUE('a')}::text AS book,
                    EXISTS (SELECT 1 FROM condemnation_lines l JOIN condemnations k ON k.id = l.condemnation_id
                             WHERE l.asset_id = a.id AND k.id <> $2 AND k.status IN ('draft', 'committee', 'approval')) AS open
               FROM assets a WHERE a.id = $1`,
            [l.assetId, id],
          )
        ).rows[0];
        if (!a) throw new DomainError('validation-failed', 'An asset was not found');
        if (!['in_store', 'in_use', 'under_repair', 'lost'].includes(a.status))
          throw new DomainError('validation-failed', `${a.tag} is off the register already`, {
            status: 400,
          });
        if (a.open)
          throw new DomainError('validation-failed', `${a.tag} is on another open condemnation`, {
            status: 409,
          });
        await c.query(
          `INSERT INTO condemnation_lines (school_id, condemnation_id, kind, asset_id, reason_kind, reason, book_value)
           VALUES (app.current_school_id(), $1, 'asset', $2, $3, $4, $5)`,
          [id, l.assetId, l.reasonKind, l.reason ?? null, a.book],
        );
        continue;
      }
      const it = (
        await c.query<{ name: string; tracks_batch: boolean; item_type: string }>(
          `SELECT name, tracks_batch, item_type FROM purchase_items WHERE id = $1`,
          [l.itemId],
        )
      ).rows[0];
      if (!it) throw new DomainError('validation-failed', 'An item was not found');
      if (it.item_type === 'asset')
        throw new DomainError('validation-failed', `${it.name}: propose its assets (by tag)`, {
          status: 400,
        });
      if (it.tracks_batch && !l.batch)
        throw new DomainError('validation-failed', `${it.name}: name the batch`, { status: 400 });
      const f = await freeStock(c, l.storeId!, l.itemId!);
      if (l.qty! > f.free + 1e-9)
        throw new DomainError(
          'stock.insufficient',
          `${it.name}: ${qty3(f.free)} free in the store (${qty3(f.reserved)} reserved or held)`,
          { status: 409 },
        );
      if (l.batch) {
        const b = await c.query<{ q: string }>(
          `SELECT COALESCE(sum(qty_left), 0)::text AS q FROM stock_batches WHERE store_id = $1 AND item_id = $2 AND batch_no = $3`,
          [l.storeId, l.itemId, l.batch],
        );
        if (l.qty! > Number(b.rows[0]!.q) + 1e-9)
          throw new DomainError(
            'validation-failed',
            `${it.name}: batch ${l.batch} holds ${qty3(Number(b.rows[0]!.q))}`,
            {
              status: 400,
            },
          );
      }
      const avg = (
        await c.query<{ avg: string }>(
          `SELECT avg_rate::text AS avg FROM stock_balances WHERE store_id = $1 AND item_id = $2`,
          [l.storeId, l.itemId],
        )
      ).rows[0];
      await c.query(
        `INSERT INTO condemnation_lines (school_id, condemnation_id, kind, store_id, item_id, batch_no, qty, reason_kind, reason, book_value)
         VALUES (app.current_school_id(), $1, 'stock', $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          l.storeId,
          l.itemId,
          l.batch ?? null,
          l.qty,
          l.reasonKind,
          l.reason ?? null,
          Math.round(l.qty! * Number(avg?.avg ?? 0) * 100) / 100,
        ],
      );
      // held from issue while the proposal is open
      await refreshReserved(c, l.storeId!, l.itemId!);
    }
  }

  async create(ctx: RequestContext, dto: CondemnationDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const number = (
        await c.query<{ n: string }>(`SELECT app.purchase_next_number('condemnation') AS n`)
      ).rows[0]!.n;
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO condemnations (school_id, number, title, note, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, app.current_user_id()) RETURNING id::text`,
          [number, dto.title, dto.note ?? null],
        )
      ).rows[0]!.id;
      await this.writeLines(c, id, dto);
      await this.audit.stage(ctx, c, {
        action: 'purchase.condemnation.create',
        entityType: 'condemnations',
        entityId: id,
        after: { number, lines: dto.lines.length },
      });
      return { id, number };
    });
  }

  async update(ctx: RequestContext, id: string, dto: CondemnationDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id, true);
      if (k.status !== 'draft')
        throw new DomainError('purchase.not_waiting', 'Only a draft is changed', { status: 409 });
      await c.query(
        `UPDATE condemnations SET title = $2, note = $3, updated_at = now() WHERE id = $1`,
        [id, dto.title, dto.note ?? null],
      );
      await this.writeLines(c, id, dto);
      return { saved: true };
    });
  }

  async submit(ctx: RequestContext, id: string) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id, true);
      if (k.status !== 'draft')
        throw new DomainError('purchase.not_waiting', 'Only a draft goes to the committee', {
          status: 409,
        });
      const members = (await this.committee(c, id)).filter((m) => m.user_id);
      if (!members.length)
        throw new DomainError(
          'purchase.no_committee',
          'Name the condemnation committee first (Purchase settings)',
          { status: 409 },
        );
      await c.query(
        `UPDATE condemnations SET status = 'committee', submitted_at = now(), decision_note = NULL, updated_at = now() WHERE id = $1`,
        [id],
      );
      await c.query(`DELETE FROM condemnation_signoffs WHERE condemnation_id = $1`, [id]);
      await this.audit.stage(ctx, c, {
        action: 'purchase.condemnation.submit',
        entityType: 'condemnations',
        entityId: id,
        after: { number: k.number },
      });
      return { status: 'committee' };
    });
  }

  /** A committee member signs the recommendation; with enough signatures it goes for approval. */
  async sign(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id, true);
      if (k.status !== 'committee')
        throw new DomainError('purchase.not_waiting', 'This is not with the committee', {
          status: 409,
        });
      const committee = await this.committee(c, id);
      const me = committee.find((m) => m.me);
      if (!me)
        throw new DomainError('permission-denied', 'Only the condemnation committee signs', {
          status: 403,
        });
      await c.query(
        `INSERT INTO condemnation_signoffs (school_id, condemnation_id, employee_id, user_id)
         VALUES (app.current_school_id(), $1, $2, app.current_user_id()) ON CONFLICT DO NOTHING`,
        [id, me.employee_id],
      );
      const signed = (
        await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM condemnation_signoffs WHERE condemnation_id = $1`,
          [id],
        )
      ).rows[0]!.n;
      const need = await this.required(c, committee.length);
      if (signed >= need)
        await c.query(
          `UPDATE condemnations SET status = 'approval', updated_at = now() WHERE id = $1`,
          [id],
        );
      await this.audit.stage(ctx, c, {
        action: 'purchase.condemnation.sign',
        entityType: 'condemnations',
        entityId: id,
        after: { signed, need },
      });
      return { signed, need, status: signed >= need ? 'approval' : 'committee' };
    });
  }

  /**
   * The committee member sends it back (to draft), or the approver approves (written off), rejects it
   * or sends it back.
   */
  async decide(ctx: RequestContext, id: string, dto: CondemnationDecisionDto) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id, true);
      if (dto.action !== 'approve' && (dto.note ?? '').length < 3)
        throw new DomainError('validation-failed', 'Give the reason', { status: 400 });
      if (dto.action === 'send_back' && k.status === 'committee') {
        const me = (await this.committee(c, id)).find((m) => m.me);
        if (!me)
          throw new DomainError(
            'permission-denied',
            'Only the condemnation committee sends it back',
            {
              status: 403,
            },
          );
      } else {
        if (k.status !== 'approval')
          throw new DomainError('purchase.not_waiting', 'This is not waiting for approval', {
            status: 409,
          });
        if (!this.has(ctx, PURCHASE.condemnationApprove))
          throw new DomainError(
            'permission-denied',
            'Only the school admin approves condemnation',
            {
              status: 403,
            },
          );
        if (k.created_by === String(ctx.user.id))
          throw new DomainError(
            'workflow.self_approval',
            'You proposed it: someone else approves it',
            {
              status: 403,
            },
          );
      }
      const lines = await this.linesOf(c, id);
      if (dto.action === 'send_back' || dto.action === 'reject') {
        await c.query(
          `UPDATE condemnations SET status = $2, decision_note = $3, decided_at = now(), decided_by = app.current_user_id(),
                  updated_at = now() WHERE id = $1`,
          [id, dto.action === 'send_back' ? 'draft' : 'rejected', dto.note],
        );
        await c.query(`DELETE FROM condemnation_signoffs WHERE condemnation_id = $1`, [id]);
        if (dto.action === 'reject') await this.release(c, lines);
        await this.audit.stage(ctx, c, {
          action: `purchase.condemnation.${dto.action}`,
          entityType: 'condemnations',
          entityId: id,
          after: { note: dto.note },
        });
        return { status: dto.action === 'send_back' ? 'draft' : 'rejected' };
      }
      // approved: written off — assets at their book value now, stock out of the store
      const day = istToday();
      for (const l of lines) {
        if (l.kind === 'asset') {
          const book = (
            await c.query<{ b: string }>(
              // eslint-disable-next-line no-restricted-syntax -- BOOK_VALUE is a fixed fragment
              `SELECT ${BOOK_VALUE('a')}::text AS b FROM assets a WHERE a.id = $1`,
              [l.asset_id],
            )
          ).rows[0]!.b;
          // an asset kept in a store is in its stock too: it leaves the store
          if (l.asset_status === 'in_store' && l.asset_store_id) {
            const per = (
              await c.query<{ s: boolean }>(
                `SELECT stock_tracked AS s FROM purchase_items WHERE id = $1`,
                [l.item_id],
              )
            ).rows[0]!.s;
            const inStock = per
              ? Number(
                  (
                    await c.query<{ q: string }>(
                      `SELECT COALESCE(qty, 0)::text AS q FROM stock_balances WHERE store_id = $1 AND item_id = $2`,
                      [l.asset_store_id, l.item_id],
                    )
                  ).rows[0]?.q ?? 0,
                )
              : 0;
            if (inStock >= 1) {
              const moveId = await postStock(
                c,
                {
                  storeId: l.asset_store_id,
                  itemId: l.item_id!,
                  kind: 'write_off',
                  qty: -1,
                  docType: 'condemnation',
                  docId: id,
                  docLineId: l.id,
                  note: `${k.number}: ${l.tag ?? ''}`,
                  day,
                },
                l.item,
              );
              await c.query(`UPDATE condemnation_lines SET move_id = $2 WHERE id = $1`, [
                l.id,
                moveId,
              ]);
            }
          }
          await c.query(
            `UPDATE assets SET status = 'written_off', left_on = $2, book_value_at_exit = $3, store_id = NULL, custodian_employee_id = NULL,
                    updated_at = now() WHERE id = $1`,
            [l.asset_id, day, book],
          );
          await c.query(
            `INSERT INTO asset_movements (school_id, asset_id, kind, moved_on, doc, note, created_by)
             VALUES (app.current_school_id(), $1, 'written_off', $2, $3, $4, app.current_user_id())`,
            [
              l.asset_id,
              day,
              k.number,
              `${REASON[l.reason_kind] ?? l.reason_kind}${l.reason ? `: ${l.reason}` : ''}`.slice(
                0,
                500,
              ),
            ],
          );
          continue;
        }
        const moveId = await postStock(
          c,
          {
            storeId: l.store_id!,
            itemId: l.item_id!,
            kind: 'write_off',
            qty: -Number(l.qty),
            batch: l.batch_no,
            docType: 'condemnation',
            docId: id,
            docLineId: l.id,
            note: `${k.number}: ${REASON[l.reason_kind] ?? l.reason_kind}`,
            day,
          },
          l.item,
        );
        await c.query(`UPDATE condemnation_lines SET move_id = $2 WHERE id = $1`, [l.id, moveId]);
      }
      await c.query(
        `UPDATE condemnations SET status = 'written_off', written_off_on = $2, decision_note = $3, decided_at = now(),
                decided_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
        [id, day, dto.note ?? null],
      );
      await this.release(c, lines);
      await this.audit.stage(ctx, c, {
        action: 'purchase.condemnation.approve',
        entityType: 'condemnations',
        entityId: id,
        after: { number: k.number, lines: lines.length },
      });
      return { status: 'written_off' };
    });
  }

  /** The stock a proposal held is free (or gone) again. */
  private async release(
    c: PoolClient,
    lines: Awaited<ReturnType<PurchaseCondemnationsService['linesOf']>>,
  ) {
    const done = new Set<string>();
    for (const l of lines)
      if (
        l.kind === 'stock' &&
        l.store_id &&
        l.item_id &&
        !done.has(`${l.store_id}:${l.item_id}`)
      ) {
        done.add(`${l.store_id}:${l.item_id}`);
        await refreshReserved(c, l.store_id, l.item_id);
      }
  }

  async cancel(ctx: RequestContext, id: string, dto: ReasonDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id, true);
      if (!OPEN.includes(k.status))
        throw new DomainError('purchase.not_waiting', 'Only an open proposal is cancelled', {
          status: 409,
        });
      await c.query(
        `UPDATE condemnations SET status = 'cancelled', decision_note = $2, updated_at = now() WHERE id = $1`,
        [id, dto.reason],
      );
      await this.release(c, await this.linesOf(c, id));
      await this.audit.stage(ctx, c, {
        action: 'purchase.condemnation.cancel',
        entityType: 'condemnations',
        entityId: id,
        after: { reason: dto.reason },
      });
      return { cancelled: true };
    });
  }

  /** What was written off is disposed of: how, to whom, for how much (by tender or auction above ₹2 lakh). */
  async dispose(ctx: RequestContext, id: string, dto: DisposalDto) {
    this.mustManage(ctx);
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const k = await this.load(c, id, true);
      if (k.status !== 'written_off')
        throw new DomainError('purchase.not_waiting', 'Only what is written off is disposed of', {
          status: 409,
        });
      const lines = await this.linesOf(c, id);
      const value = lines.reduce((a, l) => a + Number(l.book_value), 0);
      if (
        value > AUCTION_ABOVE &&
        (!['auction', 'tender_sale'].includes(dto.method) || !dto.reference)
      )
        throw new DomainError(
          'validation-failed',
          `The book value is ${money2(value)}, above ₹2 lakh: dispose of it by public auction or tender, with its reference (GFR 2017 rule 217)`,
          { status: 400 },
        );
      if (['auction', 'tender_sale', 'sale', 'buyback', 'scrap'].includes(dto.method) && !dto.party)
        throw new DomainError('validation-failed', 'Name the buyer', { status: 400 });
      if (dto.disposedOn < (k.written_off_on ?? dto.disposedOn) || dto.disposedOn > istToday())
        throw new DomainError(
          'validation-failed',
          'The day disposed is between the write-off and today',
          {
            status: 400,
          },
        );
      await c.query(
        `INSERT INTO disposals (school_id, condemnation_id, method, disposed_on, party, amount, reference, note, file_id, created_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, app.current_user_id())`,
        [
          id,
          dto.method,
          dto.disposedOn,
          dto.party ?? null,
          dto.amount,
          dto.reference ?? null,
          dto.note ?? null,
          dto.fileId ?? null,
        ],
      );
      const assets = lines.filter((l) => l.kind === 'asset').map((l) => l.asset_id!);
      if (assets.length) {
        await c.query(
          `UPDATE assets SET status = 'disposed', updated_at = now() WHERE id = ANY($1::bigint[])`,
          [assets],
        );
        await c.query(
          `INSERT INTO asset_movements (school_id, asset_id, kind, moved_on, doc, note, created_by)
           SELECT app.current_school_id(), a, 'disposed', $2, $3, $4, app.current_user_id() FROM unnest($1::bigint[]) a`,
          [
            assets,
            dto.disposedOn,
            k.number,
            `${METHOD[dto.method] ?? dto.method}${dto.party ? ` to ${dto.party}` : ''}`.slice(
              0,
              500,
            ),
          ],
        );
      }
      await c.query(
        `UPDATE condemnations SET status = 'disposed', updated_at = now() WHERE id = $1`,
        [id],
      );
      await this.audit.stage(ctx, c, {
        action: 'purchase.condemnation.dispose',
        entityType: 'condemnations',
        entityId: id,
        after: { ...dto },
      });
      return { status: 'disposed' };
    });
  }

  /** The condemnation and disposal record (in the manner of form GFR-17). */
  async pdf(ctx: RequestContext, id: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustSee(c, ctx);
      const k = await this.load(c, id);
      const lines = await this.linesOf(c, id);
      const committee = await this.committee(c, id);
      const d = (
        await c.query<{
          method: string;
          disposed_on: string;
          party: string | null;
          amount: string;
          reference: string | null;
        }>(
          `SELECT method, disposed_on::text, party, amount::text, reference FROM disposals WHERE condemnation_id = $1`,
          [id],
        )
      ).rows[0];
      const read = (key: string) => this.storage.read(key);
      const head = await pdfSchool(c, read);
      const value = lines.reduce((a, l) => a + Number(l.book_value), 0);
      // as on the GRN: signature, name, Emp. ID · designation and when (docs/design/83)
      const signers: SignBox[] = [];
      for (const m of committee.filter((x) => x.signed_at).slice(0, 3))
        signers.push(
          await signerOf(c, read, {
            as: m.role ?? 'Committee member',
            name: m.name,
            userId: m.user_id,
            at: m.signed_at,
            verb: 'Signed on',
          }),
        );
      signers.push(
        k.decided_at && k.decided_by_id
          ? await signerOf(c, read, {
              as: 'Approved by',
              name: k.decided_by,
              userId: k.decided_by_id,
              at: k.decided_at,
              verb: 'Approved on',
            })
          : blankBox('Approved by'),
      );
      const bytes = await purchaseStockPdf({
        ...head,
        title: 'Condemnation and Disposal Record',
        number: k.number,
        watermark: ['written_off', 'disposed'].includes(k.status)
          ? null
          : k.status === 'rejected'
            ? 'REJECTED'
            : k.status === 'cancelled'
              ? 'CANCELLED'
              : 'NOT APPROVED',
        facts: [
          ['Proposal', k.title],
          ['Proposed by', `${k.by ?? ''} on ${dmy(k.created_at.toISOString().slice(0, 10))}`],
          ...((k.note ? [['Note', k.note]] : []) as Array<[string, string]>),
          ...((k.written_off_on
            ? [['Written off', `${dmy(k.written_off_on)}, approved by ${k.decided_by ?? ''}`]]
            : []) as Array<[string, string]>),
          ...((d
            ? [
                [
                  'Disposed of',
                  `${METHOD[d.method] ?? d.method} on ${dmy(d.disposed_on)}${d.party ? ` to ${d.party}` : ''} for Rs ${money2(Number(d.amount))}${d.reference ? ` (${d.reference})` : ''}`,
                ],
              ]
            : []) as Array<[string, string]>),
        ],
        columns: [
          { label: '#', width: 4 },
          { label: 'Asset / item', width: 40 },
          { label: 'Quantity', width: 12, right: true },
          { label: 'Bought', width: 12 },
          { label: 'Book value (Rs)', width: 15, right: true },
          { label: 'Why', width: 17 },
        ],
        rows: lines.map((l, i) => ({
          cells: [
            String(i + 1),
            l.kind === 'asset'
              ? `${l.tag ?? ''} · ${l.item}`
              : `${l.item}${l.store ? ` · ${l.store}` : ''}`,
            l.kind === 'asset' ? '1' : `${qty3(Number(l.qty))} ${l.unit ?? ''}`,
            l.acquired_on ? dmy(l.acquired_on) : '',
            money2(Number(l.book_value)),
            REASON[l.reason_kind] ?? l.reason_kind,
          ],
          detail: [
            l.reason,
            l.batch_no ? `Batch ${l.batch_no}` : null,
            l.cost ? `Cost Rs ${money2(Number(l.cost))}` : null,
          ]
            .filter(Boolean)
            .join(' · '),
        })),
        total: { label: 'Book value (Rs)', value: money2(value) },
        signatures: signers,
        foot: 'GFR 2017 rule 217: unserviceable, obsolete or surplus goods declared by a committee, written off on approval and disposed of — by tender or public auction where the residual value is above Rs 2 lakh.',
      });
      return { bytes, filename: `${k.number.replaceAll('/', '-')}.pdf` };
    });
  }
}
