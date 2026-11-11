import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { AttendanceService } from './attendance.service';
import {
  DayCorrectDto,
  BulkDaysDto,
  DecideDto,
  ExceptionsDto,
  LEAVE_OFFICE,
  LEAVE_OWN,
  LockDto,
  MyMonthDto,
  ReasonDto,
  RegisterMonthDto,
  TeamAttendanceDto,
  RegulariseDto,
  RunDto,
  SheetDto,
  TimingBulkDto,
  TimingListDto,
  TimingLogDto,
  TimingsQueryDto,
  TimingDto,
  WithdrawDto,
} from './leave.dto';

const check = (re: RegExp, what: string) => ({
  parse: (v: string) => {
    if (!re.test(v)) throw new DomainError('validation-failed', `Not ${what}`, { status: 400 });
    return v;
  },
});
const Day = check(/^\d{4}-\d{2}-\d{2}$/, 'a date');
const Id = check(/^\d{1,18}$/, 'an id');

/** Staff attendance (docs/design/85, phase C). */
@ApiTags('leave')
@ApiBearerAuth()
@Controller('staff-attendance')
export class AttendanceController {
  constructor(private readonly att: AttendanceService) {}

  @Get('register')
  @ApiOperation({ summary: 'A month of every employee; format=xlsx: the payroll feed' })
  @RequirePermission(LEAVE_OFFICE)
  register(@ReqCtx() ctx: RequestContext, @Query() q: RegisterMonthDto) {
    return q.format ? this.att.payrollFeed(ctx, q) : this.att.register(ctx, q);
  }

  @Get('days/:employeeId/:day')
  @AuthenticatedOnly()
  day(@ReqCtx() ctx: RequestContext, @Param('employeeId') emp: string, @Param('day') day: string) {
    return this.att.day(ctx, Id.parse(emp), Day.parse(day));
  }

  @Post('days')
  @ApiOperation({ summary: 'The office corrects a day (with the reason)' })
  @RequirePermission(LEAVE_OFFICE)
  correct(@ReqCtx() ctx: RequestContext, @Body() body: DayCorrectDto) {
    return this.att.correct(ctx, body);
  }

  @Post('days/bulk')
  @ApiOperation({
    summary: 'Bulk update: one status for many employees (or a department) over a few days',
  })
  @RequirePermission(LEAVE_OFFICE)
  bulk(@ReqCtx() ctx: RequestContext, @Body() body: BulkDaysDto) {
    return this.att.bulkDays(ctx, body);
  }

  @Get('team')
  @ApiOperation({
    summary:
      'My team’s attendance: all my reportees a column a day (up to 31 days), or one of them day by day (up to 92); Excel or PDF',
  })
  @AuthenticatedOnly()
  team(@ReqCtx() ctx: RequestContext, @Query() q: TeamAttendanceDto) {
    return this.att.team(ctx, q);
  }

  @Get('mine')
  @AuthenticatedOnly()
  mine(@ReqCtx() ctx: RequestContext, @Query() q: MyMonthDto) {
    return this.att.myMonth(ctx, q);
  }

  @Post('regularisations')
  @ApiOperation({ summary: 'Ask for my day to be corrected (decided through Who approves)' })
  @RequirePermission(LEAVE_OWN)
  regularise(@ReqCtx() ctx: RequestContext, @Body() body: RegulariseDto) {
    return this.att.regularise(ctx, body);
  }

  @Get('regularisations/approvals')
  @AuthenticatedOnly()
  regApprovals(@ReqCtx() ctx: RequestContext, @Query('view') view: string | undefined) {
    return this.att.regApprovals(ctx, view === 'decided' ? 'decided' : 'waiting');
  }

  @Post('regularisations/:id/decide')
  @AuthenticatedOnly()
  decideReg(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: DecideDto) {
    return this.att.decideReg(ctx, Id.parse(id), body);
  }

  @Post('regularisations/:id/withdraw')
  @AuthenticatedOnly()
  withdrawReg(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: WithdrawDto) {
    return this.att.withdrawReg(ctx, Id.parse(id), body);
  }

  @Get('exceptions')
  @RequirePermission(LEAVE_OFFICE)
  exceptions(@ReqCtx() ctx: RequestContext, @Query() q: ExceptionsDto) {
    return this.att.exceptions(ctx, q);
  }

