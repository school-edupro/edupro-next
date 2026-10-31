import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { AuthenticatedOnly } from '../../common/auth/decorators';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ChoicesFindDto,
  ChoicesHistoryDto,
  ChoicesListFileDto,
  ClassBulkChoiceDto,
  EXAMS,
  PutSubjectChoicesDto,
  PutSubjectSetupDto,
  SubjectChoicesQueryDto,
  SubjectChoicesUploadDto,
  SubjectClassQueryDto,
  SubjectCountsFileDto,
} from './exams.dto';
import { SubjectChoicesService } from './subject-choices.service';

/**
 * Each student's subjects for the year (docs/design/65, 67): the class's subject order, choice groups
 * and streams; choices set by the office or the section's class teacher (checked in the service).
 */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/subject-choices')
export class SubjectChoicesController {
  constructor(private readonly svc: SubjectChoicesService) {}

  @Get('sections')
  @ApiOperation({
    summary: "The year's sections (with the number of students and whether the caller sets them)",
  })
  @RequirePermission(EXAMS.marksView)
  sections(@ReqCtx() ctx: RequestContext) {
    return this.svc.sections(ctx);
  }

  @Get()
  @ApiOperation({ summary: "A section's students with their subjects for the year" })
  @RequirePermission(EXAMS.marksView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: SubjectChoicesQueryDto) {
    return this.svc.list(ctx, q.classSectionId);
  }

  @Put()
  @ApiOperation({ summary: "Set students' subjects (each list replaces the student's)" })
  @AuthenticatedOnly()
  put(@ReqCtx() ctx: RequestContext, @Body() dto: PutSubjectChoicesDto) {
    return this.svc.put(ctx, dto);
  }

  @Post('defaults')
  @ApiOperation({ summary: "Give students without choices the class's compulsory subjects" })
  @AuthenticatedOnly()
  defaults(@ReqCtx() ctx: RequestContext, @Body() dto: SubjectChoicesQueryDto) {
    return this.svc.fillDefaults(ctx, dto.classSectionId);
  }

  @Post('last-year')
  @ApiOperation({ summary: "Give students without choices their last year's subjects and stream" })
  @AuthenticatedOnly()
  lastYear(@ReqCtx() ctx: RequestContext, @Body() dto: SubjectChoicesQueryDto) {
    return this.svc.lastYear(ctx, dto.classSectionId);
  }

  @Post('bulk')
  @ApiOperation({
    summary: 'Set one column for every section of a class (stream, a group subject, an elective)',
  })
  @AuthenticatedOnly()
  bulk(@ReqCtx() ctx: RequestContext, @Body() dto: ClassBulkChoiceDto) {
    return this.svc.bulk(ctx, dto);
  }

  @Get('list-file')
  @ApiOperation({ summary: "A section's or a class's students with their subjects (Excel or PDF)" })
  @RequirePermission(EXAMS.marksView)
  listFile(@ReqCtx() ctx: RequestContext, @Query() q: ChoicesListFileDto) {
    return this.svc.listFile(ctx, {
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.classSectionId ? { classSectionId: q.classSectionId } : {}),
      format: q.format,
      portrait: q.portrait === 'true',
    });
  }

  @Get('find')
  @ApiOperation({ summary: 'Students of the year by admission no or name, with their section' })
  @RequirePermission(EXAMS.marksView)
  find(@ReqCtx() ctx: RequestContext, @Query() q: ChoicesFindDto) {
    return this.svc.find(ctx, q.q);
  }

  @Get('history')
  @ApiOperation({ summary: "Who changed a student's subjects this year, and what" })
  @RequirePermission(EXAMS.marksView)
  history(@ReqCtx() ctx: RequestContext, @Query() q: ChoicesHistoryDto) {
    return this.svc.history(ctx, q.studentId);
  }

  @Get('excel')
  @ApiOperation({ summary: "The section's choices as an Excel sheet (base64)" })
  @RequirePermission(EXAMS.marksView)
  excel(@ReqCtx() ctx: RequestContext, @Query() q: SubjectChoicesQueryDto) {
    return this.svc.excel(ctx, q.classSectionId);
  }

  @Post('upload')
  @ApiOperation({ summary: 'A filled choices sheet: preview, then save with apply' })
  @AuthenticatedOnly()
  upload(@ReqCtx() ctx: RequestContext, @Body() dto: SubjectChoicesUploadDto) {
    return this.svc.upload(ctx, dto);
  }

  @Get('setup')
  @ApiOperation({ summary: "A class's subjects in order, with its choice groups and streams" })
  @RequirePermission(EXAMS.marksView)
  setup(@ReqCtx() ctx: RequestContext, @Query() q: SubjectClassQueryDto) {
    return this.svc.setup(ctx, q.classId);
  }

  @Put('setup')
  @ApiOperation({ summary: "Set a class's subject order, choice groups and streams" })
  @RequirePermission(EXAMS.masterManage)
  putSetup(@ReqCtx() ctx: RequestContext, @Body() dto: PutSubjectSetupDto) {
    return this.svc.putSetup(ctx, dto);
  }

  @Get('counts')
  @ApiOperation({ summary: 'How many students take each subject of a class, section by section' })
  @RequirePermission(EXAMS.marksView)
  counts(@ReqCtx() ctx: RequestContext, @Query() q: SubjectClassQueryDto) {
    return this.svc.counts(ctx, q.classId);
  }

  @Get('counts/file')
  @ApiOperation({ summary: 'The subject counts as Excel or PDF (base64)' })
  @RequirePermission(EXAMS.marksView)
  countsFile(@ReqCtx() ctx: RequestContext, @Query() q: SubjectCountsFileDto) {
    return this.svc.countsFile(ctx, q.classId, q.format);
  }
}
