import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { CopyDto, DefaultsDto, LayoutDto, WishDto } from './dashboard.dto';
import { DashboardWidgetsService } from './dashboard-widgets.service';
import { DashboardService } from './dashboard.service';

/** The admin landing page by role (docs/design/26-admin-landing.md). */
@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly dash: DashboardService,
    private readonly widgets: DashboardWidgetsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      "The user's landing: role, widgets in order (permission-checked), hidden, quick actions",
  })
  @AuthenticatedOnly()
  layout(@ReqCtx() ctx: RequestContext) {
    return this.dash.layout(ctx);
  }

  @Put('layout')
  @ApiOperation({
    summary: "Save the user's own widget order, hidden widgets and pinned quick actions",
  })
  @AuthenticatedOnly()
  saveLayout(@ReqCtx() ctx: RequestContext, @Body() dto: LayoutDto) {
    return this.dash.saveLayout(ctx, dto);
  }

  @Delete('layout')
  @ApiOperation({ summary: "Back to the role's landing" })
  @AuthenticatedOnly()
  resetLayout(@ReqCtx() ctx: RequestContext) {
    return this.dash.resetLayout(ctx);
  }

  @Get('defaults')
  @RequirePermission('platform.dashboard.manage')
  defaults(@ReqCtx() ctx: RequestContext) {
    return this.dash.defaults(ctx);
  }

  @Put('defaults/:role')
  @ApiOperation({ summary: "Set a role's landing widgets and quick actions for the school" })
  @RequirePermission('platform.dashboard.manage')
  saveDefaults(
    @ReqCtx() ctx: RequestContext,
    @Param('role') role: string,
    @Body() dto: DefaultsDto,
  ) {
    return this.dash.saveDefaults(ctx, role, dto);
  }

  @Delete('defaults/:role')
  @ApiOperation({ summary: 'Back to the built-in landing of a role' })
  @RequirePermission('platform.dashboard.manage')
  removeDefaults(@ReqCtx() ctx: RequestContext, @Param('role') role: string) {
    return this.dash.removeDefaults(ctx, role);
  }

  @Post('defaults/:role/copy')
  @ApiOperation({ summary: "Copy another role's landing to this role" })
  @RequirePermission('platform.dashboard.manage')
  copyDefaults(@ReqCtx() ctx: RequestContext, @Param('role') role: string, @Body() dto: CopyDto) {
    return this.dash.copyDefaults(ctx, role, dto.from);
  }

  @Post('defaults/:role/apply')
  @ApiOperation({ summary: "Push a role's landing to its users (drops their own arrangement)" })
  @RequirePermission('platform.dashboard.manage')
  applyDefaults(@ReqCtx() ctx: RequestContext, @Param('role') role: string) {
    return this.dash.applyDefaults(ctx, role);
  }

  @Get('preview/:role')
  @ApiOperation({ summary: 'The landing of a role as its permissions show it' })
  @RequirePermission('platform.dashboard.manage')
  preview(@ReqCtx() ctx: RequestContext, @Param('role') role: string) {
    return this.dash.preview(ctx, role);
  }

  @Get('w/:key')
  @ApiOperation({
    summary: 'The data of one widget the user may see (birthdays; the rest read their modules)',
  })
  @AuthenticatedOnly()
  widget(@ReqCtx() ctx: RequestContext, @Param('key') key: string, @Query('days') days?: string) {
    const n = Number(days);
    return this.dash.widget(ctx, key, Number.isFinite(n) && n > 0 ? n : undefined);
  }

  @Post('wish')
  @ApiOperation({
    summary:
      'Wish a pupil or a member of staff a happy birthday (app, and SMS / WhatsApp when ready)',
  })
  @RequirePermission('people.birthday.wish')
  wish(@ReqCtx() ctx: RequestContext, @Body() dto: WishDto) {
    return this.widgets.wish(ctx, dto);
  }
}
