import type { PoolClient } from 'pg';
import type { RequestContext } from '../../common/http/request-context';
import type { WorkflowService } from '../workflow/workflow.service';

/**
 * Fee requests other than the fee change of a pupil (late-fee waiver, sibling transfer, fee waiver,
 * a paid late fee or bounce charge adjusted in fee) are approved by the same levels as the fee change
 * (Fee setup -> Approval levels). The engine keeps one open request per definition and record, so each
 * family of requests rides its own definition, made equal to the fee change one whenever a request
 * starts. Returns the approval's id, or null when the school has no active fee change approval (the
 * request is then decided on its own page, as before).
 */
export async function startFeeApproval(
  workflow: WorkflowService,
  c: PoolClient,
  ctx: RequestContext,
  flow: { code: string; name: string },
  entityId: string,
  subject: string,
  payload: Record<string, unknown>,
): Promise<string | null> {
  const src = await c.query<{ levels: unknown; creator_roles: string[] }>(
    `SELECT levels, creator_roles FROM workflow_definitions
      WHERE entity_type = 'fee_profile_change' AND status = 'active' AND deleted_at IS NULL ORDER BY id LIMIT 1`,
  );
  if (!src.rows[0]) return null;
  const levels = JSON.stringify(src.rows[0].levels);
  const upd = await c.query(
    `UPDATE workflow_definitions SET levels = $1::jsonb, creator_roles = $2::text[], status = 'active', updated_at = now(), updated_by = app.current_user_id()
      WHERE code = $3 AND deleted_at IS NULL`,
    [levels, src.rows[0].creator_roles, flow.code],
  );
  if (upd.rowCount === 0)
    await c.query(
      `INSERT INTO workflow_definitions (school_id, code, name, entity_type, levels, creator_roles, created_by, updated_by)
       VALUES (app.current_school_id(), $3, $4, $3, $1::jsonb, $2::text[], app.current_user_id(), app.current_user_id())`,
      [levels, src.rows[0].creator_roles, flow.code, flow.name],
    );
  const instance = await workflow.start(c, ctx, {
    definitionCode: flow.code,
    entityType: flow.code,
    entityId,
    subject: subject.slice(0, 240),
    payload,
  });
  return instance.id;
}

/** Who a request waits with: the level's name and the people who can approve it. */
export const WAITING_WITH = (instanceColumn: string) =>
  // eslint-disable-next-line no-restricted-syntax -- the column name comes from code, never from a request
  `(SELECT st.name || ' (' || COALESCE((SELECT string_agg(au.display_name, ', ' ORDER BY au.display_name) FROM users au WHERE au.id = ANY(st.assignee_user_ids)), 'nobody holds this role yet') || ')'
      FROM workflow_instances i JOIN workflow_steps st ON st.instance_id = i.id AND st.level = i.current_level AND st.status = 'pending'
     WHERE i.id = ${instanceColumn} AND i.status = 'pending')`;
