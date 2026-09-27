import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { LessonPlansService } from './lesson-plans.service';
import {
  CreateLessonPlanDto,
  CreateSubstitutionDto,
  FreeTeachersQueryDto,
  ListLessonPlansDto,
  PLANNER,
  SubstitutionQueryDto,
  UpdateLessonPlanDto,
} from './planner.dto';
import { SubstitutionsService } from './substitutions.service';

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
