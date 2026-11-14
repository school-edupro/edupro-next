/**
 * Dated payroll rows (rates, statutory settings, OT rates, pay-head versions, salary structures) — the legacy
 * `pr_approve_dated_row_core`: a row is made as DRAFT, changed or deleted only while DRAFT (by its maker or a
 * checker), and approved by a checker who did not make it (a payroll admin may approve their own set-up
 * draft). Approving refuses a second ACTIVE row from the same date and any back-dating behind a later ACTIVE
 * row; it gives the ACTIVE row in force an end date the day before and leaves it ACTIVE (past months still
 * read it), noting on the new row which rows it ended and the end each had (closed_rows). Ending a row by hand gives
 * it an end date and leaves it ACTIVE: the months up to the end still read it (it used to be hidden from every
 * month). A row approved by mistake is WITHDRAWN while no approved, locked or paid run has read it: it stays in the
 * history, no run reads it, and the rows it ended open again; once read, it is corrected by a new row from the first
 * month not yet approved.
 */
import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';

export interface DatedTable {
  table: string;
  /** the columns two rows must share to replace each other (besides school_id) */
  key: readonly string[];
}

export const DATED: Record<string, DatedTable> = {
  rates: { table: 'payroll_rates', key: ['rate_code'] },
  pf: { table: 'payroll_pf_settings', key: [] },
  esi: { table: 'payroll_esi_settings', key: [] },
  pt: { table: 'payroll_pt_slabs', key: ['state_code', 'gender', 'wage_from'] },
  lwf: { table: 'payroll_lwf_settings', key: ['state_code'] },
  ot: { table: 'payroll_ot_rates', key: ['employee_type'] },
  versions: { table: 'payroll_pay_head_versions', key: ['pay_head_id'] },
  structures: { table: 'payroll_structures', key: ['employee_id', 'pay_head_id'] },
};

const fail = (message: string, status = 400): never => {
  throw new DomainError(status === 409 ? 'conflict' : 'validation-failed', message, { status });
};

interface Row {
  id: string;
  status: string;
  effective_from: string;
  effective_to: string | null;
  created_by: string | null;
  [k: string]: unknown;
}

/** The row, locked for the change; 404 when it is not there. */
export async function loadDated(c: PoolClient, t: DatedTable, id: string): Promise<Row> {
  const r = await c.query<Row>(
    // eslint-disable-next-line no-restricted-syntax -- the table name comes from the fixed DATED map
    `SELECT *, id::text, effective_from::text, effective_to::text, created_by::text FROM ${t.table} WHERE id = $1 FOR UPDATE`,
    [id],
  );
  const row = r.rows[0];
  if (!row) throw new DomainError('not-found', 'Not found', { status: 404 });
  return row;
}

/** A draft may be changed or deleted by its maker or by a checker. */
export function mustOwnDraft(row: Row, userId: string, isChecker: boolean) {
  if (row.status !== 'draft')
    fail('Only a DRAFT can be changed — ACTIVE history stays; make a new dated row', 409);
  if (!isChecker && row.created_by !== userId)
    fail('Only the person who made this draft, or a checker, can change it', 403);
}

const dayBefore = (d: string) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() - 1);
  return t.toISOString().slice(0, 10);
};

/**
 * Approves a draft (see the module comment). Returns the rows given an end date, for the message.
 */
export async function approveDated(
  c: PoolClient,
  t: DatedTable,
  id: string,
  approver: string,
  approverIsAdmin: boolean,
): Promise<{ closed: number; closedTo: string | null; selfApproved?: true }> {
  const row = await loadDated(c, t, id);
  if (row.status !== 'draft')
    fail(`Only DRAFT records can be approved (this one is ${row.status.toUpperCase()})`, 409);
  if (!approverIsAdmin && row.created_by === approver)
    fail('You cannot approve your own draft — a different checker must approve it', 403);
  const keyWhere = t.key.map((col, i) => `AND ${col} = $${String(i + 2)}`).join(' ');
  const actives = (
    await c.query<{ id: string; effective_from: string; effective_to: string | null }>(
      // eslint-disable-next-line no-restricted-syntax -- table and key columns come from the fixed DATED map
      `SELECT id::text, effective_from::text, effective_to::text FROM ${t.table}
        WHERE status = 'active' AND school_id = $1 ${keyWhere}
        ORDER BY effective_from DESC FOR UPDATE`,
      [row.school_id, ...t.key.map((col) => row[col])],
    )
  ).rows;
  const from = row.effective_from;
  const toClose: string[] = [];
  const closed: Array<{ id: string; to: string | null }> = [];
  for (const a of actives) {
    if (a.effective_from === from)
      fail(
        'An ACTIVE record with the same date already exists — end it first or pick a different date',
        409,
      );
    if (a.effective_from > from)
      fail(
        `An ACTIVE record starting later (${a.effective_from}) already exists — dating before it is refused; make a correction or revision instead`,
        409,
      );
    if (a.effective_to === null || a.effective_to >= from) {
      toClose.push(a.id);
      closed.push({ id: a.id, to: a.effective_to });
    }
  }
  const closeTo = dayBefore(from);
  for (const aid of toClose)
    await c.query(
      // eslint-disable-next-line no-restricted-syntax -- the table name comes from the fixed DATED map
      `UPDATE ${t.table} SET effective_to = $2, updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
      [aid, closeTo],
    );
  await c.query(
    // eslint-disable-next-line no-restricted-syntax -- the table name comes from the fixed DATED map
    `UPDATE ${t.table} SET status = 'active', approved_by = app.current_user_id(), approved_at = now(),
            closed_rows = $2::jsonb, updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
    [id, JSON.stringify(closed)],
  );
  return {
    closed: toClose.length,
    closedTo: toClose.length ? closeTo : null,
    // the payroll admin approving their own draft: marked in the audit trail
    ...(row.created_by === approver ? { selfApproved: true as const } : {}),
  };
}

