import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';

const HEADS = {
  damage: { code: 'HOSTDMG', name: 'Hostel damages', order: 910 },
  mess: { code: 'HOSTMESS', name: 'Mess dues', order: 911 },
} as const;

/**
 * A charge raised at a withdrawal clearance (docs/design/27-hostel-withdrawal.md): the warden's damages
 * or the mess dues, put on the pupil as a mandatory misc fee due at once (misc ledger, collected at the
 * misc counter, shown in the misc dues and to the parent). Once per clearance; a department that raises no
 * charge refuses an amount. Returns null when nothing is raised.
 */
export async function raiseHostelCharge(
  c: PoolClient,
  x: {
    department: {
      departmentName: string;
      chargeKind: 'damage' | 'mess' | null;
      charge: string;
      chargeMiscFeeId: string | null;
    };
    amount: number;
    studentId: string;
    yearId: string;
    /** e.g. "leaving the hostel on 31-10-2026" */
    what: string;
  },
): Promise<{ amount: number; miscFeeId: string } | null> {
  if (!(x.amount > 0)) return null;
  const d = x.department;
  if (!d.chargeKind)
    throw new DomainError(
      'withdrawal.no_charge',
      `${d.departmentName} does not raise a charge on the pupil`,
      { status: 400 },
    );
  if (d.chargeMiscFeeId) {
    if (Math.abs(Number(d.charge) - x.amount) < 0.005) return null;
    throw new DomainError(
      'withdrawal.charge_raised',
      `${d.departmentName} already raised ₹${d.charge}; change it from Misc fees`,
      { status: 409 },
    );
  }
  const h = HEADS[d.chargeKind];
  const head = await c.query<{ id: string }>(
    `INSERT INTO fee_heads (school_id, code, name, kind, ledger, sort_order, created_by, updated_by)
     VALUES (app.current_school_id(), $1, $2, 'misc', 'school', $3, app.current_user_id(), app.current_user_id())
     ON CONFLICT (school_id, code) WHERE deleted_at IS NULL DO UPDATE SET updated_at = now() RETURNING id::text`,
    [h.code, h.name, h.order],
  );
  const f = await c.query<{ id: string }>(
    `INSERT INTO misc_fees (school_id, academic_year_id, head_id, title, amount, last_date, remark, mandatory, status, requested_by, announced_at)
     VALUES (app.current_school_id(), $1, $2, $3, $4, CURRENT_DATE, $5, true, 'announced', app.current_user_id(), now()) RETURNING id::text`,
    [
      x.yearId,
      head.rows[0]!.id,
      `${h.name} · ${d.departmentName}`.slice(0, 120),
      x.amount.toFixed(2),
      `${h.name} on ${x.what}`.slice(0, 300),
    ],
  );
  await c.query(
    `INSERT INTO misc_fee_students (school_id, misc_fee_id, student_id, amount) VALUES (app.current_school_id(), $1, $2, $3)`,
    [f.rows[0]!.id, x.studentId, x.amount.toFixed(2)],
  );
  return { amount: x.amount, miscFeeId: f.rows[0]!.id };
}
