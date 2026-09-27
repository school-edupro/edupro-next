import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import {
  ApplyPromotionsDto,
  CancelDto,
  ClearanceDto,
  IssueTcDto,
  LIFECYCLE,
  ListPromotionsQueryDto,
  ListTcQueryDto,
  ListWithdrawalsQueryDto,
  RequestWithdrawalDto,
  SetPromotionsDto,
  YearSectionsQueryDto,
} from './lifecycle.dto';
import { PromotionsService } from './promotions.service';
import { TcService } from './tc.service';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('people')
@ApiBearerAuth()
@Controller('people')
export class LifecycleController {
  constructor(
    private readonly tc: TcService,
    private readonly withdrawals: WithdrawalsService,
    private readonly promotions: PromotionsService,
  ) {}

  // ---- transfer certificates --------------------------------------------------------------------
  @Get('tc')
  @ApiOperation({ summary: 'Transfer certificates issued by the school' })
  @RequirePermission(LIFECYCLE.tcView, { description: 'View transfer certificates' })
  async listTc(@ReqCtx() ctx: RequestContext, @Query() q: ListTcQueryDto) {
    const { rows, total } = await this.tc.list(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('tc/:id')
  @RequirePermission(LIFECYCLE.tcView)
  getTc(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.tc.get(ctx, id);
  }

  @Get('students/:id/tc')
  @RequirePermission(LIFECYCLE.tcView)
  async tcOfStudent(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.tc.forStudent(ctx, id) };
  }

  @Post('students/:id/tc')
  @ApiOperation({
    summary: 'Issue a transfer certificate (numbered, snapshot, PDF through the export centre)',
  })
  @RequirePermission(LIFECYCLE.tcIssue, { description: 'Issue and cancel transfer certificates' })
  issueTc(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: IssueTcDto) {
    return this.tc.issue(ctx, id, body);
  }

  @Post('tc/:id/render')
  @ApiOperation({ summary: 'Queue (again) the PDF of a transfer certificate' })
  @RequirePermission(LIFECYCLE.tcIssue)
  renderTc(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.tc.render(ctx, id);
  }

  @Post('tc/:id/cancel')
  @RequirePermission(LIFECYCLE.tcIssue)
  cancelTc(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CancelDto) {
    return this.tc.cancel(ctx, id, body);
  }

  // ---- withdrawals ------------------------------------------------------------------------------
  @Get('withdrawals')
  @ApiOperation({ summary: 'Withdrawal requests with their department clearances' })
  @RequirePermission(LIFECYCLE.withdrawalView, {
    description: 'View withdrawal requests and clearances',
  })
  async listWithdrawals(@ReqCtx() ctx: RequestContext, @Query() q: ListWithdrawalsQueryDto) {
    const { rows, total } = await this.withdrawals.list(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('withdrawals/:id')
  @RequirePermission(LIFECYCLE.withdrawalView)
  getWithdrawal(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.withdrawals.get(ctx, id);
  }

  @Get('students/:id/withdrawals')
  @RequirePermission(LIFECYCLE.withdrawalView)
  async withdrawalsOfStudent(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.withdrawals.forStudent(ctx, id) };
  }

  @Post('students/:id/withdrawal')
  @ApiOperation({ summary: 'Step 1: request a withdrawal; one clearance per department is opened' })
  @RequirePermission(LIFECYCLE.withdrawalManage, {
    description: 'Request, complete and cancel withdrawals',
  })
  requestWithdrawal(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: RequestWithdrawalDto,
  ) {
    return this.withdrawals.request(ctx, id, body);
  }

  @Put('withdrawals/:id/clearances/:department')
  @ApiOperation({ summary: 'Record a department clearance (cleared, hold or pending)' })
  @RequirePermission(LIFECYCLE.withdrawalClear, {
    description: 'Record a department clearance on a withdrawal',
  })
  clearance(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('department') department: string,
    @Body() body: ClearanceDto,
  ) {
    return this.withdrawals.clearance(ctx, id, department, body);
  }

  @Post('withdrawals/:id/complete')
  @ApiOperation({ summary: 'Step 2: complete; refused until every department has cleared' })
  @RequirePermission(LIFECYCLE.withdrawalManage)
  complete(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.withdrawals.complete(ctx, id);
  }

  @Post('withdrawals/:id/cancel')
  @RequirePermission(LIFECYCLE.withdrawalManage)
  cancelWithdrawal(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CancelDto,
  ) {
    return this.withdrawals.cancel(ctx, id, body);
  }

  // ---- promotions -------------------------------------------------------------------------------
  @Get('promotions')
  @ApiOperation({
    summary: 'Students of a class in the source year with their promotion decisions',
  })
  @RequirePermission(LIFECYCLE.promotionView, { description: 'View promotion decisions' })
  async listPromotions(@ReqCtx() ctx: RequestContext, @Query() q: ListPromotionsQueryDto) {
    return { data: await this.promotions.list(ctx, q) };
  }

  @Get('promotions/sections')
  @ApiOperation({ summary: 'Sections of a target year' })
  @RequirePermission(LIFECYCLE.promotionView)
  async yearSections(@ReqCtx() ctx: RequestContext, @Query() q: YearSectionsQueryDto) {
    return { data: await this.promotions.sectionsOfYear(ctx, q) };
  }

  @Put('promotions')
  @ApiOperation({
    summary: 'Record decisions (promote, retain, transfer out, graduate) for students',
  })
  @RequirePermission(LIFECYCLE.promotionManage, {
    description: 'Record and apply promotion decisions',
  })
  setPromotions(@ReqCtx() ctx: RequestContext, @Body() body: SetPromotionsDto) {
    return this.promotions.set(ctx, body);
  }

  @Post('promotions/apply')
  @ApiOperation({ summary: 'Apply pending decisions into next-year enrolments' })
  @RequirePermission(LIFECYCLE.promotionManage)
  apply(@ReqCtx() ctx: RequestContext, @Body() body: ApplyPromotionsDto) {
    return this.promotions.apply(ctx, body);
  }
}
