import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  FALLBACK,
  ROLE_DEFAULTS,
  ROLE_ORDER,
  WIDGETS,
  type WidgetDef,
} from './dashboard.catalogue';
import { DashboardWidgetsService } from './dashboard-widgets.service';

export interface Layout {
  role: string | null;
  roleName: string | null;
  widgets: Array<Pick<WidgetDef, 'key' | 'title' | 'wide'>>;
  hidden: string[];
  available: Array<Pick<WidgetDef, 'key' | 'title'>>;
  quickActions: string[];
  /** true when the user changed their own order or pins */
  personal: boolean;
}

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/**
 * The landing page: the widgets of the user's role (the school's defaults or the built-in ones), the
 * user's own order, hidden widgets and pinned quick actions, each widget only when its permission is
 * held; the data of each widget (DashboardWidgetsService); and the birthday wishes.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly widgets: DashboardWidgetsService,
  ) {}

  private allowed(ctx: RequestContext, w: WidgetDef) {
    return w.anyOf.length === 0 || w.anyOf.some((p) => ctx.permissions?.has(p));
  }

  /** The user's landing role: the first of ROLE_ORDER they hold. */
  private async role(c: PoolClient, userId: string) {
    const r = await c.query<{ code: string; name: string }>(
      `SELECT DISTINCT r.code, r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.school_id = app.current_school_id() AND ur.user_id = $1 AND ur.revoked_at IS NULL
          AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
      [userId],
    );
    const held = r.rows;
    const first = ROLE_ORDER.map((code) => held.find((h) => h.code === code)).find(Boolean);
    return first ?? held[0] ?? null;
  }

  async layout(ctx: RequestContext): Promise<Layout> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const role = await this.role(c, ctx.user.id);
      const school = role
        ? (
            await c.query<{ widgets: unknown; quick_actions: unknown }>(
              `SELECT widgets, quick_actions FROM dashboard_role_defaults WHERE school_id = app.current_school_id() AND role_code = $1`,
              [role.code],
            )
          ).rows[0]
        : undefined;
      const mine = (
        await c.query<{ widgets: unknown; hidden: unknown; quick_actions: unknown }>(
          `SELECT widgets, hidden, quick_actions FROM user_dashboards WHERE school_id = app.current_school_id() AND user_id = $1`,
          [ctx.user.id],
        )
      ).rows[0];
      const base = asList(school?.widgets).length
        ? asList(school?.widgets)
        : (role && ROLE_DEFAULTS[role.code]) || FALLBACK;
      const order = asList(mine?.widgets).length ? asList(mine?.widgets) : base;
      const hidden = asList(mine?.hidden);
      const ok = WIDGETS.filter((w) => this.allowed(ctx, w));
      const byKey = new Map(ok.map((w) => [w.key, w]));
      const widgets = order
        .filter((k) => byKey.has(k) && !hidden.includes(k))
        .map((k) => byKey.get(k)!)
        .map(({ key, title, wide }) => ({ key, title, wide }));
      return {
        role: role?.code ?? null,
        roleName: role?.name ?? null,
        widgets,
        hidden: hidden.filter((k) => byKey.has(k)),
        available: ok.map(({ key, title }) => ({ key, title })),
        quickActions: asList(mine?.quick_actions).length
          ? asList(mine?.quick_actions)
          : asList(school?.quick_actions),
        personal: !!mine,
      };
    });
  }

  async saveLayout(
    ctx: RequestContext,
    dto: { widgets: string[]; hidden: string[]; quickActions: string[] },
  ) {
    const known = new Set(WIDGETS.map((w) => w.key));
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO user_dashboards (school_id, user_id, widgets, hidden, quick_actions)
         VALUES (app.current_school_id(), $1, $2::jsonb, $3::jsonb, $4::jsonb)
         ON CONFLICT (school_id, user_id) DO UPDATE SET widgets = EXCLUDED.widgets, hidden = EXCLUDED.hidden,
              quick_actions = EXCLUDED.quick_actions, updated_at = now()`,
        [
          ctx.user.id,
          JSON.stringify(dto.widgets.filter((k) => known.has(k))),
          JSON.stringify(dto.hidden.filter((k) => known.has(k))),
          JSON.stringify(dto.quickActions),
        ],
      );
      return { ok: true };
    });
  }

  /** Back to the role's page: the user's own order and pins are dropped. */
  async resetLayout(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `DELETE FROM user_dashboards WHERE school_id = app.current_school_id() AND user_id = $1`,
        [ctx.user.id],
      );
      return { ok: true };
    });
  }

  /** The roles the school can set a landing for, with what each has now. */
  async defaults(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const r = await c.query<{ role_code: string; widgets: unknown; quick_actions: unknown }>(
        `SELECT role_code, widgets, quick_actions FROM dashboard_role_defaults WHERE school_id = app.current_school_id()`,
      );
      const names = await c.query<{ code: string; name: string }>(
        `SELECT DISTINCT ON (code) code, name FROM roles
          WHERE (school_id IS NULL OR school_id = app.current_school_id()) AND code = ANY ($1::text[])
          ORDER BY code, school_id NULLS LAST`,
        [Object.keys(ROLE_DEFAULTS)],
      );
      return {
        widgets: WIDGETS.map(({ key, title }) => ({ key, title })),
        roles: Object.keys(ROLE_DEFAULTS).map((code) => {
          const own = r.rows.find((x) => x.role_code === code);
          return {
            code,
            name:
              names.rows.find((n) => n.code === code)?.name ??
              code.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase()),
            widgets: asList(own?.widgets).length ? asList(own?.widgets) : ROLE_DEFAULTS[code]!,
            quickActions: asList(own?.quick_actions),
            custom: !!own,
          };
        }),
      };
    });
  }

  async saveDefaults(
    ctx: RequestContext,
    role: string,
    dto: { widgets: string[]; quickActions: string[] },
  ) {
    if (!ROLE_DEFAULTS[role])
      throw new DomainError('not-found', 'No landing page for this role', { status: 404 });
    const known = new Set(WIDGETS.map((w) => w.key));
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await c.query(
        `INSERT INTO dashboard_role_defaults (school_id, role_code, widgets, quick_actions, updated_by)
         VALUES (app.current_school_id(), $1, $2::jsonb, $3::jsonb, app.current_user_id())
         ON CONFLICT (school_id, role_code) DO UPDATE SET widgets = EXCLUDED.widgets, quick_actions = EXCLUDED.quick_actions,
              updated_at = now(), updated_by = app.current_user_id()`,
        [
          role,
          JSON.stringify(dto.widgets.filter((k) => known.has(k))),
          JSON.stringify(dto.quickActions),
        ],
      );
      await this.audit.stage(ctx, c, {
        action: 'dashboard.defaults.save',
        entityType: 'dashboard_role_defaults',
        entityId: role,
        after: dto,
      });
      return { ok: true };
    });
  }

  /** One widget's data, when the user may see it. */
  async widget(ctx: RequestContext, key: string) {
    const w = WIDGETS.find((x) => x.key === key);
    if (!w || !this.allowed(ctx, w))
      throw new DomainError('not-found', 'No such widget', { status: 404 });
    return this.widgets.data(ctx, key);
  }
}
