import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthenticatedOnly, TenantOptional } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AccessService } from '../access/access.service';

/**
 * GET /api/v1/me: identity, memberships, selected school and year, effective permissions.
 * The front ends build navigation from `permissions` (ADR-004 point 10).
 */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly access: AccessService) {}

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
    return {
      user: {
        id: ctx.user.id,
        displayName: ctx.user.displayName,
        mfa: ctx.user.mfa,
      },
      memberships: ctx.user.memberships,
      school: ctx.tenant ? { id: ctx.tenant.schoolId } : null,
      academicYear: ctx.tenant?.academicYearId ? { id: ctx.tenant.academicYearId } : null,
      permissions,
    };
  }
}
