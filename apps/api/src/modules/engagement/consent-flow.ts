import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';
import type { ConsentApproval, ConsentFee } from './consent-forms.dto';

/**
 * Consent forms, part 2 (docs/design/28-consent-forms.md): the approval of answers and the fee.
 *
 * Approval: each form has its own workflow definitions, kept in step with the form's levels: one for
 * answers about a pupil, one for staff answers (without the class-teacher levels; none left = no
 * approval for staff). Fee: one misc fee per form (head "Consent forms"), one line per pupil carrying the
 * sum of the pupil's answers' fees, so it is paid, receipted, bounced and refunded as any misc fee.
 */
export const ENTITY = 'consent_response';
export const flowCode = (formId: string, staff: boolean) =>
  `consent_form_${formId}${staff ? '_staff' : ''}`;

/** The levels for answers about a pupil, or for staff answers (no class teacher there). */
export function levelsFor(approval: ConsentApproval | undefined, staff: boolean) {
  if (!approval?.on) return [];
  return approval.levels
    .filter((l) => !staff || l.resolver.kind !== 'class_teacher')
    .map((l, i) => ({ level: i + 1, name: l.name, resolver: l.resolver }));
}

/** Writes the form's two definitions from its levels (inactive when there is nothing to approve). */
export async function syncFlows(
  c: PoolClient,
  f: { id: string; title: string; approval: ConsentApproval | undefined },
) {
  for (const staff of [false, true]) {
    const levels = levelsFor(f.approval, staff);
    const code = flowCode(f.id, staff);
    const name = `Consent form: ${f.title}${staff ? ' (staff)' : ''}`.slice(0, 120);
    const status = levels.length ? 'active' : 'inactive';
    const upd = await c.query(
      `UPDATE workflow_definitions SET name = $2, levels = $3::jsonb, status = $4::row_status, creator_roles = '{}',
              updated_at = now(), updated_by = app.current_user_id()
        WHERE code = $1 AND deleted_at IS NULL`,
      [code, name, JSON.stringify(levels), status],
    );
    if (!upd.rowCount && levels.length)
      await c.query(
        `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, creator_roles, status, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2, $3, $4::jsonb, '{}', 'active', app.current_user_id(), app.current_user_id())`,
        [code, name, ENTITY, JSON.stringify(levels)],
      );
  }
}

/** Is there an approval for this answer (about a pupil, or a staff answer)? */
export const needsApproval = (approval: ConsentApproval | undefined, staff: boolean) =>
  levelsFor(approval, staff).length > 0;

/** The line's amount is the sum of the pupil's live answers' fees; paid in full = paid. */
export async function syncLine(c: PoolClient, lineId: string) {
  await c.query(
    `UPDATE misc_fee_students l SET
        amount = COALESCE((SELECT sum(x.fee_amount) FROM consent_form_responses x
                            WHERE x.misc_line_id = l.id AND x.status NOT IN ('withdrawn', 'rejected')), 0),
        updated_at = now()
      WHERE l.id = $1`,
    [lineId],
  );
  await c.query(
    `UPDATE misc_fee_students SET status = CASE WHEN status = 'cancelled' THEN status
                                                WHEN amount > 0 AND paid >= amount THEN 'paid' ELSE 'open' END,
            updated_at = now()
      WHERE id = $1`,
    [lineId],
  );
}

/**
 * Raises the fee of an answer about a pupil on the form's misc fee (made at the first fee): the pupil's
 * line gets this answer's amount. Nothing for a zero fee or a staff answer.
 */
export async function raiseFee(
  c: PoolClient,
  f: {
    id: string;
    title: string;
    code: string;
    year_id: string;
    misc_fee_id: string | null;
    fee: ConsentFee | undefined;
    closesAt?: string;
  },
  r: { id: string; studentId: string | null; amount: number },
): Promise<string | null> {
  if (!r.studentId || !(r.amount > 0)) return null;
  let miscFeeId = f.misc_fee_id;
  if (!miscFeeId) {
    const head = await c.query<{ id: string }>(
      `INSERT INTO fee_heads (school_id, code, name, kind, ledger, sort_order, created_by, updated_by)
       VALUES (app.current_school_id(), 'CONSENT', 'Consent forms', 'misc', 'school', 920, app.current_user_id(), app.current_user_id())
       ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET updated_at = now() RETURNING id::text`,
    );
    const last =
      f.fee?.lastDate ??
      (f.closesAt ? f.closesAt.slice(0, 10) : null) ??
      new Date(Date.now() + 14 * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
    const m = await c.query<{ id: string }>(
      `INSERT INTO misc_fees (school_id, academic_year_id, head_id, title, amount, last_date, remark, mandatory, status, requested_by, announced_at)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, $6, true, 'announced', app.current_user_id(), now()) RETURNING id::text`,
      [
        f.year_id,
        head.rows[0]!.id,
        f.title.slice(0, 120),
        (f.fee?.mode === 'fixed' ? (f.fee.amount ?? 0) : 0).toFixed(2),
        last,
        `Consent form ${f.code}`.slice(0, 300),
      ],
    );
    miscFeeId = m.rows[0]!.id;
    await c.query(`UPDATE consent_forms SET misc_fee_id = $2 WHERE id = $1`, [f.id, miscFeeId]);
  }
  const line = await c.query<{ id: string }>(
    `INSERT INTO misc_fee_students (school_id, misc_fee_id, student_id, amount) VALUES (app.current_school_id(), $1, $2, 0)
     ON CONFLICT (misc_fee_id, student_id) DO UPDATE SET status = CASE WHEN misc_fee_students.status = 'cancelled' THEN 'open' ELSE misc_fee_students.status END
     RETURNING id::text`,
    [miscFeeId, r.studentId],
  );
  const lineId = line.rows[0]!.id;
  await c.query(`UPDATE consent_form_responses SET misc_line_id = $2 WHERE id = $1`, [
    r.id,
    lineId,
  ]);
  await syncLine(c, lineId);
  return lineId;
}

/** A changed answer may change its fee only while nothing is paid on the pupil's line. */
export async function refeeAllowed(c: PoolClient, lineId: string | null, from: number, to: number) {
  if (!lineId || Math.abs(from - to) < 0.005) return;
  const l = await c.query<{ paid: string }>(
    `SELECT paid::text FROM misc_fee_students WHERE id = $1`,
    [lineId],
  );
  if (Number(l.rows[0]?.paid ?? 0) > 0)
    throw new DomainError(
      'consent.fee_paid',
      `The fee of ₹${from} is already paid; a change that makes it ₹${to} needs the school office`,
      { status: 409 },
    );
}
