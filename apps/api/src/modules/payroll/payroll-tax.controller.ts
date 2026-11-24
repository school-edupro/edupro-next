import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import {
  ChallanDto,
  ClearFinalDto,
  DecideDto,
  DeclareDto,
  DeclListDto,
  FinalDto,
  FyQueryDto,
  PerqDto,
  PrevDto,
  ReasonDto,
  MyRegimeDto,
  RegimeDto,
  TaxYearDto,
} from './payroll-tax.dto';
import { OWN, PayrollTaxService } from './payroll-tax.service';
import { fyOf, istToday } from './payroll-setup.service';
import { PAYROLL } from './payroll.dto';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};
const fyOk = (v: string) => {
  if (!/^\d{4}-\d{2}$/.test(v))
    throw new DomainError('validation-failed', 'Not a financial year (2026-27)', { status: 400 });
  return v;
};

/**
 * Income tax (docs/design/86, phase D step 3): My tax for every employee, and the tax centre for payroll staff —
 * declarations and proofs, the earlier employer, the regime, perquisites, the school's final figure, TDS challans,
 * the PAN check, the year's settings. Maker / checker / admin and own-only rules are checked again in the service.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollTaxController {
  constructor(private readonly tax: PayrollTaxService) {}

  // ---- My tax ----
  @Get('me/tax')
  @ApiOperation({
    summary: 'My tax: the year worked out, my declarations, earlier employer, regime',
  })
  @RequirePermission(OWN)
  mine(@ReqCtx() ctx: RequestContext, @Query() q: FyQueryDto) {
    return this.tax.mine(ctx, q.fy);
  }

  @Post('me/tax/declarations')
  @ApiOperation({ summary: 'Declare a section (in the year’s window), with proofs' })
  @RequirePermission(OWN)
  declareMine(@ReqCtx() ctx: RequestContext, @Body() dto: DeclareDto) {
    return this.tax.declare(ctx, { ...dto, employeeId: undefined });
  }

  @Delete('me/tax/declarations/:id')
  @ApiOperation({ summary: 'Withdraw my declaration (not once verified)' })
  @RequirePermission(OWN)
  withdraw(@ReqCtx() ctx: RequestContext, @Param('id') did: string) {
    return this.tax.withdraw(ctx, id(did));
  }

  @Post('me/tax/prev')
  @ApiOperation({ summary: 'My earlier employer this year (Form 122 / 12B)' })
  @RequirePermission(OWN)
  prevMine(@ReqCtx() ctx: RequestContext, @Body() dto: PrevDto) {
    return this.tax.savePrev(ctx, { ...dto, employeeId: undefined });
  }

  @Post('me/tax/regime')
  @ApiOperation({ summary: 'Choose my regime (until the cut-off month)' })
  @RequirePermission(OWN)
  regimeMine(@ReqCtx() ctx: RequestContext, @Body() dto: MyRegimeDto) {
    return this.tax.regime(ctx, { ...dto, employeeId: undefined, reason: undefined });
  }

  // ---- the tax centre ----
  @Get('tax/declarations')
  @ApiOperation({ summary: 'The year’s declarations: waiting, verified, rejected' })
  @RequirePermission(RUN.view)
  declarations(@ReqCtx() ctx: RequestContext, @Query() q: DeclListDto) {
    return this.tax.declarations(ctx, q);
  }

  @Post('tax/declarations')
  @ApiOperation({ summary: 'Declare for an employee without a sign-in (a maker)' })
  @RequirePermission(RUN.manage)
  declareFor(@ReqCtx() ctx: RequestContext, @Body() dto: DeclareDto) {
    if (!dto.employeeId)
      throw new DomainError('validation-failed', 'Name the employee', { status: 400 });
    return this.tax.declare(ctx, dto);
  }

  @Post('tax/declarations/:id/decide')
  @ApiOperation({
    summary: 'Verify (all or part), reject with a reason, or reopen — never one’s own',
  })
  @RequirePermission(RUN.approve)
  decide(@ReqCtx() ctx: RequestContext, @Param('id') did: string, @Body() dto: DecideDto) {
    return this.tax.decide(ctx, id(did), dto);
  }

  @Get('tax/proofs/:fileId')
  @ApiOperation({ summary: 'A proof file (payroll staff)' })
  @RequirePermission(RUN.view)
  proof(@ReqCtx() ctx: RequestContext, @Param('fileId') fid: string) {
    return this.tax.proofUrl(ctx, id(fid));
  }

  @Get('tax/prev')
  @ApiOperation({ summary: 'The year’s earlier employers' })
  @RequirePermission(RUN.view)
  prev(@ReqCtx() ctx: RequestContext, @Query() q: FyQueryDto) {
    return this.tax.prevList(ctx, q.fy);
  }

  @Post('tax/prev')
  @ApiOperation({ summary: 'An earlier employer for an employee without a sign-in (a maker)' })
  @RequirePermission(RUN.manage)
  prevFor(@ReqCtx() ctx: RequestContext, @Body() dto: PrevDto) {
    if (!dto.employeeId)
      throw new DomainError('validation-failed', 'Name the employee', { status: 400 });
    return this.tax.savePrev(ctx, dto);
  }

  @Post('tax/prev/:id/decide')
  @ApiOperation({
    summary: 'Verify, reject or reopen an earlier employer (a checker, never one’s own)',
  })
  @RequirePermission(RUN.approve)
  prevDecide(@ReqCtx() ctx: RequestContext, @Param('id') pid: string, @Body() dto: DecideDto) {
    return this.tax.prevDecide(ctx, id(pid), dto);
  }

  @Post('tax/regime')
  @ApiOperation({
    summary: 'Set an employee’s regime (the payroll admin; a reason after the cut-off)',
  })
  @RequirePermission(PAYROLL.admin)
  regimeFor(@ReqCtx() ctx: RequestContext, @Body() dto: RegimeDto) {
    if (!dto.employeeId)
      throw new DomainError('validation-failed', 'Name the employee', { status: 400 });
    return this.tax.regime(ctx, dto);
  }

  @Get('tax/perquisites')
  @ApiOperation({ summary: 'The year’s perquisites' })
  @RequirePermission(RUN.view)
  perqs(@ReqCtx() ctx: RequestContext, @Query() q: FyQueryDto) {
    return this.tax.perquisites(ctx, q.fy);
  }

  @Post('tax/perquisites')
  @ApiOperation({ summary: 'A perquisite’s value for the year (a maker; a change is a new row)' })
  @RequirePermission(RUN.manage)
  savePerq(@ReqCtx() ctx: RequestContext, @Body() dto: PerqDto) {
    return this.tax.savePerq(ctx, dto);
  }

  @Post('tax/perquisites/:id/:action')
  @ApiOperation({ summary: 'Verify or unverify (a checker), or remove (a maker) a perquisite' })
  @RequirePermission(RUN.view)
  perqAction(
    @ReqCtx() ctx: RequestContext,
    @Param('id') pid: string,
    @Param('action') action: string,
  ) {
    if (!['verify', 'unverify', 'delete'].includes(action))
      throw new DomainError('validation-failed', 'Not an action', { status: 400 });
    return this.tax.perqAction(ctx, id(pid), action as 'verify' | 'unverify' | 'delete');
  }

  @Get('tax/employees/:employeeId')
  @ApiOperation({ summary: 'An employee’s year of tax, worked out live (nothing stored)' })
  @RequirePermission(RUN.view)
  sheet(@ReqCtx() ctx: RequestContext, @Param('employeeId') eid: string, @Query() q: FyQueryDto) {
    return this.tax.sheet(ctx, id(eid), q.fy ?? fyOf(istToday()));
  }

  @Post('tax/finals')
  @ApiOperation({ summary: 'The school’s final figure for an employee’s year (a checker)' })
  @RequirePermission(RUN.approve)
  setFinal(@ReqCtx() ctx: RequestContext, @Body() dto: FinalDto) {
    return this.tax.setFinal(ctx, dto);
  }

  @Post('tax/finals/clear')
  @ApiOperation({ summary: 'Back to the worked-out figure (a checker)' })
  @RequirePermission(RUN.approve)
  clearFinal(@ReqCtx() ctx: RequestContext, @Body() dto: ClearFinalDto) {
    return this.tax.clearFinal(ctx, dto.employeeId, dto.fy);
  }

  @Get('tax/challans')
  @ApiOperation({ summary: 'The year’s TDS challans against the months’ deductions' })
  @RequirePermission(RUN.view)
  challans(@ReqCtx() ctx: RequestContext, @Query() q: FyQueryDto) {
    return this.tax.challans(ctx, q.fy);
  }

  @Post('tax/challans')
  @ApiOperation({ summary: 'A TDS challan (a maker)' })
  @RequirePermission(RUN.manage)
  addChallan(@ReqCtx() ctx: RequestContext, @Body() dto: ChallanDto) {
    return this.tax.addChallan(ctx, dto);
  }

  @Post('tax/challans/:id/remove')
  @ApiOperation({ summary: 'Remove a challan (a checker, with a reason)' })
  @RequirePermission(RUN.approve)
  removeChallan(@ReqCtx() ctx: RequestContext, @Param('id') cid: string, @Body() dto: ReasonDto) {
    return this.tax.removeChallan(ctx, id(cid), dto.reason);
  }

  @Get('tax/pan-check')
  @ApiOperation({ summary: 'Staff whose PAN is missing or wrong (a checker)' })
  @RequirePermission(RUN.approve)
  pan(@ReqCtx() ctx: RequestContext) {
    return this.tax.panCheck(ctx);
  }

  @Get('tax/years/:fy')
  @ApiOperation({
    summary: 'The tax year: the declaration window, the proof deadline, the listed cities',
  })
  @RequirePermission(RUN.view)
  year(@ReqCtx() ctx: RequestContext, @Param('fy') fy: string) {
    return this.tax.year(ctx, fyOk(fy));
  }

  @Put('tax/years/:fy')
  @ApiOperation({ summary: 'Set the tax year (the payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  saveYear(@ReqCtx() ctx: RequestContext, @Param('fy') fy: string, @Body() dto: TaxYearDto) {
    return this.tax.saveYear(ctx, fyOk(fy), dto);
  }

  @Post('tax/years/:fy/freeze')
  @ApiOperation({ summary: 'Close the tax year (the payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  freeze(@ReqCtx() ctx: RequestContext, @Param('fy') fy: string) {
    return this.tax.freeze(ctx, fyOk(fy));
  }
}
