import type { PoolClient } from '@edupro/db';
import { DomainError } from '../errors/domain-error';
import type { RequestContext } from '../http/request-context';

/**
 * Rights only their holders may pass on (docs/design/101): a school's own admin may not give them to a role, take
 * them from one, or give a role that carries them to a person — else any school's admin could give themselves a
 * right over every school. Mobilise makes the first grant (scripts/ai/ai-model-admin.mjs).
 */
export const HOLDERS_ONLY: readonly string[] = ['platform.ai_model.manage'];

const NAMES: Record<string, string> = {
  'platform.ai_model.manage': 'AI model for all schools',
};

/** Refuses when the codes include a holders-only right the person does not hold. */
export function assertMayPassOn(ctx: RequestContext, codes: Iterable<string>): void {
  const missing = [...new Set(codes)].filter(
    (c) => HOLDERS_ONLY.includes(c) && !ctx.permissions?.has(c),
  );
  if (missing.length)
    throw new DomainError(
      'access.holders_only',
      `Only someone who holds this right may give it or take it away: ${missing.map((c) => NAMES[c] ?? c).join(', ')}`,
      { status: 403, extra: { rights: missing } },
    );
}

/** The same, for a role: the holders-only rights it carries. */
export async function assertMayGiveRole(
  ctx: RequestContext,
  c: PoolClient,
  roleId: string,
): Promise<void> {
  const r = await c.query<{ code: string }>(
    `SELECT permission_code AS code FROM role_permissions WHERE role_id = $1 AND permission_code = ANY($2::text[])`,
    [roleId, HOLDERS_ONLY],
  );
  assertMayPassOn(
    ctx,
    r.rows.map((x) => x.code),
  );
}
