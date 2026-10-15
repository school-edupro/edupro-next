import { Body, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { Public } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  CcavenueReturnDto,
  CreateFamilyIntentDto,
  CreateFamilyMiscIntentDto,
  CreateFeeIntentDto,
  GatewayOptionsQueryDto,
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
  RefundFeeDueDto,
  RefundRegisterFileQueryDto,
  RefundRegisterQueryDto,
  RequestAdvanceRefundDto,
  RequestRefundDto,
  RequestStudentRefundDto,
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
  webhook(@Body() body: PayuWebhookDto, @Query('gw') gw?: string) {
    return this.payments.handlePayuWebhook(body, 'webhook', gw);
  }

  @Post('payu/return')
  @Public()
  @ApiOperation({ summary: 'PayU browser return (same verification as the webhook)' })
  returned(@Body() body: PayuWebhookDto, @Query('gw') gw?: string) {
    return this.payments.handlePayuWebhook(body, 'return', gw);
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
  razorpayReturned(@Body() body: RazorpayReturnDto, @Query('gw') gw?: string) {
    return this.payments.handleRazorpayReturn(body, gw);
  }

  @Post('razorpay/webhook')
  @Public()
  @ApiOperation({ summary: 'Razorpay webhook (HMAC over the raw body, idempotent)' })
  razorpayWebhook(
    @Req() req: FastifyRequest,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Body() body: RazorpayWebhookDto,
    @Query('gw') gw?: string,
  ) {
    const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? JSON.stringify(body);
    return this.payments.handleRazorpayWebhook(raw, signature, body, gw);
  }

  @Post('ccavenue/return')
  @Public()
  @ApiOperation({ summary: 'CCAvenue redirect and cancel URL: encrypted response' })
  ccavenueReturned(@Body() body: CcavenueReturnDto, @Query('gw') gw?: string) {
    return this.payments.handleCcavenueReturn(body, gw);
  }

  @Post('sbiepay/return')
  @Public()
  @ApiOperation({
    summary: "SBI ePay success and fail URL: encData opened with the school account's key",
  })
  sbiepayReturned(@Body() body: Record<string, string>, @Query('gw') gw?: string) {
    return this.payments.handleSbiepayReturn({ encData: body?.encData ?? body?.encdata }, gw);
  }

  @Post('atom/return')
  @Public()
  @ApiOperation({
    summary: "Atom return URL: result signed with the school account's response hash key",
  })
  atomReturned(@Body() body: Record<string, string>, @Query('gw') gw?: string) {
    return this.payments.handleAtomReturn(body ?? {}, gw);
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

  @Post('intents/mine/misc')
  @ApiBearerAuth()
  @ApiOperation({ summary: "A guardian pays a child's misc fee online, in full" })
  @RequirePermission(PAYMENTS.familyPay)
  createMineMisc(@ReqCtx() ctx: RequestContext, @Body() body: CreateFamilyMiscIntentDto) {
    return this.payments.createFamilyMiscIntent(ctx, body);
  }

  @Get('gateways/options')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'The gateways a fee may be paid through, with their convenience charge',
  })
  @RequirePermission(PAYMENTS.familyPay)
  async gatewayOptions(@ReqCtx() ctx: RequestContext, @Query() q: GatewayOptionsQueryDto) {
    return { data: await this.payments.gatewayOptions(ctx, q.ledger) };
  }

  @Post('intents/mine/:id/checkout')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Reopen the checkout of one of my own pending payments (Sprint 19: consent-form fees)',
  })
  @RequirePermission(PAYMENTS.familyPay)
  familyCheckout(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.payments.familyCheckout(ctx, id);
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

  @Get('refunds/register')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The refund register: filters, totals and pages' })
  @RequirePermission(PAYMENTS.refundRequest)
  async refundRegister(@ReqCtx() ctx: RequestContext, @Query() q: RefundRegisterQueryDto) {
    const { rows, total, totals } = await this.refunds.register(ctx, q);
    return { data: rows, totals, page: { number: q.page, size: q.size, total } };
  }

  @Get('refunds/register/file')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The refund register as filtered, as Excel or PDF' })
  @RequirePermission(PAYMENTS.refundRequest)
  async refundRegisterFile(@ReqCtx() ctx: RequestContext, @Query() q: RefundRegisterFileQueryDto) {
    const { format, ...filters } = q;
    const f = await this.refunds.registerFile(ctx, filters, format);
    return { filename: f.filename, contentType: f.contentType, base64: f.bytes.toString('base64') };
  }

  @Get('receipts/:paymentId/refundable')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'What a receipt can still give back, head by head' })
  @RequirePermission(PAYMENTS.refundRequest)
  refundable(@ReqCtx() ctx: RequestContext, @Param('paymentId') paymentId: string) {
    return this.refunds.refundable(ctx, paymentId);
  }

  @Get('refunds/opening-advance/:studentId')
  @ApiBearerAuth()
  @ApiOperation({ summary: "What is left of a pupil's advance from last year" })
  @RequirePermission(PAYMENTS.refundRequest)
  openingAdvance(@ReqCtx() ctx: RequestContext, @Param('studentId') studentId: string) {
    return this.refunds.openingAdvance(ctx, studentId);
  }

  @Post('refunds/opening-advance')
  @ApiBearerAuth()
  @ApiOperation({ summary: "Ask to refund a pupil's advance from last year" })
  @RequirePermission(PAYMENTS.refundRequest)
  requestAdvanceRefund(@ReqCtx() ctx: RequestContext, @Body() body: RequestAdvanceRefundDto) {
    return this.refunds.requestAdvance(ctx, body);
  }

  @Get('refunds/student/:studentId/refundable')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'What a pupil can still be given back over every receipt of the year' })
  @RequirePermission(PAYMENTS.refundRequest)
  studentRefundable(@ReqCtx() ctx: RequestContext, @Param('studentId') studentId: string) {
    return this.refunds.studentRefundable(ctx, studentId);
  }

  @Post('refunds/student/:studentId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'One refund for a pupil over many receipts (one approval, one voucher)',
  })
  @RequirePermission(PAYMENTS.refundRequest)
  requestStudentRefund(
    @ReqCtx() ctx: RequestContext,
    @Param('studentId') studentId: string,
    @Body() body: RequestStudentRefundDto,
  ) {
    return this.refunds.requestForStudent(ctx, studentId, body);
  }

  @Get('refunds/:id/voucher')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The refund voucher as it prints' })
  @RequirePermission(PAYMENTS.refundRequest)
  refundVoucher(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.refunds.voucher(ctx, id);
  }

  @Get('refunds/:id/voucher-file')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The refund voucher as a PDF made at once' })
  @RequirePermission(PAYMENTS.refundRequest)
  refundVoucherFile(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.refunds.voucherFile(ctx, id);
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

  @Get('receipts/:paymentId/refund-draft')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The draft refund saved for a receipt, if any' })
  @RequirePermission(PAYMENTS.refundRequest)
  async refundDraft(@ReqCtx() ctx: RequestContext, @Param('paymentId') paymentId: string) {
    return { draft: await this.refunds.draftOf(ctx, paymentId) };
  }

  @Post('refunds/:id/send')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Send a draft refund for approval' })
  @RequirePermission(PAYMENTS.refundRequest)
  sendRefundDraft(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.refunds.sendDraft(ctx, id, 'send');
  }

  @Post('refunds/:id/discard')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Drop a draft refund' })
  @RequirePermission(PAYMENTS.refundRequest)
  discardRefundDraft(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.refunds.sendDraft(ctx, id, 'discard');
  }

  @Post('refunds/:id/fee-due')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Turn a paid refund that cancelled its fee into one whose fee stays due',
  })
  @RequirePermission(PAYMENTS.refundApprove)
  refundFeeDue(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: RefundFeeDueDto,
  ) {
    return this.refunds.feeDueAgain(ctx, id, body.reason);
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
