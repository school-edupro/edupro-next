import { Body, Controller, Delete, Get, Param, Put } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error';
import { requireTenant } from '../../common/http/request-context';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly, TenantOptional } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AccessService } from '../access/access.service';
import { DbService } from '../../common/db/db.service';

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
  ) {}

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
