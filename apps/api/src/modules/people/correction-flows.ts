import type { PoolClient } from '@edupro/db';
import type { Level } from '../workflow/workflow.service';

/** The approval flows of the student corrections (docs/design/37). */
export interface CorrectionFlow {
  code: string;
  entityType: string;
  name: string;
}
/** A school starts with the principal deciding; the levels are changed under Workflow. */
const DEFAULT_LEVELS: Level[] = [
  {
    level: 1,
    name: 'Principal approval',
    resolver: { kind: 'role', roleCode: 'school_admin' },
    slaHours: 48,
  },
];

/** The flow's definition, made with the principal at one level the first time it is needed. */
export async function ensureCorrectionFlow(
  c: PoolClient,
  flow: CorrectionFlow,
): Promise<{ id: string; levels: Level[] }> {
  await c.query(
    `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, created_by, updated_by)
     SELECT app.current_school_id(), $1, $3, $2, $4::jsonb, app.current_user_id(), app.current_user_id()
      WHERE NOT EXISTS (SELECT 1 FROM workflow_definitions WHERE code = $1 AND deleted_at IS NULL)`,
    [flow.code, flow.entityType, flow.name, JSON.stringify(DEFAULT_LEVELS)],
  );
  // switched off under Workflow: corrections have no other way to be decided
  await c.query(
    `UPDATE workflow_definitions SET status = 'active', updated_at = now()
      WHERE code = $1 AND deleted_at IS NULL AND status <> 'active'`,
    [flow.code],
  );
  const r = await c.query<{ id: string; levels: Level[] }>(
    `SELECT id::text, levels FROM workflow_definitions WHERE code = $1 AND deleted_at IS NULL`,
    [flow.code],
  );
  return r.rows[0]!;
}

/** Who decides at each level, in words (shown beside the request form). */
export async function describeLevels(
  c: PoolClient,
  levels: Level[],
): Promise<Array<{ level: number; name: string; approvers: string }>> {
  const roles = await c.query<{ code: string; name: string }>(
    `SELECT code, name FROM roles WHERE school_id IS NULL OR school_id = app.current_school_id()`,
  );
  const users = await c.query<{ id: string; name: string }>(
    `SELECT id::text, display_name AS name FROM users WHERE id = ANY($1::bigint[])`,
    [
      levels.flatMap((l) =>
        l.resolver.kind === 'named_user'
          ? [l.resolver.userId]
          : l.resolver.kind === 'any_of'
            ? l.resolver.userIds
            : [],
      ),
    ],
  );
  const roleName = new Map(roles.rows.map((x) => [x.code, x.name]));
  const userName = new Map(users.rows.map((x) => [x.id, x.name]));
  const who = (l: Level): string => {
    const r = l.resolver;
    if (r.kind === 'role') return roleName.get(r.roleCode) ?? r.roleCode;
    if (r.kind === 'any_of')
      return [
        ...r.roleCodes.map((x) => roleName.get(x) ?? x),
        ...r.userIds.map((x) => userName.get(x) ?? 'A named person'),
      ].join(', ');
    if (r.kind === 'named_user') return userName.get(r.userId) ?? 'A named person';
    if (r.kind === 'class_teacher') return 'Class teacher';
    if (r.kind === 'position' || r.kind === 'staff')
      return `Designation: ${('designation' in r && r.designation) || 'HOD'}`;
    return 'The requester’s reporting line';
  };
  return [...levels]
    .sort((a, b) => a.level - b.level)
    .map((l) => ({ level: l.level, name: l.name, approvers: who(l) }));
}
