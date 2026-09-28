import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  CcavenueReturnDto,
  CreateFamilyIntentDto,
  CreateFeeIntentDto,
  DecideRefundDto,
  ListIntentsQueryDto,
  ListRefundsQueryDto,
  MockPayDto,
  PAYMENTS,
  PayuWebhookDto,
  PostReceiptDto,
  RazorpayReturnDto,
  RazorpayWebhookDto,
  RecordOfflinePaymentDto,
  RequestRefundDto,
  UploadSettlementDto,
} from './payments.dto';
import { PaymentsService } from './payments.service';
import { RefundsService } from './refunds.service';
import { SettlementsService } from './settlements.service';

@ApiTags('payments')
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly refunds: RefundsService,
    private readonly settlements: SettlementsService,
  ) {}

  // ---- gateway callbacks (public, signature-verified) --------------------------------------------
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

  @Post('razorpay/return')
  @Public()
  @ApiOperation({ summary: 'Razorpay checkout handler: order id, payment id and signature' })
  razorpayReturned(@Body() body: RazorpayReturnDto) {
    return this.payments.handleRazorpayReturn(body);
  }

  @Post('razorpay/webhook')
  @Public()
  @ApiOperation({ summary: 'Razorpay webhook (HMAC over the raw body, idempotent)' })
  razorpayWebhook(
    @Req() req: FastifyRequest,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Body() body: RazorpayWebhookDto,
  ) {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? JSON.stringify(body);
    return this.payments.handleRazorpayWebhook(raw, signature, body);
  }

  @Post('ccavenue/return')
  @Public()
  @ApiOperation({ summary: 'CCAvenue redirect and cancel URL: encrypted response' })
  ccavenueReturned(@Body() body: CcavenueReturnDto) {
    return this.payments.handleCcavenueReturn(body);
  }

  // ---- intents -----------------------------------------------------------------------------------
  @Get('intents')
  @ApiBearerAuth()
  @RequirePermission(PAYMENTS.intentView, {
    description: 'View payment intents and gateway events',
  })
  async list(@ReqCtx() ctx: RequestContext, @Query() q: ListIntentsQueryDto) {
    const { rows, total } = await this.payments.list(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total }, mode: this.payments.mode };
  }

  @Get('intents/mine')
  @ApiBearerAuth()
  @ApiOperation({ summary: "The family's own online payments (recent first)" })
  @RequirePermission(PAYMENTS.familyPay, { description: "Pay fees online for one's own children" })
  async mine(@ReqCtx() ctx: RequestContext) {
    return { data: await this.payments.familyIntents(ctx) };
  }

  @Post('intents/mine')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'A guardian starts an online payment for one of their children' })
  @RequirePermission(PAYMENTS.familyPay)
  createMine(@ReqCtx() ctx: RequestContext, @Body() body: CreateFamilyIntentDto) {
    return this.payments.createFamilyIntent(ctx, body);
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

  // ---- receipts ----------------------------------------------------------------------------------
  @Post('offline')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Record a cash, cheque, UPI or bank payment (posts a receipt)' })
  @RequirePermission(PAYMENTS.offlineRecord, {
    description: 'Record an offline fee payment (cash, cheque, UPI, bank)',
  })
  offline(@ReqCtx() ctx: RequestContext, @Body() body: RecordOfflinePaymentDto) {
    return this.payments.recordOffline(ctx, body);
  }

  @Post('receipts')
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Cashier: post a receipt in one transaction (validate, number, allocate per instalment, late fee, advance)',
  })
  @RequirePermission(PAYMENTS.receiptPost, {
    description: 'Post a fee receipt at the counter (cash, cheque, DD, UPI, bank, card)',
  })
  postReceipt(@ReqCtx() ctx: RequestContext, @Body() body: PostReceiptDto) {
    return this.payments.postReceipt(ctx, body);
  }

  // ---- refunds -----------------------------------------------------------------------------------
  @Get('refunds')
  @ApiBearerAuth()
  @RequirePermission(PAYMENTS.refundRequest, { description: 'Request a refund against a receipt' })
  async refundList(@ReqCtx() ctx: RequestContext, @Query() q: ListRefundsQueryDto) {
    const { rows, total } = await this.refunds.list(ctx, q);
    return { data: rows, page: { number: q.page, size: q.size, total } };
  }

  @Get('refunds/:id')
  @ApiBearerAuth()
  @RequirePermission(PAYMENTS.refundRequest)
  refund(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.refunds.get(ctx, id);
  }

  @Post('receipts/:paymentId/refunds')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Request a refund against a receipt' })
  @RequirePermission(PAYMENTS.refundRequest)
  requestRefund(
    @ReqCtx() ctx: RequestContext,
    @Param('paymentId') paymentId: string,
    @Body() body: RequestRefundDto,
  ) {
    return this.refunds.request(ctx, paymentId, body);
  }

  @Post('refunds/:id/decide')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Approve (and pay out) or reject a refund' })
  @RequirePermission(PAYMENTS.refundApprove, {
    description: 'Approve, reject and pay out refunds',
  })
  decideRefund(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: DecideRefundDto,
  ) {
    return this.refunds.decide(ctx, id, body);
  }

  // ---- settlements -------------------------------------------------------------------------------
  @Get('settlements')
  @ApiBearerAuth()
  @RequirePermission(PAYMENTS.settlementView, {
    description: 'View gateway settlement files and their matching',
  })
  async settlementList(@ReqCtx() ctx: RequestContext) {
    return { data: await this.settlements.list(ctx) };
  }

  @Get('settlements/:id')
  @ApiBearerAuth()
  @RequirePermission(PAYMENTS.settlementView)
  settlement(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.settlements.get(ctx, id);
  }

  @Post('settlements')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Upload a provider's settlement CSV and match it against intents" })
  @RequirePermission(PAYMENTS.settlementManage, {
    description: 'Upload and match gateway settlement files',
  })
  uploadSettlement(@ReqCtx() ctx: RequestContext, @Body() body: UploadSettlementDto) {
    return this.settlements.upload(ctx, body);
  }
}
