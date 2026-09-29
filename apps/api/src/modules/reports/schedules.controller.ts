import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePermission } from '../../common/access/require-permission.decorator';
import { ReqCtx, type RequestContext } from '../../common/http/request-context';
import { SCHEDULES, ScheduleDto, ScheduleStatusDto, SchedulesService } from './schedules.service';

/** Sprint 19: scheduled reports. */
@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports/schedules')
export class SchedulesController {
  constructor(private readonly schedules: SchedulesService) {}

  @Get()
  @RequirePermission(SCHEDULES.manage, { description: 'Create and run scheduled reports' })
  async list(@ReqCtx() ctx: RequestContext) {
    return { data: await this.schedules.list(ctx) };
  }

  @Post()
  @RequirePermission(SCHEDULES.manage)
  create(@ReqCtx() ctx: RequestContext, @Body() body: ScheduleDto) {
    return this.schedules.create(ctx, body);
  }

  @Put(':id/status')
  @RequirePermission(SCHEDULES.manage)
  async status(
    @ReqCtx() ctx: RequestContext,
    @Param('id') id: string,
    @Body() body: ScheduleStatusDto,
  ) {
    await this.schedules.setStatus(ctx, id, body);
    return { ok: true };
  }

  @Post(':id/run')
  @ApiOperation({ summary: 'Run the schedule now (an export as the caller)' })
  @RequirePermission(SCHEDULES.manage)
  run(@ReqCtx() ctx: RequestContext, @Param('id') id: string) {
    return this.schedules.runNow(ctx, id);
  }
}
