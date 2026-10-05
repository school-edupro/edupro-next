import { Body, Controller, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  CreateExamDto,
  EXAMS,
  LockExamSubjectsDto,
  SetExamSubjectsDto,
  SetPartsDto,
  UpdateExamDto,
  UpdateExamTypeDto,
  UpsertExamTypeDto,
  UpsertGradeScaleDto,
} from './exams.dto';
import { ExamsService } from './exams.service';

/** Sprint 14: exam masters (types, grade scales, exams per year and class, subjects with locks). */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams')
export class ExamsController {
  constructor(private readonly exams: ExamsService) {}

  @Get('types')
  @RequirePermission(EXAMS.masterView, {
    description: 'View exam types, exams, subjects and grade scales',
  })
  async types(@ReqCtx() ctx: RequestContext) {
    return { data: await this.exams.types(ctx) };
  }

  @Post('types')
  @RequirePermission(EXAMS.masterManage, {
    description: 'Maintain exam types, exams, subjects, locks and grade scales',
  })
  createType(@ReqCtx() ctx: RequestContext, @Body() dto: UpsertExamTypeDto) {
    return this.exams.createType(ctx, dto);
  }

  @Patch('types/:id')
  @RequirePermission(EXAMS.masterManage)
  updateType(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: UpdateExamTypeDto,
  ) {
    return this.exams.updateType(ctx, id, dto);
  }

  @Get('grade-scales')
  @RequirePermission(EXAMS.masterView)
  async scales(@ReqCtx() ctx: RequestContext) {
    return { data: await this.exams.scales(ctx) };
  }

  @Put('grade-scales')
  @ApiOperation({ summary: 'Create or replace a grade scale and its bands' })
  @RequirePermission(EXAMS.masterManage)
  upsertScale(@ReqCtx() ctx: RequestContext, @Body() dto: UpsertGradeScaleDto) {
    return this.exams.upsertScale(ctx, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Exams of the working year with their classes' })
  @RequirePermission(EXAMS.masterView)
  async list(@ReqCtx() ctx: RequestContext) {
    return { data: await this.exams.exams(ctx) };
  }

  @Post()
  @RequirePermission(EXAMS.masterManage)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateExamDto) {
    return this.exams.createExam(ctx, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One exam with its classes and subjects' })
  @RequirePermission(EXAMS.masterView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.exams.exam(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(EXAMS.masterManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateExamDto) {
    return this.exams.updateExam(ctx, id, dto);
  }

  @Put(':id/subjects/:examSubjectId/parts')
  @ApiOperation({
    summary:
      'The parts an exam subject is entered in (Theory / Practical, or one per teaching subject)',
  })
  @RequirePermission(EXAMS.masterManage)
  setParts(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Param('examSubjectId') examSubjectId: string,
    @Body() dto: SetPartsDto,
  ) {
    return this.exams.setParts(ctx, id, examSubjectId, dto);
  }

  @Put(':id/subjects')
  @ApiOperation({
    summary: 'Replace the subjects of one class in the exam (max marks, pass marks, dates)',
  })
  @RequirePermission(EXAMS.masterManage)
  setSubjects(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() dto: SetExamSubjectsDto,
  ) {
    return this.exams.setSubjects(ctx, id, dto);
  }

  @Post(':id/subjects/lock')
  @ApiOperation({ summary: 'Lock or unlock marks entry for subjects of one class' })
  @RequirePermission(EXAMS.masterManage)
  lock(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: LockExamSubjectsDto) {
    return this.exams.lockSubjects(ctx, id, dto);
  }
}
