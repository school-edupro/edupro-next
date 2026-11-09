import { Body, Controller, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PurchaseCountsService } from './purchase-counts.service';
import { PurchaseIssuesService } from './purchase-issues.service';
import { PurchaseReturnsService } from './purchase-returns.service';
import { PurchaseTransfersService } from './purchase-transfers.service';
import {
  AcknowledgeDto,
  CountDecisionDto,
  CountDto,
  CountImportDto,
  CountLinesDto,
  CountViewDto,
  IssueDto,
  ReleaseHoldDto,
  NoteDto,
  PURCHASE,
  ReturnToStoreDto,
  ReturnSourceQueryDto,
  StockDocQueryDto,
  TransferDto,
  VendorReturnDto,
} from './purchase.dto';

const pdf = (
  reply: FastifyReply,
  save: string | undefined,
  f: { bytes: Buffer; filename: string },
) =>
  void reply
    .header('content-type', 'application/pdf')
    .header(
      'content-disposition',
      `${save === '1' ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
    )
    .header('cache-control', 'private, no-store')
    .send(f.bytes);

/**
 * Purchase phase 2, part 8 (docs/design/84): issues and their acknowledgement, returns to the store
 * and to the vendor, transfers between stores, the physical count. Keepers work the stores they keep
 * (checked in the services); the department acknowledges what it was issued (no right of its own).
 */
@ApiTags('purchase')
@ApiBearerAuth()
@Controller('purchase')
export class PurchaseStockController {
  constructor(
    private readonly issues: PurchaseIssuesService,
    private readonly returns: PurchaseReturnsService,
    private readonly transfers: PurchaseTransfersService,
    private readonly counts: PurchaseCountsService,
  ) {}

  // ---- issues -----------------------------------------------------------------------------------------
  @Get('issues')
  @ApiOperation({ summary: 'Issues (the stores see all; a department sees what it was issued)' })
  @AuthenticatedOnly()
  listIssues(@ReqCtx() ctx: RequestContext, @Query() q: StockDocQueryDto) {
    return this.issues.list(ctx, q);
  }

  @Post('to-issue/:reservationId/release')
  @ApiOperation({
    summary: 'Let go what is held for an indent line (not in the store): the rest goes to purchase',
  })
  @RequirePermission(PURCHASE.storeOperate)
  releaseHold(
    @ReqCtx() ctx: RequestContext,
    @Param('reservationId') reservationId: string,
    @Body() body: ReleaseHoldDto,
  ) {
    return this.issues.releaseHold(ctx, reservationId, body);
  }

  @Get('to-issue')
  @ApiOperation({ summary: 'Reserved requisition lines still to issue, in the stores I keep' })
  @RequirePermission(PURCHASE.storeOperate)
  toIssue(@ReqCtx() ctx: RequestContext) {
    return this.issues.toIssue(ctx);
  }

  @Get('issue-form')
  @RequirePermission(PURCHASE.storeOperate)
  issueForm(@ReqCtx() ctx: RequestContext) {
    return this.issues.formLists(ctx);
  }

  @Post('issues')
  @ApiOperation({ summary: 'Issue against a requisition’s reservations, or at the counter' })
  @RequirePermission(PURCHASE.storeOperate)
  issue(@ReqCtx() ctx: RequestContext, @Body() body: IssueDto) {
    return this.issues.create(ctx, body);
  }

  @Get('issues/:id')
  @AuthenticatedOnly()
  getIssue(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.issues.get(ctx, id);
  }

  @Post('issues/:id/acknowledge')
  @ApiOperation({
    summary: 'The department acknowledges what it received (or the store a signed slip)',
  })
  @AuthenticatedOnly()
  acknowledge(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: AcknowledgeDto,
  ) {
    return this.issues.acknowledge(ctx, id, body);
  }

  @Post('issues/:id/return')
  @ApiOperation({ summary: 'Goods brought back to the store against the issue' })
  @RequirePermission(PURCHASE.storeOperate)
  returnToStore(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: ReturnToStoreDto,
  ) {
    return this.issues.returnToStore(ctx, id, body);
  }

  @Get('issues/:id/pdf')
  @ApiOperation({ summary: 'The issue slip' })
  @AuthenticatedOnly()
  async issuePdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    pdf(reply, save, await this.issues.slip(ctx, id));
  }

  // ---- returns ----------------------------------------------------------------------------------------
  @Get('returns')
  @RequirePermission(PURCHASE.storeView)
  listReturns(@ReqCtx() ctx: RequestContext, @Query() q: StockDocQueryDto) {
    return this.returns.list(ctx, q);
  }

  @Get('return-sources')
  @ApiOperation({
    summary:
      'Where a new return starts: POs with goods to send back, or issues with goods to take back',
  })
  @RequirePermission(PURCHASE.storeView)
  returnSources(@ReqCtx() ctx: RequestContext, @Query() q: ReturnSourceQueryDto) {
    return this.returns.sources(ctx, q);
  }

  @Get('returnable/:orderId')
  @ApiOperation({ summary: 'What of a PO can go back to the vendor' })
  @RequirePermission(PURCHASE.storeView)
  returnable(@ReqCtx() ctx: RequestContext, @Param('orderId') orderId: string) {
    return this.returns.returnable(ctx, orderId);
  }

  @Post('vendor-returns')
  @ApiOperation({ summary: 'Return rejected or defective goods to the vendor' })
  @RequirePermission(PURCHASE.storeOperate)
  vendorReturn(@ReqCtx() ctx: RequestContext, @Body() body: VendorReturnDto) {
    return this.returns.create(ctx, body);
  }

  @Get('returns/:id')
  @RequirePermission(PURCHASE.storeView)
  getReturn(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.returns.get(ctx, id);
  }

  @Get('returns/:id/pdf')
  @RequirePermission(PURCHASE.storeView)
  async returnPdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    pdf(reply, save, await this.returns.pdf(ctx, id));
  }

  // ---- transfers --------------------------------------------------------------------------------------
  @Get('transfers')
  @RequirePermission(PURCHASE.storeView)
  listTransfers(@ReqCtx() ctx: RequestContext, @Query() q: StockDocQueryDto) {
    return this.transfers.list(ctx, q);
  }

  @Post('transfers')
  @RequirePermission(PURCHASE.storeOperate)
  transfer(@ReqCtx() ctx: RequestContext, @Body() body: TransferDto) {
    return this.transfers.create(ctx, body);
  }

  @Get('transfers/:id')
  @RequirePermission(PURCHASE.storeView)
  getTransfer(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.transfers.get(ctx, id);
  }

  @Post('transfers/:id/receive')
  @RequirePermission(PURCHASE.storeOperate)
  receiveTransfer(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: NoteDto) {
    return this.transfers.receive(ctx, id, body);
  }

  @Post('transfers/:id/cancel')
  @RequirePermission(PURCHASE.storeOperate)
  cancelTransfer(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: NoteDto) {
    return this.transfers.cancel(ctx, id, body);
  }

  @Get('transfers/:id/pdf')
  @RequirePermission(PURCHASE.storeView)
  async transferPdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    pdf(reply, save, await this.transfers.pdf(ctx, id));
  }

  // ---- counts -----------------------------------------------------------------------------------------
  @Get('counts')
  // the stores; ?mine=1 (waiting at my level) for anyone (checked in the service)
  @AuthenticatedOnly()
  listCounts(@ReqCtx() ctx: RequestContext, @Query() q: StockDocQueryDto) {
    return this.counts.list(ctx, q);
  }

  @Post('counts')
  @ApiOperation({ summary: 'Start a physical count of a store (or one category)' })
  @RequirePermission(PURCHASE.storeOperate)
  startCount(@ReqCtx() ctx: RequestContext, @Body() body: CountDto) {
    return this.counts.create(ctx, body);
  }

  @Get('counts/:id')
  // the stores, or someone on its approval (checked in the service)
  @AuthenticatedOnly()
  getCount(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: CountViewDto) {
    return this.counts.get(ctx, id, q);
  }

  @Put('counts/:id/lines')
  @RequirePermission(PURCHASE.storeOperate)
  countLines(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CountLinesDto) {
    return this.counts.saveLines(ctx, id, body);
  }

  @Get('counts/:id/sheet')
  @ApiOperation({ summary: 'The count sheet as Excel (blind)' })
  @RequirePermission(PURCHASE.storeView)
  countSheet(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.counts.sheet(ctx, id);
  }

  @Post('counts/:id/import')
  @RequirePermission(PURCHASE.storeOperate)
  countImport(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CountImportDto,
  ) {
    return this.counts.importSheet(ctx, id, body);
  }

  @Post('counts/:id/submit')
  @RequirePermission(PURCHASE.storeOperate)
  submitCount(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.counts.submit(ctx, id);
  }

  @Post('counts/:id/decide')
  @ApiOperation({ summary: 'Approve the count (its differences post) or send it back' })
  // the approver at the count's level on Purchase → Who approves (checked in the service)
  @AuthenticatedOnly()
  decideCount(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: CountDecisionDto,
  ) {
    return this.counts.decide(ctx, id, body);
  }

  @Post('counts/:id/cancel')
  @RequirePermission(PURCHASE.storeOperate)
  cancelCount(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: NoteDto) {
    return this.counts.cancel(ctx, id, body);
  }

  @Get('counts/:id/statement')
  @ApiOperation({ summary: 'The count as Excel: book, counted, excess, shortage, value, reason' })
  // the stores, or someone on its approval (checked in the service)
  @AuthenticatedOnly()
  countStatement(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.counts.statement(ctx, id);
  }

  @Get('counts/:id/pdf')
  // the stores, or someone on its approval (checked in the service)
  @AuthenticatedOnly()
  async countPdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    pdf(reply, save, await this.counts.pdf(ctx, id));
  }
}
