import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { DoneDto, FyDto, ReopenDto, VoucherDto, VoucherFileDto } from './payroll-accounts.dto';
import { PayrollAccountsService } from './payroll-accounts.service';
import { RUN } from './payroll-inputs.dto';
import { PAYROLL } from './payroll.dto';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};

/** The compliance calendar and the monthly salary voucher (docs/design/86, phase C step 3). */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollAccountsController {
  constructor(private readonly accounts: PayrollAccountsService) {}

  @Get('compliance')
  @ApiOperation({ summary: 'A financial year’s statutory dues: due, overdue, done' })
  @RequirePermission(RUN.view)
  calendar(@ReqCtx() ctx: RequestContext, @Query() q: FyDto) {
    return this.accounts.calendar(ctx, q.fy);
  }

  @Post('compliance/seed')
  @ApiOperation({
    summary: 'Set up a financial year’s dues (a checker; adds only what is missing)',
  })
  @RequirePermission(RUN.approve)
  seed(@ReqCtx() ctx: RequestContext, @Body() dto: FyDto) {
    return this.accounts.seed(ctx, dto.fy);
  }

  @Post('compliance/:id/done')
  @ApiOperation({
    summary: 'A due paid or filed: its acknowledgement, date and amount (a checker)',
  })
  @RequirePermission(RUN.approve)
  done(@ReqCtx() ctx: RequestContext, @Param('id') cid: string, @Body() dto: DoneDto) {
    return this.accounts.done(ctx, id(cid), dto);
  }

  @Post('compliance/:id/reopen')
  @ApiOperation({ summary: 'Reopen a due marked done (the payroll admin, with a reason)' })
  @RequirePermission(PAYROLL.admin)
  reopen(@ReqCtx() ctx: RequestContext, @Param('id') cid: string, @Body() dto: ReopenDto) {
    return this.accounts.reopen(ctx, id(cid), dto.reason);
  }

  @Get('voucher')
  @ApiOperation({ summary: 'The month’s salary voucher (journal): debit and credit by ledger' })
  @RequirePermission(RUN.view)
  voucher(@ReqCtx() ctx: RequestContext, @Query() q: VoucherDto) {
    return this.accounts.voucher(ctx, q.month);
  }

  @Get('voucher/file')
  @ApiOperation({ summary: 'The salary voucher as Excel, CSV or PDF' })
  @RequirePermission(RUN.view)
  voucherFile(@ReqCtx() ctx: RequestContext, @Query() q: VoucherFileDto) {
    return this.accounts.voucherFile(ctx, q.month, q.format);
  }
}
