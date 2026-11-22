import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import {
  ReqCtx,
  type ContextualRequest,
  type RequestContext,
} from '../../common/http/request-context';
import { PLATFORM } from './platform.permissions';
import { StaffLayoutDto, StaffShortcutsDto } from './staff-layout.dto';
import { StaffLayoutService } from './staff-layout.service';

/**
 * The staff app's layout kept by the school (0413, docs/design/94): the office's draft, preview and publish on System
 * settings (`platform/staff-app-layout`, the settings rights); a staff member's own layout and Home shortcuts
 * (`me/staff-layout`).
 */
@ApiTags('platform')
@ApiBearerAuth()
@Controller()
export class StaffLayoutController {
  constructor(private readonly layouts: StaffLayoutService) {}

  // ---- staff

  @Get('me/staff-layout')
  @ApiOperation({
    summary: 'My staff app layout: tabs, Home shortcuts (mine or the school’s), Home cards',
  })
  @AuthenticatedOnly()
  mine(@ReqCtx() ctx: RequestContext, @Req() req: ContextualRequest) {
    return this.layouts.mine(ctx, req);
  }

  @Put('me/staff-layout/shortcuts')
  @ApiOperation({ summary: 'My own staff Home shortcuts (4 to 12 screens I can open)' })
  @AuthenticatedOnly()
  saveMine(
    @ReqCtx() ctx: RequestContext,
    @Req() req: ContextualRequest,
    @Body() dto: StaffShortcutsDto,
  ) {
    return this.layouts.saveMine(ctx, req, dto.shortcuts);
  }

  @Delete('me/staff-layout/shortcuts')
  @ApiOperation({ summary: 'Back to the school’s staff Home shortcuts' })
  @AuthenticatedOnly()
  resetMine(@ReqCtx() ctx: RequestContext, @Req() req: ContextualRequest) {
    return this.layouts.resetMine(ctx, req);
  }

  // ---- System settings

  @Get('platform/staff-app-layout')
  @ApiOperation({ summary: 'The staff app layout: draft, published, catalogue' })
  @RequirePermission(PLATFORM.settingsView)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.layouts.setup(ctx);
  }

  @Put('platform/staff-app-layout')
  @ApiOperation({ summary: 'Save the draft staff layout (staff get it when it is published)' })
  @RequirePermission(PLATFORM.settingsEdit)
  save(@ReqCtx() ctx: RequestContext, @Body() dto: StaffLayoutDto) {
    return this.layouts.saveDraft(ctx, dto);
  }

  @Post('platform/staff-app-layout/publish')
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish the draft staff layout' })
  @RequirePermission(PLATFORM.settingsEdit)
  publish(@ReqCtx() ctx: RequestContext) {
    return this.layouts.publish(ctx);
  }

  @Post('platform/staff-app-layout/discard')
  @HttpCode(200)
  @ApiOperation({ summary: 'Discard the draft staff layout: back to the published one' })
  @RequirePermission(PLATFORM.settingsEdit)
  discard(@ReqCtx() ctx: RequestContext) {
    return this.layouts.discard(ctx);
  }
}
