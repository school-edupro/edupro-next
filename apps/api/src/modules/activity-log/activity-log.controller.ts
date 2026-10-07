import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import {
  ACTIVITY,
  ActivityReportDto,
  ActivitySettingsDto,
  CategoryDto,
  DateQueryDto,
  DayQueryDto,
  RangeQueryDto,
  ReviewDto,
  SaveLogDto,
} from './activity-log.dto';
import { ActivityLogService } from './activity-log.service';

@ApiTags('staff')
@ApiBearerAuth()
@Controller('staff/activity')
export class ActivityLogController {
  constructor(private readonly logs: ActivityLogService) {}

  @Get('mine')
  @ApiOperation({ summary: 'My activity log of a day, with what the timetable already knows' })
  @RequirePermission(ACTIVITY.fill, { description: 'Write my daily activity log' })
  mine(@ReqCtx() ctx: RequestContext, @Query() q: DateQueryDto) {
    return this.logs.mine(ctx, q.date);
  }

  @Put('mine')
  @ApiOperation({ summary: 'Save my day as a draft, or submit it' })
  @RequirePermission(ACTIVITY.fill)
  save(@ReqCtx() ctx: RequestContext, @Body() body: SaveLogDto) {
    return this.logs.save(ctx, body);
  }

  @Get('setup')
  @RequirePermission(ACTIVITY.fill)
  setup(@ReqCtx() ctx: RequestContext) {
    return this.logs.setup(ctx);
  }

  @Put('setup')
  @ApiOperation({ summary: 'The cut-off time and how many days back a log may be filled' })
  @RequirePermission(ACTIVITY.setup, {
    description: 'Set the activity categories and the rules of the daily log',
  })
  saveSettings(@ReqCtx() ctx: RequestContext, @Body() body: ActivitySettingsDto) {
    return this.logs.saveSettings(ctx, body);
  }

  @Post('categories')
  @HttpCode(200)
  @RequirePermission(ACTIVITY.setup)
  saveCategory(@ReqCtx() ctx: RequestContext, @Body() body: CategoryDto) {
    return this.logs.saveCategory(ctx, body);
  }

  @Get('day')
  @ApiOperation({ summary: 'Every employee on a day: submitted, late, sent back or not filled' })
  @RequirePermission(ACTIVITY.review, {
    description: 'See and review the daily activity logs of employees',
  })
  day(@ReqCtx() ctx: RequestContext, @Query() q: DayQueryDto) {
    return this.logs.day(ctx, q);
  }

  @Get('dashboard')
  @RequirePermission(ACTIVITY.review)
  dashboard(@ReqCtx() ctx: RequestContext, @Query() q: RangeQueryDto) {
    return this.logs.dashboard(ctx, q);
  }

  @Get('compliance')
  @RequirePermission(ACTIVITY.review)
  compliance(@ReqCtx() ctx: RequestContext, @Query() q: RangeQueryDto) {
    return this.logs.compliance(ctx, q);
  }

  @Get('report')
  @ApiOperation({ summary: 'Compliance, time by category, an employee or a day, as Excel or PDF' })
  @RequirePermission(ACTIVITY.review)
  async report(
    @ReqCtx() ctx: RequestContext,
    @Query() q: ActivityReportDto,
    @Res() reply: FastifyReply,
  ) {
    const f = await this.logs.reportFile(ctx, q);
    reply
      .header('content-type', f.contentType)
      .header('content-disposition', `attachment; filename="${f.filename}"`)
      .send(f.bytes);
  }

  @Get('logs/:id')
  @ApiOperation({ summary: 'One log in full (my own, or any for a reviewer)' })
  @RequirePermission(ACTIVITY.fill)
  detail(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.logs.detail(ctx, id);
  }

  @Post('logs/:id/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mark a submitted log reviewed, or send it back with a remark' })
  @RequirePermission(ACTIVITY.review)
  review(@ReqCtx() ctx: RequestContext, @Param('id') id: string, @Body() body: ReviewDto) {
    return this.logs.review(ctx, id, body);
  }
}
