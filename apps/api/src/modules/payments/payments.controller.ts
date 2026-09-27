import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  CreateFeeIntentDto,
  ListIntentsQueryDto,
  MockPayDto,
  PAYMENTS,
  PayuWebhookDto,
  RecordOfflinePaymentDto,
} from './payments.dto';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Post('payu/webhook')
  @Public()
  @ApiOperation({ summary: 'PayU server-to-server notification (signature verified, idempotent)' })
  webhook(@Body() body: PayuWebhookDto) {
    return this.payments.handlePayuWebhook(body, 'webhook');
  }

  @Post('payu/return')
  @Public()
  @ApiOperation({ summary: 'PayU browser return (same verification as the webhook)' })
  returned(@Body() body: PayuWebhookDto) {
    return this.payments.handlePayuWebhook(body, 'return');
  }

  @Post('payu/mock')
  @Public()
  @ApiOperation({
    summary: 'Development gateway: signs and applies a success or failure for a transaction',
  })
  mock(@Body() body: MockPayDto) {
    return this.payments.mockPay(body.txnid, body.outcome);
  }

  @Get('intents')
  @ApiBearerAuth()
  @RequirePermission(PAYMENTS.intentView, {
    description: 'View payment intents and gateway events',
  })
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListIntentsQueryDto) {
    const { rows, total } = await this.payments.list(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total }, mode: this.payments.mode };
  }

  @Get('intents/:id')
  @ApiBearerAuth()
  @RequirePermission(PAYMENTS.intentView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.payments.get(ctx, id);
  }

  @Post('intents/fee')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start an online fee instalment payment for a student' })
  @RequirePermission(PAYMENTS.intentCreate, { description: 'Create payment intents for fees' })
  createFee(@ReqCtx() ctx: RequestContext, @Body() body: CreateFeeIntentDto) {
    return this.payments.createFeeIntent(ctx, body);
  }

  @Post('offline')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record a cash, cheque, UPI or bank payment and allocate it to dues' })
  @RequirePermission(PAYMENTS.offlineRecord, {
    description: 'Record an offline fee payment (cash, cheque, UPI, bank)',
  })
  offline(@ReqCtx() ctx: RequestContext, @Body() body: RecordOfflinePaymentDto) {
    return this.payments.recordOffline(ctx, body);
  }
}
