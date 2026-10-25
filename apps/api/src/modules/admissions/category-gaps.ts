import type { PoolClient } from '@edupro/db';

/**
 * A fee category that a session's form cannot decide (docs/design/43, part 5): its conditions name
 * questions the form does not ask, so its families are charged the default category's fee instead.
 * `never`: no family on that form can ever fall in the category (every question it needs is missing
 * for "any", one is enough for "all"); otherwise only some of its ways in are missing.
 */
export interface CategoryGap {
  cycleId: string;
  cycleName: string;
  categoryId: string;
  categoryName: string;
  formId: string;
  formName: string;
  classes: string[];
  missing: string[];
  never: boolean;
}

/** The gaps of the sessions given (none given: every session not closed). */
export async function categoryGaps(c: PoolClient, cycleIds?: string[]): Promise<CategoryGap[]> {
  const cats = await c.query<{
    id: string;
    name: string;
    logic: 'all' | 'any';
    conditions: Array<{ field?: string }>;
  }>(
    `SELECT id::text, name, logic, conditions FROM admission_fee_categories
      WHERE status = 'active' AND NOT is_default AND jsonb_array_length(conditions) > 0 ORDER BY sort_order, id`,
  );
  if (!cats.rows.length) return [];
  const forms = await c.query<{
    cycle_id: string;
    cycle_name: string;
    form_id: string;
    form_name: string;
    keys: string[] | null;
    classes: string[];
  }>(
    `SELECT y.id::text AS cycle_id, y.name AS cycle_name, f.id::text AS form_id, f.name AS form_name,
            (SELECT array_agg(x ->> 'key') FROM jsonb_array_elements(f.def -> 'fields') x) AS keys,
            array_agg(cl.name ORDER BY cl.display_order, cl.name) AS classes
       FROM admission_class_criteria k
       JOIN admission_cycles y ON y.id = k.cycle_id AND y.deleted_at IS NULL
       JOIN admission_forms f ON f.id = k.form_id
       JOIN classes cl ON cl.id = k.class_id
      WHERE ($1::bigint[] IS NULL AND y.status <> 'closed') OR y.id = ANY($1::bigint[])
      GROUP BY y.id, y.name, f.id, f.name, f.def
      ORDER BY y.id, f.name`,
    [cycleIds?.length ? cycleIds : null],
  );
  const out: CategoryGap[] = [];
  for (const f of forms.rows) {
    const asked = new Set(f.keys ?? []);
    for (const k of cats.rows) {
      const needs = [...new Set(k.conditions.map((x) => x.field).filter((x): x is string => !!x))];
      const missing = needs.filter((x) => !asked.has(x));
      if (!missing.length) continue;
      out.push({
        cycleId: f.cycle_id,
        cycleName: f.cycle_name,
        categoryId: k.id,
        categoryName: k.name,
        formId: f.form_id,
        formName: f.form_name,
        classes: f.classes,
        missing,
        never: k.logic === 'all' || missing.length === needs.length,
      });
    }
  }
  return out;
}
