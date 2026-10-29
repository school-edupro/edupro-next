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

/** The placeholders a prefix may hold (docs/design/63). */
export const PREFIX_PLACEHOLDERS = ['{SESSION}', '{YYYY}', '{YY}', '{CLASS}'] as const;
/** A placeholder-looking part that is not one of them. */
export const unknownPlaceholder = (prefix: string) =>
  (prefix.match(/\{[^}]*\}?/g) ?? []).find(
    (x) => !(PREFIX_PLACEHOLDERS as readonly string[]).includes(x),
  ) ?? null;

/** Where a number is made: the session's academic year (2027-28) and the class's code (I, VI, NUR). */
export interface SeriesPlace {
  session: string;
  classCode: string | null;
}

/** The prefix with its placeholders filled ("REG/{SESSION}/{CLASS}/" → "REG/2027-28/I/"). */
export function fillPrefix(prefix: string, p: SeriesPlace): string {
  const session = p.session.replace(/^Session\s+/i, '').replace(/\s+/g, '');
  const yyyy = session.match(/\d{4}/)?.[0] ?? '';
  return prefix
    .replaceAll('{SESSION}', session)
    .replaceAll('{YYYY}', yyyy)
    .replaceAll('{YY}', yyyy.slice(2))
    .replaceAll('{CLASS}', (p.classCode ?? '').replace(/\s+/g, ''));
}

/** A session's academic year and a class's code, for the placeholders. */
export async function seriesPlace(
  c: PoolClient,
  cycleId: string,
  classId: string | null,
): Promise<SeriesPlace> {
  const r = await c.query<{ year: string | null; code: string | null }>(
    `SELECT (SELECT ay.name FROM admission_cycles y JOIN academic_years ay ON ay.id = y.academic_year_id WHERE y.id = $1) AS year,
            (SELECT code FROM classes WHERE id = $2::bigint) AS code`,
    [cycleId, classId],
  );
  return { session: r.rows[0]?.year ?? '', classCode: r.rows[0]?.code ?? null };
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
 * The most specific active series that matches a registration (docs/design/48, part 5): its class and
 * the most answer conditions first, then the class, then the session's; none: null (the default numbers).
 */
export async function seriesPick(
  c: PoolClient,
  kind: SeriesKind,
  a: { cycle_id: string; class_id: string; data: AdmissionAnswers | null },
): Promise<(SeriesRow & { name: string }) | null> {
  const r = await c.query<SeriesRow & { name: string }>(
    `SELECT id::text, class_id::text, conditions, prefix, next_no::text, digits, name FROM admission_number_series
      WHERE status = 'active' AND kind = $1 AND cycle_id = $2 AND (class_id IS NULL OR class_id = $3)`,
    [kind, a.cycle_id, a.class_id],
  );
  const answers = a.data ?? {};
  return (
    r.rows
      .filter((s) => !s.conditions.length || conditionsHold(s.conditions, 'all', answers))
      .sort(
        (x, y) =>
          (y.class_id ? 10 : 0) +
            y.conditions.length -
            ((x.class_id ? 10 : 0) + x.conditions.length) || Number(x.id) - Number(y.id),
      )[0] ?? null
  );
}

/**
 * The number a registration would get now, without using it (docs/design/63, Test a series): the
 * series and its next free number, the placeholders filled; none: null.
 */
export async function seriesPreview(
  c: PoolClient,
  kind: SeriesKind,
  a: { cycle_id: string; class_id: string; data: AdmissionAnswers | null },
): Promise<{ id: string; name: string; number: string | null } | null> {
  const best = await seriesPick(c, kind, a);
  if (!best) return null;
  const prefix = fillPrefix(best.prefix, await seriesPlace(c, a.cycle_id, a.class_id));
  let n = BigInt(best.next_no);
  for (let i = 0; i < 10_000; i += 1, n += 1n) {
    const no = seriesText(prefix, n, best.digits);
    if (!(await numberTaken(c, kind, no))) return { id: best.id, name: best.name, number: no };
  }
  return { id: best.id, name: best.name, number: null };
}

/**
 * The next number of the most specific series that matches a registration, the prefix's placeholders
 * filled (docs/design/63). The series row is locked, so two payments at once never share a number, and
 * a number already given (by hand, another series) is stepped over.
 */
export async function seriesNumber(
  c: PoolClient,
  kind: SeriesKind,
  a: { cycle_id: string; class_id: string; data: AdmissionAnswers | null },
): Promise<string | null> {
  const best = await seriesPick(c, kind, a);
  if (!best) return null;
  const locked = await c.query<SeriesRow>(
    `SELECT id::text, class_id::text, conditions, prefix, next_no::text, digits
       FROM admission_number_series WHERE id = $1 FOR UPDATE`,
    [best.id],
  );
  const s = locked.rows[0]!;
  const prefix = fillPrefix(s.prefix, await seriesPlace(c, a.cycle_id, a.class_id));
  let n = BigInt(s.next_no);
  for (let i = 0; i < 10_000; i += 1, n += 1n) {
    const no = seriesText(prefix, n, s.digits);
    if (await numberTaken(c, kind, no)) continue;
    await c.query(
      `UPDATE admission_number_series SET next_no = $2, last_given = $3, given = given + 1, updated_at = now() WHERE id = $1`,
      [s.id, (n + 1n).toString(), no],
    );
    return no;
  }
  return null;
}
