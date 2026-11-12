import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PayrollAttendanceService } from './payroll-attendance.service';
import {
  AdhocDto,
  AdhocListDto,
  AttendanceImportDto,
  AttendanceListDto,
  ClaimDecideDto,
  ClaimDto,
  ClaimListDto,
  EmployeeQueryDto,
  FeeRecoveryDto,
  HoldDto,
  LiftDto,
  LoanDto,
  LoanListDto,
  LoanScheduleDto,
  LoanStatusDto,
  ManualAttendanceDto,
  MarkPresentDto,
  Month,
  MonthQueryDto,
  OvertimeDto,
  PayeeDto,
  PullDto,
  RecurringDto,
  RecurringListDto,
  RecurringStatusDto,
  RUN,
  TdsManualDto,
  UnfinaliseDto,
  WardLinkDto,
} from './payroll-inputs.dto';
import { PayrollItemsService } from './payroll-items.service';
import { PAYROLL } from './payroll.dto';

function valid<T>(schema: z.ZodType<T>, v: unknown, what: string): T {
  const r = schema.safeParse(v);
  if (!r.success)
    throw new DomainError('validation-failed', `Not a valid ${what}`, { status: 400 });
  return r.data;
}
const id = (v: string) => valid(z.string().regex(/^\d{1,18}$/), v, 'id');
const month = (v: string) => valid(Month, v, 'month (YYYY-MM)');

