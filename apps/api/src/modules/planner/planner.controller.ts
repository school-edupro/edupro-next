import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { LessonPlansService } from './lesson-plans.service';
import { LessonUploadsService } from './lesson-uploads.service';
import {
  CoverageQueryDto,
  CreateLessonPlanDto,
  LessonDecideDto,
  LessonListDto,
  LessonRangeDto,
  LessonRuleDto,
  LessonUploadDto,
  MarkTopicDto,
  SaveChapterDto,
  SaveTopicDto,
  SyllabusImportDto,
  SyllabusReportDto,
  SyllabusTreeDto,
  WeekQueryDto,
  CreateSubstitutionDto,
  FreeTeachersQueryDto,
  ListLessonPlansDto,
  PLANNER,
  SubstitutionQueryDto,
  UpdateLessonPlanDto,
} from './planner.dto';
import { SubstitutionsService } from './substitutions.service';
import { SyllabusService } from './syllabus.service';

@ApiTags('planner')
@ApiBearerAuth()
@Controller('academics/lesson-plans')
export class LessonPlansController {
  constructor(private readonly plans: LessonPlansService) {}

  @Get()
  @ApiOperation({ summary: 'Lesson plans visible to the viewer (scoped for class teachers)' })
  @RequirePermission(PLANNER.planView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: ListLessonPlansDto) {
    return this.plans.list(ctx, q);
  }

  @Get('mine')
  @RequirePermission(PLANNER.planManage)
  mine(@ReqCtx() ctx: RequestContext) {
    return this.plans.mine(ctx);
  }

  @Post()
  @ApiOperation({ summary: 'Write a weekly plan (optionally submit it for approval)' })
  @RequirePermission(PLANNER.planManage)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateLessonPlanDto) {
    return this.plans.create(ctx, dto);
  }

  @Get(':id')
  @RequirePermission(PLANNER.planView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.plans.get(ctx, id);
  }

  @Patch(':id')
  @RequirePermission(PLANNER.planManage)
  update(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() dto: UpdateLessonPlanDto) {
    return this.plans.update(ctx, id, dto);
  }

  @Post(':id/submit')
  @RequirePermission(PLANNER.planManage)
  submit(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.plans.submit(ctx, id);
  }
}

@ApiTags('planner')
@ApiBearerAuth()
@Controller('academics/substitutions')
export class SubstitutionsController {
  constructor(private readonly subs: SubstitutionsService) {}

  @Get()
  @RequirePermission(PLANNER.subView)
  list(@ReqCtx() ctx: RequestContext, @Query() q: SubstitutionQueryDto) {
    return this.subs.list(ctx, q);
  }

  @Get('mine')
  @RequirePermission(PLANNER.subView)
  mine(@ReqCtx() ctx: RequestContext) {
    return this.subs.mine(ctx);
  }

  @Get('free-teachers')
  @ApiOperation({ summary: 'Teachers free at a period on a date, lightest load first' })
  @RequirePermission(PLANNER.subManage)
  free(@ReqCtx() ctx: RequestContext, @Query() q: FreeTeachersQueryDto) {
    return this.subs.freeTeachers(ctx, q);
  }

  @Post()
  @ApiOperation({
    summary: 'Arrange a substitution; refuses a substitute who already teaches that period',
  })
  @RequirePermission(PLANNER.subManage)
  create(@ReqCtx() ctx: RequestContext, @Body() dto: CreateSubstitutionDto) {
    return this.subs.create(ctx, dto);
  }

  @Delete(':id')
  @RequirePermission(PLANNER.subManage)
  remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.subs.remove(ctx, id);
  }
}

@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics/syllabus')
export class SyllabusController {
  constructor(private readonly syllabus: SyllabusService) {}

  @Get()
  @ApiOperation({ summary: 'Every class and subject with how much syllabus is entered' })
  @RequirePermission(PLANNER.planView)
  async index(@ReqCtx() ctx: RequestContext) {
    return { data: await this.syllabus.index(ctx) };
  }

  @Get('tree')
  @ApiOperation({
    summary: 'Chapters and topics of a class and subject; with a section, what is done',
  })
  @RequirePermission(PLANNER.planView)
  tree(@ReqCtx() ctx: RequestContext, @Query() q: SyllabusTreeDto) {
    return this.syllabus.tree(ctx, q.classId, q.subjectId, q.classSectionId);
  }

  @Get('mine')
  @ApiOperation({ summary: 'The classes and subjects I teach, with their coverage' })
  @RequirePermission(PLANNER.planManage)
  async mine(@ReqCtx() ctx: RequestContext) {
    return { data: await this.syllabus.mine(ctx) };
  }

  @Get('coverage')
  @ApiOperation({ summary: 'Coverage by class, subject and teacher' })
  @RequirePermission('academics.syllabus.report', {
    description: 'See syllabus coverage of every class and teacher',
  })
  async coverage(@ReqCtx() ctx: RequestContext, @Query() q: CoverageQueryDto) {
    return { data: await this.syllabus.coverage(ctx, q) };
  }

  @Get('dashboard')
  @RequirePermission('academics.syllabus.report')
  dashboard(@ReqCtx() ctx: RequestContext, @Query() q: WeekQueryDto) {
    return this.syllabus.dashboard(ctx, q.week);
  }

