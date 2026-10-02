import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../../common/http/request-context';
import {
  AcceptTransferDto,
  ApplyPromotionsDto,
  BulkClearanceDto,
  BulkTcDto,
  BulkWithdrawalDto,
  BypassDto,
  CancelDto,
  ClearanceDto,
  IssueTcDto,
  LIFECYCLE,
  ListPromotionsQueryDto,
  ListTcQueryDto,
  ListTransfersQueryDto,
  ListWithdrawalsQueryDto,
  RequestTransferDto,
  RequestWithdrawalDto,
  SaveDepartmentsDto,
  SetPromotionsDto,
  WithdrawalTcDto,
  YearSectionsQueryDto,
} from './lifecycle.dto';
import { PromotionsService } from './promotions.service';
import { TcService } from './tc.service';
import { TransfersService } from './transfers.service';
import { WithdrawalsService } from './withdrawals.service';

@ApiTags('people')
@ApiBearerAuth()
@Controller('people')
export class LifecycleController {
  constructor(
    private readonly tc: TcService,
    private readonly withdrawals: WithdrawalsService,
    private readonly promotions: PromotionsService,
    private readonly transfers: TransfersService,
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

  @Get('withdrawal-departments')
  @ApiOperation({ summary: 'Withdrawal departments: steps, approvers, checks, bypass, TC gate' })
  @RequirePermission(LIFECYCLE.withdrawalView)
  departments(@ReqCtx() ctx: RequestContext) {
    return this.withdrawals.departments(ctx);
  }

  @Put('withdrawal-departments')
  @ApiOperation({ summary: 'Save the withdrawal departments (left-out codes are switched off)' })
  @RequirePermission(LIFECYCLE.withdrawalManage)
  saveDepartments(@ReqCtx() ctx: RequestContext, @Body() body: SaveDepartmentsDto) {
    return this.withdrawals.saveDepartments(ctx, body);
  }

  @Post('withdrawals/bulk')
  @ApiOperation({ summary: 'Start withdrawals for many students with one leaving date and reason' })
  @RequirePermission(LIFECYCLE.withdrawalManage)
  bulkWithdrawal(@ReqCtx() ctx: RequestContext, @Body() body: BulkWithdrawalDto) {
    return this.withdrawals.bulkRequest(ctx, body);
  }

  @Post('withdrawals/clearances/bulk')
  @ApiOperation({ summary: 'One department clears (or holds) many withdrawals at once' })
  @RequirePermission(LIFECYCLE.withdrawalClear)
  bulkClearance(@ReqCtx() ctx: RequestContext, @Body() body: BulkClearanceDto) {
    return this.withdrawals.bulkClearance(ctx, body);
  }

  @Post('withdrawals/tc/bulk')
  @ApiOperation({ summary: 'Issue the TCs of many withdrawals whose TC gate has cleared' })
  @RequirePermission(LIFECYCLE.tcIssue)
  bulkTc(@ReqCtx() ctx: RequestContext, @Body() body: BulkTcDto) {
    return this.withdrawals.bulkTc(ctx, body);
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
  @ApiOperation({
    summary: 'Start a withdrawal; each active department opens a clearance at its step',
  })
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

  @Post('withdrawals/:id/clearances/:department/bypass')
  @ApiOperation({ summary: 'Bypass a department the school allows to be skipped (reason kept)' })
  @RequirePermission(LIFECYCLE.withdrawalClear)
  bypass(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('department') department: string,
    @Body() body: BypassDto,
  ) {
    return this.withdrawals.bypass(ctx, id, department, body);
  }

  @Post('withdrawals/:id/tc')
  @ApiOperation({ summary: 'Issue the TC from the withdrawal once its gating departments cleared' })
  @RequirePermission(LIFECYCLE.tcIssue)
  withdrawalTc(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: WithdrawalTcDto,
  ) {
    return this.withdrawals.issueTc(ctx, id, body);
  }

  @Post('withdrawals/:id/complete')
  @ApiOperation({
    summary: 'Complete: ends the enrolment, revokes the student (and lone parent) login',
  })
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

  // ---- transfers between schools of the group ---------------------------------------------------
  @Get('school-transfers/targets')
  @ApiOperation({ summary: 'Other schools of the group a student can be transferred to' })
  @RequirePermission(LIFECYCLE.transferManage, {
    description: 'Send students to, and accept them from, other schools of the group',
  })
  async transferTargets(@ReqCtx() ctx: RequestContext) {
    return this.transfers.targets(ctx);
  }

  @Get('school-transfers')
  @RequirePermission(LIFECYCLE.transferManage)
  listTransfers(@ReqCtx() ctx: RequestContext, @Query() q: ListTransfersQueryDto) {
    return this.transfers.list(ctx, q.box);
  }

  @Get('school-transfers/:id')
  @RequirePermission(LIFECYCLE.transferManage)
  getTransfer(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.transfers.get(ctx, id);
  }

  @Post('withdrawals/:id/transfer')
  @ApiOperation({ summary: 'Send a cleared withdrawal to another school of the group' })
  @RequirePermission(LIFECYCLE.transferManage)
  requestTransfer(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: RequestTransferDto,
  ) {
    return this.transfers.request(ctx, id, dto);
  }

  @Post('school-transfers/:id/accept')
  @ApiOperation({ summary: 'Accept an incoming transfer into a class and section' })
  @RequirePermission(LIFECYCLE.transferManage)
  acceptTransfer(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: AcceptTransferDto,
  ) {
    return this.transfers.accept(ctx, id, dto);
  }

  @Post('school-transfers/:id/reject')
  @RequirePermission(LIFECYCLE.transferManage)
  rejectTransfer(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.transfers.close(ctx, id, 'rejected', dto.reason);
  }

  @Post('school-transfers/:id/cancel')
  @RequirePermission(LIFECYCLE.transferManage)
  cancelTransfer(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: CancelDto) {
    return this.transfers.close(ctx, id, 'cancelled', dto.reason);
  }
}
