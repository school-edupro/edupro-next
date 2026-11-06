import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  BulkHoldDto,
  CardsQueryDto,
  ClassPublishDto,
  CreateReleaseDto,
  CreateTemplateDto,
  GenerateCardsDto,
  HoldDto,
  HoldsFileDto,
  HoldsQueryDto,
  HoldsUploadDto,
  SignatureDto,
  TemplateArtDto,
  PreviewDto,
  RenderBatchDto,
  REPORT_CARDS,
  UpdateReleaseDto,
  UpdateTemplateDto,
} from './report-cards.dto';
import { ReportCardSignaturesService } from './report-card-signatures.service';
import { ReportCardsService } from './report-cards.service';

/** Sprint 17: report-card templates, term releases, batch render; the family's results and card. */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/report-cards')
export class ReportCardsController {
  constructor(
    private readonly cards: ReportCardsService,
    private readonly signatures: ReportCardSignaturesService,
  ) {}

  @Post('templates/ready-made')
  @ApiOperation({
    summary: 'Install the ready-made report cards (I-II, III-V, VI-VIII, IX, X, XI, XII)',
  })
  @RequirePermission(REPORT_CARDS.manage)
  async installReadyMade(@ReqCtx() ctx: RequestContext) {
    return { data: await this.cards.installReadyMade(ctx) };
  }

  @Post('templates/hpc')
  @ApiOperation({ summary: 'Install the holistic progress card (Balvatika to II)' })
  @RequirePermission(REPORT_CARDS.manage)
  async installHpc(@ReqCtx() ctx: RequestContext) {
    return { data: await this.cards.installReadyMade(ctx, 'hpc') };
  }

  @Get('signatures')
  @ApiOperation({ summary: 'Signatures (and the seal) the cards print, by role' })
  @RequirePermission(REPORT_CARDS.view)
  signaturesList(@ReqCtx() ctx: RequestContext) {
    return this.signatures.list(ctx);
  }

  @Post('signatures')
  @RequirePermission(REPORT_CARDS.manage)
  signatureCreate(@ReqCtx() ctx: RequestContext, @Body() body: SignatureDto) {
    return this.signatures.create(ctx, body);
  }

  @Put('signatures/:id')
  @RequirePermission(REPORT_CARDS.manage)
  signatureUpdate(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: SignatureDto,
  ) {
    return this.signatures.update(ctx, id, body);
  }

  @Get('signatures/:id/image')
  @RequirePermission(REPORT_CARDS.view)
  signatureImage(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.signatures.imageOf(ctx, id);
  }

  @Get('templates')
  @RequirePermission(REPORT_CARDS.view, {
    description: 'View report-card templates, releases and rendered cards',
  })
  async templates(@ReqCtx() ctx: RequestContext) {
    return { data: await this.cards.templates(ctx) };
  }

  @Post('templates/defaults')
  @ApiOperation({ summary: 'Install the default layout of each class band' })
  @RequirePermission(REPORT_CARDS.manage, {
    description: 'Design templates, create and release terms, render cards in batch',
  })
  async defaults(@ReqCtx() ctx: RequestContext) {
    return { data: await this.cards.installDefaults(ctx) };
  }

  @Post('templates')
  @RequirePermission(REPORT_CARDS.manage)
  createTemplate(@ReqCtx() ctx: RequestContext, @Body() body: CreateTemplateDto) {
    return this.cards.createTemplate(ctx, body);
  }

  @Patch('templates/:id')
  @RequirePermission(REPORT_CARDS.manage)
  updateTemplate(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: UpdateTemplateDto,
  ) {
    return this.cards.updateTemplate(ctx, id, body);
  }

  @Put('templates/:id/art/:slot')
  @ApiOperation({
    summary:
      "A card design's picture (docs/design/73): cover_art, cover_corner, logo_2, scholastic, co_scholastic, record",
  })
  @RequirePermission(REPORT_CARDS.manage)
  setArt(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('slot') slot: string,
    @Body() body: TemplateArtDto,
  ) {
    return this.cards.setArt(ctx, id, slot, body);
  }

  @Delete('templates/:id/art/:slot')
  @ApiOperation({ summary: "Take a card design's picture out" })
  @RequirePermission(REPORT_CARDS.manage)
  removeArt(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('slot') slot: string) {
    return this.cards.removeArt(ctx, id, slot);
  }

