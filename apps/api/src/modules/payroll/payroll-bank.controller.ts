import { Body, Controller, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  BankAccountDto,
  BankFileDto,
  BatchCreateDto,
  CancelDto,
  ConfirmDto,
  LayoutCheckDto,
  MarkPaidDto,
  RejectLineDto,
} from './payroll-bank.dto';
import { PayrollBankService } from './payroll-bank.service';
import { RUN } from './payroll-inputs.dto';
import { must } from './payroll-month';
import { PAYROLL } from './payroll.dto';

const id = (v: string) => {
  if (!/^\d{1,18}$/.test(v))
    throw new DomainError('validation-failed', 'Not a valid id', { status: 400 });
  return v;
};

/**
 * Bank batches (docs/design/86, phase C step 1): the school's bank accounts and their file layouts, a run's
 * payments by bank, bank files and their life (uploaded, confirmed with the UTR, cancelled, a line returned), cash
 * and cheque payments. The checker / admin rules are checked again in the service.
 */
@ApiTags('payroll')
@ApiBearerAuth()
@Controller('payroll')
export class PayrollBankController {
  constructor(private readonly bank: PayrollBankService) {}

  @Get('bank/accounts')
  @ApiOperation({
    summary: 'The school’s bank accounts salaries are paid from, with their file layouts',
  })
  @RequirePermission(RUN.view)
  accounts(@ReqCtx() ctx: RequestContext) {
    return this.bank.accounts(ctx);
  }

  @Post('bank/accounts')
  @ApiOperation({ summary: 'Add a bank account and its file layout (the payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  addAccount(@ReqCtx() ctx: RequestContext, @Body() dto: BankAccountDto) {
    return this.bank.saveAccount(ctx, dto);
  }

  @Put('bank/accounts/:id')
  @ApiOperation({ summary: 'Change a bank account or its file layout (the payroll admin)' })
  @RequirePermission(PAYROLL.admin)
  updateAccount(
    @ReqCtx() ctx: RequestContext,
    @Param('id') aid: string,
    @Body() dto: BankAccountDto,
  ) {
    return this.bank.saveAccount(ctx, dto, id(aid));
  }

  @Post('bank/layout/check')
  @ApiOperation({ summary: 'A file layout tried on two made-up payments' })
  @RequirePermission(RUN.view)
  checkLayout(@ReqCtx() ctx: RequestContext, @Body() dto: LayoutCheckDto) {
    must(ctx, PAYROLL.admin, 'Only the payroll admin sets a file layout');
    return this.bank.checkLayout(dto.layout);
  }

  @Get('runs/:id/bank')
  @ApiOperation({ summary: 'A run’s payments: by bank, cash and cheque, its bank files' })
  @RequirePermission(RUN.approve)
  preview(@ReqCtx() ctx: RequestContext, @Param('id') rid: string) {
    return this.bank.preview(ctx, id(rid));
  }

  @Post('runs/:id/bank')
  @ApiOperation({ summary: 'Make a bank file (a checker): one bank, or every payment together' })
  @RequirePermission(RUN.approve)
  generate(@ReqCtx() ctx: RequestContext, @Param('id') rid: string, @Body() dto: BatchCreateDto) {
    return this.bank.generate(ctx, id(rid), dto);
  }

  @Post('runs/:id/records/:recordId/paid')
  @ApiOperation({
    summary: 'A cash or cheque salary paid, with its voucher or cheque number (a checker)',
  })
  @RequirePermission(RUN.approve)
  markPaid(
    @ReqCtx() ctx: RequestContext,
    @Param('id') rid: string,
    @Param('recordId') rec: string,
    @Body() dto: MarkPaidDto,
  ) {
    return this.bank.markPaid(ctx, id(rid), id(rec), dto);
  }

  @Get('bank/batches/:id')
  @ApiOperation({ summary: 'A bank file: its lines and what can be done' })
  @RequirePermission(RUN.approve)
  batch(@ReqCtx() ctx: RequestContext, @Param('id') bid: string) {
    return this.bank.batch(ctx, id(bid));
  }

  @Get('bank/batches/:id/file')
  @ApiOperation({ summary: 'The bank file as made, or the bank letter (Excel or PDF)' })
  @RequirePermission(RUN.approve)
  file(@ReqCtx() ctx: RequestContext, @Param('id') bid: string, @Query() q: BankFileDto) {
    return this.bank.file(ctx, id(bid), q.as);
  }

  @Post('bank/batches/:id/uploaded')
  @ApiOperation({ summary: 'The file is uploaded to the bank (the run locked)' })
  @RequirePermission(RUN.approve)
  uploaded(@ReqCtx() ctx: RequestContext, @Param('id') bid: string) {
    return this.bank.uploaded(ctx, id(bid));
  }

  @Post('bank/batches/:id/confirm')
  @ApiOperation({ summary: 'The bank paid it: confirmed with its UTR; the salaries are paid' })
  @RequirePermission(RUN.approve)
  confirm(@ReqCtx() ctx: RequestContext, @Param('id') bid: string, @Body() dto: ConfirmDto) {
    return this.bank.confirm(ctx, id(bid), dto);
  }

  @Post('bank/batches/:id/cancel')
  @ApiOperation({ summary: 'Cancel a bank file not yet uploaded (a checker, with a reason)' })
  @RequirePermission(RUN.approve)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') bid: string, @Body() dto: CancelDto) {
    return this.bank.cancel(ctx, id(bid), dto);
  }

  @Post('bank/lines/:id/reject')
  @ApiOperation({
    summary: 'The bank returned a payment: the salary held, paid again once released',
  })
  @RequirePermission(RUN.approve)
  reject(@ReqCtx() ctx: RequestContext, @Param('id') lid: string, @Body() dto: RejectLineDto) {
    return this.bank.rejectLine(ctx, id(lid), dto);
  }
}
