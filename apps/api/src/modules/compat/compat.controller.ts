import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { AuthenticatedOnly, Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { HandshakeDto } from './compat.dto';
import { CompatService } from './compat.service';

/**
 * Compatibility routes keep the legacy paths and envelopes (WP14). Everything after the handshake requires
 * the app session token; the school comes from the token, so the apps send no X-School-Id header.
 */
@ApiTags('compat')
@Controller('compat/v1')
export class CompatController {
  constructor(private readonly compat: CompatService) {}

  @Post('auth/handshake')
  @HttpCode(200)
  @Public()
  @ApiOperation({
    summary:
      'Exchange the central auth token of the current apps for an app session (legacy envelope)',
  })
  handshake(@Body() body: HandshakeDto, @Req() req: FastifyRequest) {
    return this.compat.handshake(body, { ip: req.ip, userAgent: req.headers['user-agent'] });
  }

  @Get('student/GetMenuDetail')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Student app menu in the legacy { items } shape' })
  menu(@ReqCtx() ctx: RequestContext) {
    return this.compat.menu(ctx);
  }

  @Get('student/GetSchoolConfig')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'School configuration in the legacy { items } shape' })
  schoolConfig(@ReqCtx() ctx: RequestContext) {
    return this.compat.schoolConfig(ctx);
  }

  @Get('teacher/get_module_permissions')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Teacher app module matrix and the caller teacher types' })
  modulePermissions(@ReqCtx() ctx: RequestContext) {
    return this.compat.modulePermissions(ctx);
  }
}
