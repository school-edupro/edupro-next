import type { PoolClient } from '@edupro/db';
import { DomainError } from '../../common/errors/domain-error';

/**
 * The hostel fee profile of a session follows the pupil's stays: a hosteller from the first stay, to
 * the end of the last (open: to the end of the session), at least to feeUntil; the demand is made again.
 * A school without the fee set-up for the session still gets the stay (synced = false, with why).
 */
export async function syncHostelFee(
  c: PoolClient,
  studentId: string,
  yearId: string,
  /** the hostel fee runs to this month at least (a hostel withdrawal with short notice keeps one more) */
  feeUntil?: string,
): Promise<{ synced: boolean; note?: string }> {
  const y = (
    await c.query<{ start_date: string; end_date: string }>(
      `SELECT start_date::text, end_date::text FROM academic_years WHERE id = $1`,
      [yearId],
    )
  ).rows[0];
  if (!y) return { synced: false, note: 'no session' };
  const span = (
    await c.query<{
      first: string | null;
      last: string | null;
      open: boolean;
      any: boolean;
    }>(
      `SELECT min(a.from_date)::text AS first, max(a.to_date)::text AS last, bool_or(a.to_date IS NULL) AS open, count(*) > 0 AS any
         FROM hostel_allotments a
        WHERE a.student_id = $1 AND a.from_date <= $3::date AND (a.to_date IS NULL OR a.to_date >= $2::date)`,
      [studentId, y.start_date, y.end_date],
    )
  ).rows[0]!;
  const month = (d: string) => `${d.slice(0, 7)}-01`;
  const hosteller = span.any;
  const from = hosteller && span.first && span.first > y.start_date ? month(span.first) : null;
  const last = feeUntil && span.last && feeUntil > span.last ? feeUntil : span.last;
  const to =
    hosteller && !span.open && last && month(last) < month(y.end_date) ? month(last) : null;
  await c.query('SAVEPOINT hostel_fee');
  try {
    await c.query(
      `INSERT INTO student_fee_profiles (school_id, student_id, academic_year_id, hosteller, hostel_from, hostel_to, created_by, updated_by)
       VALUES (app.current_school_id(), $1, $2, $3, $4, $5, app.current_user_id(), app.current_user_id())
       ON CONFLICT (student_id, academic_year_id) DO UPDATE SET hosteller = EXCLUDED.hosteller, hostel_from = EXCLUDED.hostel_from,
            hostel_to = EXCLUDED.hostel_to, updated_at = now(), updated_by = app.current_user_id()`,
      [studentId, yearId, hosteller, from, to],
    );
    const run = await c.query<{ run_id: string }>(
      `SELECT o_run_id::text AS run_id FROM app.generate_fee_demand($1, $2)`,
      [studentId, yearId],
    );
    await c.query(`SELECT app.apply_instalment_override($1, $2, $3)`, [
      studentId,
      yearId,
      run.rows[0]!.run_id,
    ]);
    await c.query('RELEASE SAVEPOINT hostel_fee');
    return { synced: true };
  } catch (e) {
    await c.query('ROLLBACK TO SAVEPOINT hostel_fee');
    const err = e as { code?: string; message?: string };
    if (err.code === 'P0001') return { synced: false, note: err.message ?? 'fee set-up missing' };
    throw e;
  }
}

const monthOf = (d: string) => `${d.slice(0, 7)}-01`;
const addMonths = (m: string, n: number) => {
  const d = new Date(`${m}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const label = (m: string) =>
  new Date(`${m}T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });
const dmy = (d: string) => d.slice(0, 10).split('-').reverse().join('-');

export interface HostelReturn {
  studentId: string;
  yearId: string;
  /** the stay that ended (its bed is the one taken back by default) */
  allotmentId: string;
  /** the last day of that stay */
  leftOn: string;
  /** the last month the hostel fee was charged for (the leaving month when not known) */
  feeUntil: string | null;
  /** continue: as if never left; from_date: a new stay from that day (months away not charged) */
  mode: 'continue' | 'from_date';
  fromDate?: string | null;
  /** from_date: another bed (else the same one) */
  bedId?: string | null;
  /** what makes the stay: shown on the new allotment */
  remark: string;
}

