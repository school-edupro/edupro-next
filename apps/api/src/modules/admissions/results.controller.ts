import { Body, Controller, Get, Post, Put, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ADMISSIONS } from './admissions.dto';
import { ADMISSION_SCHEDULE } from './process.service';
import {
  ResultsExportDto,
  ResultsOverviewDto,
  ResultsPlaceDto,
  ResultsQueryDto,
  ResultsReleaseDto,
  ResultsSaveDto,
  ResultsSessionExportDto,
  ResultsSheetDto,
  ResultsUploadQueryDto,
} from './results.dto';
import { AdmissionResultsService } from './results.service';

/**
 * Test and interview results by part (docs/design/57, part 2): the grid of a session, class and stage,
 * saved from the screen or by the class's sheet, and exported. Reading needs the registrations; marks
 * and decisions are the admission office's (the tests and interviews right).
 */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions/results')
export class AdmissionResultsController {
  constructor(private readonly svc: AdmissionResultsService) {}

  @Get('options')
  @ApiOperation({ summary: 'Sessions with their classes, and the Test and Interview stages' })
  @RequirePermission(ADMISSIONS.applicationView)
  options(@ReqCtx() ctx: RequestContext) {
    return this.svc.options(ctx);
  }

  @Get('overview')
  @ApiOperation({
    summary:
      "A session's classes and stages: candidates, marked, waiting, decided, cut-off, release",
  })
  @RequirePermission(ADMISSIONS.applicationView)
  overview(@ReqCtx() ctx: RequestContext, @Query() q: ResultsOverviewDto) {
    return this.svc.overview(ctx, q.cycleId);
  }

  @Get('export-session')
  @ApiOperation({
    summary: 'The whole session: an overview, then each class and stage (Excel or PDF, base64)',
  })
  @RequirePermission(ADMISSIONS.applicationView)
  exportSession(@ReqCtx() ctx: RequestContext, @Query() q: ResultsSessionExportDto) {
    return this.svc.exportSession(ctx, q);
  }

  @Get()
  @ApiOperation({
    summary: 'Each candidate at (or past) the stage with marks by part, total and %',
  })
  @RequirePermission(ADMISSIONS.applicationView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: ResultsQueryDto) {
    return this.svc.list(ctx, q);
  }

  @Put()
  @ApiOperation({
    summary: 'Rows saved from the screen: marks by part, absent, remark, a decision',
  })
  @RequirePermission(ADMISSION_SCHEDULE)
  save(@ReqCtx() ctx: RequestContext, @Body() dto: ResultsSaveDto) {
    return this.svc.save(ctx, dto);
  }

  @Get('sheet')
  @ApiOperation({ summary: "The class's results sheet (xlsx, as base64)" })
  @RequirePermission(ADMISSION_SCHEDULE)
  sheet(@ReqCtx() ctx: RequestContext, @Query() q: ResultsSheetDto) {
    return this.svc.sheet(ctx, q);
  }

  @Post('sheet')
  @ApiOperation({
    summary: 'The filled sheet (xlsx or csv as the body): checked row by row; apply=1 saves',
  })
  @RequirePermission(ADMISSION_SCHEDULE)
  upload(
    @ReqCtx() ctx: RequestContext,
    @Query() q: ResultsUploadQueryDto,
    @Req() req: FastifyRequest,
  ) {
    return this.svc.upload(ctx, req.body, q.apply === '1');
  }

  @Put('release')
  @ApiOperation({
    summary: 'The results of a class and stage shown to families from a date and time',
  })
  @RequirePermission(ADMISSION_SCHEDULE)
  release(@ReqCtx() ctx: RequestContext, @Body() dto: ResultsReleaseDto) {
    return this.svc.setRelease(ctx, dto);
  }

  @Post('release/withdraw')
  @ApiOperation({ summary: 'A release withdrawn before its time' })
  @RequirePermission(ADMISSION_SCHEDULE)
  withdraw(@ReqCtx() ctx: RequestContext, @Body() dto: ResultsPlaceDto) {
    return this.svc.withdrawRelease(ctx, dto);
  }

  @Post('release/tell')
  @ApiOperation({ summary: 'The families told the results are out (email, SMS, WhatsApp)' })
  @RequirePermission(ADMISSION_SCHEDULE)
  tell(@ReqCtx() ctx: RequestContext, @Body() dto: ResultsPlaceDto) {
    return this.svc.tell(ctx, dto);
  }

  @Get('export')
  @ApiOperation({ summary: 'The grid as filtered, as Excel or PDF (base64)' })
  @RequirePermission(ADMISSIONS.applicationView)
  export(@ReqCtx() ctx: RequestContext, @Query() q: ResultsExportDto) {
    return this.svc.export(ctx, q);
  }
}