  @Get('templates/:id/art/:slot')
  @ApiOperation({ summary: "A card design's picture (base64), for the designer" })
  @RequirePermission(REPORT_CARDS.view)
  artImage(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('slot') slot: string) {
    return this.cards.artImage(ctx, id, slot);
  }

  @Post('templates/:id/preview')
  @ApiOperation({ summary: 'HTML of one card (a pupil of a release, or sample data of a band)' })
  @RequirePermission(REPORT_CARDS.view)
  preview(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: PreviewDto) {
    return this.cards.preview(ctx, id, body);
  }

  @Get('scope')
  @ApiOperation({
    summary: 'The classes and sections I see on Report cards',
    description:
      'Every class for whoever may publish results; else the classes I coordinate and the sections I am class teacher of',
  })
  @RequirePermission(REPORT_CARDS.view)
  scope(@ReqCtx() ctx: RequestContext) {
    return this.cards.myScope(ctx);
  }

  @Get('releases')
  @RequirePermission(REPORT_CARDS.view)
  async releases(@ReqCtx() ctx: RequestContext) {
    return { data: await this.cards.releases(ctx) };
  }

  @Post('releases')
  @RequirePermission(REPORT_CARDS.manage)
  createRelease(@ReqCtx() ctx: RequestContext, @Body() body: CreateReleaseDto) {
    return this.cards.createRelease(ctx, body);
  }

  @Get('releases/:id')
  @RequirePermission(REPORT_CARDS.view)
  release(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.cards.release(ctx, id);
  }

  @Get('releases/:id/parent-message')
  @ApiOperation({
    summary:
      "The families' message when the release is published (e-mail and SMS), filled for one of its pupils",
  })
  @RequirePermission(REPORT_CARDS.view)
  parentMessage(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.cards.parentMessage(ctx, id);
  }

  @Patch('releases/:id')
  @ApiOperation({
    summary: 'Edit a release; status released opens it to families, withdrawn closes it',
  })
  @RequirePermission(REPORT_CARDS.manage)
  updateRelease(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: UpdateReleaseDto,
  ) {
    return this.cards.updateRelease(ctx, id, body);
  }

  @Put('releases/:id/holds')
  @ApiOperation({ summary: "Hold one student's card back (with a reason), or show it again" })
  @RequirePermission(REPORT_CARDS.manage)
  hold(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: HoldDto) {
    return this.cards.setHold(ctx, id, body);
  }

  @Get('releases/:id/holds')
  @ApiOperation({
    summary: 'The held cards of a release (docs/design/75), by class, section or words',
  })
  @RequirePermission(REPORT_CARDS.view)
  holds(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: HoldsQueryDto) {
    return this.cards.holds(ctx, id, q);
  }

  @Get('releases/:id/holds/file')
  @ApiOperation({ summary: 'The held cards as Excel or PDF (base64)' })
  @RequirePermission(REPORT_CARDS.view)
  holdsFile(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: HoldsFileDto) {
    return this.cards.holdsFile(ctx, id, q);
  }

  @Post('releases/:id/holds/bulk')
  @ApiOperation({
    summary:
      'Hold many cards with one reason (also in other published cards), or show them again; the family is told when a published card is shown again',
  })
  @RequirePermission(REPORT_CARDS.manage)
  bulkHolds(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: BulkHoldDto) {
    return this.cards.bulkHolds(ctx, id, body);
  }

  @Get('releases/:id/holds/template')
  @ApiOperation({ summary: 'The Excel to fill with admission numbers and reasons (base64)' })
  @RequirePermission(REPORT_CARDS.manage)
  holdsTemplate(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.cards.holdsTemplate(ctx, id);
  }

  @Post('releases/:id/holds/upload')
  @ApiOperation({
    summary: 'A filled holds sheet: every row checked; apply holds the rows without a problem',
  })
  @RequirePermission(REPORT_CARDS.manage)
  holdsUpload(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: HoldsUploadDto,
  ) {
    return this.cards.holdsUpload(ctx, id, body);
  }

  @Get('releases/:id/readiness')
  @RequirePermission(REPORT_CARDS.view)
  readiness(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.cards.readiness(ctx, id);
  }

  @Get('releases/:id/cards')
  @ApiOperation({ summary: 'The cards of a section or a whole class, by student status' })
  @RequirePermission(REPORT_CARDS.view)
  async cardsOf(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Query() q: CardsQueryDto) {
    return { data: await this.cards.cards(ctx, id, q) };
  }

