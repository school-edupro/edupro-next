import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';

/** The library's own misc fee heads (made the first time one is needed). */
export const LIBRARY_HEADS = {
  book: { code: 'LIBBOOK', name: 'Library: lost or damaged book', order: 920 },
  fine: { code: 'LIBFINE', name: 'Library: late fine', order: 921 },
  sale: { code: 'LIBSALE', name: 'Library: book sale', order: 922 },
} as const;

/** A library fee head's id. */
export async function libraryHead(c: PoolClient, h: { code: string; name: string; order: number }) {
  const r = await c.query<{ id: string }>(
    `INSERT INTO fee_heads (school_id, code, name, kind, ledger, sort_order, created_by, updated_by)
     VALUES (app.current_school_id(), $1, $2, 'misc', 'school', $3, app.current_user_id(), app.current_user_id())
     ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET updated_at = now() RETURNING id::text`,
    [h.code, h.name, h.order],
  );
  return r.rows[0]!.id;
}

/** The year a library fee or receipt goes in: the active one, else the working one. */
export async function libraryYear(c: PoolClient, ctx: RequestContext) {
  const year = await c.query<{ id: string }>(
    `SELECT id::text FROM academic_years WHERE status = 'active' ORDER BY start_date DESC LIMIT 1`,
  );
  const yearId = year.rows[0]?.id ?? requireTenant(ctx).academicYearId;
  if (!yearId)
    throw new DomainError('year.not_selected', 'No academic year is active', { status: 409 });
  return yearId;
}

/**
 * A misc fee announced at once on one pupil or staff member (no approval, as hostel damages are): the
 * parent or the staff member sees it, the fees counter collects it.
 */
export async function announceMiscFee(
  c: PoolClient,
  x: {
    yearId: string;
    headId: string;
    title: string;
    amount: number;
    remark: string;
    kind: 'student' | 'employee';
    personId: string;
  },
): Promise<{ miscFeeId: string; lineId: string }> {
  const fee = await c.query<{ id: string }>(
    `INSERT INTO misc_fees (school_id, academic_year_id, head_id, title, amount, last_date, remark, mandatory, status, requested_by, announced_at)
     VALUES (app.current_school_id(), $1, $2, $3, $4, CURRENT_DATE, $5, true, 'announced', app.current_user_id(), now())
     RETURNING id::text`,
    [x.yearId, x.headId, x.title.slice(0, 120), x.amount.toFixed(2), x.remark.slice(0, 300)],
  );
  const line = await c.query<{ id: string }>(
    `INSERT INTO misc_fee_students (school_id, misc_fee_id, student_id, employee_id, amount)
     VALUES (app.current_school_id(), $1, CASE WHEN $4 = 'student' THEN $2::bigint END,
             CASE WHEN $4 = 'employee' THEN $2::bigint END, $3) RETURNING id::text`,
    [fee.rows[0]!.id, x.personId, x.amount.toFixed(2), x.kind],
  );
  return { miscFeeId: fee.rows[0]!.id, lineId: line.rows[0]!.id };
}
