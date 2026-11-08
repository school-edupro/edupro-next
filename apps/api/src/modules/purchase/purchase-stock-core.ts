import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';
import { registerGeneratedOn, registerLetterhead } from '../exams/register-head';
import { assetsOut } from './purchase-asset-core';

/**
 * Stock shared by the requisition, issue, return, transfer and count screens (docs/design/84, part 8):
 * reservations for requisition lines "from the store" (made when the PR is sent for approval, let go
 * when it is sent back, rejected, cancelled or reopened, used up as the keeper issues), and the free
 * stock of an item in a store (in hand less reserved).
 */

const qtyWords = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/** The balance's reserved quantity worked out again from the open reservations. */
export async function refreshReserved(c: PoolClient, storeId: string, itemId: string) {
  await c.query(`SELECT app.stock_reserved_refresh($1, $2)`, [storeId, itemId]);
}

/** In hand, reserved and free (in hand less reserved) of an item in a store, in the store unit. */
export async function freeStock(c: PoolClient, storeId: string, itemId: string) {
  const r = (
    await c.query<{ qty: string; reserved: string }>(
      `SELECT qty::text, reserved::text FROM stock_balances WHERE store_id = $1 AND item_id = $2`,
      [storeId, itemId],
    )
  ).rows[0];
  const qty = Number(r?.qty ?? 0);
  const reserved = Number(r?.reserved ?? 0);
  return { qty, reserved, free: Math.max(0, Math.round((qty - reserved) * 1000) / 1000) };
}

interface StoreLine {
  id: string;
  item_id: string | null;
  name: string;
  quantity: string;
  per_unit: string;
  stock_tracked: boolean;
  store_id: string | null;
  store: string | null;
  open: string;
}

/** The requisition's lines issued from a store, with what each already holds reserved. */
async function storeLines(c: PoolClient, prId: string) {
  return (
    await c.query<StoreLine>(
      `SELECT l.id::text, l.item_id::text, COALESCE(i.name, l.free_text) AS name, l.quantity::text,
              COALESCE(i.stock_per_unit, 1)::text AS per_unit, COALESCE(i.stock_tracked, false) AS stock_tracked,
              l.store_id::text, s.name AS store,
              COALESCE((SELECT sum(r.qty - r.issued_qty) FROM stock_reservations r
                         WHERE r.requisition_line_id = l.id AND r.status = 'open'), 0)::text AS open
         FROM purchase_requisition_lines l
         LEFT JOIN purchase_items i ON i.id = l.item_id
         LEFT JOIN stores s ON s.id = l.store_id
        WHERE l.requisition_id = $1 AND l.fulfil = 'store' ORDER BY l.seq`,
      [prId],
    )
  ).rows;
}

/**
 * What stops the requisition's "from the store" lines being reserved: a kept-in-stock item with no
 * store named, or not enough free stock in the store (what the line already holds counts as its own).
 */
export async function storeProblems(c: PoolClient, prId: string) {
  const out: string[] = [];
  const need = new Map<string, number>();
  for (const l of await storeLines(c, prId)) {
    if (!l.item_id || !l.stock_tracked) continue;
    if (!l.store_id) {
      out.push(`${l.name}: pick the store it is issued from`);
      continue;
    }
    const key = `${l.store_id}:${l.item_id}`;
    need.set(key, (need.get(key) ?? 0) + Number(l.quantity) * Number(l.per_unit) - Number(l.open));
    const f = await freeStock(c, l.store_id, l.item_id);
    const short = need.get(key)! - f.free;
    if (short > 1e-9)
      out.push(
        `${l.name}: ${qtyWords(f.free)} free in ${l.store ?? 'the store'} (${qtyWords(f.qty)} in hand, ${qtyWords(f.reserved)} reserved) — buy the rest`,
      );
  }
  return out;
}

