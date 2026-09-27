import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, requireTenant, type RequestContext } from '../../common/http/request-context';
import { SecurityEventsService } from '../../common/security/security-events.service';
import { BreakGlassDto, StartImpersonationDto } from './access.dto';
import { ACCESS } from './access.permissions';
import { BreakGlassService } from './break-glass.service';
import { ImpersonationService } from './impersonation.service';

const SECURITY_VIEW = 'platform.security.view';

@ApiTags('access')
@ApiBearerAuth()
@Controller('access')
export class AccessSecurityController {
  constructor(
    private readonly impersonation: ImpersonationService,
    private readonly breakGlass: BreakGlassService,
    private readonly security: SecurityEventsService,
  ) {}

  @Post('impersonation')
  @ApiOperation({ summary: 'Start acting as another member for a short, reasoned window (MFA)' })
  @RequirePermission(ACCESS.impersonate, {
    mfa: true,
    description: 'Start an impersonation session',
  })
  start(@ReqCtx() ctx: RequestContext, @Body() body: StartImpersonationDto) {
    return this.impersonation.start(ctx, body);
  }

  @Delete('impersonation/:id')
  @HttpCode(200)
  @RequirePermission(ACCESS.impersonate, { mfa: true })
  end(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.impersonation.end(ctx, id);
  }

  @Get('impersonation')
  @RequirePermission(SECURITY_VIEW, {
    description: 'View security alerts, impersonation and break-glass activity',
  })
  async listImpersonation(@ReqCtx() ctx: RequestContext, @Query('active') active?: string) {
    return { data: await this.impersonation.list(requireTenant(ctx), active === 'true') };
  }

  @Post('break-glass')
  @ApiOperation({
    summary:
      'Emergency self-grant of a template role for at most four hours (MFA, reason required)',
  })
  @RequirePermission(ACCESS.assignmentManage, { mfa: true })
  openBreakGlass(@ReqCtx() ctx: RequestContext, @Body() body: BreakGlassDto) {
    return this.breakGlass.start(ctx, body);
  }

  @Get('break-glass')
  @RequirePermission(SECURITY_VIEW)
  async listBreakGlass(@ReqCtx() ctx: RequestContext) {
    return { data: await this.breakGlass.list(requireTenant(ctx)) };
  }

  @Get('security/alerts')
  @ApiOperation({ summary: 'Recent security alerts raised by the in-process detector' })
  @RequirePermission(SECURITY_VIEW)
  alerts(@ReqCtx() ctx: RequestContext) {
    return { data: this.security.recentAlerts(requireTenant(ctx).schoolId) };
  }
}