/**
 * Payroll's monthly inputs (docs/design/86, phase B step 1): attendance for payroll, salary hold, a month's typed
 * tax, loans, one-off items and fee recovery, recurring deductions and payees, claims, overtime. Maker, checker
 * and admin rules are checked again in the services.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll/inputs')
export class PayrollInputsController {
  constructor(
    private readonly att: PayrollAttendanceService,
    private readonly items: PayrollItemsService,
  ) {}

  // ---- attendance -----------------------------------------------------------------------------------------
  @Get('attendance')
  @ApiOperation({
    summary:
      'A month’s attendance for payroll: every employee on the roster, figures, register locks',
  })
  @RequirePermission(RUN.view)
  attendance(@ReqCtx() ctx: RequestContext, @Query() q: AttendanceListDto) {
    return this.att.month(ctx, q);
  }

  @Post('attendance/pull')
  @ApiOperation({
    summary: 'Pull the month from the attendance register (a month over must be locked there)',
  })
  @RequirePermission(RUN.manage)
  pull(@ReqCtx() ctx: RequestContext, @Body() dto: PullDto) {
    return this.att.pull(ctx, dto);
  }

  @Post('attendance/mark-present')
  @ApiOperation({
    summary:
      'Mark everyone not finalised present for the month, but the exceptions (a checker; dryRun first)',
  })
  @RequirePermission(RUN.approve)
  markPresent(@ReqCtx() ctx: RequestContext, @Body() dto: MarkPresentDto) {
    return this.att.markPresent(ctx, dto);
  }

  @Post('attendance/finalise')
  @ApiOperation({
    summary: 'Finalise the month’s attendance (a checker): runs read only finalised attendance',
  })
  @RequirePermission(RUN.approve)
  finalise(@ReqCtx() ctx: RequestContext, @Body() dto: MonthQueryDto) {
    return this.att.finalise(ctx, dto.month);
  }

  @Post('attendance/unfinalise')
  @ApiOperation({
    summary:
      'Un-finalise the month (the payroll admin, with a reason; not once a run is past draft)',
  })
  @RequirePermission(PAYROLL.admin)
  unfinalise(@ReqCtx() ctx: RequestContext, @Body() dto: UnfinaliseDto) {
    return this.att.unfinalise(ctx, dto);
  }

  @Get('attendance/format')
  @ApiOperation({ summary: 'The month’s attendance sheet to fill (Excel)' })
  @RequirePermission(RUN.manage)
  format(@ReqCtx() ctx: RequestContext, @Query() q: MonthQueryDto) {
    return this.att.sheetFormat(ctx, q.month);
  }

  @Post('attendance/import')
  @ApiOperation({ summary: 'The filled attendance sheet: checked (dryRun), then saved' })
  @RequirePermission(RUN.manage)
  importSheet(@ReqCtx() ctx: RequestContext, @Body() dto: AttendanceImportDto) {
    return this.att.importSheet(ctx, dto);
  }

  @Get('attendance/:employeeId')
  @ApiOperation({
    summary: 'One employee’s month explained: the days of each kind, leave by type, warnings',
  })
  @RequirePermission(RUN.view)
  explain(
    @ReqCtx() ctx: RequestContext,
    @Param('employeeId') employeeId: string,
    @Query() q: MonthQueryDto,
  ) {
    return this.att.explain(ctx, id(employeeId), q.month);
  }

  @Put('attendance/:employeeId')
  @ApiOperation({ summary: 'Correct one employee’s month by hand, with a reason' })
  @RequirePermission(RUN.manage)
  manual(
    @ReqCtx() ctx: RequestContext,
    @Param('employeeId') employeeId: string,
    @Body() dto: ManualAttendanceDto,
  ) {
    return this.att.setManual(ctx, id(employeeId), dto);
  }

  // ---- salary hold and typed tax ----------------------------------------------------------------------------
  @Get('holds')
  @ApiOperation({ summary: 'The month’s salary holds (HOLD: paid when released; SKIP: left out)' })
  @RequirePermission(RUN.view)
  holds(@ReqCtx() ctx: RequestContext, @Query() q: MonthQueryDto) {
    return this.att.holds(ctx, q.month);
  }

  @Post('holds')
  @ApiOperation({ summary: 'Hold or skip an employee’s salary for a month (a checker)' })
  @RequirePermission(RUN.approve)
  hold(@ReqCtx() ctx: RequestContext, @Body() dto: HoldDto) {
    return this.att.setHold(ctx, dto);
  }

  @Post('holds/:id/lift')
  @ApiOperation({ summary: 'Lift a salary hold (a checker)' })
  @RequirePermission(RUN.approve)
  lift(@ReqCtx() ctx: RequestContext, @Param('id') hid: string, @Body() dto: LiftDto) {
    return this.att.liftHold(ctx, id(hid), dto);
  }

  @Get('tds')
  @ApiOperation({ summary: 'A month’s income tax typed by hand' })
  @RequirePermission(RUN.view)
  tds(@ReqCtx() ctx: RequestContext, @Query() q: MonthQueryDto) {
    return this.att.tds(ctx, q.month);
  }

  @Put('tds')
  @ApiOperation({ summary: 'Type an employee’s tax for a month (it wins over the projection)' })
  @RequirePermission(RUN.manage)
  setTds(@ReqCtx() ctx: RequestContext, @Body() dto: TdsManualDto) {
    return this.att.setTds(ctx, dto);
  }

  @Delete('tds/:id')
  @ApiOperation({ summary: 'Remove a typed tax' })
  @RequirePermission(RUN.manage)
  deleteTds(@ReqCtx() ctx: RequestContext, @Param('id') tid: string) {
    return this.att.deleteTds(ctx, id(tid));
  }

  // ---- loans ------------------------------------------------------------------------------------------------
  @Get('loans')
  @ApiOperation({ summary: 'Loans and advances' })
  @RequirePermission(RUN.view)
  loans(@ReqCtx() ctx: RequestContext, @Query() q: LoanListDto) {
    return this.items.loans(ctx, q);
  }

  @Post('loans/schedule')
  @ApiOperation({ summary: 'A loan’s schedule before it is saved' })
  @RequirePermission(RUN.view)
  schedule(@Body() dto: LoanScheduleDto) {
    return this.items.schedulePreview(dto);
  }

  @Post('loans')
  @ApiOperation({ summary: 'Add a loan or advance' })
  @RequirePermission(RUN.manage)
  addLoan(@ReqCtx() ctx: RequestContext, @Body() dto: LoanDto) {
    return this.items.addLoan(ctx, dto);
  }

  @Get('loans/:id')
  @ApiOperation({ summary: 'A loan, with what remains of its schedule' })
  @RequirePermission(RUN.view)
  loan(@ReqCtx() ctx: RequestContext, @Param('id') lid: string) {
    return this.items.loan(ctx, id(lid));
  }

  @Post('loans/:id/status')
  @ApiOperation({ summary: 'Hold, resume (a maker) or foreclose (a checker) a loan' })
  @RequirePermission(RUN.manage)
  loanStatus(@ReqCtx() ctx: RequestContext, @Param('id') lid: string, @Body() dto: LoanStatusDto) {
    return this.items.loanStatus(ctx, id(lid), dto);
  }

  // ---- one-off items and fee recovery --------------------------------------------------------------------------
  @Get('adhoc')
  @ApiOperation({ summary: 'A month’s one-off earnings and deductions' })
  @RequirePermission(RUN.view)
  adhoc(@ReqCtx() ctx: RequestContext, @Query() q: AdhocListDto) {
    return this.items.adhoc(ctx, q);
  }

  @Post('adhoc')
  @ApiOperation({ summary: 'Add a one-off earning or deduction' })
  @RequirePermission(RUN.manage)
  addAdhoc(@ReqCtx() ctx: RequestContext, @Body() dto: AdhocDto) {
    return this.items.addAdhoc(ctx, dto);
  }

  @Delete('adhoc/:id')
  @ApiOperation({ summary: 'Remove a one-off item not yet paid' })
  @RequirePermission(RUN.manage)
  deleteAdhoc(@ReqCtx() ctx: RequestContext, @Param('id') aid: string) {
    return this.items.deleteAdhoc(ctx, id(aid));
  }

  @Get('wards')
  @ApiOperation({
    summary: 'A staff member’s children: linked, found by mobile, and their fee dues',
  })
  @RequirePermission(RUN.view)
  wards(@ReqCtx() ctx: RequestContext, @Query() q: EmployeeQueryDto) {
    return this.items.wards(ctx, q.employeeId);
  }

  @Post('wards')
  @ApiOperation({ summary: 'Link a child for fee recovery (a checker)' })
  @RequirePermission(RUN.approve)
  linkWard(@ReqCtx() ctx: RequestContext, @Body() dto: WardLinkDto) {
    return this.items.linkWard(ctx, dto);
  }

  @Delete('wards/:id')
  @ApiOperation({ summary: 'Unlink a child (a checker)' })
  @RequirePermission(RUN.approve)
  unlinkWard(@ReqCtx() ctx: RequestContext, @Param('id') wid: string) {
    return this.items.unlinkWard(ctx, id(wid));
  }

  @Post('fee-recovery')
  @ApiOperation({
    summary: 'Deduct a child’s fee dues from a month’s salary; the receipt is posted at Lock',
  })
  @RequirePermission(RUN.manage)
  feeRecovery(@ReqCtx() ctx: RequestContext, @Body() dto: FeeRecoveryDto) {
    return this.items.stageFeeRecovery(ctx, dto);
  }

  // ---- recurring deductions and payees -----------------------------------------------------------------------
  @Get('payees')
  @ApiOperation({ summary: 'Payees of recurring deductions (LIC, society, union, court …)' })
  @RequirePermission(RUN.view)
  payees(@ReqCtx() ctx: RequestContext) {
    return this.items.payees(ctx);
  }

  @Post('payees')
  @ApiOperation({ summary: 'Add a payee' })
  @RequirePermission(RUN.manage)
  addPayee(@ReqCtx() ctx: RequestContext, @Body() dto: PayeeDto) {
    return this.items.savePayee(ctx, null, dto);
  }

  @Put('payees/:id')
  @ApiOperation({ summary: 'Change a payee' })
  @RequirePermission(RUN.manage)
  savePayee(@ReqCtx() ctx: RequestContext, @Param('id') pid: string, @Body() dto: PayeeDto) {
    return this.items.savePayee(ctx, id(pid), dto);
  }

  @Get('recurring')
  @ApiOperation({ summary: 'Recurring deductions' })
  @RequirePermission(RUN.view)
  recurring(@ReqCtx() ctx: RequestContext, @Query() q: RecurringListDto) {
    return this.items.recurring(ctx, q);
  }

  @Post('recurring')
  @ApiOperation({ summary: 'Add a recurring deduction' })
  @RequirePermission(RUN.manage)
  addRecurring(@ReqCtx() ctx: RequestContext, @Body() dto: RecurringDto) {
    return this.items.addRecurring(ctx, dto);
  }

  @Post('recurring/:id/status')
  @ApiOperation({ summary: 'Hold, resume or end a recurring deduction' })
  @RequirePermission(RUN.manage)
  recurringStatus(
    @ReqCtx() ctx: RequestContext,
    @Param('id') rid: string,
    @Body() dto: RecurringStatusDto,
  ) {
    return this.items.recurringStatus(ctx, id(rid), dto);
  }

  @Get('payout')
  @ApiOperation({ summary: 'What each payee is due in a month (a checker)' })
  @RequirePermission(RUN.approve)
  payout(@ReqCtx() ctx: RequestContext, @Query('month') m: string) {
    return this.items.payout(ctx, month(m));
  }

  // ---- claims ------------------------------------------------------------------------------------------------
  @Get('claims')
  @ApiOperation({ summary: 'Claims (reimbursements)' })
  @RequirePermission(RUN.view)
  claims(@ReqCtx() ctx: RequestContext, @Query() q: ClaimListDto) {
    return this.items.claims(ctx, q);
  }

  @Post('claims')
  @ApiOperation({ summary: 'Enter a claim for an employee' })
  @RequirePermission(RUN.manage)
  addClaim(@ReqCtx() ctx: RequestContext, @Body() dto: ClaimDto) {
    return this.items.addClaim(ctx, dto);
  }

  @Post('claims/:id/decide')
  @ApiOperation({
    summary: 'Approve (paid in a month) or reject a claim (a checker who did not enter it)',
  })
  @RequirePermission(RUN.approve)
  decideClaim(
    @ReqCtx() ctx: RequestContext,
    @Param('id') cid: string,
    @Body() dto: ClaimDecideDto,
  ) {
    return this.items.decideClaim(ctx, id(cid), dto);
  }

  // ---- overtime ----------------------------------------------------------------------------------------------
  @Get('overtime')
  @ApiOperation({ summary: 'A month’s rate-based overtime' })
  @RequirePermission(RUN.view)
  overtime(@ReqCtx() ctx: RequestContext, @Query() q: MonthQueryDto) {
    return this.items.overtime(ctx, q.month);
  }

  @Put('overtime')
  @ApiOperation({
    summary: 'An employee’s overtime for a month at the dated rate (replaces an unpaid entry)',
  })
  @RequirePermission(RUN.manage)
  saveOvertime(@ReqCtx() ctx: RequestContext, @Body() dto: OvertimeDto) {
    return this.items.saveOvertime(ctx, dto);
  }

  @Delete('overtime/:id')
  @ApiOperation({ summary: 'Remove overtime not yet paid' })
  @RequirePermission(RUN.manage)
  deleteOvertime(@ReqCtx() ctx: RequestContext, @Param('id') oid: string) {
    return this.items.deleteOvertime(ctx, id(oid));
  }
}
