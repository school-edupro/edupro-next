import { Controller, Get } from '@nestjs/common';
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
}
