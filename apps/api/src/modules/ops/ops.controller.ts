import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  CloseMonthDto,
  CreateRunDto,
  IssueDto,
  IssueListDto,
  IssueUpdateDto,
  LegacyCountsDto,
  LockDto,
  OPS,
  ReopenMonthDto,
  RunStatusDto,
  StepDto,
} from './ops.dto';
import { OpsService } from './ops.service';

/** Sprints 22-23: cut-over runs, hypercare and the pilot feature flags. Design note 18. */
@ApiTags('ops')
@ApiBearerAuth()
@Controller('ops')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('features')
  @AuthenticatedOnly()
  @ApiOperation({ summary: 'Modules enabled for the pilot and the hypercare window' })
  features(@ReqCtx() ctx: RequestContext) {
    return this.ops.features(ctx);
  }

  // ---- cut-over ----
  @Get('cutover/runs')
  @RequirePermission(OPS.cutoverManage, { description: 'Run cut-over rehearsals and sign-off' })
  async runs(@ReqCtx() ctx: RequestContext) {
    return { data: await this.ops.runs(ctx) };
  }

  @Post('cutover/runs')
  @RequirePermission(OPS.cutoverManage)
  createRun(@ReqCtx() ctx: RequestContext, @Body() body: CreateRunDto) {
    return this.ops.createRun(ctx, body);
  }

  @Get('cutover/runs/:id')
  @RequirePermission(OPS.cutoverManage)
  run(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.ops.runDetail(ctx, id);
  }

  @Put('cutover/runs/:id/status')
  @RequirePermission(OPS.cutoverManage)
  runStatus(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: RunStatusDto) {
    return this.ops.setRunStatus(ctx, id, body);
  }

  @Put('cutover/runs/:id/steps/:stepId')
  @RequirePermission(OPS.cutoverManage)
  step(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('stepId') stepId: string,
    @Body() body: StepDto,
  ) {
    return this.ops.setStep(ctx, id, stepId, body);
  }

  @Post('cutover/runs/:id/snapshots/live')
  @ApiOperation({ summary: 'Take the live counts under the caller’s row-level security' })
  @RequirePermission(OPS.cutoverManage)
  snapshotLive(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.ops.snapshotLive(ctx, id);
  }

  @Post('cutover/runs/:id/snapshots/legacy')
  @ApiOperation({
    summary: 'Record the legacy counts from the legacy reports or the ETL reconciliation',
  })
  @RequirePermission(OPS.cutoverManage)
  snapshotLegacy(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: LegacyCountsDto,
  ) {
    return this.ops.snapshotLegacy(ctx, id, body);
  }

  @Post('cutover/runs/:id/sign-off')
  @ApiOperation({ summary: 'Sign the run off: every step done, counts within tolerance' })
  @RequirePermission(OPS.cutoverManage)
  signOff(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.ops.signOff(ctx, id);
  }

  // ---- hypercare ----
  @Get('hypercare/issues')
  @RequirePermission(OPS.hypercareManage, { description: 'Triage and resolve hypercare issues' })
  issues(@ReqCtx() ctx: RequestContext, @Query() q: IssueListDto) {
    return this.ops.issues(ctx, q, false);
  }

  @Get('hypercare/issues/mine')
  @RequirePermission(OPS.hypercareReport, { description: 'Report a hypercare issue' })
  myIssues(@ReqCtx() ctx: RequestContext, @Query() q: IssueListDto) {
    return this.ops.issues(ctx, q, true);
  }

  @Post('hypercare/issues')
  @RequirePermission(OPS.hypercareReport)
  report(@ReqCtx() ctx: RequestContext, @Body() body: IssueDto) {
    return this.ops.createIssue(ctx, body);
  }

  @Get('hypercare/issues/:id')
  @RequirePermission(OPS.hypercareManage)
  issue(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.ops.issueDetail(ctx, id);
  }

  @Put('hypercare/issues/:id')
  @RequirePermission(OPS.hypercareManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: IssueUpdateDto) {
    return this.ops.updateIssue(ctx, id, body);
  }
}

/** Month-end close and period locks live under the fees prefix. */
@ApiTags('fees')
@ApiBearerAuth()
@Controller('fees')
export class MonthEndController {
  constructor(private readonly ops: OpsService) {}

  @Get('period-locks')
  @RequirePermission(OPS.periodView, { description: 'View month-end checks and period locks' })
  async locks(@ReqCtx() ctx: RequestContext) {
    return { data: await this.ops.locks(ctx) };
  }

  @Post('period-locks')
  @RequirePermission(OPS.periodLock, {
    description: 'Lock a fee period (second factor)',
    mfa: true,
  })
  lock(@ReqCtx() ctx: RequestContext, @Body() body: LockDto) {
    return this.ops.lock(ctx, body);
  }

  @Get('month-end/:month')
  @ApiOperation({ summary: 'The checks of a month (yyyy-mm) and its close state' })
  @RequirePermission(OPS.periodView)
  monthEnd(@ReqCtx() ctx: RequestContext, @Param('month') month: string) {
    return this.ops.monthEnd(ctx, month);
  }

  @Post('month-end/:month/close')
  @ApiOperation({ summary: 'Close the month: lock the period and queue the month-end pack' })
  @RequirePermission(OPS.periodLock, { mfa: true })
  close(@ReqCtx() ctx: RequestContext, @Param('month') month: string, @Body() body: CloseMonthDto) {
    return this.ops.closeMonth(ctx, month, body);
  }

  @Post('month-end/:month/reopen')
  @ApiOperation({ summary: 'Reopen a closed month with a reason (audited)' })
  @RequirePermission(OPS.periodLock, { mfa: true })
  reopen(
    @ReqCtx() ctx: RequestContext,
    @Param('month') month: string,
    @Body() body: ReopenMonthDto,
  ) {
    return this.ops.reopenMonth(ctx, month, body);
  }
}
