import {
  conditionsHold,
  type AdmissionAnswers,
  type AdmissionCondition,
  type PoolClient,
} from '@edupro/db';

export type SeriesKind = 'registration' | 'admission';

interface SeriesRow {
  id: string;
  class_id: string | null;
  conditions: AdmissionCondition[];
  prefix: string;
  next_no: string;
  digits: number;
}

/** A series' number: the prefix and the number with at least its digits ("DP1" + 1, 4 → DP10001). */
export function seriesText(prefix: string, n: bigint | number | string, digits: number): string {
  return `${prefix}${String(n).padStart(digits, '0')}`;
}

/** Whether a number is given already (registration: any registration; admission: any student too). */
export async function numberTaken(c: PoolClient, kind: SeriesKind, no: string): Promise<boolean> {
  const r = await c.query(
    kind === 'registration'
      ? `SELECT 1 FROM applications WHERE lower(application_no) = lower($1) LIMIT 1`
      : `SELECT 1 FROM students WHERE lower(admission_no) = lower($1)
         UNION ALL SELECT 1 FROM applications WHERE lower(admission_no) = lower($1) LIMIT 1`,
    [no],
  );
  return r.rows.length > 0;
}

/**
 * The next number of the most specific series that matches a registration (docs/design/48, part 5):
 * its class and the most answer conditions first, then the class, then the session's; none: null and
 * the caller uses the school's default. The series row is locked, so two payments at once never share
 * a number, and a number already given (by hand, another series) is stepped over.
 */
export async function seriesNumber(
  c: PoolClient,
  kind: SeriesKind,
  a: { cycle_id: string; class_id: string; data: AdmissionAnswers | null },
): Promise<string | null> {
  const r = await c.query<SeriesRow>(
    `SELECT id::text, class_id::text, conditions, prefix, next_no::text, digits FROM admission_number_series
      WHERE status = 'active' AND kind = $1 AND cycle_id = $2 AND (class_id IS NULL OR class_id = $3)`,
    [kind, a.cycle_id, a.class_id],
  );
  const answers = a.data ?? {};
  const best = r.rows
    .filter((s) => !s.conditions.length || conditionsHold(s.conditions, 'all', answers))
    .sort(
      (x, y) =>
        (y.class_id ? 10 : 0) +
          y.conditions.length -
          ((x.class_id ? 10 : 0) + x.conditions.length) || Number(x.id) - Number(y.id),
    )[0];
  if (!best) return null;
  const locked = await c.query<SeriesRow>(
    `SELECT id::text, class_id::text, conditions, prefix, next_no::text, digits
       FROM admission_number_series WHERE id = $1 FOR UPDATE`,
    [best.id],
  );
  const s = locked.rows[0]!;
  let n = BigInt(s.next_no);
  for (let i = 0; i < 10_000; i += 1, n += 1n) {
    const no = seriesText(s.prefix, n, s.digits);
    if (await numberTaken(c, kind, no)) continue;
    await c.query(
      `UPDATE admission_number_series SET next_no = $2, last_given = $3, given = given + 1, updated_at = now() WHERE id = $1`,
      [s.id, (n + 1n).toString(), no],
    );
    return no;
  }
  return null;
}