  @Get('report')
  @ApiOperation({ summary: 'Coverage, topic-wise status or missing plans, as Excel or PDF' })
  @RequirePermission('academics.syllabus.report')
  async report(
    @ReqCtx() ctx: RequestContext,
    @Query() q: SyllabusReportDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const f = await this.syllabus.reportFile(ctx, q);
    if (q.wrap)
      return {
        filename: f.filename,
        contentType: f.contentType,
        base64: Buffer.from(f.bytes).toString('base64'),
      };
    reply
      .header('content-type', f.contentType)
      .header('content-disposition', `attachment; filename="${f.filename}"`);
    return reply.send(f.bytes);
  }

  @Get('template.xlsx')
  @RequirePermission('academics.syllabus.manage', {
    description: 'Keep the syllabus: chapters and topics of each class and subject',
  })
  async template(@ReqCtx() ctx: RequestContext, @Res() reply: FastifyReply) {
    const f = await this.syllabus.template(ctx);
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('content-disposition', `attachment; filename="${f.filename}"`)
      .send(f.bytes);
  }

  @Post('import')
  @HttpCode(200)
  @RequirePermission('academics.syllabus.manage')
  import(@ReqCtx() ctx: RequestContext, @Body() body: SyllabusImportDto) {
    return this.syllabus.import(ctx, body.fileBase64);
  }

  @Post('chapters')
  @HttpCode(200)
  @RequirePermission('academics.syllabus.manage')
  saveChapter(@ReqCtx() ctx: RequestContext, @Body() body: SaveChapterDto) {
    return this.syllabus.saveChapter(ctx, body);
  }

  @Delete('chapters/:id')
  @RequirePermission('academics.syllabus.manage')
  removeChapter(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.syllabus.removeChapter(ctx, id);
  }

  @Post('topics')
  @HttpCode(200)
  @RequirePermission('academics.syllabus.manage')
  saveTopic(@ReqCtx() ctx: RequestContext, @Body() body: SaveTopicDto) {
    return this.syllabus.saveTopic(ctx, body);
  }

  @Delete('topics/:id')
  @RequirePermission('academics.syllabus.manage')
  removeTopic(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.syllabus.removeTopic(ctx, id);
  }

  @Post('mark')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a topic done, partly done or not done for a section' })
  @RequirePermission(PLANNER.planManage)
  mark(@ReqCtx() ctx: RequestContext, @Body() body: MarkTopicDto) {
    return this.syllabus.mark(ctx, body);
  }
}

const LESSON_SETUP = 'academics.lesson_plan.setup';

@ApiTags('academics')
@ApiBearerAuth()
@Controller('academics/lessons')
export class LessonUploadsController {
  constructor(private readonly lessons: LessonUploadsService) {}

  @Get()
  @ApiOperation({
    summary: 'Lessons uploaded for approval: mine, those I approve, or all (the office)',
  })
  @RequirePermission(PLANNER.planView)
  async list(
    @ReqCtx() ctx: RequestContext,
    @Query() q: LessonListDto,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!q.format) return this.lessons.list(ctx, q);
    const f = await this.lessons.exportFile(ctx, q, q.format);
    if (q.wrap)
      return {
        filename: f.filename,
        contentType: f.contentType,
        base64: Buffer.from(f.bytes).toString('base64'),
      };
    reply
      .header('content-type', f.contentType)
      .header('content-disposition', `attachment; filename="${f.filename}"`);
    return reply.send(f.bytes);
  }

  @Get('options')
  @ApiOperation({ summary: 'The classes and sections I upload lessons for' })
  @RequirePermission(PLANNER.planManage)
  options(@ReqCtx() ctx: RequestContext) {
    return this.lessons.options(ctx);
  }

  @Get('dashboard')
  @RequirePermission(LESSON_SETUP, {
    description: 'Set who approves lessons (by employee, class or department) and see every lesson',
  })
  dashboard(@ReqCtx() ctx: RequestContext, @Query() q: LessonRangeDto) {
    return this.lessons.dashboard(ctx, q);
  }

  @Get('approvers')
  @RequirePermission(LESSON_SETUP)
  rules(@ReqCtx() ctx: RequestContext) {
    return this.lessons.rules(ctx);
  }

  @Post('approvers')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Who approves lessons of an employee, a class, a department, or by default',
  })
  @RequirePermission(LESSON_SETUP)
  saveRule(@ReqCtx() ctx: RequestContext, @Body() body: LessonRuleDto) {
    return this.lessons.saveRule(ctx, body);
  }

  @Delete('approvers/:id')
  @RequirePermission(LESSON_SETUP)
  removeRule(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.lessons.removeRule(ctx, id);
  }

  @Post()
  @ApiOperation({
    summary: 'Upload a lesson: it goes to the approvers set for me, my class or department',
  })
  @RequirePermission(PLANNER.planManage)
  create(@ReqCtx() ctx: RequestContext, @Body() body: LessonUploadDto) {
    return this.lessons.create(ctx, body);
  }

  @Get(':id')
  @RequirePermission(PLANNER.planView)
  get(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.lessons.get(ctx, id);
  }

  @Get(':id/files/:fileId')
  @RequirePermission(PLANNER.planView)
  file(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Param('fileId') fileId: string) {
    return this.lessons.fileUrl(ctx, id, fileId);
  }

  @Post(':id/decide')
  @HttpCode(200)
  @ApiOperation({ summary: 'Acknowledge the lesson at my level, or reject it with a remark' })
  @RequirePermission(PLANNER.planView)
  decide(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: LessonDecideDto) {
    return this.lessons.decide(ctx, id, body);
  }

  @Delete(':id')
  @RequirePermission(PLANNER.planView)
  remove(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.lessons.remove(ctx, id);
  }
}
