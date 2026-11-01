import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  CardsQueryDto,
  ClassPublishDto,
  CreateReleaseDto,
  CreateTemplateDto,
  GenerateCardsDto,
  HoldDto,
  SignatureDto,
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

  @Post('templates/dps')
  @ApiOperation({
    summary: 'Install the DPS Noida report cards (I-II, III-V, VI-VIII, IX, X, XI, XII)',
  })
  @RequirePermission(REPORT_CARDS.manage)
  async installDps(@ReqCtx() ctx: RequestContext) {
    return { data: await this.cards.installDps(ctx) };
  }

  @Post('templates/hpc')
  @ApiOperation({ summary: 'Install the holistic progress card (Balvatika to II)' })
  @RequirePermission(REPORT_CARDS.manage)
  async installHpc(@ReqCtx() ctx: RequestContext) {
    return { data: await this.cards.installDps(ctx, 'hpc') };
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
