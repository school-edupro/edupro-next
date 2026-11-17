import { Body, Controller, Delete, Get, Param, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { DomainError } from '../../common/errors/domain-error';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { BoardDetailsService } from './board-details.service';
import { BoardGazetteService } from './board-gazette.service';
import {
  BOARD_RESULTS,
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
}
