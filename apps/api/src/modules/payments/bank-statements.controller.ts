import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { BankStatementsService } from './bank-statements.service';
import { PAYMENTS, UploadBankStatementDto } from './payments.dto';

/** Sprint 15: bank upload reconciliation (statement credits against non-cash receipts). */
@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments/bank-statements')
export class BankStatementsController {
  constructor(private readonly bank: BankStatementsService) {}

  @Get()
  @RequirePermission(PAYMENTS.settlementView)
  async list(@ReqCtx() ctx: RequestContext) {
    return { data: await this.bank.list(ctx) };
  }

  @Get(':id')
  @RequirePermission(PAYMENTS.settlementView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.bank.get(ctx, id);
  }

  @Post()
  @ApiOperation({ summary: 'Upload a bank statement CSV and match its credits to receipts' })
  @RequirePermission(PAYMENTS.settlementManage)
  upload(@ReqCtx() ctx: RequestContext, @Body() dto: UploadBankStatementDto) {
    return this.bank.upload(ctx, dto);
  }
}
