import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import { AuditService } from '../../common/audit/audit.service';
import { DbService } from '../../common/db/db.service';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant, type RequestContext } from '../../common/http/request-context';
import {
  FALLBACK,
  NO_LANDING,
  ROLE_DEFAULTS,
  ROLE_ORDER,
  WIDGETS,
  type WidgetDef,
} from './dashboard.catalogue';
import { DashboardWidgetsService } from './dashboard-widgets.service';

export interface QuickItem {
  href: string;
  label?: string;
  icon?: string;
}
export interface WidgetSetting {
  title?: string;
  size?: 'normal' | 'wide';
  days?: number;
  count?: number;
}
export type Settings = Record<string, WidgetSetting>;

export interface Layout {
  role: string | null;
  roleName: string | null;
  widgets: Array<{ key: string; title: string; wide?: boolean; days?: number; count?: number }>;
  hidden: string[];
  available: Array<{ key: string; title: string }>;
  /** in order, with the school's own label and icon */
  quickActions: QuickItem[];
  /** the role's links to pages outside EduPro, which a user may also pin */
  links: QuickItem[];
  /** the school keeps this role's page as set: no own arrangement */
  locked: boolean;
  /** true when the user changed their own order or pins (and the role is not locked) */
  personal: boolean;
}

interface RoleRow {
  widgets: unknown;
  quick_actions: unknown;
  settings: unknown;
  locked: boolean;
}

const asList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const external = (href: string) => href.startsWith('https://');
const asItems = (v: unknown): QuickItem[] =>
  Array.isArray(v)
    ? v.flatMap((x): QuickItem[] => {
        if (typeof x === 'string') return [{ href: x }];
        if (x && typeof x === 'object' && typeof (x as QuickItem).href === 'string') {
          const { href, label, icon } = x as QuickItem;
          return [{ href, ...(label ? { label } : {}), ...(icon ? { icon } : {}) }];
        }
        return [];
      })
    : [];
const asSettings = (v: unknown): Settings =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Settings) : {};
const clamp = (n: number, [min, max]: [number, number, number]) =>
  Math.min(max, Math.max(min, Math.round(n)));

