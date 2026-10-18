import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly, Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PortalAsDto, PortalHandoffDto, PortalLoginDto } from './access.dto';
import { ACCESS } from './access.permissions';
import { PortalAsService } from './portal-as.service';

/** Open the parent portal or the teacher app as someone (docs/design/31-portal-view-as.md). */
@ApiTags('access')
@ApiBearerAuth()
@Controller('access/portal-as')
export class PortalAsController {
  constructor(private readonly svc: PortalAsService) {}

  @Get('student/:id')
  @ApiOperation({ summary: 'The student and each parent the parent portal can be opened as' })
  @RequirePermission(ACCESS.portalViewAs)
  student(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.forStudent(ctx, id);
  }

  @Get('employee/:id')
  @ApiOperation({ summary: 'The employee the teacher app can be opened as' })
  @RequirePermission(ACCESS.portalViewAs)
  employee(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.forEmployee(ctx, id);
  }

  @Post('login')
  @ApiOperation({ summary: 'Make a portal login for a student, parent or employee who has none' })
  @RequirePermission(ACCESS.portalViewAs)
  login(@ReqCtx() ctx: RequestContext, @Body() body: PortalLoginDto) {
    return this.svc.makeLogin(ctx, body);
  }

  @Post()
  @ApiOperation({
    summary: 'Start a session as them (view only or acting) and get the portal link',
  })
  @RequirePermission(ACCESS.portalViewAs)
  open(@ReqCtx() ctx: RequestContext, @Body() body: PortalAsDto) {
    return this.svc.open(ctx, body);
  }

  @Post('handoff')
  @HttpCode(200)
  @Public()
  @ApiOperation({ summary: 'The portal hands in the one-time code for the session token' })
  handoff(@Body() body: PortalHandoffDto) {
    return this.svc.take(body);
  }

  @Post('end')
  @HttpCode(200)
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'End the portal session this request runs under' })
  end(@ReqCtx() ctx: RequestContext) {
    return this.svc.endSelf(ctx);
  }
}
