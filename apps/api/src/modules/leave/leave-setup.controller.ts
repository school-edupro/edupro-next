import { Body, Controller, Get, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { LeaveSetupService } from './leave-setup.service';
import {
  ApprovalRuleDto,
  BandLevelsDto,
  ChainPreviewDto,
  LEAVE,
  LeaveSettingsDto,
  RuleStatusDto,
} from './leave.dto';

/** Staff leave and attendance set-up (docs/design/85, phase A). */
@ApiTags('leave')
@ApiBearerAuth()
@Controller('leave/setup')
export class LeaveSetupController {
  constructor(private readonly setup: LeaveSetupService) {}

  @Get('overview')
  @ApiOperation({ summary: 'The set-up counts and what is missing or would misbehave' })
  @RequirePermission(LEAVE.setupView)
  overview(@ReqCtx() ctx: RequestContext) {
    return this.setup.overview(ctx);
  }

  @Get('approvals')
  @ApiOperation({ summary: 'Who approves: the rules by scope and leave type' })
  @RequirePermission(LEAVE.setupView)
  rules(@ReqCtx() ctx: RequestContext) {
    return this.setup.rules(ctx);
  }

  @Get('approvals/preview')
  @ApiOperation({ summary: 'Test the chain: who would approve for an employee, a type and days' })
  @RequirePermission(LEAVE.setupView)
  preview(@ReqCtx() ctx: RequestContext, @Query() q: ChainPreviewDto) {
    return this.setup.preview(ctx, q);
  }

  @Get('approvals/:id')
  @RequirePermission(LEAVE.setupView)
  rule(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.setup.rule(ctx, id);
  }

  @Post('approvals')
  @RequirePermission(LEAVE.setupManage)
  createRule(@ReqCtx() ctx: RequestContext, @Body() body: ApprovalRuleDto) {
    return this.setup.createRule(ctx, body);
  }

  @Put('approvals/:id')
  @RequirePermission(LEAVE.setupManage)
  updateRule(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: ApprovalRuleDto,
  ) {
    return this.setup.updateRule(ctx, id, body);
  }

  @Put('approvals/:id/bands/:band')
  @ApiOperation({ summary: 'The levels of one day band (up to 3)' })
  @RequirePermission(LEAVE.setupManage)
  setBand(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('band', ParseIntPipe) band: number,
    @Body() body: BandLevelsDto,
  ) {
    return this.setup.setBand(ctx, id, band, body);
  }

  @Post('approvals/:id/status')
  @RequirePermission(LEAVE.setupManage)
  setStatus(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: RuleStatusDto) {
    return this.setup.setStatus(ctx, id, body);
  }

  @Get('settings')
  @RequirePermission(LEAVE.setupView)
  settings(@ReqCtx() ctx: RequestContext) {
    return this.setup.settings(ctx);
  }

  @Put('settings')
  @RequirePermission(LEAVE.setupManage)
  saveSettings(@ReqCtx() ctx: RequestContext, @Body() body: LeaveSettingsDto) {
    return this.setup.saveSettings(ctx, body);
  }
}
