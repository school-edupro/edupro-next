import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  CreateReleaseDto,
  CreateTemplateDto,
  PreviewDto,
  RenderBatchDto,
  REPORT_CARDS,
  UpdateReleaseDto,
  UpdateTemplateDto,
} from './report-cards.dto';
import { ReportCardsService } from './report-cards.service';

/** Sprint 17: report-card templates, term releases, batch render; the family's results and card. */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/report-cards')
export class ReportCardsController {
  constructor(private readonly cards: ReportCardsService) {}

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

  @Get('releases/:id/cards')
  @RequirePermission(REPORT_CARDS.view)
  async cardsOf(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Query('classSectionId') classSectionId: string,
  ) {
    return { data: await this.cards.cards(ctx, id, classSectionId) };
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

  @Get('exports/:id')
  @RequirePermission(REPORT_CARDS.familyView)
  status(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.cards.myExportStatus(ctx, id);
  }
}