/** Ends an ACTIVE row by hand: from the day after `effectiveTo` nothing reads it. */
export async function endDated(c: PoolClient, t: DatedTable, id: string, effectiveTo: string) {
  const row = await loadDated(c, t, id);
  if (row.status !== 'active') fail('Only ACTIVE records can be ended', 409);
  if (effectiveTo < row.effective_from) fail('The end date is before the record starts');
  await c.query(
    // eslint-disable-next-line no-restricted-syntax -- the table name comes from the fixed DATED map
    `UPDATE ${t.table} SET effective_to = $2, updated_by = app.current_user_id(), updated_at = now()
      WHERE id = $1`,
    [id, effectiveTo],
  );
}

/** Deletes a draft (its maker or a checker); ACTIVE and ENDED history is never removed. */
export async function deleteDraft(
  c: PoolClient,
  t: DatedTable,
  id: string,
  userId: string,
  isChecker: boolean,
) {
  const row = await loadDated(c, t, id);
  if (row.status !== 'draft')
    fail('Only DRAFT records can be deleted — ACTIVE and ENDED history is never removed', 409);
  mustOwnDraft(row, userId, isChecker);
  // eslint-disable-next-line no-restricted-syntax -- the table name comes from the fixed DATED map
  await c.query(`DELETE FROM ${t.table} WHERE id = $1`, [id]);
}

