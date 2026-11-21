import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import { familyIcon, familyScreens, myFamilyLayout, screenIcon, staffScreens } from '@edupro/menus';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant } from '../../common/http/request-context';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly, TenantOptional } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AccessService } from '../access/access.service';
import { DbService } from '../../common/db/db.service';
import { ProfilesService } from './profiles.service';
import { FamilyLayoutService } from '../platform/family-layout.service';

/** How and where a sign-in happened (the web apps' BFF and the mobile app send it). */
const MeSignInSchema = z
  .object({
    method: z.enum(['oidc', 'otp', 'dev']).optional(),
    app: z.enum(['admin', 'parent', 'teacher', 'mobile']).optional(),
    userAgent: z.string().max(1000).optional(),
    ip: z.string().max(100).optional(),
  })
  .partial();
class MeSignInDto extends createZodDto(MeSignInSchema) {}

interface YearSummary {
  id: string;
  code: string;
  name: string;
  status: string;
  startDate: string;
  endDate: string;
}

/**
 * GET /api/v1/me: identity, memberships, selected school and year, effective permissions.
 * The front ends build navigation from `permissions` (ADR-004 point 10).
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly access: AccessService,
    private readonly db: DbService,
    private readonly profilesOf: ProfilesService,
    private readonly layouts: FamilyLayoutService,
  ) {}

  /** The mobile app's profiles (docs/design/89): each school as staff, as the parent of each child, as a student. */
  @Get('profiles')
  @ApiOperation({
    summary: 'My profiles for the mobile app: staff of a school, parent of each child, student',
  })
  @AuthenticatedOnly()
  @TenantOptional()
  profiles(@ReqCtx() ctx: RequestContext) {
    return this.profilesOf.profiles(ctx);
  }

  /**
   * The mobile app's menu for a profile (docs/design/89): the same screens the staff or the parent / student web
   * app shows this person in the school (`X-School-Id`), each with the web page it opens.
   */
  @Get('menu')
  @ApiOperation({
    summary: "My menu in the school for a profile kind (the web apps' screens, by my rights)",
  })
  @AuthenticatedOnly()
  async menu(@ReqCtx() ctx: RequestContext, @Query('kind') kind?: string) {
    const tenant = requireTenant(ctx);
    const permissions = [...(await this.access.effectivePermissions(tenant))];
    if (kind === 'staff')
      return {
        app: 'teacher',
        groups: staffScreens(permissions).map((g) => ({
          id: g.id,
          label: g.label,
          icon: g.icon,
          items: g.items.map((i) => ({
            href: i.href,
            label: i.label,
            help: i.help,
            icon: screenIcon(i.href, g.icon),
          })),
        })),
      };
    if (kind === 'parent' || kind === 'student') {
      // the school's published side menu (docs/design/90): its groups, names and order; else as built
      const published = await this.layouts.published(ctx, kind);
      if (published)
        return {
          app: 'parent',
          groups: [
            {
              id: 'home',
              label: 'Home',
              labelHi: null,
              icon: 'home',
              items: [{ href: '/', label: 'Home', help: null, icon: 'home' }],
            },
            ...myFamilyLayout(kind, permissions, published, null).menu.map((g) => ({
              id: g.key,
              label: g.label,
              labelHi: g.labelHi,
              icon: g.icon,
              items: g.items.map((i) => ({
                href: i.href,
                label: i.label,
                help: null,
                icon: i.icon,
              })),
            })),
          ],
        };
      return {
        app: 'parent',
        groups: familyScreens(kind, permissions).map((g) => ({
          id: g.section,
          label: g.label[kind],
          icon: g.icon,
          items: g.items.map((i) => ({
            href: i.href,
            label: i.label,
            help: null,
            icon: familyIcon(i.href, g.icon),
          })),
        })),
      };
    }
    throw new DomainError('validation-failed', 'kind is staff, parent or student', { status: 400 });
  }

  @Get()
  @ApiOperation({
    summary: 'Current user, memberships, active school and year, effective permissions',
  })
  @AuthenticatedOnly()
  @TenantOptional()
  async me(@ReqCtx() ctx: RequestContext) {
    const permissions = ctx.tenant
      ? [...(await this.access.effectivePermissions(ctx.tenant))].sort()
      : [];
    // Every signed-in member may see the school's open years, so the apps can offer a year switch
    // without `platform.year.view`; planned years are excluded because the tenant guard refuses them.
    const years: YearSummary[] = ctx.tenant
      ? await this.db.tenant(ctx.tenant, async (c) => {
          const r = await c.query<YearSummary>(
            `SELECT id::text, code, name, status::text, start_date::text AS "startDate", end_date::text AS "endDate"
               FROM academic_years WHERE status <> 'planned' ORDER BY start_date DESC`,
          );
          return r.rows;
        })
      : [];
    const current = years.find((y) => y.id === ctx.tenant?.academicYearId) ?? null;
    return {
      user: {
        id: ctx.user.id,
        displayName: ctx.user.displayName,
        mfa: ctx.user.mfa,
      },
      impersonation: ctx.user.impersonation ?? null,
      memberships: ctx.user.memberships,
      school: ctx.tenant ? { id: ctx.tenant.schoolId } : null,
      academicYear: ctx.tenant?.academicYearId
        ? {
            id: ctx.tenant.academicYearId,
            code: current?.code ?? null,
            status: current?.status ?? null,
          }
        : null,
      academicYears: years,
      permissions,
    };
  }

  /**
   * The apps call this right after a sign-in so "last login" can be shown: the time, the app and the
   * browser are recorded in login_events.
   */
  @Post('sign-in')
  @HttpCode(204)
  @AuthenticatedOnly()
  @TenantOptional()
  async signIn(@ReqCtx() ctx: RequestContext, @Body() body: MeSignInDto) {
    const method = body?.method === 'dev' ? 'dev' : body?.method === 'otp' ? 'otp' : 'oidc';
    const app = ['admin', 'parent', 'teacher', 'mobile'].includes(String(body?.app))
      ? String(body?.app)
      : 'admin';
    const ip =
      typeof body?.ip === 'string' && /^[0-9a-fA-F:.]{3,45}$/.test(body.ip) ? body.ip : null;
    await this.db.global((c) =>
      c.query(
        `INSERT INTO login_events (user_id, school_id, method, outcome, ip, user_agent, detail)
         VALUES ($1, $2, $3::login_method, 'success', $4::inet, $5, $6::jsonb)`,
        [
          ctx.user.id,
          ctx.tenant?.schoolId ?? ctx.user.memberships[0]?.schoolId ?? null,
          method,
          ip,
          typeof body?.userAgent === 'string' ? body.userAgent.slice(0, 300) : null,
          JSON.stringify({ app }),
        ],
      ),
    );
  }

  /** The header's user card: name, roles, school and year, mobile / email, this and the last sign-in. */
  @Get('card')
  @AuthenticatedOnly()
  async card(@ReqCtx() ctx: RequestContext) {
    const tenant = requireTenant(ctx);
    const info = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{
        roles: string[] | null;
        school: string | null;
        year: string | null;
        mobile: string | null;
        email: string | null;
        designation: string | null;
      }>(
        // the roles, the one that says most first (the header shows it with "+N" for the rest)
        `SELECT (SELECT array_agg(x.name ORDER BY x.rank, x.name) FROM (
                   SELECT DISTINCT r.name,
                          CASE r.code WHEN 'group_admin' THEN 0 WHEN 'school_admin' THEN 1 WHEN 'principal' THEN 2
                                      WHEN 'vice_principal' THEN 3 WHEN 'academic_coordinator' THEN 4 ELSE 9 END AS rank
                     FROM user_roles ur JOIN roles r ON r.id = ur.role_id
                    WHERE ur.user_id = app.current_user_id() AND ur.school_id = app.current_school_id() AND ur.revoked_at IS NULL
                      AND ur.valid_from <= CURRENT_DATE AND (ur.valid_to IS NULL OR ur.valid_to >= CURRENT_DATE)) x) AS roles,
                (SELECT name FROM schools WHERE id = app.current_school_id()) AS school,
                (SELECT name FROM academic_years WHERE id = app.current_academic_year_id()) AS year,
                COALESCE((SELECT e.mobile FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1), u.mobile) AS mobile,
                COALESCE((SELECT e.email::text FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1), u.email::text) AS email,
                (SELECT e.designation FROM employees e WHERE e.user_id = u.id AND e.deleted_at IS NULL LIMIT 1) AS designation
           FROM users u WHERE u.id = app.current_user_id()`,
      );
      return r.rows[0];
    });
    const logins = await this.db.tenant(tenant, (c) =>
      c.query<{ occurred_at: Date; user_agent: string | null; detail: { app?: string } }>(
        `SELECT occurred_at, user_agent, detail FROM login_events
          WHERE user_id = $1 AND outcome = 'success' AND method <> 'impersonation' ORDER BY occurred_at DESC LIMIT 2`,
        [ctx.user.id],
      ),
    );
    const device = (ua: string | null) => {
      if (!ua) return null;
      const browser = /Edg\//.test(ua)
        ? 'Edge'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Browser';
      const os = /Android/.test(ua)
        ? 'Android'
        : /iPhone|iPad/.test(ua)
          ? 'iOS'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Mac OS X/.test(ua)
              ? 'macOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : '';
      return os ? `${browser} on ${os}` : browser;
    };
    const login = (x?: {
      occurred_at: Date;
      user_agent: string | null;
      detail: { app?: string };
    }) =>
      x
        ? {
            at: x.occurred_at.toISOString(),
            device: device(x.user_agent),
            app: x.detail?.app ?? null,
          }
        : null;
    return {
      name: ctx.user.displayName,
      roles: info?.roles ?? [],
      designation: info?.designation ?? null,
      school: info?.school ?? null,
      academicYear: info?.year ?? null,
      mobile: info?.mobile ?? null,
      email: info?.email ?? null,
      thisLogin: login(logins.rows[0]),
      lastLogin: login(logins.rows[1]),
    };
  }

  // ---- per-user preferences (screen views), never shared with other users ------------------------
  private prefKey(key: string): string {
    if (!/^[a-z0-9_.-]{2,60}$/.test(key))
      throw new DomainError('validation-failed', 'Unknown preference', { status: 400 });
    return key;
  }

  @Get('preferences/:key')
  @ApiOperation({
    summary: "The signed-in user's saved preference for this school (null when none)",
  })
  @AuthenticatedOnly()
  async getPreference(@ReqCtx() ctx: RequestContext, @Param('key') key: string) {
    const k = this.prefKey(key);
    const tenant = requireTenant(ctx);
    const value = await this.db.tenant(tenant, async (c) => {
      const r = await c.query<{ value: unknown }>(
        'SELECT value FROM user_preferences WHERE user_id = $1 AND pref_key = $2',
        [ctx.user.id, k],
      );
      return r.rows[0]?.value ?? null;
    });
    return { key: k, value };
  }

  @Put('preferences/:key')
  @ApiOperation({ summary: "Save the signed-in user's preference for this school" })
  @AuthenticatedOnly()
  async putPreference(
    @ReqCtx() ctx: RequestContext,
    @Param('key') key: string,
    @Body() body: { value?: unknown },
  ) {
    const k = this.prefKey(key);
    const json = JSON.stringify(body?.value ?? null);
    if (json.length > 32_000)
      throw new DomainError('validation-failed', 'Preference too large', { status: 400 });
    const tenant = requireTenant(ctx);
    await this.db.tenant(tenant, (c) =>
      c.query(
        `INSERT INTO user_preferences (school_id, user_id, pref_key, value)
         VALUES (app.current_school_id(), $1, $2, $3::jsonb)
         ON CONFLICT (school_id, user_id, pref_key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [ctx.user.id, k, json],
      ),
    );
    return { key: k, saved: true };
  }

  @Delete('preferences/:key')
  @AuthenticatedOnly()
  async deletePreference(@ReqCtx() ctx: RequestContext, @Param('key') key: string) {
    const k = this.prefKey(key);
    await this.db.tenant(requireTenant(ctx), (c) =>
      c.query('DELETE FROM user_preferences WHERE user_id = $1 AND pref_key = $2', [
        ctx.user.id,
        k,
      ]),
    );
    return { key: k, deleted: true };
  }
}