/**
 * The landing page: the widgets of the user's role (the school's settings or the built-in ones), the
 * user's own order, hidden widgets and pinned quick actions unless the school locked the role, each
 * widget only when its permission is held; the school's settings per role (titles, size, days, rows,
 * quick menu with own labels and outside links), copy, push to users and preview.
 */
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly widgets: DashboardWidgetsService,
  ) {}

  private static allowed(perms: ReadonlySet<string> | undefined, w: WidgetDef) {
    return w.anyOf.length === 0 || w.anyOf.some((p) => perms?.has(p));
  }

  /**
   * The user's landing role: a role the school made and set a landing for, else the first of
   * ROLE_ORDER, else a school role, else any role held.
   */
  private async role(c: PoolClient, userId: string) {
    const r = await c.query<{ code: string; name: string; own: boolean; set: boolean }>(
      `SELECT DISTINCT r.code, r.name, r.school_id IS NOT NULL AS own,
              EXISTS (SELECT 1 FROM dashboard_role_defaults d
                       WHERE d.school_id = app.current_school_id() AND d.role_code = r.code) AS set
         FROM user_roles ur JOIN roles r ON r.id = ur.role_id
        WHERE ur.school_id = app.current_school_id() AND ur.user_id = $1 AND ur.revoked_at IS NULL
          AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)`,
      [userId],
    );
    const held = r.rows.filter((h) => !NO_LANDING.has(h.code));
    const rank = (h: (typeof held)[number]) => {
      if (h.own && h.set && !ROLE_ORDER.includes(h.code)) return -1;
      const i = ROLE_ORDER.indexOf(h.code);
      if (i >= 0) return i;
      return h.own ? 100 : 200;
    };
    return [...held].sort((a, b) => rank(a) - rank(b))[0] ?? r.rows[0] ?? null;
  }

  private async roleRow(c: PoolClient, code: string) {
    return (
      await c.query<RoleRow>(
        `SELECT widgets, quick_actions, settings, locked FROM dashboard_role_defaults
          WHERE school_id = app.current_school_id() AND role_code = $1`,
        [code],
      )
    ).rows[0];
  }

  /** The widgets of a role in order, with the school's titles and settings, that `perms` may see. */
  private static compose(
    code: string | null,
    row: RoleRow | undefined,
    perms: ReadonlySet<string> | undefined,
    mine?: { widgets: string[]; hidden: string[] },
  ) {
    const base = asList(row?.widgets).length
      ? asList(row?.widgets)
      : (code && ROLE_DEFAULTS[code]) || FALLBACK;
    const settings = asSettings(row?.settings);
    const order = mine?.widgets.length ? mine.widgets : base;
    const hidden = mine?.hidden ?? [];
    const ok = WIDGETS.filter((w) => DashboardService.allowed(perms, w));
    const byKey = new Map(ok.map((w) => [w.key, w]));
    const title = (w: WidgetDef) => settings[w.key]?.title?.trim() || w.title;
    const widgets = order
      .filter((k) => byKey.has(k) && !hidden.includes(k))
      .map((k) => {
        const w = byKey.get(k)!;
        const s = settings[k] ?? {};
        return {
          key: w.key,
          title: title(w),
          wide: s.size ? s.size === 'wide' : !!w.wide,
          ...(w.days ? { days: clamp(s.days ?? w.days[2], w.days) } : {}),
          ...(w.count ? { count: clamp(s.count ?? w.count[2], w.count) } : {}),
        };
      });
    return {
      widgets,
      hidden: hidden.filter((k) => byKey.has(k)),
      available: ok.map((w) => ({ key: w.key, title: title(w) })),
    };
  }

  async layout(ctx: RequestContext): Promise<Layout> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const role = await this.role(c, ctx.user.id);
      const row = role ? await this.roleRow(c, role.code) : undefined;
      const locked = !!row?.locked;
      const mine = locked
        ? undefined
        : (
            await c.query<{ widgets: unknown; hidden: unknown; quick_actions: unknown }>(
              `SELECT widgets, hidden, quick_actions FROM user_dashboards WHERE school_id = app.current_school_id() AND user_id = $1`,
              [ctx.user.id],
            )
          ).rows[0];
      const roleItems = asItems(row?.quick_actions);
      const byHref = new Map(roleItems.map((i) => [i.href, i]));
      const own = asList(mine?.quick_actions);
      return {
        role: role?.code ?? null,
        roleName: role?.name ?? null,
        ...DashboardService.compose(role?.code ?? null, row, ctx.permissions, {
          widgets: asList(mine?.widgets),
          hidden: asList(mine?.hidden),
        }),
        // a user's own pins keep the school's labels; an outside link only while the role still has it
        quickActions: own.length
          ? own
              .filter((h) => !external(h) || byHref.has(h))
              .map((h) => byHref.get(h) ?? { href: h })
          : roleItems,
        links: roleItems.filter((i) => external(i.href)),
        locked,
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
      const role = await this.role(c, ctx.user.id);
      if (role && (await this.roleRow(c, role.code))?.locked)
        throw new DomainError(
          'dashboard.locked',
          'The school has set this page for your role; it cannot be arranged',
          { status: 409 },
        );
      await c.query(
        `INSERT INTO user_dashboards (school_id, user_id, widgets, hidden, quick_actions)
         VALUES (app.current_school_id(), $1, $2::jsonb, $3::jsonb, $4::jsonb)
         ON CONFLICT (school_id, user_id) DO UPDATE SET widgets = EXCLUDED.widgets, hidden = EXCLUDED.hidden,
              quick_actions = EXCLUDED.quick_actions, updated_at = now()`,
        [
          ctx.user.id,
          JSON.stringify(dto.widgets.filter((k) => known.has(k))),
          JSON.stringify(dto.hidden.filter((k) => known.has(k))),
          JSON.stringify(dto.quickActions.slice(0, 12)),
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

  /** The roles that can have a landing: the built-in ones and the school's own (Access). */
  private async roles(c: PoolClient) {
    const r = await c.query<{ code: string; name: string; own: boolean }>(
      `SELECT DISTINCT ON (code) code, name, school_id IS NOT NULL AS own FROM roles
        WHERE deleted_at IS NULL AND status = 'active'
          AND ((school_id IS NULL AND code = ANY ($1::text[])) OR school_id = app.current_school_id())
        ORDER BY code, school_id NULLS LAST`,
      [Object.keys(ROLE_DEFAULTS)],
    );
    const human = (code: string) => code.replace(/_/g, ' ').replace(/^./, (x) => x.toUpperCase());
    const builtIn = Object.keys(ROLE_DEFAULTS).map((code) => ({
      code,
      name: r.rows.find((n) => n.code === code)?.name ?? human(code),
      builtIn: true,
    }));
    const own = r.rows
      .filter((x) => x.own && !ROLE_DEFAULTS[x.code] && !NO_LANDING.has(x.code))
      .map((x) => ({ code: x.code, name: x.name, builtIn: false }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return [...builtIn, ...own];
  }

  private async mustRole(c: PoolClient, code: string) {
    const role = (await this.roles(c)).find((r) => r.code === code);
    if (!role) throw new DomainError('not-found', 'No landing page for this role', { status: 404 });
    return role;
  }

  /** The roles the school can set a landing for, with what each has now. */
  async defaults(ctx: RequestContext) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const rows = await c.query<RoleRow & { role_code: string }>(
        `SELECT role_code, widgets, quick_actions, settings, locked FROM dashboard_role_defaults
          WHERE school_id = app.current_school_id()`,
      );
      const users = await c.query<{ code: string; users: number; personal: number }>(
        `SELECT r.code, count(DISTINCT ur.user_id)::int AS users,
                count(DISTINCT ud.user_id)::int AS personal
           FROM user_roles ur JOIN roles r ON r.id = ur.role_id
           LEFT JOIN user_dashboards ud ON ud.school_id = ur.school_id AND ud.user_id = ur.user_id
          WHERE ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL
            AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)
          GROUP BY r.code`,
      );
      return {
        widgets: WIDGETS.map(({ key, title, wide, days, count }) => ({
          key,
          title,
          wide: !!wide,
          ...(days ? { days } : {}),
          ...(count ? { count } : {}),
        })),
        roles: (await this.roles(c)).map((role) => {
          const own = rows.rows.find((x) => x.role_code === role.code);
          const u = users.rows.find((x) => x.code === role.code);
          return {
            ...role,
            widgets: asList(own?.widgets).length
              ? asList(own?.widgets)
              : (ROLE_DEFAULTS[role.code] ?? FALLBACK),
            quickActions: asItems(own?.quick_actions),
            settings: asSettings(own?.settings),
            locked: !!own?.locked,
            custom: !!own,
            users: u?.users ?? 0,
            personal: u?.personal ?? 0,
          };
        }),
      };
    });
  }

  async saveDefaults(
    ctx: RequestContext,
    role: string,
    dto: {
      widgets: string[];
      quickActions: Array<string | QuickItem>;
      settings: Settings;
      locked: boolean;
    },
  ) {
    const byKey = new Map(WIDGETS.map((w) => [w.key, w]));
    const settings: Settings = {};
    for (const [key, s] of Object.entries(dto.settings)) {
      const w = byKey.get(key);
      if (!w) continue;
      const out: WidgetSetting = {};
      if (s.title?.trim() && s.title.trim() !== w.title) out.title = s.title.trim();
      if (s.size && s.size !== (w.wide ? 'wide' : 'normal')) out.size = s.size;
      if (w.days && s.days !== undefined && s.days !== w.days[2]) out.days = clamp(s.days, w.days);
      if (w.count && s.count !== undefined && s.count !== w.count[2])
        out.count = clamp(s.count, w.count);
      if (Object.keys(out).length) settings[key] = out;
    }
    const seen = new Set<string>();
    const quick: QuickItem[] = [];
    for (const q of dto.quickActions.map((x) => (typeof x === 'string' ? { href: x } : x))) {
      if (seen.has(q.href)) continue;
      seen.add(q.href);
      quick.push({
        href: q.href,
        ...(q.label?.trim() ? { label: q.label.trim() } : {}),
        ...(q.icon ? { icon: q.icon } : {}),
      });
    }
    if (quick.some((q) => external(q.href) && !q.label))
      throw new DomainError('validation', 'A link outside EduPro needs a name', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustRole(c, role);
      const widgets = [...new Set(dto.widgets.filter((k) => byKey.has(k)))];
      await this.upsert(c, role, { widgets, quick, settings, locked: dto.locked });
      await this.audit.stage(ctx, c, {
        action: 'dashboard.defaults.save',
        entityType: 'dashboard_role_defaults',
        entityId: role,
        after: { widgets, quickActions: quick, settings, locked: dto.locked },
      });
      return { ok: true };
    });
  }

  private async upsert(
    c: PoolClient,
    role: string,
    v: { widgets: string[]; quick: QuickItem[]; settings: Settings; locked: boolean },
  ) {
    await c.query(
      `INSERT INTO dashboard_role_defaults (school_id, role_code, widgets, quick_actions, settings, locked, updated_by)
       VALUES (app.current_school_id(), $1, $2::jsonb, $3::jsonb, $4::jsonb, $5, app.current_user_id())
       ON CONFLICT (school_id, role_code) DO UPDATE SET widgets = EXCLUDED.widgets,
            quick_actions = EXCLUDED.quick_actions, settings = EXCLUDED.settings, locked = EXCLUDED.locked,
            updated_at = now(), updated_by = app.current_user_id()`,
      [
        role,
        JSON.stringify(v.widgets),
        JSON.stringify(v.quick),
        JSON.stringify(v.settings),
        v.locked,
      ],
    );
  }

  /** Copy another role's page (the school's settings, or the built-in page) to this role. */
  async copyDefaults(ctx: RequestContext, role: string, from: string) {
    if (role === from)
      throw new DomainError('validation', 'Pick another role to copy from', { status: 400 });
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustRole(c, role);
      await this.mustRole(c, from);
      const src = await this.roleRow(c, from);
      const v = {
        widgets: asList(src?.widgets).length
          ? asList(src?.widgets)
          : (ROLE_DEFAULTS[from] ?? FALLBACK),
        quick: asItems(src?.quick_actions),
        settings: asSettings(src?.settings),
        locked: !!src?.locked,
      };
      await this.upsert(c, role, v);
      await this.audit.stage(ctx, c, {
        action: 'dashboard.defaults.copy',
        entityType: 'dashboard_role_defaults',
        entityId: role,
        after: { from, ...v },
      });
      return { ok: true };
    });
  }

  /** Back to the built-in page of the role (a school role: the common page). */
  async removeDefaults(ctx: RequestContext, role: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustRole(c, role);
      const before = await this.roleRow(c, role);
      await c.query(
        `DELETE FROM dashboard_role_defaults WHERE school_id = app.current_school_id() AND role_code = $1`,
        [role],
      );
      await this.audit.stage(ctx, c, {
        action: 'dashboard.defaults.remove',
        entityType: 'dashboard_role_defaults',
        entityId: role,
        before: before ?? null,
        after: null,
      });
      return { ok: true };
    });
  }

  /** Push the role's page to its users: their own arrangements are dropped. */
  async applyDefaults(ctx: RequestContext, role: string) {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      await this.mustRole(c, role);
      const r = await c.query(
        `DELETE FROM user_dashboards ud
          WHERE ud.school_id = app.current_school_id()
            AND ud.user_id IN (SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                                WHERE ur.school_id = app.current_school_id() AND r.code = $1
                                  AND ur.revoked_at IS NULL)`,
        [role],
      );
      await this.audit.stage(ctx, c, {
        action: 'dashboard.defaults.apply',
        entityType: 'dashboard_role_defaults',
        entityId: role,
        after: { cleared: r.rowCount ?? 0 },
      });
      return { ok: true, cleared: r.rowCount ?? 0 };
    });
  }

  /** The page a role lands on, as its permissions show it (no one's own arrangement). */
  async preview(ctx: RequestContext, role: string): Promise<Layout & { permissions: string[] }> {
    return this.db.tenant(requireTenant(ctx), async (c) => {
      const info = await this.mustRole(c, role);
      const perms = (
        await c.query<{ code: string }>(
          `SELECT DISTINCT rp.permission_code AS code FROM role_permissions rp JOIN roles r ON r.id = rp.role_id
            WHERE r.code = $1 AND r.deleted_at IS NULL
              AND (r.school_id IS NULL OR r.school_id = app.current_school_id())`,
          [role],
        )
      ).rows.map((x) => x.code);
      const row = await this.roleRow(c, role);
      const items = asItems(row?.quick_actions);
      return {
        role,
        roleName: info.name,
        ...DashboardService.compose(role, row, new Set(perms)),
        quickActions: items,
        links: items.filter((i) => external(i.href)),
        locked: !!row?.locked,
        personal: false,
        permissions: perms,
      };
    });
  }

  /** One widget's data, when the user may see it. */
  async widget(ctx: RequestContext, key: string, days?: number) {
    const w = WIDGETS.find((x) => x.key === key);
    if (!w || !DashboardService.allowed(ctx.permissions, w))
      throw new DomainError('not-found', 'No such widget', { status: 404 });
    return this.widgets.data(ctx, key, w.days && days ? clamp(days, w.days) : undefined);
  }
}