  @Post('late-marks/:id/waive')
  @RequirePermission(LEAVE_OFFICE)
  waive(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.att.clearMark(ctx, 'late', Id.parse(id), body.reason);
  }

  @Post('missing-punches/:id/retire')
  @RequirePermission(LEAVE_OFFICE)
  retire(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.att.clearMark(ctx, 'missing', Id.parse(id), body.reason);
  }

  @Post('lock')
  @ApiOperation({
    summary: 'Lock a past month for payroll (unexplained absence becomes loss of pay first)',
  })
  @RequirePermission(LEAVE_OFFICE)
  lock(@ReqCtx() ctx: RequestContext, @Body() body: LockDto) {
    return this.att.lock(ctx, body, true);
  }

  @Post('unlock')
  @RequirePermission(LEAVE_OFFICE)
  unlock(@ReqCtx() ctx: RequestContext, @Body() body: LockDto) {
    return this.att.lock(ctx, body, false);
  }

  @Post('run')
  @ApiOperation({
    summary:
      'Run now: read the punches, the nightly run, work days out again, a month’s deductions',
  })
  @RequirePermission(LEAVE_OFFICE)
  run(@ReqCtx() ctx: RequestContext, @Body() body: RunDto) {
    return this.att.run(ctx, body);
  }

  @Get('timings')
  @RequirePermission('leave.setup.view')
  timings(@ReqCtx() ctx: RequestContext, @Query() q: TimingsQueryDto) {
    return this.att.timings(ctx, q);
  }

  @Get('timings/log')
  @ApiOperation({
    summary: 'The timing change log: who changed which timing, when, old and new; Excel or PDF',
  })
  @RequirePermission('leave.setup.view')
  timingLog(@ReqCtx() ctx: RequestContext, @Query() q: TimingLogDto) {
    return this.att.timingLog(ctx, q);
  }

  @Get('timings/list')
  @ApiOperation({
    summary: 'Department or special timings, a page at a time, filtered; Excel or PDF',
  })
  @RequirePermission('leave.setup.view')
  timingList(@ReqCtx() ctx: RequestContext, @Query() q: TimingListDto) {
    return this.att.timingList(ctx, q);
  }

  @Post('timings')
  @RequirePermission('leave.setup.manage')
  addTiming(@ReqCtx() ctx: RequestContext, @Body() body: TimingDto) {
    return this.att.saveTiming(ctx, null, body);
  }

  @Post('timings/bulk')
  @ApiOperation({ summary: 'Bulk edit of special timings: tick-to-apply, check first (dryRun)' })
  @RequirePermission('leave.setup.manage')
  bulkTiming(@ReqCtx() ctx: RequestContext, @Body() body: TimingBulkDto) {
    return this.att.bulkTiming(ctx, body);
  }

  @Get('timings/special-format')
  @ApiOperation({
    summary: 'Special timings as Excel: the ones there are, a row each, to change or add to',
  })
  @RequirePermission('leave.setup.manage')
  specialFormat(@ReqCtx() ctx: RequestContext) {
    return this.att.specialFormat(ctx);
  }

  @Post('timings/special-import')
  @ApiOperation({ summary: 'Special timings from Excel: check (dryRun), then save the good rows' })
  @RequirePermission('leave.setup.manage')
  specialImport(@ReqCtx() ctx: RequestContext, @Body() body: SheetDto) {
    return this.att.specialImport(ctx, body);
  }

  @Put('timings/:id')
  @RequirePermission('leave.setup.manage')
  saveTiming(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: TimingDto) {
    return this.att.saveTiming(ctx, Id.parse(id), body);
  }

  @Post('timings/:id/retire')
  @RequirePermission('leave.setup.manage')
  retireTiming(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.att.retireTiming(ctx, Id.parse(id));
  }

  @Get('sheets/:what/format')
  @RequirePermission(LEAVE_OFFICE)
  sheetFormat(@ReqCtx() ctx: RequestContext, @Param('what') what: string) {
    return this.att.sheetFormat(ctx, what === 'punches' ? 'punches' : 'days');
  }

  @Post('sheets/:what/import')
  @RequirePermission(LEAVE_OFFICE)
  sheetImport(@ReqCtx() ctx: RequestContext, @Param('what') what: string, @Body() body: SheetDto) {
    return this.att.sheetImport(ctx, what === 'punches' ? 'punches' : 'days', body);
  }
}
