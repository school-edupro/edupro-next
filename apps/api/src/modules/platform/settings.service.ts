import { Injectable } from '@nestjs/common';
import type { TenantContext } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import { SETTINGS_CATALOGUE } from './settings.catalogue';

export interface SettingView {
  key: string;
  module: string;
  description: string;
  value: unknown;
  /** The standard value (what the school has when it never set one). */
  default: unknown;
  isDefault: boolean;
  validFrom: string | null;
}

@Injectable()
export class SettingsService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
  ) {}

  /** Effective values as of today for every catalogued key, with defaults where the school has not set one. */
  current(tenant: TenantContext): Promise<SettingView[]> {
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ key: string; value: unknown; valid_from: string }>(
        `SELECT DISTINCT ON (key) key, value, to_char(valid_from, 'YYYY-MM-DD') AS valid_from
           FROM school_settings
          WHERE valid_from <= CURRENT_DATE AND (valid_to IS NULL OR valid_to >= CURRENT_DATE)
          ORDER BY key, valid_from DESC, id DESC`,
      );
      const set = new Map(r.rows.map((x) => [x.key, x]));
      return Object.entries(SETTINGS_CATALOGUE).map(([key, def]) => {
        const row = set.get(key);
        return {
          key,
          module: def.module,
          description: def.description,
          value: row ? row.value : def.default,
          default: def.default,
          isDefault: !row,
          validFrom: row ? row.valid_from : null,
        };
      });
    });
  }

  history(
    tenant: TenantContext,
    key: string,
  ): Promise<
    Array<{ value: unknown; validFrom: string; validTo: string | null; createdAt: string }>
  > {
    this.assertKey(key);
    return this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        value: unknown;
        valid_from: string;
        valid_to: string | null;
        created_at: Date;
      }>(
        `SELECT value, to_char(valid_from, 'YYYY-MM-DD') AS valid_from, to_char(valid_to, 'YYYY-MM-DD') AS valid_to, created_at
           FROM school_settings WHERE key = $1 ORDER BY valid_from DESC, id DESC`,
        [key],
      );
      return r.rows.map((x) => ({
        value: x.value,
        validFrom: x.valid_from,
        validTo: x.valid_to,
        createdAt: x.created_at.toISOString(),
      }));
    });
  }

  async set(
    ctx: RequestContext,
    key: string,
    value: unknown,
    validFrom?: string,
  ): Promise<SettingView> {
    const def = this.assertKey(key);
    const parsed = def.schema.safeParse(value);
    if (!parsed.success) {
      throw new DomainError('validation-failed', `Invalid value for ${key}`, {
        status: 400,
        extra: {
          errors: parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    const tenant = requireTenant(ctx);
    const before = (await this.current(tenant)).find((s) => s.key === key);
    await this.db.tenant(tenant, async (c) => {
      // Close the currently open row so history stays unambiguous, then insert the new value.
      await c.query(
        `UPDATE school_settings SET valid_to = (COALESCE($2::date, CURRENT_DATE) - 1), updated_by = app.current_user_id()
          WHERE key = $1 AND valid_to IS NULL AND valid_from < COALESCE($2::date, CURRENT_DATE)`,
        [key, validFrom ?? null],
      );
      // A second change on the same day replaces that day's row (the audit log keeps every value).
      await c.query(
        `DELETE FROM school_settings WHERE key = $1 AND valid_from = COALESCE($2::date, CURRENT_DATE)`,
        [key, validFrom ?? null],
      );
      await c.query(
        `INSERT INTO school_settings (school_id, key, value, valid_from, created_by, updated_by)
         VALUES (app.current_school_id(), $1, $2::jsonb, COALESCE($3::date, CURRENT_DATE), app.current_user_id(), app.current_user_id())`,
        [key, JSON.stringify(parsed.data), validFrom ?? null],
      );
    });
    const after = (await this.current(tenant)).find((s) => s.key === key)!;
    ctx.audit = {
      action: 'platform.settings.edit',
      entityType: 'school_settings',
      entityId: key,
      before,
      after,
    };
    return after;
  }

  /**
   * Several settings saved together (docs/design/95): each checked by its own schema first — all or none — then
   * written from the same date in one transaction, one audit row each.
   */
  async setMany(
    ctx: RequestContext,
    values: Record<string, unknown>,
    validFrom?: string,
  ): Promise<SettingView[]> {
    const keys = Object.keys(values);
    if (!keys.length)
      throw new DomainError('validation-failed', 'Nothing to save.', { status: 400 });
    const errors: Array<{ path: string; message: string }> = [];
    const parsed = new Map<string, unknown>();
    for (const key of keys) {
      const def = SETTINGS_CATALOGUE[key];
      if (!def) {
        errors.push({ path: key, message: `Unknown setting ${key}` });
        continue;
      }
      const r = def.schema.safeParse(values[key]);
      if (r.success) parsed.set(key, r.data);
      else
        for (const i of r.error.issues)
          errors.push({ path: [key, ...i.path].join('.'), message: i.message });
    }
    if (errors.length)
      throw new DomainError('validation-failed', 'Some settings are not valid.', {
        status: 400,
        extra: { errors },
      });
    const tenant = requireTenant(ctx);
    const before = new Map((await this.current(tenant)).map((s) => [s.key, s]));
    await this.db.tenant(tenant, async (c) => {
      for (const [key, value] of parsed) {
        await c.query(
          `UPDATE school_settings SET valid_to = (COALESCE($2::date, CURRENT_DATE) - 1), updated_by = app.current_user_id()
            WHERE key = $1 AND valid_to IS NULL AND valid_from < COALESCE($2::date, CURRENT_DATE)`,
          [key, validFrom ?? null],
        );
        await c.query(
          `DELETE FROM school_settings WHERE key = $1 AND valid_from = COALESCE($2::date, CURRENT_DATE)`,
          [key, validFrom ?? null],
        );
        await c.query(
          `INSERT INTO school_settings (school_id, key, value, valid_from, created_by, updated_by)
           VALUES (app.current_school_id(), $1, $2::jsonb, COALESCE($3::date, CURRENT_DATE), app.current_user_id(), app.current_user_id())`,
          [key, JSON.stringify(value), validFrom ?? null],
        );
        await this.audit.stage(ctx, c, {
          action: 'platform.settings.edit',
          entityType: 'school_settings',
          entityId: key,
          before: before.get(key) ?? null,
          after: { key, value, validFrom: validFrom ?? null },
        });
      }
    });
    const now = await this.current(tenant);
    return now.filter((s) => parsed.has(s.key));
  }

  private assertKey(key: string) {
    const def = SETTINGS_CATALOGUE[key];
    if (!def) throw new DomainError('not-found', `Unknown setting ${key}`);
    return def;
  }
}
