import type { PoolClient } from '@edupro/db';
import type { Level } from '../workflow/workflow.service';
import { BANDS, REG_BAND } from './leave.dto';

/** One band of a rule as stored: its days and the engine levels. */
export interface StoredBand {
  from: number;
  to: number;
  levels: Level[];
}

/** The band a leave of so many days falls in (at a boundary the lower band wins). */
export const bandOf = (kind: 'leave' | 'regularisation', days: number): number =>
  kind === 'regularisation' ? 0 : days <= BANDS[0].to ? 0 : days <= BANDS[1].to ? 1 : 2;

export const emptyBands = (kind: 'leave' | 'regularisation'): StoredBand[] =>
  kind === 'regularisation'
    ? [{ from: REG_BAND.from, to: REG_BAND.to, levels: [] }]
    : BANDS.map((b) => ({ from: b.from, to: b.to, levels: [] }));

/**
 * Who approves a leave (or a regularisation) of an employee (docs/design/85, "Who approves"): the active
 * rules of that kind whose scope takes the employee in, for the leave type or any type, by priority (a
 * rule for the leave type before one for any type at the same priority); the first whose band for those
 * days has a level. Worked out when the leave is applied, so a new joiner is covered.
 */
export async function chainFor(
  c: PoolClient,
  employeeId: string,
  kind: 'leave' | 'regularisation',
  leaveTypeId: string | null,
  days: number,
): Promise<{ ruleId: string; rule: string; band: number; levels: Level[] } | null> {
  const r = await c.query<{ id: string; name: string; bands: StoredBand[] }>(
    `SELECT r.id::text, r.name, r.bands FROM staff_leave_approval_rules r
      WHERE r.status = 'active' AND r.kind = $1 AND (r.leave_type_id IS NULL OR r.leave_type_id = $2::bigint)
        AND app.staff_in_scope(r.scope, r.scope_values, $3::bigint)
      ORDER BY r.priority, (r.leave_type_id IS NULL), r.id`,
    [kind, leaveTypeId, employeeId],
  );
  const band = bandOf(kind, days);
  for (const x of r.rows) {
    const levels = x.bands[band]?.levels ?? [];
    if (levels.length) return { ruleId: x.id, rule: x.name, band, levels };
  }
  return null;
}
