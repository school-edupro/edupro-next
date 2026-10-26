import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { ADMISSIONS } from './admissions.dto';
import { AdmissionNumberSeriesService } from './number-series.service';
import { AdmissionScoreReportService } from './score-report.service';
import { AdmissionScoreTablesService } from './score-tables.service';
import {
  NumberSeriesDto,
  RecalculateDto,
  ScoreImportDto,
  ScoreReportQueryDto,
  ScoreRowDto,
} from './scores.dto';
import { ADMISSION_SETUP } from './setup.controller';

const send = (reply: FastifyReply, f: { bytes: Buffer; filename: string; contentType: string }) =>
  void reply
    .header('content-type', f.contentType)
    .header('content-disposition', `attachment; filename="${f.filename}"`)
    .send(f.bytes);

/**
 * Merit score tables, the score report, Recalculate and number series (docs/design/48).
 */
@ApiTags('admissions')
@ApiBearerAuth()
@Controller('admissions')
export class AdmissionScoresController {
  constructor(
    private readonly tables: AdmissionScoreTablesService,
    private readonly report: AdmissionScoreReportService,
    private readonly series: AdmissionNumberSeriesService,
  ) {}

  // ---- score tables (part 1) ------------------------------------------------------------------------
  @Get('score-tables')
  @ApiOperation({ summary: 'Qualifications, localities and alumni schools with their scores' })
  @RequirePermission(ADMISSIONS.cycleView)
  list(@ReqCtx() ctx: RequestContext) {
    return this.tables.list(ctx);
  }

  @Get('score-tables/:table/sheet.xlsx')
  @ApiOperation({ summary: 'A score table as Excel (rows=1) or its empty format' })
  @RequirePermission(ADMISSIONS.cycleView)
  async sheet(
    @ReqCtx() ctx: RequestContext,
    @Param('table') table: string,
    @Query('rows') rows: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.tables.sheet(ctx, table, rows === '1'));
  }

  @Post('score-tables/qualification/from-list')
  @ApiOperation({
    summary: "Add the Education list's qualifications not yet in the table (0 scores)",
  })
  @RequirePermission(ADMISSION_SETUP)
  fromList(@ReqCtx() ctx: RequestContext) {
    return this.tables.fromEducationList(ctx);
  }

  @Post('score-tables/:table/import')
  @HttpCode(200)
  @ApiOperation({ summary: 'A score table from Excel: every row checked, then all saved' })
  @RequirePermission(ADMISSION_SETUP)
  importSheet(
    @ReqCtx() ctx: RequestContext,
    @Param('table') table: string,
    @Body() dto: ScoreImportDto,
  ) {
    return this.tables.importSheet(ctx, table, dto.fileBase64);
  }

  @Post('score-tables/:table')
  @RequirePermission(ADMISSION_SETUP)
  add(@ReqCtx() ctx: RequestContext, @Param('table') table: string, @Body() dto: ScoreRowDto) {
    return this.tables.save(ctx, table, null, dto);
  }

  @Put('score-tables/:table/:id')
  @RequirePermission(ADMISSION_SETUP)
  change(
    @ReqCtx() ctx: RequestContext,
    @Param('table') table: string,
    @Param('id') id: string,
    @Body() dto: ScoreRowDto,
  ) {
    return this.tables.save(ctx, table, id, dto);
  }

  @Delete('score-tables/:table/:id')
  @RequirePermission(ADMISSION_SETUP)
  archive(@ReqCtx() ctx: RequestContext, @Param('table') table: string, @Param('id') id: string) {
    return this.tables.archive(ctx, table, id);
  }

  // ---- Recalculate (part 3) and the score report (part 4) ------------------------------------------
  @Post('cycles/:id/points/recalculate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Work the points out again (a class or the session) for those not yet confirmed',
  })
  @RequirePermission(ADMISSION_SETUP)
  recalculate(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: RecalculateDto) {
    return this.report.recalculate(ctx, id, dto.classId);
  }

  @Get('score-report')
  @ApiOperation({ summary: "A class's registrations with each criterion's points, total and rank" })
  @RequirePermission(ADMISSIONS.applicationView)
  scoreReport(@ReqCtx() ctx: RequestContext, @Query() q: ScoreReportQueryDto) {
    return this.report.report(ctx, q);
  }

  @Get('score-report.xlsx')
  @RequirePermission(ADMISSIONS.applicationView)
  async scoreReportXlsx(
    @ReqCtx() ctx: RequestContext,
    @Query() q: ScoreReportQueryDto,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.report.xlsx(ctx, q));
  }

  @Get('score-report.pdf')
  @RequirePermission(ADMISSIONS.applicationView)
  async scoreReportPdf(
    @ReqCtx() ctx: RequestContext,
    @Query() q: ScoreReportQueryDto,
    @Res() reply: FastifyReply,
  ) {
    send(reply, await this.report.pdf(ctx, q));
  }

  // ---- number series (part 5) ----------------------------------------------------------------------
  @Get('number-series')
  @ApiOperation({
    summary: 'Registration and admission number series with the next number of each',
  })
  @RequirePermission(ADMISSIONS.cycleView)
  listSeries(@ReqCtx() ctx: RequestContext) {
    return this.series.list(ctx);
  }

  @Post('number-series')
  @RequirePermission(ADMISSION_SETUP)
  addSeries(@ReqCtx() ctx: RequestContext, @Body() dto: NumberSeriesDto) {
    return this.series.save(ctx, null, dto);
  }

  @Put('number-series/:id')
  @RequirePermission(ADMISSION_SETUP)
  changeSeries(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: NumberSeriesDto,
  ) {
    return this.series.save(ctx, id, dto);
  }

  @Delete('number-series/:id')
  @RequirePermission(ADMISSION_SETUP)
  archiveSeries(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.series.archive(ctx, id);
  }
}
