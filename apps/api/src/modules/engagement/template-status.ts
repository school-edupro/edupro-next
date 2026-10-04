import type { PoolClient } from '@edupro/db';

export interface TemplateStatus {
  code: string;
  channel: string;
  name: string;
  active: boolean;
  /** It will go out: active, and SMS has its DLT id / WhatsApp its approved name. */
  ready: boolean;
}

/**
 * Which messages of one module can go out, for its set-up page: every template whose code starts with
 * the prefix, per channel. The module's templates are created on the first read.
 */
export async function templateStatus(c: PoolClient, prefix: string): Promise<TemplateStatus[]> {
  await c.query(`SELECT app.module_seed_templates($1)`, [`${prefix}_x`]);
  const r = await c.query<Record<string, unknown>>(
    `SELECT t.code, t.channel::text, t.name, t.status::text, (t.dlt_template_id IS NOT NULL AND btrim(t.dlt_template_id) <> '') AS has_dlt,
            (t.wa_template_name IS NOT NULL AND btrim(t.wa_template_name) <> '') AS has_wa
       FROM comms_templates t WHERE left(t.code, length($1) + 1) = $1 || '_' AND t.deleted_at IS NULL ORDER BY t.code, t.channel`,
    [prefix],
  );
  return r.rows.map((t) => ({
    code: String(t.code),
    channel: String(t.channel),
    name: String(t.name),
    active: t.status === 'active',
    ready:
      t.status === 'active' &&
      (t.channel === 'email' || (t.channel === 'sms' ? Boolean(t.has_dlt) : Boolean(t.has_wa))),
  }));
}
