import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { EXAMS } from './exams.dto';
import {
  CopySubjectMarksDto,
  FillSubjectMarksDto,
  LastYearSubjectMarksDto,
  SaveSubjectMarksDto,
  SubjectMarksFileDto,
  SubjectMarksQueryDto,
} from './subject-marks.dto';
import { SubjectMarksService } from './subject-marks.service';

/**
 * The subject marks master (docs/design/70): per exam type and class, the subjects with their maximum
 * and pass marks, grade-only scale and Optional, which the exams of the type take.
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/subject-marks')
export class SubjectMarksController {
  constructor(private readonly svc: SubjectMarksService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Every exam type × class of the year: how many subjects are set' })
  @RequirePermission(EXAMS.masterView)
  overview(@ReqCtx() ctx: RequestContext) {
    return this.svc.overview(ctx);
  }

  @Get()
  @ApiOperation({ summary: "An exam type's subjects and marks for a class" })
  @RequirePermission(EXAMS.masterView)
  get(@ReqCtx() ctx: RequestContext, @Query() q: SubjectMarksQueryDto) {
    return this.svc.get(ctx, q.typeId, q.classId);
  }

  @Put()
  @ApiOperation({ summary: "Save an exam type's subjects and marks for a class (the whole list)" })
  @RequirePermission(EXAMS.masterManage)
  save(@ReqCtx() ctx: RequestContext, @Body() body: SaveSubjectMarksDto) {
    return this.svc.save(ctx, body);
  }

  @Post('copy')
  @ApiOperation({
    summary: 'Copy a list to other classes (same type) or other exam types (same class)',
  })
  @RequirePermission(EXAMS.masterManage)
  copy(@ReqCtx() ctx: RequestContext, @Body() body: CopySubjectMarksDto) {
    return this.svc.copy(ctx, body);
  }

  @Post('fill')
  @ApiOperation({ summary: "Fill the master of an exam's type from the exam's subjects" })
  @RequirePermission(EXAMS.masterManage)
  fill(@ReqCtx() ctx: RequestContext, @Body() body: FillSubjectMarksDto) {
    return this.svc.fillFromExam(ctx, body.examId);
  }

  @Post('last-year')
  @ApiOperation({ summary: "Copy last year's lists into this year (what is set already stays)" })
  @RequirePermission(EXAMS.masterManage)
  lastYear(@ReqCtx() ctx: RequestContext, @Body() body: LastYearSubjectMarksDto) {
    return this.svc.fromLastYear(ctx, body.typeId);
  }

  @Get('file')
  @ApiOperation({ summary: "An exam type's lists as Excel or PDF" })
  @RequirePermission(EXAMS.masterView)
  file(@ReqCtx() ctx: RequestContext, @Query() q: SubjectMarksFileDto) {
    return this.svc.file(ctx, q);
  }
}