/** The bed is free for the stay asked, the pupil holds no other bed, the day is in the session. */
export async function checkHostelReturn(c: PoolClient, r: HostelReturn): Promise<void> {
  const a = (
    await c.query<{ bed_id: string }>(`SELECT bed_id::text FROM hostel_allotments WHERE id = $1`, [
      r.allotmentId,
    ])
  ).rows[0];
  if (!a)
    throw new DomainError('not-found', 'The stay to go back to is not found', { status: 404 });
  const held = await c.query(
    `SELECT 1 FROM hostel_allotments WHERE student_id = $1 AND id <> $2
        AND (to_date IS NULL OR to_date >= (now() AT TIME ZONE 'Asia/Kolkata')::date)`,
    [r.studentId, r.allotmentId],
  );
  if (held.rowCount)
    throw new DomainError('hostel.already_allotted', 'The pupil holds a bed again', {
      status: 409,
    });
  const yr = await c.query<{ end: string }>(
    `SELECT end_date::text AS end FROM academic_years WHERE id = $1`,
    [r.yearId],
  );
  if (r.mode === 'from_date') {
    if (!r.fromDate)
      throw new DomainError('validation-failed', 'Give the day the pupil is back in the hostel', {
        status: 400,
      });
    if (r.fromDate <= r.leftOn || r.fromDate > yr.rows[0]!.end)
      throw new DomainError(
        'validation-failed',
        `The day back in the hostel must be after ${dmy(r.leftOn)} and in the same session (up to ${dmy(yr.rows[0]!.end)})`,
        { status: 400 },
      );
  }
  const bed = r.mode === 'continue' ? a.bed_id : (r.bedId ?? a.bed_id);
  const start = r.mode === 'continue' ? r.leftOn : r.fromDate!;
  const taken = await c.query<{ who: string }>(
    `SELECT s.display_name AS who FROM hostel_allotments x JOIN students s ON s.id = x.student_id
      WHERE x.bed_id = $1 AND x.id <> $2 AND (x.to_date IS NULL OR x.to_date > $3::date) LIMIT 1`,
    [bed, r.allotmentId, start],
  );
  if (taken.rows[0])
    throw new DomainError(
      'hostel.bed_taken',
      `The bed is held by ${taken.rows[0].who}: choose 'back from a day' with another bed`,
      { status: 409 },
    );
  const blocked = await c.query(`SELECT 1 FROM hostel_beds WHERE id = $1 AND status <> 'active'`, [
    bed,
  ]);
  if (blocked.rowCount)
    throw new DomainError('hostel.bed_blocked', 'The bed is blocked', { status: 409 });
}

/**
 * Puts the pupil back in the hostel: the stay goes on (as if never left) or a new stay from the day (the
 * months between the last charged and the month back are not charged); the hostel fee is made again.
 * `carry` moves what was paid for the months away to the next unpaid fee. Returns what was done, as notes.
 */
export async function returnToHostel(
  c: PoolClient,
  r: HostelReturn,
  carry: (c: PoolClient, studentId: string, yearId: string) => Promise<string | null>,
  withdrawalId: string | null = null,
): Promise<string[]> {
  await checkHostelReturn(c, r);
  const notes: string[] = [];
  if (r.mode === 'continue') {
    await c.query(
      `UPDATE hostel_allotments SET to_date = NULL, end_reason = NULL, end_remarks = NULL, ended_at = NULL, ended_by = NULL WHERE id = $1`,
      [r.allotmentId],
    );
    notes.push(
      'Back in the hostel as if never left: the stay goes on and the hostel fee of the months away is charged.',
    );
  } else {
    const bed = (
      await c.query<{ bed_id: string }>(
        `SELECT bed_id::text FROM hostel_allotments WHERE id = $1`,
        [r.allotmentId],
      )
    ).rows[0]!.bed_id;
    await c.query(
      `INSERT INTO hostel_allotments (school_id, student_id, bed_id, from_date, kind, remarks, created_by)
       VALUES (app.current_school_id(), $1, $2, $3::date, 'allot', $4, app.current_user_id())`,
      [r.studentId, r.bedId ?? bed, r.fromDate, r.remark],
    );
    const gapFrom = addMonths(r.feeUntil ?? monthOf(r.leftOn), 1);
    const back = monthOf(r.fromDate!);
    if (gapFrom < back) {
      const gapTo = addMonths(back, -1);
      await c.query(
        `INSERT INTO hostel_fee_gaps (school_id, student_id, academic_year_id, from_month, to_month, withdrawal_id)
         VALUES (app.current_school_id(), $1, $2, $3::date, $4::date, $5)`,
        [r.studentId, r.yearId, gapFrom, gapTo, withdrawalId],
      );
      notes.push(
        `Back in the hostel from ${dmy(r.fromDate!)}: no hostel fee for ${label(gapFrom)}${gapFrom === gapTo ? '' : ` to ${label(gapTo)}`}.`,
      );
    } else notes.push(`Back in the hostel from ${dmy(r.fromDate!)}.`);
  }
  const sync = await syncHostelFee(c, r.studentId, r.yearId);
  notes.push(
    sync.synced
      ? 'The hostel fee is made again.'
      : `The hostel fee was not changed: ${sync.note ?? 'no fee set-up'}.`,
  );
  if (sync.synced && r.mode === 'from_date') {
    const carried = await carry(c, r.studentId, r.yearId);
    if (carried) notes.push(carried);
  }
  return notes;
}