/** The month's first and last day, for "as of a month" reads. */
export function monthBounds(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

/** The SQL that picks the row in force for a period: ACTIVE, covering it, the latest start first. */
export const ASOF = `status = 'active' AND effective_from <= $2::date AND (effective_to IS NULL OR effective_to >= $1::date)`;

// ---- withdraw and correct ---------------------------------------------------------------------------------------
/** The stages after which a run's figures stand: a row it read is corrected, not withdrawn. */
export const CLOSED_STAGES = ['APPROVED', 'LOCKED', 'PAID'];
/** The stages of a run processed but not approved: withdrawing a row it read sends it back to be processed again. */
export const OPEN_STAGES = ['PROCESSING', 'REVIEW'];

export interface DatedUsage {
  /** an approved, locked or paid run read it: it is corrected from `correctFrom` */
  closed: boolean;
  /** the months of those runs, newest first */
  closedMonths: string[];
  /** runs processed but not approved that read it (they go back to draft on a withdrawal) */
  open: Array<{ id: string; month: string; stage: string }>;
  /** the first month after the last approved one, as a date (the first of the month) */
  correctFrom: string | null;
}

const nextMonth = (ym: string) => {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  return m === 12 ? `${String(y + 1)}-01-01` : `${String(y)}-${String(m + 1).padStart(2, '0')}-01`;
};

/**
 * Which runs read the given ACTIVE rows: a run reads a row when its month meets the row's dates — a structure only
 * when the run has a record of that employee. Deleted runs never count.
 */
export async function datedUsage(
  c: PoolClient,
  t: DatedTable,
  ids: string[],
): Promise<Map<string, DatedUsage>> {
  const out = new Map<string, DatedUsage>();
  if (!ids.length) return out;
  const perEmployee =
    t.table === 'payroll_structures'
      ? 'AND EXISTS (SELECT 1 FROM payroll_records pr WHERE pr.run_id = r.id AND pr.employee_id = x.employee_id)'
      : '';
  const rows = (
    await c.query<{ id: string; run: string; month: string; stage: string }>(
      // eslint-disable-next-line no-restricted-syntax -- the table name and the fragment are fixed; values are bound
      `SELECT x.id::text, r.id::text AS run, to_char(r.month, 'YYYY-MM') AS month, r.stage
         FROM ${t.table} x
         JOIN payroll_runs r ON r.school_id = x.school_id AND r.deleted_at IS NULL
          AND r.month <= COALESCE(x.effective_to, 'infinity'::date)
          AND (r.month + interval '1 month - 1 day')::date >= x.effective_from
          AND r.stage = ANY($2::text[])
        WHERE x.id = ANY($1::bigint[]) AND x.status = 'active' ${perEmployee}
        ORDER BY r.month DESC`,
      [ids, [...CLOSED_STAGES, ...OPEN_STAGES]],
    )
  ).rows;
  for (const id of ids) {
    const mine = rows.filter((r) => r.id === id);
    const closedMonths = [
      ...new Set(mine.filter((r) => CLOSED_STAGES.includes(r.stage)).map((r) => r.month)),
    ];
    out.set(id, {
      closed: closedMonths.length > 0,
      closedMonths,
      open: mine
        .filter((r) => OPEN_STAGES.includes(r.stage))
        .map((r) => ({ id: r.run, month: r.month, stage: r.stage })),
      correctFrom: closedMonths[0] ? nextMonth(closedMonths[0]) : null,
    });
  }
  return out;
}

/**
 * Withdraws an ACTIVE row no approved, locked or paid run has read: it becomes WITHDRAWN (kept, never read), and the
 * rows it ended open again — to the end each had, but no later than this row's own end (a row after it stays in
 * force). Rows approved before closed_rows was kept are found by their end the day before this row. Returns the open
 * runs that read it, for the caller to send back to be processed again.
 */
export async function withdrawDated(
  c: PoolClient,
  t: DatedTable,
  id: string,
  reason: string,
): Promise<{ row: Row; reopened: number; open: DatedUsage['open'] }> {
  const row = await loadDated(c, t, id);
  if (row.status !== 'active')
    fail(`Only an ACTIVE record is withdrawn (this one is ${row.status.toUpperCase()})`, 409);
  if (reason.trim().length < 10) fail('Say why it is withdrawn (at least 10 characters)');
  const usage = (await datedUsage(c, t, [id])).get(id)!;
  if (usage.closed)
    fail(
      `An approved or locked run read it (${usage.closedMonths.join(', ')}): it cannot be withdrawn — correct it with a new row from ${usage.correctFrom!.slice(0, 7)}`,
      409,
    );
  const closed = (row.closed_rows as Array<{ id: string; to: string | null }> | null) ?? null;
  const own = row.effective_to;
  // the end a reopened row gets: its own, but never past this row's end (what followed this row stays in force)
  const restore = (to: string | null) =>
    to === null ? own : own === null ? to : to < own ? to : own;
  let reopened = 0;
  if (closed) {
    for (const x of closed) {
      const r = await c.query(
        // eslint-disable-next-line no-restricted-syntax -- the table name comes from the fixed DATED map
        `UPDATE ${t.table} SET effective_to = $2, updated_by = app.current_user_id(), updated_at = now()
          WHERE id = $1 AND status = 'active'`,
        [x.id, restore(x.to)],
      );
      reopened += r.rowCount ?? 0;
    }
  } else {
    // approved before closed_rows was kept: the rows of its key that end the day before it
    const keyWhere = t.key.map((col, i) => `AND ${col} = $${String(i + 5)}`).join(' ');
    const r = await c.query(
      // eslint-disable-next-line no-restricted-syntax -- table and key columns come from the fixed DATED map
      `UPDATE ${t.table} SET effective_to = $2, updated_by = app.current_user_id(), updated_at = now()
        WHERE status = 'active' AND school_id = $1 AND id <> $3 AND effective_to = $4::date - 1 ${keyWhere}`,
      [row.school_id, own, id, row.effective_from, ...t.key.map((col) => row[col])],
    );
    reopened = r.rowCount ?? 0;
  }
  await c.query(
    // eslint-disable-next-line no-restricted-syntax -- the table name comes from the fixed DATED map
    `UPDATE ${t.table} SET status = 'withdrawn', withdrawn_by = app.current_user_id(), withdrawn_at = now(),
            withdraw_reason = $2, updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
    [id, reason.trim()],
  );
  return { row, reopened, open: usage.open };
}

/** The rows with `usage` on each ACTIVE one (which runs read it), for the screens to offer Withdraw or Correct. */
export async function withUsage<R extends { id: unknown; status: unknown }>(
  c: PoolClient,
  t: DatedTable,
  rows: R[],
): Promise<Array<R & { usage?: DatedUsage }>> {
  const ids = rows.filter((r) => r.status === 'active').map((r) => String(r.id));
  const u = await datedUsage(c, t, ids);
  return rows.map((r) => (u.has(String(r.id)) ? { ...r, usage: u.get(String(r.id))! } : r));
}
