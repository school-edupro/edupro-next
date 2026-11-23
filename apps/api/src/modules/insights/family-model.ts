import type { PoolClient } from '@edupro/db';

/**
 * docs/design/102: the AI model for parents and students. The consent purpose `ai.model` names who runs the model; a
 * consent counts only when given after that name last changed. Shared by the assistant and the family consents.
 */
export const MODEL_PURPOSE = 'ai.model';

export interface FamilyModel {
  /** who runs the model, as the consent names it */
  operator: string;
  /** when the name last changed: consents before it count no more */
  since: Date | null;
  /** the school's switches for the model's help */
  parent: boolean;
  student: boolean;
}

/** The model as families meet it in this school (tenant connection); null when it is off, unnamed, or not switched on
 * for parents or students. */
export async function familyModel(c: PoolClient): Promise<FamilyModel | null> {
  const m = await c.query<{
    is_on: boolean;
    operator: string | null;
    operator_changed_at: Date | null;
  }>('SELECT is_on, operator, operator_changed_at FROM app.ai_model_family()');
  const row = m.rows[0];
  if (!row?.is_on || !row.operator) return null;
  const s = await c.query<{ claude: Record<string, unknown> | null }>(
    'SELECT claude FROM assistant_settings WHERE school_id = app.current_school_id()',
  );
  const on = s.rows[0]?.claude ?? {};
  const parent = on.parent === true;
  const student = on.student === true;
  if (!parent && !student) return null;
  return { operator: row.operator, since: row.operator_changed_at, parent, student };
}

/**
 * Whether the model may help: a parent's own consent, or (for a student) a consent of one of their parents — the
 * latest choice, given after the name last changed.
 */
export async function modelConsented(
  c: PoolClient,
  since: Date | null,
  studentIds: string[] | null,
): Promise<boolean> {
  // whose consent counts: the person's own, or every parent of the student who has a sign-in
  const r = await c.query<{ ok: boolean }>(
    `SELECT COALESCE(bool_or(l.status = 'granted' AND ($2::timestamptz IS NULL OR l.recorded_at >= $2)), false) AS ok
       FROM (SELECT app.current_user_id() AS user_id WHERE $3::bigint[] IS NULL
             UNION
             SELECT g.user_id FROM student_guardians sg JOIN guardians g ON g.id = sg.guardian_id
              WHERE sg.student_id = ANY($3::bigint[]) AND g.user_id IS NOT NULL AND g.deleted_at IS NULL) u
       CROSS JOIN LATERAL (SELECT x.status::text AS status, x.recorded_at FROM consents x
                            WHERE x.user_id = u.user_id AND x.purpose_code = $1
                            ORDER BY x.recorded_at DESC, x.id DESC LIMIT 1) l`,
    [MODEL_PURPOSE, since, studentIds],
  );
  return r.rows[0]?.ok ?? false;
}
