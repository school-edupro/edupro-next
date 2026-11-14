import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { RUN } from './payroll-inputs.dto';
import { OWN, PayrollPayslipService } from './payroll-payslip.service';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};

/** Payslips (docs/design/86, phase B step 5): one, a run's, sent by e-mail, and My payslips. */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollPayslipController {
  constructor(private readonly slips: PayrollPayslipService) {}

  @Get('runs/:id/records/:recordId/payslip')
  @ApiOperation({
    summary: 'A payslip of a locked run as a PDF (locked with the employee’s password)',
  })
  @RequirePermission(RUN.view)
  one(@ReqCtx() ctx: RequestContext, @Param('id') rid: string, @Param('recordId') rec: string) {
    return this.slips.recordPayslip(ctx, id(rid), id(rec));
  }

  @Get('runs/:id/payslips')
  @ApiOperation({
    summary: 'All of a run’s payslips: one office copy, or a zip of locked files (a checker)',
  })
  @RequirePermission(RUN.approve)
  all(@ReqCtx() ctx: RequestContext, @Param('id') rid: string, @Query('mode') mode?: string) {
    return this.slips.runPayslips(ctx, id(rid), mode === 'zip' ? 'zip' : 'single');
  }

  @Get('runs/:id/payslips/status')
  @ApiOperation({ summary: 'How many payslips are released and e-mailed' })
  @RequirePermission(RUN.view)
  status(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.slips.runStatus(ctx, id(rid));
  }

  @Post('runs/:id/payslips/send')
  @ApiOperation({
    summary: 'E-mail the payslips not yet sent, each with its locked PDF (a checker)',
  })
  @RequirePermission(RUN.approve)
  send(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.slips.sendPending(ctx, id(rid));
  }

  @Get('me/payslips')
  @ApiOperation({ summary: 'My payslips of a financial year, with the year so far' })
  @RequirePermission(OWN)
  mine(@ReqCtx() ctx: RequestContext, @Query('fy') fy?: string) {
    return this.slips.mine(ctx, fy && /^\d{4}$/.test(fy) ? Number(fy) : undefined);
  }

  @Get('me/payslips/:recordId')
  @ApiOperation({ summary: 'One of my payslips as a PDF (locked with my password)' })
  @RequirePermission(OWN)
  minePdf(@ReqCtx() ctx: RequestContext, @Param('recordId') rec: string) {
    return this.slips.minePdf(ctx, id(rec));
  }
}
