import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import {
  CommentDto,
  DropDto,
  HoldRecordDto,
  RecordListDto,
  RecoveryDto,
  RunCreateDto,
  RunListDto,
} from './payroll-run.dto';
import { PayrollRunService } from './payroll-run.service';
import { PAYROLL } from './payroll.dto';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};
/**
 * Payroll runs (docs/design/86, phase B step 3): create, the checks before a run, process in batches, review,
 * approve, reject, lock, unapprove, reopen, drop failed, hold and release, recover a negative net. Maker, checker
 * and admin rules are checked again in the service.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/runs')
export class PayrollRunController {
  constructor(private readonly runs: PayrollRunService) {}

  @Get()
  @ApiOperation({ summary: 'A financial year’s runs' })
  @RequirePermission(RUN.view)
  list(@ReqCtx() ctx: RequestContext, @Query() q: RunListDto) {
    return this.runs.list(ctx, q);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a run (a maker): regular, supplementary (named staff) or bonus',
  })
  @RequirePermission(RUN.manage)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: RunCreateDto) {
    return this.runs.create(ctx, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'A run: its stage, figures, record counts and history' })
  @RequirePermission(RUN.view)
  get(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.runs.get(ctx, id(rid));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Remove a draft run with nothing worked out' })
  @RequirePermission(RUN.manage)
  remove(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.runs.remove(ctx, id(rid));
  }

  @Get(':id/checks')
  @ApiOperation({ summary: 'The checks before processing: red stops it, amber informs' })
  @RequirePermission(RUN.view)
  checks(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.runs.checks(ctx, id(rid));
  }

  @Post(':id/process')
  @ApiOperation({ summary: 'Work out the next batch of employees (call again until done)' })
  @RequirePermission(RUN.manage)
  process(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.runs.process(ctx, id(rid));
  }

  @Get(':id/records')
  @ApiOperation({ summary: 'The run’s records with last month’s net and the flags to look at' })
  @RequirePermission(RUN.view)
  records(@ReqCtx() ctx: RequestContext, @Param('id') rid: string, @Query() q: RecordListDto) {
    return this.runs.records(ctx, id(rid), q);
  }

  @Get(':id/records/:recordId')
  @ApiOperation({
    summary: 'A record: its lines, statutory figures, tax, loans and the trace of every amount',
  })
  @RequirePermission(RUN.view)
  record(@ReqCtx() ctx: RequestContext, @Param('id') rid: string, @Param('recordId') rec: string) {
    return this.runs.record(ctx, id(rid), id(rec));
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve (a checker who did not create it; no failed record)' })
  @RequirePermission(RUN.approve)
  approve(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.runs.approve(ctx, id(rid));
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject with a comment (a checker)' })
  @RequirePermission(RUN.approve)
  reject(@ReqCtx() ctx: RequestContext, @Param('id') rid: string, @Body() dto: CommentDto) {
    return this.runs.reject(ctx, id(rid), dto);
  }

  @Post(':id/lock')
  @ApiOperation({ summary: 'Lock (a checker): payslips frozen and released, fee receipts posted' })
  @RequirePermission(RUN.approve)
  lock(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.runs.lock(ctx, id(rid));
  }

  @Post(':id/unapprove')
  @ApiOperation({ summary: 'Unapprove (the payroll admin, with a reason)' })
  @RequirePermission(PAYROLL.admin)
  unapprove(@ReqCtx() ctx: RequestContext, @Param('id') rid: string, @Body() dto: CommentDto) {
    return this.runs.unapprove(ctx, id(rid), dto);
  }

  @Post(':id/reopen')
  @ApiOperation({
    summary: 'Reopen a locked run (the payroll admin, with a reason): back to draft',
  })
  @RequirePermission(PAYROLL.admin)
  reopen(@ReqCtx() ctx: RequestContext, @Param('id') rid: string, @Body() dto: CommentDto) {
    return this.runs.reopen(ctx, id(rid), dto);
  }

  @Post(':id/drop-failed')
  @ApiOperation({
    summary: 'Drop the failed records (a checker, with a reason): not paid in this run',
  })
  @RequirePermission(RUN.approve)
  dropFailed(@ReqCtx() ctx: RequestContext, @Param('id') rid: string, @Body() dto: DropDto) {
    return this.runs.dropFailed(ctx, id(rid), dto);
  }

  @Post(':id/records/:recordId/hold')
  @ApiOperation({ summary: 'Hold a salary (a checker, once approved)' })
  @RequirePermission(RUN.approve)
  hold(
    @ReqCtx() ctx: RequestContext,
    @Param('id') rid: string,
    @Param('recordId') rec: string,
    @Body() dto: HoldRecordDto,
  ) {
    return this.runs.hold(ctx, id(rid), id(rec), dto, false);
  }

  @Post(':id/records/:recordId/release')
  @ApiOperation({ summary: 'Release a held salary (a checker)' })
  @RequirePermission(RUN.approve)
  release(
    @ReqCtx() ctx: RequestContext,
    @Param('id') rid: string,
    @Param('recordId') rec: string,
    @Body() dto: HoldRecordDto,
  ) {
    return this.runs.hold(ctx, id(rid), id(rec), dto, true);
  }

  @Post(':id/records/:recordId/recovery')
  @ApiOperation({ summary: 'Recover a negative net over the coming months (a checker)' })
  @RequirePermission(RUN.approve)
  recovery(
    @ReqCtx() ctx: RequestContext,
    @Param('id') rid: string,
    @Param('recordId') rec: string,
    @Body() dto: RecoveryDto,
  ) {
    return this.runs.recovery(ctx, id(rid), id(rec), dto);
  }
}