  @Put('releases/:id/classes/:classId')
  @ApiOperation({
    summary: "Publish one class's cards to its families, or revoke them with a reason",
  })
  @RequirePermission(REPORT_CARDS.view)
  classStatus(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('classId') classId: string,
    @Body() body: ClassPublishDto,
  ) {
    return this.cards.setClassStatus(ctx, id, classId, body);
  }

  @Post('releases/:id/generate')
  @ApiOperation({
    summary: 'A Cards line: a section or a class, a roll-order range or one admission number',
    description: 'A class teacher prints their own section; a coordinator their classes',
  })
  @RequirePermission(REPORT_CARDS.view)
  generate(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: GenerateCardsDto) {
    return this.cards.generate(ctx, id, body);
  }

  @Get('classes/:classId/cards')
  @ApiOperation({ summary: "A class's cards: each release that carries it and where it stands" })
  @RequirePermission(REPORT_CARDS.view)
  async classCards(@ReqCtx() ctx: RequestContext, @Param('classId') classId: string) {
    if (!/^\d{1,18}$/.test(classId))
      throw new DomainError('validation-failed', 'Unknown class', { status: 400 });
    return { data: await this.cards.classCards(ctx, classId) };
  }

  @Get('releases/:id/exports')
  @ApiOperation({ summary: 'The Download Log: the PDFs made for this release' })
  @RequirePermission(REPORT_CARDS.view)
  async exportsOf(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return { data: await this.cards.exportsOf(ctx, id) };
  }

  @Post('releases/:id/render')
  @ApiOperation({ summary: 'Render every card of a section into one PDF' })
  @RequirePermission(REPORT_CARDS.manage)
  renderBatch(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: RenderBatchDto,
  ) {
    return this.cards.renderBatch(ctx, id, body);
  }

  @Get('releases/:id/students/:studentId/preview')
  @ApiOperation({ summary: "One student's card as HTML, with the design of the student's class" })
  @RequirePermission(REPORT_CARDS.view)
  studentPreview(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    if (!/^\d{1,18}$/.test(id) || !/^\d{1,18}$/.test(studentId))
      throw new DomainError('validation-failed', 'Unknown student', { status: 400 });
    return this.cards.studentPreview(ctx, id, studentId);
  }

  @Post('releases/:id/students/:studentId/render')
  @RequirePermission(REPORT_CARDS.manage)
  renderOne(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('studentId') studentId: string,
  ) {
    return this.cards.renderOne(ctx, id, studentId);
  }
}

@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/mine')
export class FamilyResultsController {
  constructor(private readonly cards: ReportCardsService) {}

  @Get('results')
  @ApiOperation({ summary: 'Released terms of my children with the term summary' })
  @RequirePermission(REPORT_CARDS.familyView, {
    description: 'A family reads released results and report cards of its own children',
  })
  mine(@ReqCtx() ctx: RequestContext) {
    return this.cards.mine(ctx);
  }

  @Post('report-cards/:releaseId/:studentId/pdf')
  @ApiOperation({
    summary:
      'Queue my child’s report card PDF (withheld while fee dues stand, when the release says so)',
  })
  @RequirePermission(REPORT_CARDS.familyView)
  pdf(
    @ReqCtx() ctx: RequestContext,
    @Param('releaseId') releaseId: string,
    @Param('studentId') studentId: string,
  ) {
    return this.cards.myReportCardPdf(ctx, releaseId, studentId);
  }

  @Get('report-cards/:releaseId/:studentId/view')
  @ApiOperation({
    summary: 'My child’s report card as a page, at once (the same checks as the PDF)',
  })
  @RequirePermission(REPORT_CARDS.familyView)
  view(
    @ReqCtx() ctx: RequestContext,
    @Param('releaseId') releaseId: string,
    @Param('studentId') studentId: string,
  ) {
    if (!/^\d{1,18}$/.test(releaseId) || !/^\d{1,18}$/.test(studentId))
      throw new DomainError('not-found', 'Report card not found', { status: 404 });
    return this.cards.myReportCardHtml(ctx, releaseId, studentId);
  }

  @Get('exports/:id')
  @RequirePermission(REPORT_CARDS.familyView)
  status(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.cards.myExportStatus(ctx, id);
  }
}
