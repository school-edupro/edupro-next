import { Body, Controller, Delete, Get, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { PurchaseRequisitionsService } from './purchase-requisitions.service';
import {
  CertificateDto,
  ChoicesDto,
  CreateRequisitionDto,
  IndentDecisionDto,
  PURCHASE,
  QuoteDto,
  ReasonDto,
  RequisitionFileDto,
  RequisitionExportQueryDto,
  RequisitionListQueryDto,
  SignDto,
  TenderDto,
  UpdateRequisitionDto,
} from './purchase.dto';

/**
 * Purchase, part 3 (docs/design/83): the Purchase Requisition — made by the purchase office, sourced by
 * tier (certificate, quotes and the comparative statement with the committee's signatures, tender),
 * approved on the department's PR levels. Approvers and committee members reach theirs without a right
 * of their own (the levels and the committee decide).
 */
@ApiTags('purchase')
@ApiBearerAuth()
@Controller('purchase')
export class PurchaseRequisitionsController {
  constructor(private readonly prs: PurchaseRequisitionsService) {}

  @Get('requisitions')
  @ApiOperation({
    summary: 'Requisitions: all (purchase office), waiting for me, to sign (committee)',
  })
  @AuthenticatedOnly()
  list(@ReqCtx() ctx: RequestContext, @Query() q: RequisitionListQueryDto) {
    return this.prs.list(ctx, q);
  }

  @Get('requisition-candidates')
  @ApiOperation({ summary: 'Approved indents waiting for a requisition, with their lines' })
  @RequirePermission(PURCHASE.requisitionManage)
  candidates(@ReqCtx() ctx: RequestContext) {
    return this.prs.candidates(ctx);
  }

  @Get('requisition-form')
  @RequirePermission(PURCHASE.requisitionManage)
  form(@ReqCtx() ctx: RequestContext) {
    return this.prs.formLists(ctx);
  }

  @Get('requisitions/export')
  @ApiOperation({ summary: 'The requisitions list as on screen (its filters), as Excel or PDF' })
  @AuthenticatedOnly()
  exportList(@ReqCtx() ctx: RequestContext, @Query() q: RequisitionExportQueryDto) {
    return this.prs.exportList(ctx, q);
  }

  @Get('requisitions/:id/documents/:indentLineId')
  @ApiOperation({ summary: 'The document of an indent line the PR came from' })
  @AuthenticatedOnly()
  async indentDocument(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('indentLineId') indentLineId: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.prs.indentDocument(ctx, id, indentLineId);
    void reply
      .header('content-type', f.contentType)
      .header(
        'content-disposition',
        `${save === '1' ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
      )
      .header('cache-control', 'private, no-store')
      .header('x-content-type-options', 'nosniff')
      .send(f.bytes);
  }

  @Get('requisitions/:id/pdf')
  @ApiOperation({ summary: 'The printed Purchase Requisition (with the comparative statement)' })
  @AuthenticatedOnly()
  async pdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('save') save: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.prs.pdf(ctx, id);
    void reply
      .header('content-type', 'application/pdf')
      .header(
        'content-disposition',
        `${save === '1' ? 'attachment' : 'inline'}; filename="${f.filename.replace(/[^\w.\- ]+/g, '_')}"`,
      )
      .header('cache-control', 'private, no-store')
      .send(f.bytes);
  }

  @Get('requisitions/:id')
  @AuthenticatedOnly()
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.prs.get(ctx, id);
  }

  @Post('requisitions')
  @ApiOperation({
    summary: 'A requisition from approved indents (lines combined by item), or direct',
  })
  @RequirePermission(PURCHASE.requisitionManage)
  create(@ReqCtx() ctx: RequestContext, @Body() body: CreateRequisitionDto) {
    return this.prs.create(ctx, body);
  }

  @Put('requisitions/:id')
  @RequirePermission(PURCHASE.requisitionManage)
  update(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: UpdateRequisitionDto,
  ) {
    return this.prs.update(ctx, id, body);
  }

  @Post('requisitions/:id/quotes')
  @RequirePermission(PURCHASE.requisitionManage)
  addQuote(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: QuoteDto) {
    return this.prs.saveQuote(ctx, id, null, body);
  }

  @Put('requisitions/:id/quotes/:quoteId')
  @RequirePermission(PURCHASE.requisitionManage)
  updateQuote(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
    @Body() body: QuoteDto,
  ) {
    return this.prs.saveQuote(ctx, id, quoteId, body);
  }

  @Delete('requisitions/:id/quotes/:quoteId')
  @RequirePermission(PURCHASE.requisitionManage)
  removeQuote(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('quoteId') quoteId: string,
  ) {
    return this.prs.removeQuote(ctx, id, quoteId);
  }

  @Put('requisitions/:id/choices')
  @ApiOperation({ summary: 'The vendor and rate per line (a dearer one than L1 with a reason)' })
  @RequirePermission(PURCHASE.requisitionManage)
  choose(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ChoicesDto) {
    return this.prs.choose(ctx, id, body);
  }

  @Put('requisitions/:id/certificate')
  @RequirePermission(PURCHASE.requisitionManage)
  certify(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: CertificateDto) {
    return this.prs.certify(ctx, id, body);
  }

  @Delete('requisitions/:id/certificate')
  @RequirePermission(PURCHASE.requisitionManage)
  uncertify(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.prs.certify(ctx, id, null);
  }

  @Put('requisitions/:id/tender')
  @RequirePermission(PURCHASE.requisitionManage)
  tender(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: TenderDto) {
    return this.prs.saveTender(ctx, id, body);
  }

  @Post('requisitions/:id/files')
  @RequirePermission(PURCHASE.requisitionManage)
  addFile(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: RequisitionFileDto,
  ) {
    return this.prs.addFile(ctx, id, body);
  }

  @Delete('requisitions/:id/files/:fileId')
  @RequirePermission(PURCHASE.requisitionManage)
  removeFile(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
  ) {
    return this.prs.removeFile(ctx, id, fileId);
  }

  @Post('requisitions/:id/sign')
  @ApiOperation({ summary: 'A purchase committee member signs the comparative statement' })
  @AuthenticatedOnly()
  sign(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: SignDto) {
    return this.prs.sign(ctx, id, body);
  }

  @Delete('requisitions/:id/sign')
  @AuthenticatedOnly()
  unsign(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.prs.sign(ctx, id, null);
  }

  @Post('requisitions/:id/submit')
  @RequirePermission(PURCHASE.requisitionManage)
  submit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.prs.submit(ctx, id);
  }

  @Post('requisitions/:id/decide')
  @AuthenticatedOnly()
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: IndentDecisionDto) {
    return this.prs.decide(ctx, id, body);
  }

  @Post('requisitions/:id/cancel')
  @RequirePermission(PURCHASE.requisitionManage)
  cancel(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.prs.cancel(ctx, id, body);
  }

  @Post('requisitions/:id/reopen')
  @RequirePermission(PURCHASE.requisitionManage)
  reopen(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.prs.reopen(ctx, id, body);
  }

  @Post('indents/:id/close')
  @ApiOperation({ summary: 'The purchase office closes an approved indent it will not buy' })
  @RequirePermission(PURCHASE.requisitionManage)
  closeIndent(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReasonDto) {
    return this.prs.closeIndent(ctx, id, body);
  }
}
