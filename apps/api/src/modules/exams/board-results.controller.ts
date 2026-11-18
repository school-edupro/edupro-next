import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { BoardAnalysisService } from './board-analysis.service';
import { BoardDetailsService } from './board-details.service';
import { BoardGazetteService } from './board-gazette.service';
import { REPORT_CARDS } from './report-cards.dto';
import {
  BOARD_RESULTS,
  BoardAnalysisFileDto,
  BoardMarksFileDto,
  BoardMarksQueryDto,
  BoardMineQueryDto,
  BoardOverallFileDto,
  BoardOverallQueryDto,
  BoardRangeFileDto,
  BoardRangeQueryDto,
  BoardSubjectPerfFileDto,
  BoardSubjectPerfQueryDto,
  BoardParentsDto,
  BoardYearFiguresDto,
  BoardAnalysisQueryDto,
  BoardClassQueryDto,
  BoardListQueryDto,
  BoardSubjectAddDto,
  BoardSubjectDto,
  BoardTeacherDto,
  BoardUploadDto,
  DetailsSheetDto,
  GazetteUploadDto,
  LayoutActiveDto,
  PickDto,
  BoardRulesDto,
} from './board-results.dto';
import { BoardResultsService } from './board-results.service';

const ID = /^[0-9]{1,18}$/;
const id = (v: string) => {
  if (!ID.test(v)) throw new DomainError('not-found', 'Not found', { status: 404 });
  return v;
};