/** Reserves the stock of the requisition's "from the store" lines (sent for approval). */
export async function reserveRequisition(c: PoolClient, prId: string) {
  const problems = await storeProblems(c, prId);
  if (problems.length)
    throw new DomainError('stock.insufficient', problems.join('; '), {
      status: 409,
      extra: { problems },
    });
  for (const l of await storeLines(c, prId)) {
    if (!l.item_id || !l.stock_tracked || !l.store_id) continue;
    const want = Math.round(Number(l.quantity) * Number(l.per_unit) * 1000) / 1000 - Number(l.open);
    if (want <= 0) continue;
    await c.query(
      `INSERT INTO stock_reservations (school_id, store_id, item_id, requisition_line_id, qty)
       VALUES (app.current_school_id(), $1, $2, $3, $4)`,
      [l.store_id, l.item_id, l.id, want],
    );
    await refreshReserved(c, l.store_id, l.item_id);
  }
}

/** Lets go what the requisition still holds unissued (sent back, rejected, cancelled, reopened). */
export async function releaseRequisition(c: PoolClient, prId: string, why: string) {
  const r = await c.query<{ store_id: string; item_id: string }>(
    `UPDATE stock_reservations r
        SET status = CASE WHEN r.issued_qty > 0 THEN 'done' ELSE 'released' END, released_note = $2, closed_at = now()
       FROM purchase_requisition_lines l
      WHERE l.id = r.requisition_line_id AND l.requisition_id = $1 AND r.status = 'open'
      RETURNING r.store_id::text, r.item_id::text`,
    [prId, why.slice(0, 300)],
  );
  const seen = new Set<string>();
  for (const x of r.rows) {
    const k = `${x.store_id}:${x.item_id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    await refreshReserved(c, x.store_id, x.item_id);
  }
  return r.rowCount ?? 0;
}

/** Whether anything reserved for the requisition has been issued (it can then not go back). */
export async function issuedAgainst(c: PoolClient, prId: string) {
  const r = await c.query(
    `SELECT 1 FROM stock_reservations r JOIN purchase_requisition_lines l ON l.id = r.requisition_line_id
      WHERE l.requisition_id = $1 AND r.issued_qty > 0 LIMIT 1`,
    [prId],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * An approved indent takes from the stores first (docs/design/83, "As built — indents served from
 * stock"): for each line of a kept-in-stock item, what the department's own store, then the main store,
 * holds free is held for the line (a reservation on the indent line) — all of it when the stores have
 * enough, else whole units of the line (the rest is bought). The line's `stock_qty` (its unit) is what
 * was held. Returns what each line took.
 */
export async function holdIndentFromStock(c: PoolClient, indentId: string) {
  const lines = (
    await c.query<{
      id: string;
      item_id: string;
      quantity: string;
      per_unit: string;
      decimals: boolean;
      department_id: string;
    }>(
      `SELECT l.id::text, l.item_id::text, l.quantity::text, COALESCE(i.stock_per_unit, 1)::text AS per_unit,
              u.decimals, pi.department_id::text
         FROM purchase_indent_lines l JOIN purchase_indents pi ON pi.id = l.indent_id
         JOIN purchase_items i ON i.id = l.item_id AND COALESCE(i.stock_tracked, false)
         JOIN purchase_uoms u ON u.id = l.uom_id
        -- a line the raiser asked to have bought new (with the reason) is not served from stock
        WHERE l.indent_id = $1 AND l.stock_qty = 0 AND l.stock_reason IS NULL
          AND NOT EXISTS (SELECT 1 FROM stock_reservations r WHERE r.indent_line_id = l.id)
        ORDER BY l.seq`,
      [indentId],
    )
  ).rows;
  const out: Array<{ lineId: string; held: number; quantity: number }> = [];
  for (const l of lines) {
    // the department's own stores first, then the main store
    const stores = (
      await c.query<{ id: string }>(
        `SELECT s.id::text FROM stores s
          WHERE s.status = 'active' AND (s.department_id = $1 OR s.kind = 'main')
          ORDER BY (s.department_id = $1) DESC, (s.kind = 'main'), s.id`,
        [l.department_id],
      )
    ).rows;
    const per = Number(l.per_unit) || 1;
    const need = Math.round(Number(l.quantity) * per * 1000) / 1000;
    const takes: Array<{ storeId: string; qty: number }> = [];
    let left = need;
    for (const st of stores) {
      if (left <= 0) break;
      const f = await freeStock(c, st.id, l.item_id);
      const take = Math.round(Math.min(left, f.free) * 1000) / 1000;
      if (take <= 0) continue;
      takes.push({ storeId: st.id, qty: take });
      left = Math.round((left - take) * 1000) / 1000;
    }
    let total = takes.reduce((a, t) => a + t.qty, 0);
    if (total < need) {
      // the rest is bought: hold whole units of the line (a box is bought whole)
      const units = l.decimals ? total / per : Math.floor(total / per + 1e-9);
      let keep = Math.round(units * per * 1000) / 1000;
      for (const t of takes) {
        t.qty = Math.min(t.qty, keep);
        keep = Math.round((keep - t.qty) * 1000) / 1000;
      }
      total = takes.reduce((a, t) => a + t.qty, 0);
    }
    if (total <= 0) continue;
    for (const t of takes.filter((x) => x.qty > 0)) {
      await c.query(
        `INSERT INTO stock_reservations (school_id, store_id, item_id, indent_line_id, qty)
         VALUES (app.current_school_id(), $1, $2, $3, $4)`,
        [t.storeId, l.item_id, l.id, t.qty],
      );
      await refreshReserved(c, t.storeId, l.item_id);
    }
    const held = Math.round((total / per) * 1000) / 1000;
    await c.query(`UPDATE purchase_indent_lines SET stock_qty = $2 WHERE id = $1`, [l.id, held]);
    out.push({ lineId: l.id, held, quantity: Number(l.quantity) });
  }
  return out;
}

/**
 * The keeper cannot give what is held for an indent line (it is not there after all): the unissued part
 * is let go and goes on to purchase — the line's `stock_qty` drops by it and the indent waits for a PR.
 * Returns the indent's id.
 */
export async function releaseIndentHold(c: PoolClient, reservationId: string, why: string) {
  const r = (
    await c.query<{
      store_id: string;
      item_id: string;
      left: string;
      per_unit: string;
      indent_line_id: string;
      indent_id: string;
    }>(
      `UPDATE stock_reservations r
          SET status = CASE WHEN r.issued_qty > 0 THEN 'done' ELSE 'released' END, released_note = $2, closed_at = now()
         FROM purchase_indent_lines l, purchase_items i
        WHERE r.id = $1 AND r.status = 'open' AND l.id = r.indent_line_id AND i.id = r.item_id
        RETURNING r.store_id::text, r.item_id::text, (r.qty - r.issued_qty)::text AS left,
                  COALESCE(i.stock_per_unit, 1)::text AS per_unit, l.id::text AS indent_line_id, l.indent_id::text`,
      [reservationId, why.slice(0, 300)],
    )
  ).rows[0];
  if (!r) throw new DomainError('not-found', 'Nothing is held there to let go', { status: 404 });
  await refreshReserved(c, r.store_id, r.item_id);
  const back = Math.round((Number(r.left) / (Number(r.per_unit) || 1)) * 1000) / 1000;
  await c.query(
    `UPDATE purchase_indent_lines SET stock_qty = GREATEST(0, stock_qty - $2) WHERE id = $1`,
    [r.indent_line_id, back],
  );
  await c.query(
    `UPDATE purchase_indents SET route = 'to_requisition', bypass_note = $2, updated_at = now()
      WHERE id = $1 AND status = 'approved'`,
    [r.indent_id, `The store could not give it all (${why.slice(0, 200)}): the rest is to buy`],
  );
  return r.indent_id;
}

/** The store's details, and whether the caller may work it: the manage right, or operate and keep it. */
export async function mustOperateStore(
  c: PoolClient,
  permissions: ReadonlySet<string> | undefined,
  storeId: string,
  verb = 'work',
) {
  const s = await c.query<{
    name: string;
    status: string;
    mine: boolean;
    department_id: string | null;
  }>(
    `SELECT s.name, s.status::text, s.department_id::text,
            EXISTS (SELECT 1 FROM store_keepers k JOIN employees e ON e.id = k.employee_id
                     WHERE k.store_id = s.id AND e.user_id = app.current_user_id()) AS mine
       FROM stores s WHERE s.id = $1`,
    [storeId],
  );
  const x = s.rows[0];
  if (!x) throw new DomainError('not-found', 'Store not found', { status: 404 });
  const manage = permissions?.has('purchase.store.manage') ?? false;
  const operate = permissions?.has('purchase.store.operate') ?? false;
  if (!manage && !(operate && x.mine))
    throw new DomainError('permission-denied', `Only the keepers of ${x.name} ${verb} it`, {
      status: 403,
    });
  return x;
}

/**
 * The school's name, address and logo for a store document's letterhead (as the indent prints it), and
 * when the paper was made.
 */
export async function pdfSchool(
  c: PoolClient,
  read: (key: string) => Promise<Buffer>,
): Promise<{
  school: { name: string; address: string | null };
  logo: { contentType: string; bytes: Buffer } | null;
  generatedOn: string;
}> {
  const h = await registerLetterhead(c);
  let logo: { contentType: string; bytes: Buffer } | null = null;
  if (h.file)
    try {
      logo = { contentType: h.file.content_type, bytes: await read(h.file.object_key) };
    } catch {
      logo = null;
    }
  return {
    school: { name: h.school, address: h.address || null },
    logo,
    generatedOn: registerGeneratedOn(),
  };
}

/** A user's name as staff know it (their employee record's), for documents. */
export const PERSON_OF = (u: string) =>
  // eslint-disable-next-line no-restricted-syntax -- u is a fixed table alias
  `COALESCE((SELECT e.display_name FROM employees e WHERE e.user_id = ${u}.id AND e.deleted_at IS NULL LIMIT 1), ${u}.display_name)`;

export const istToday = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
export const dmy = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}-${iso.slice(5, 7)}-${iso.slice(0, 4)}` : '';
export const qty3 = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
export const money2 = (n: number) =>
  n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** One share of an issue: what goes to an indent line (or a department), from which reservation. */
export interface IssueShare {
  indentId: string | null;
  indentLineId: string | null;
  departmentId: string;
  itemId: string;
  name: string;
  /** store unit */
  qty: number;
  batch: string | null;
  reservationId: string | null;
  taker: string | null;
  purpose: string | null;
}

/**
 * Posts issues out of a store: one issue per indent (or per department for what no indent asked for),
 * each line an `issue` move at the average (the named batch, else the earliest expiry first), the
 * reservations it used up updated. Returns the issues made.
 */
export async function postIssues(
  c: PoolClient,
  head: {
    storeId: string;
    kind: 'receipt' | 'indent' | 'counter';
    requisitionId?: string | null;
    receiptId?: string | null;
    day: string;
    takenBy?: string | null;
    purpose?: string | null;
  },
  shares: IssueShare[],
  post: (
    m: {
      storeId: string;
      itemId: string;
      kind: string;
      qty: number;
      batch?: string | null;
      docType?: string | null;
      docId?: string | null;
      note?: string | null;
      day?: string | null;
    },
    name: string,
  ) => Promise<string>,
) {
  const made = new Map<string, { id: string; number: string }>();
  const touched = new Set<string>();
  for (const s of shares) {
    if (s.qty <= 0) continue;
    const key = s.indentId ? `i:${s.indentId}` : `d:${s.departmentId}`;
    let doc = made.get(key);
    if (!doc) {
      const number = (await c.query<{ n: string }>(`SELECT app.purchase_next_number('issue') AS n`))
        .rows[0]!.n;
      const id = (
        await c.query<{ id: string }>(
          `INSERT INTO stock_issues (school_id, number, store_id, department_id, kind, indent_id, receipt_id, requisition_id,
                                     taken_by_employee_id, purpose, issued_on, created_by)
           VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, app.current_user_id()) RETURNING id::text`,
          [
            number,
            head.storeId,
            s.departmentId,
            head.kind,
            s.indentId,
            head.receiptId ?? null,
            head.requisitionId ?? null,
            head.takenBy ?? s.taker,
            (head.purpose ?? s.purpose)?.slice(0, 300) ?? null,
            head.day,
          ],
        )
      ).rows[0]!.id;
      doc = { id, number };
      made.set(key, doc);
    }
    const moveId = await post(
      {
        storeId: head.storeId,
        itemId: s.itemId,
        kind: 'issue',
        qty: -s.qty,
        batch: s.batch,
        docType: 'stock_issue',
        docId: doc.id,
        note: doc.number,
        day: head.day,
      },
      s.name,
    );
    const line = (
      await c.query<{ id: string }>(
        `INSERT INTO stock_issue_lines (school_id, issue_id, item_id, indent_line_id, qty, rate, value, batch_no, move_id, reservation_id)
         SELECT app.current_school_id(), $1, $2, $3, $4, m.rate, -m.value, $5, m.id, $7 FROM stock_moves m WHERE m.id = $6
         RETURNING id::text`,
        [doc.id, s.itemId, s.indentLineId, s.qty, s.batch, moveId, s.reservationId],
      )
    ).rows[0]!.id;
    // registered assets of the item go with it to the department and whoever took them
    await assetsOut(c, {
      storeId: head.storeId,
      itemId: s.itemId,
      qty: s.qty,
      issueLineId: line,
      departmentId: s.departmentId,
      custodianId: head.takenBy ?? s.taker,
      day: head.day,
      doc: doc.number,
    });
    if (s.reservationId) {
      await c.query(
        `UPDATE stock_reservations SET issued_qty = issued_qty + $2,
                status = CASE WHEN issued_qty + $2 >= qty THEN 'done' ELSE status END,
                closed_at = CASE WHEN issued_qty + $2 >= qty THEN now() ELSE closed_at END
          WHERE id = $1`,
        [s.reservationId, s.qty],
      );
      touched.add(s.itemId);
    }
  }
  for (const item of touched) await refreshReserved(c, head.storeId, item);
  return [...made.values()];
}

/**
 * Shares a quantity of a requisition line among the indent lines it came from (oldest indent first,
 * each up to what it asked for less what it was issued before); what is left goes to `fallback`'s
 * department with no indent.
 */
export async function shareAmongIndents(
  c: PoolClient,
  requisitionLineId: string | null,
  qty: number,
  fallbackDepartmentId: string | null,
) {
  const out: Array<{
    indentId: string | null;
    indentLineId: string | null;
    departmentId: string;
    qty: number;
    taker: string | null;
    purpose: string | null;
  }> = [];
  let left = Math.round(qty * 1000) / 1000;
  if (requisitionLineId) {
    const src = await c.query<{
      indent_line_id: string;
      indent_id: string;
      department_id: string;
      asked: string;
      issued: string;
      taker: string | null;
      purpose: string;
    }>(
      `SELECT src.indent_line_id::text, pil.indent_id::text, pi.department_id::text,
              (src.quantity * COALESCE(i.stock_per_unit, 1))::text AS asked,
              COALESCE((SELECT sum(sil.qty) FROM stock_issue_lines sil WHERE sil.indent_line_id = src.indent_line_id), 0)::text AS issued,
              COALESCE(pi.on_behalf_employee_id,
                       (SELECT e.id FROM employees e WHERE e.user_id = pi.raised_by AND e.deleted_at IS NULL LIMIT 1))::text AS taker,
              pi.purpose
         FROM purchase_requisition_sources src
         JOIN purchase_indent_lines pil ON pil.id = src.indent_line_id
         JOIN purchase_indents pi ON pi.id = pil.indent_id AND pi.status = 'approved'
         JOIN purchase_requisition_lines rl ON rl.id = src.requisition_line_id
         LEFT JOIN purchase_items i ON i.id = rl.item_id
        WHERE src.requisition_line_id = $1 ORDER BY pi.id, pil.seq`,
      [requisitionLineId],
    );
    for (const s of src.rows) {
      if (left <= 0) break;
      const take = Math.round(Math.min(left, Number(s.asked) - Number(s.issued)) * 1000) / 1000;
      if (take <= 0) continue;
      out.push({
        indentId: s.indent_id,
        indentLineId: s.indent_line_id,
        departmentId: s.department_id,
        qty: take,
        taker: s.taker,
        purpose: s.purpose,
      });
      left = Math.round((left - take) * 1000) / 1000;
    }
  }
  if (left > 0 && fallbackDepartmentId)
    out.push({
      indentId: null,
      indentLineId: null,
      departmentId: fallbackDepartmentId,
      qty: left,
      taker: null,
      purpose: null,
    });
  return out;
}
