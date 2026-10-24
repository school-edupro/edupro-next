import type { AdmissionCondition, PoolClient } from '@edupro/db';

/** Merit point criteria of admission sessions (docs/design/40): where they are read from. */

export interface PointRule {
  id: string;
  name: string;
  logic: 'all' | 'any';
  conditions: AdmissionCondition[];
  points: number;
}

/** The rules of a session: the session's list (class null) and each class's own, in order. */
export async function pointRulesOf(c: PoolClient, cycleId: string) {
  const r = await c.query<{
    id: string;
    class_id: string | null;
    name: string;
    logic: 'all' | 'any';
    conditions: AdmissionCondition[];
    points: string;
  }>(
    `SELECT id::text, class_id::text, name, logic, conditions, points::text FROM admission_point_rules
      WHERE cycle_id = $1 ORDER BY class_id NULLS FIRST, sort_order, id`,
    [cycleId],
  );
  const rule = (x: (typeof r.rows)[number]): PointRule => ({
    id: x.id,
    name: x.name,
    logic: x.logic,
    conditions: x.conditions,
    points: Number(x.points),
  });
  return {
    session: r.rows.filter((x) => x.class_id === null).map(rule),
    byClass: (classId: string) => r.rows.filter((x) => x.class_id === classId).map(rule),
  };
}

/** The criteria a class of a session goes by: its own list, or the session's. */
export async function classPointRules(
  c: PoolClient,
  cycleId: string,
  classId: string,
): Promise<PointRule[]> {
  const rules = await pointRulesOf(c, cycleId);
  const own = await c.query<{ own_points: boolean }>(
    `SELECT own_points FROM admission_class_criteria WHERE cycle_id = $1 AND class_id = $2`,
    [cycleId, classId],
  );
  return own.rows[0]?.own_points ? rules.byClass(classId) : rules.session;
}
