import { Body, Controller, Get, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  EXAMS,
  PutSubjectChoicesDto,
  SubjectChoicesQueryDto,
  SubjectChoicesUploadDto,
} from './exams.dto';
import { SubjectChoicesService } from './subject-choices.service';

/** Each student's subjects for the year (docs/design/65): compulsory, optional, additional. */
@ApiTags('exams')
@ApiBearerAuth()
@Controller('exams/subject-choices')
export class SubjectChoicesController {
  constructor(private readonly svc: SubjectChoicesService) {}

  @Get('sections')
  @ApiOperation({ summary: "The year's sections (with the number of students), for the picker" })
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
  @RequirePermission(EXAMS.masterManage)
  put(@ReqCtx() ctx: RequestContext, @Body() dto: PutSubjectChoicesDto) {
    return this.svc.put(ctx, dto);
  }

  @Post('defaults')
  @ApiOperation({ summary: "Give students without choices the class's compulsory subjects" })
  @RequirePermission(EXAMS.masterManage)
  defaults(@ReqCtx() ctx: RequestContext, @Body() dto: SubjectChoicesQueryDto) {
    return this.svc.fillDefaults(ctx, dto.classSectionId);
  }

  @Get('excel')
  @ApiOperation({ summary: "The section's choices as an Excel sheet (base64)" })
  @RequirePermission(EXAMS.marksView)
  excel(@ReqCtx() ctx: RequestContext, @Query() q: SubjectChoicesQueryDto) {
    return this.svc.excel(ctx, q.classSectionId);
  }

  @Post('upload')
  @ApiOperation({ summary: 'A filled choices sheet: preview, then save with apply' })
  @RequirePermission(EXAMS.masterManage)
  upload(@ReqCtx() ctx: RequestContext, @Body() dto: SubjectChoicesUploadDto) {
    return this.svc.upload(ctx, dto);
  }
}
