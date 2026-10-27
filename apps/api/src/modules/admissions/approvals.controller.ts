import { Body, Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { AdmissionApprovalsSheetService } from './approvals-sheet.service';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ApprovalCorrectDto,
  ApprovalDecideDto,
  ApprovalDocumentDto,
  ApprovalDocumentSlotDto,
  ApprovalSheetQueryDto,
  ApprovalsQueryDto,
} from './approvals.dto';
import { AdmissionApprovalsService } from './approvals.service';
import { SendBackDto } from './process.dto';

/** A PDF from the desk's base64 answer, shown in the browser or saved. */
const pdf = (
  reply: FastifyReply,
  f: { filename: string; contentType: string; base64: string },
  download: boolean,
) =>
  void reply
    .header('content-type', f.contentType)
    .header(
      'content-disposition',
      `${download ? 'attachment' : 'inline'}; filename="${f.filename}"`,
    )
    .header('cache-control', 'private, no-store')
    .send(Buffer.from(f.base64, 'base64'));

/**
 * Admission approvers (docs/design/50): open to any signed-in staff; each registration is checked —
 * waiting at a level the user is named in (decide), or decided by them lately (look).
 */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions/approvals')
export class AdmissionApprovalsController {
  constructor(
    private readonly svc: AdmissionApprovalsService,
    private readonly sheet: AdmissionApprovalsSheetService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Registrations waiting at my levels (or decided by me), with every level remark',
  })
  @AuthenticatedOnly()
  list(@ReqCtx() ctx: RequestContext, @Query() q: ApprovalsQueryDto) {
    return this.svc.list(ctx, q);
  }

  // decisions by Excel (docs/design/55): where a sheet can be made, the sheet, the filled sheet back
  @Get('sheet/options')
  @ApiOperation({
    summary: 'Each session, class, stage and level with registrations waiting for me',
  })
  @AuthenticatedOnly()
  sheetOptions(@ReqCtx() ctx: RequestContext) {
    return this.sheet.options(ctx);
  }

  @Get('sheet')
  @ApiOperation({ summary: 'The approval sheet of one level (xlsx, as base64)' })
  @AuthenticatedOnly()
  sheetFile(@ReqCtx() ctx: RequestContext, @Query() q: ApprovalSheetQueryDto) {
    return this.sheet.sheet(ctx, q);
  }

  @Post('sheet')
  @ApiOperation({
    summary:
      'The filled sheet (xlsx as the body): checked row by row; apply=1 decides the good rows',
  })
  @AuthenticatedOnly()
  sheetUpload(
    @ReqCtx() ctx: RequestContext,
    @Query('apply') apply: string | undefined,
    @Req() req: FastifyRequest,
  ) {
    return this.sheet.upload(ctx, req.body, apply === '1');
  }

  @Get('menu')
  @ApiOperation({ summary: 'Whether the Admissions menu shows Approvals, and how many wait' })
  @AuthenticatedOnly()
  menu(@ReqCtx() ctx: RequestContext) {
    return this.svc.menu(ctx);
  }

  @Get('export')
  @ApiOperation({ summary: 'The list as filtered, to Excel (format=xlsx) or PDF (format=pdf)' })
  @AuthenticatedOnly()
  async export(
    @ReqCtx() ctx: RequestContext,
    @Query() q: ApprovalsQueryDto,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.svc.export(ctx, q);
    void reply
      .header('content-type', f.contentType)
      .header('content-disposition', `attachment; filename="${f.filename}"`)
      .send(f.bytes);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'The review of a registration waiting for me: answers, documents, points, path',
  })
  @AuthenticatedOnly()
  review(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.svc.review(ctx, id);
  }

  @Post(':id/decide')
  @ApiOperation({ summary: 'Approve, hold or reject at my level, with a remark' })
  @AuthenticatedOnly()
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ApprovalDecideDto) {
    return this.svc.decide(ctx, id, dto);
  }

  @Post(':id/send-back')
  @ApiOperation({ summary: 'Send the form back to the family to correct the marked answers' })
  @AuthenticatedOnly()
  sendBack(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: SendBackDto) {
    return this.svc.sendBack(ctx, id, dto);
  }

  @Post(':id/correct')
  @ApiOperation({
    summary: 'Correct answers (with a reason); points and fee category are worked out again',
  })
  @AuthenticatedOnly()
  correct(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: ApprovalCorrectDto) {
    return this.svc.correct(ctx, id, dto);
  }

  @Post(':id/documents/:key/slot')
  @ApiOperation({
    summary: 'Upload slot for a document the approver puts in (PDF, PNG, JPEG; 5 MB)',
  })
  @AuthenticatedOnly()
  documentSlot(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() dto: ApprovalDocumentSlotDto,
  ) {
    return this.svc.documentSlot(ctx, id, key, dto);
  }

  @Post(':id/documents/:key')
  @ApiOperation({ summary: "The uploaded file takes the family's place, with the reason" })
  @AuthenticatedOnly()
  replaceDocument(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('key') key: string,
    @Body() dto: ApprovalDocumentDto,
  ) {
    return this.svc.replaceDocument(ctx, id, key, dto);
  }

  @Get(':id/form.pdf')
  @ApiOperation({ summary: 'The registration form PDF' })
  @AuthenticatedOnly()
  async formPdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('download') download: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    pdf(reply, await this.svc.formPdf(ctx, id), download === '1');
  }

  @Get(':id/receipts/:receiptId/pdf')
  @ApiOperation({ summary: 'A payment receipt of the registration' })
  @AuthenticatedOnly()
  async receiptPdf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('receiptId') receiptId: string,
    @Query('download') download: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    pdf(reply, await this.svc.receiptPdf(ctx, id, receiptId), download === '1');
  }

  @Get(':id/files/:fileId')
  @ApiOperation({ summary: 'A document of the registration (download=1 to save it)' })
  @AuthenticatedOnly()
  async file(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('fileId') fileId: string,
    @Query('download') download: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.svc.file(ctx, id, fileId);
    void reply
      .header('content-type', f.contentType)
      .header(
        'content-disposition',
        `${download === '1' ? 'attachment' : 'inline'}; filename="document-${fileId}"`,
      )
      .header('cache-control', 'private, no-store')
      .send(f.bytes);
  }
}
