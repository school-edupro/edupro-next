/**
 * Dated payroll rows (rates, statutory settings, OT rates, pay-head versions, salary structures) — the legacy
 * `pr_approve_dated_row_core`: a row is made as DRAFT, changed or deleted only while DRAFT (by its maker or a
 * checker), and approved by a checker who did not make it (a payroll admin may approve their own set-up
 * draft). Approving refuses a second ACTIVE row from the same date and any back-dating behind a later ACTIVE
 * row; it gives the ACTIVE row in force an end date the day before and leaves it ACTIVE (past months still
 * read it). Ending a row by hand makes it ENDED: no month reads it any more.
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
): Promise<{ closed: number; closedTo: string | null }> {
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
    if (a.effective_to === null || a.effective_to >= from) toClose.push(a.id);
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
            updated_by = app.current_user_id(), updated_at = now() WHERE id = $1`,
    [id],
  );
  return { closed: toClose.length, closedTo: toClose.length ? closeTo : null };
}

/** Ends an ACTIVE row by hand: from the day after `effectiveTo` nothing reads it. */
export async function endDated(c: PoolClient, t: DatedTable, id: string, effectiveTo: string) {
  const row = await loadDated(c, t, id);
  if (row.status !== 'active') fail('Only ACTIVE records can be ended', 409);
  if (effectiveTo < row.effective_from) fail('The end date is before the record starts');
  await c.query(
    // eslint-disable-next-line no-restricted-syntax -- the table name comes from the fixed DATED map
    `UPDATE ${t.table} SET effective_to = $2, status = 'ended', updated_by = app.current_user_id(), updated_at = now()
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
