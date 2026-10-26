import type { PointTable, PointTables, PoolClient } from '@edupro/db';

/**
 * The school's merit score tables (docs/design/48) as the points engine reads them for one class:
 * qualifications (a father's and a mother's score), the class's localities (else those for every
 * class), alumni schools by pass-out class, and siblings found in the student master.
 */
export async function pointTablesFor(
  c: PoolClient,
  classId: string,
  /** the admission nos. the registration names as siblings, looked up in the student master */
  siblingNos: string[] = [],
): Promise<PointTables> {
  const q = await c.query<{ name: string; father: string; mother: string }>(
    `SELECT lower(btrim(name)) AS name, father_score::text AS father, mother_score::text AS mother
       FROM admission_qualifications WHERE status = 'active'`,
  );
  // a class's own row wins over the one for every class
  const l = await c.query<{ name: string; score: string }>(
    `SELECT DISTINCT ON (lower(btrim(name))) lower(btrim(name)) AS name, score::text AS score
       FROM admission_localities WHERE status = 'active' AND (class_id = $1 OR class_id IS NULL)
      ORDER BY lower(btrim(name)), class_id NULLS LAST`,
    [classId],
  );
  const s = await c.query<{ name: string; passout: string; score: string }>(
    `SELECT lower(btrim(name)) AS name, lower(btrim(passout_class)) AS passout, score::text AS score
       FROM admission_alumni_schools WHERE status = 'active'`,
  );
  const quals = new Map(
    q.rows.map((x) => [x.name, { father: Number(x.father), mother: Number(x.mother) }]),
  );
  const locs = new Map(l.rows.map((x) => [x.name, Number(x.score)]));
  const schools = new Map(
    s.rows.map((x) => [`${x.name}|${passoutKey(x.passout)}`, Number(x.score)]),
  );
  const max = (ns: number[]) => ns.reduce((m, n) => Math.max(m, n), 0);
  const most: Record<PointTable, Record<string, number>> = {
    qualification: {
      father: max([...quals.values()].map((x) => x.father)),
      mother: max([...quals.values()].map((x) => x.mother)),
      child: 0,
    },
    locality: { father: 0, mother: 0, child: max([...locs.values()]) },
    alumni_school: {
      father: max([...schools.values()]),
      mother: max([...schools.values()]),
      child: max([...schools.values()]),
    },
  };
  const key = (n: string) => n.trim().toLowerCase();
  const nos = [...new Set(siblingNos.map(key).filter(Boolean))];
  const found = new Set(
    nos.length
      ? (
          await c.query<{ no: string }>(
            `SELECT lower(btrim(admission_no)) AS no FROM students
              WHERE deleted_at IS NULL AND status = 'active' AND lower(btrim(admission_no)) = ANY($1::text[])`,
            [nos],
          )
        ).rows.map((x) => x.no)
      : [],
  );
  return {
    qualification: (name) => quals.get(key(name)) ?? null,
    locality: (name) => locs.get(key(name)) ?? null,
    alumni: (school, passout) => schools.get(`${key(school)}|${passoutKey(passout)}`) ?? null,
    most: (table, role) => most[table][role] ?? 0,
    siblingFound: (list) => list.some((n) => found.has(key(n))),
  };
}

/** A pass-out class however it is written: X, 10, 10th, Class X are one; XII, 12, 12th likewise. */
export function passoutKey(p: string): string {
  const v = p
    .trim()
    .toLowerCase()
    .replace(/^class\s+/, '')
    .replace(/^(\d+)(st|nd|rd|th)$/, '$1');
  if (v === 'x' || v === '10') return '10';
  if (v === 'xii' || v === '12') return '12';
  return v;
}

/** The sibling admission nos. in a registration's answers (every siblings question). */
export function siblingNosOf(answers: Record<string, unknown>): string[] {
  return Object.values(answers).flatMap((v) =>
    v && typeof v === 'object' && !Array.isArray(v) && Array.isArray((v as { list?: unknown }).list)
      ? (v as { list: Array<{ admissionNo?: unknown }> }).list
          .map((x) => String(x.admissionNo ?? '').trim())
          .filter(Boolean)
      : [],
  );
}