/**
 * Board results: Sprint 18's import of a CSV / Excel file, and CBSE's result gazette (.TXT) read with a layout —
 * built in, kept, or learned by Claude from masked lines (docs/design/88).
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/board-results')
export class BoardResultsController {
  constructor(
    private readonly boards: BoardResultsService,
    private readonly gazettes: BoardGazetteService,
    private readonly details: BoardDetailsService,
    private readonly analyses: BoardAnalysisService,
  ) {}

  @Get()
  @RequirePermission(BOARD_RESULTS.view, {
    description: 'View imported board results and their analysis',
  })
  list(@ReqCtx() ctx: RequestContext, @Query() q: BoardListQueryDto) {
    return this.boards.list(ctx, q);
  }

  @Get('imports')
  @RequirePermission(BOARD_RESULTS.view)
  async imports(@ReqCtx() ctx: RequestContext) {
    return { data: await this.boards.imports(ctx) };
  }

  @Post('imports/validate')
  @ApiOperation({
    summary: 'Dry run: parse a CBSE result file (csv or xlsx), match pupils, keep the report',
  })
  @RequirePermission(BOARD_RESULTS.import, { description: 'Import board result files' })
  validate(@ReqCtx() ctx: RequestContext, @Body() body: BoardUploadDto) {
    return this.boards.validate(ctx, body);
  }

  @Post('gazette')
  @ApiOperation({
    summary:
      "Upload CBSE's result gazette (.TXT): read with a known layout or one Claude learns from masked lines; a preview, nothing saved",
  })
  @RequirePermission(BOARD_RESULTS.import)
  gazette(@ReqCtx() ctx: RequestContext, @Body() body: GazetteUploadDto) {
    return this.gazettes.upload(ctx, body);
  }

  @Get('imports/:id')
  @ApiOperation({
    summary: 'One upload: figures, problems, candidates, the layout, what it replaces',
  })
  @RequirePermission(BOARD_RESULTS.view)
  detail(@ReqCtx() ctx: RequestContext, @Param('id') importId: string) {
    return this.gazettes.detail(ctx, id(importId));
  }

  @Get('imports/:id/file')
  @ApiOperation({ summary: 'The uploaded result file as sent' })
  @RequirePermission(BOARD_RESULTS.view)
  file(@ReqCtx() ctx: RequestContext, @Param('id') importId: string) {
    return this.gazettes.file(ctx, id(importId));
  }

  @Post('imports/:id/relearn')
  @ApiOperation({
    summary: 'Ask Claude again for the layout (told which checks failed) and read the file anew',
  })
  @RequirePermission(BOARD_RESULTS.import)
  relearn(@ReqCtx() ctx: RequestContext, @Param('id') importId: string) {
    return this.gazettes.relearn(ctx, id(importId));
  }

  @Post('imports/:id/commit')
  @RequirePermission(BOARD_RESULTS.import)
  async commit(@ReqCtx() ctx: RequestContext, @Param('id') importId: string) {
    const kind = await this.boards.kindOf(ctx, id(importId));
    if (kind === 'gazette') return this.gazettes.commit(ctx, importId);
    return this.boards.commit(ctx, importId);
  }

  @Get('years')
  @ApiOperation({
    summary: 'Academic years with the year of their board examination (the upload form)',
  })
  @RequirePermission(BOARD_RESULTS.view)
  async years(@ReqCtx() ctx: RequestContext) {
    return { data: await this.gazettes.academicYears(ctx) };
  }

  @Get('layouts')
  @ApiOperation({
    summary: 'The layouts the school reads gazettes with: built in, and learned and kept',
  })
  @RequirePermission(BOARD_RESULTS.view)
  async layouts(@ReqCtx() ctx: RequestContext) {
    return { data: await this.gazettes.layouts(ctx) };
  }

  @Post('layouts/:id/active')
  @ApiOperation({
    summary: 'Switch a learned layout off (the next such file is learned again) or back on',
  })
  @RequirePermission(BOARD_RESULTS.import)
  setActive(
    @ReqCtx() ctx: RequestContext,
    @Param('id') layoutId: string,
    @Body() body: LayoutActiveDto,
  ) {
    return this.gazettes.setLayoutActive(ctx, id(layoutId), body.active);
  }

  // ---- phase B: students, details, CBSE subjects, teachers ---------------------------------------------------------
  @Get('imports/:id/review')
  @ApiOperation({
    summary:
      'A saved file: its candidates (those not found first) and the class students not linked',
  })
  @RequirePermission(BOARD_RESULTS.view)
  review(@ReqCtx() ctx: RequestContext, @Param('id') importId: string) {
    return this.details.review(ctx, id(importId));
  }

  @Post('candidates/:id/student')
  @ApiOperation({
    summary:
      'Link a candidate to a student (or mark not ours, or unlink); details and roll number follow',
  })
  @RequirePermission(BOARD_RESULTS.import)
  pick(@ReqCtx() ctx: RequestContext, @Param('id') candidateId: string, @Body() body: PickDto) {
    return this.details.pick(ctx, id(candidateId), body);
  }

  @Post('imports/:id/refresh')
  @ApiOperation({ summary: "Take every found candidate's details again from the student records" })
  @RequirePermission(BOARD_RESULTS.import)
  refresh(@ReqCtx() ctx: RequestContext, @Param('id') importId: string) {
    return this.details.refresh(ctx, id(importId));
  }

  @Get('imports/:id/details-sheet')
  @ApiOperation({
    summary:
      "The details sheet to fill: this saved file's candidates in the school's two-sheet layout, with what EduPro already has",
  })
  @RequirePermission(BOARD_RESULTS.import)
  detailsTemplate(@ReqCtx() ctx: RequestContext, @Param('id') importId: string) {
    return this.details.detailsTemplate(ctx, id(importId));
  }

  @Post('imports/:id/details-sheet')
  @ApiOperation({
    summary:
      "The school's old details sheet (roll no → details; section × code → teacher) as an override",
  })
  @RequirePermission(BOARD_RESULTS.import)
  detailsSheet(
    @ReqCtx() ctx: RequestContext,
    @Param('id') importId: string,
    @Body() body: DetailsSheetDto,
  ) {
    return this.details.detailsSheet(ctx, id(importId), body.fileBase64);
  }

  @Get('subjects')
  @ApiOperation({ summary: "The school's CBSE subject codes of a class, linked to its subjects" })
  @RequirePermission(BOARD_RESULTS.view)
  subjects(@ReqCtx() ctx: RequestContext, @Query() q: BoardClassQueryDto) {
    return this.details.subjects(ctx, q.classLabel);
  }

  @Post('subjects')
  @RequirePermission(BOARD_RESULTS.import)
  addSubject(@ReqCtx() ctx: RequestContext, @Body() body: BoardSubjectAddDto) {
    return this.details.addSubject(ctx, body);
  }

  @Put('subjects/:id')
  @RequirePermission(BOARD_RESULTS.import)
  saveSubject(
    @ReqCtx() ctx: RequestContext,
    @Param('id') subjectId: string,
    @Body() body: BoardSubjectDto,
  ) {
    return this.details.saveSubject(ctx, id(subjectId), body);
  }

  @Get('teachers')
  @ApiOperation({
    summary: 'Each section × subject of a saved year with its teacher(s) and the overrides',
  })
  @RequirePermission(BOARD_RESULTS.view)
  teachers(@ReqCtx() ctx: RequestContext, @Query() q: BoardClassQueryDto) {
    return this.details.teachers(ctx, q.classLabel, q.examYear);
  }

  @Post('teachers')
  @ApiOperation({
    summary: "A section's subject taught by another teacher (all of it, or some roll numbers)",
  })
  @RequirePermission(BOARD_RESULTS.import)
  setTeacher(@ReqCtx() ctx: RequestContext, @Body() body: BoardTeacherDto) {
    return this.details.setTeacher(ctx, body);
  }

  @Delete('teachers/:id')
  @RequirePermission(BOARD_RESULTS.import)
  removeTeacher(@ReqCtx() ctx: RequestContext, @Param('id') overrideId: string) {
    return this.details.removeTeacher(ctx, id(overrideId));
  }

  // ---- phase C: the ten annexures ----

  @Get('analysis')
  @ApiOperation({
    summary:
      "The school's ten annexures of a saved CBSE result (a class and year, one section or all), with the rules used",
  })
  @RequirePermission(BOARD_RESULTS.view)
  analysis(@ReqCtx() ctx: RequestContext, @Query() q: BoardAnalysisQueryDto) {
    return this.analyses.analysis(ctx, q);
  }

  @Get('analysis/file')
  @ApiOperation({ summary: 'The annexures as one Excel workbook, or a PDF (one annexure or all)' })
  @RequirePermission(BOARD_RESULTS.view)
  analysisFile(@ReqCtx() ctx: RequestContext, @Query() q: BoardAnalysisFileDto) {
    return this.analyses.file(ctx, q);
  }

  @Get('rules')
  @RequirePermission(BOARD_RESULTS.view)
  rules(@ReqCtx() ctx: RequestContext) {
    return this.analyses.rules(ctx);
  }

  @Put('rules')
  @ApiOperation({
    summary: 'The best five, distinction and pass marks and the grade basis the annexures use',
  })
  @RequirePermission(BOARD_RESULTS.import)
  saveRules(@ReqCtx() ctx: RequestContext, @Body() body: BoardRulesDto) {
    return this.analyses.saveRules(ctx, body);
  }

  // ---- phase D: a teacher's own, a student's, the dashboard's, the parent app switch ----

  @Get('mine')
  @ApiOperation({
    summary:
      'My board results: the sections and subjects I taught (section-wise figures, PI, ACR bands, my students)',
  })
  @RequirePermission(BOARD_RESULTS.own, {
    description: 'See my own CBSE board results: the sections and subjects I taught',
  })
  mine(@ReqCtx() ctx: RequestContext, @Query() q: BoardMineQueryDto) {
    return this.analyses.mine(ctx, q.examYear);
  }

  @Get('student/:id')
  @ApiOperation({ summary: "A student's CBSE board results, every saved year" })
  @RequirePermission(BOARD_RESULTS.view)
  student(@ReqCtx() ctx: RequestContext, @Param('id') studentId: string) {
    return this.analyses.student(ctx, id(studentId));
  }

  @Get('summary')
  @ApiOperation({ summary: "Each class's latest saved year in figures (the exam page)" })
  @RequirePermission(BOARD_RESULTS.view)
  summary(@ReqCtx() ctx: RequestContext) {
    return this.analyses.summary(ctx);
  }

  @Get('parents')
  @RequirePermission(BOARD_RESULTS.view)
  parents(@ReqCtx() ctx: RequestContext) {
    return this.analyses.parents(ctx);
  }

  @Put('parents')
  @ApiOperation({ summary: "Show (or stop showing) a child's board result on the parent app" })
  @RequirePermission(BOARD_RESULTS.import)
  setParents(@ReqCtx() ctx: RequestContext, @Body() body: BoardParentsDto) {
    return this.analyses.setParents(ctx, body.on);
  }
  // ---- phase E: an earlier year's figures typed in ----

  @Get('year-figures')
  @ApiOperation({ summary: "Earlier years' figures typed in (their result files lost), by class" })
  @RequirePermission(BOARD_RESULTS.view)
  yearFigures(@ReqCtx() ctx: RequestContext, @Query() q: BoardClassQueryDto) {
    return this.analyses.yearFigures(ctx, q.classLabel);
  }

  @Put('year-figures')
  @ApiOperation({
    summary:
      "Type (or correct) an earlier year's figures: the headline and each subject's (not for a year whose file is saved)",
  })
  @RequirePermission(BOARD_RESULTS.import)
  saveYearFigures(@ReqCtx() ctx: RequestContext, @Body() body: BoardYearFiguresDto) {
    return this.analyses.saveYearFigures(ctx, body);
  }

  @Delete('year-figures/:id')
  @RequirePermission(BOARD_RESULTS.import)
  removeYearFigures(@ReqCtx() ctx: RequestContext, @Param('id') figuresId: string) {
    return this.analyses.removeYearFigures(ctx, id(figuresId));
  }

  // ---- the Results tab: candidate-wise marks ----

  @Get('marks')
  @ApiOperation({
    summary:
      'Candidate-wise marks of a saved CBSE result: every subject, the aggregate (best five or all), percentage, class rank',
  })
  @RequirePermission(BOARD_RESULTS.view)
  marks(@ReqCtx() ctx: RequestContext, @Query() q: BoardMarksQueryDto) {
    return this.analyses.marks(ctx, q);
  }

  @Get('marks/file')
  @ApiOperation({ summary: 'The candidate-wise marks the filters keep, as Excel or PDF' })
  @RequirePermission(BOARD_RESULTS.view)
  marksFile(@ReqCtx() ctx: RequestContext, @Query() q: BoardMarksFileDto) {
    return this.analyses.marksFile(ctx, q);
  }

  // ---- the Reports tab ----

  @Get('reports/range-subjects')
  @ApiOperation({
    summary:
      "Range Wise Subject Summary: each subject's students, pass, fail, compartment, divisions, grades and marks, against earlier years",
  })
  @RequirePermission(BOARD_RESULTS.view)
  rangeSummary(@ReqCtx() ctx: RequestContext, @Query() q: BoardRangeQueryDto) {
    return this.analyses.rangeSummary(ctx, q);
  }

  @Get('reports/range-subjects/file')
  @ApiOperation({ summary: 'The Range Wise Subject Summary as Excel or PDF' })
  @RequirePermission(BOARD_RESULTS.view)
  rangeSummaryFile(@ReqCtx() ctx: RequestContext, @Query() q: BoardRangeFileDto) {
    return this.analyses.rangeSummaryFile(ctx, q);
  }

  @Get('reports/range-overall')
  @ApiOperation({
    summary:
      "Range Wise Summary: the class's students, pass, fail, compartment, divisions and aggregate ranges, against earlier years",
  })
  @RequirePermission(BOARD_RESULTS.view)
  overallSummary(@ReqCtx() ctx: RequestContext, @Query() q: BoardOverallQueryDto) {
    return this.analyses.overallSummary(ctx, q);
  }

  @Get('reports/range-overall/file')
  @ApiOperation({ summary: 'The Range Wise Summary as Excel or PDF' })
  @RequirePermission(BOARD_RESULTS.view)
  overallSummaryFile(@ReqCtx() ctx: RequestContext, @Query() q: BoardOverallFileDto) {
    return this.analyses.overallSummaryFile(ctx, q);
  }

  @Get('reports/subject-summary')
  @ApiOperation({
    summary:
      'Subject Summary: every subject by boys and girls — results, averages, highest and the marks ranges (percentage-based)',
  })
  @RequirePermission(BOARD_RESULTS.view)
  subjectPerf(@ReqCtx() ctx: RequestContext, @Query() q: BoardSubjectPerfQueryDto) {
    return this.analyses.subjectPerf(ctx, q);
  }

  @Get('reports/subject-summary/file')
  @ApiOperation({ summary: 'The Subject Summary as Excel or PDF' })
  @RequirePermission(BOARD_RESULTS.view)
  subjectPerfFile(@ReqCtx() ctx: RequestContext, @Query() q: BoardSubjectPerfFileDto) {
    return this.analyses.subjectPerfFile(ctx, q);
  }
}

/** The parent app's board results (docs/design/88, phase D): the family's children, when the school shows them. */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/mine')
export class BoardFamilyController {
  constructor(private readonly analyses: BoardAnalysisService) {}

  @Get('board-results')
  @ApiOperation({ summary: "My children's CBSE board results (when the school shows them)" })
  @RequirePermission(REPORT_CARDS.familyView)
  family(@ReqCtx() ctx: RequestContext) {
    return this.analyses.family(ctx);
  }
}
